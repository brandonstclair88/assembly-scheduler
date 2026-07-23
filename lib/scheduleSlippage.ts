import { AppData, ProjectAssembly, ScheduledItem } from './types';
import { capacityForDate } from './scheduler';

// --- "Behind Schedule" detection and push-forward planning ---
//
// The Weekly Board's Live Forecast mode already re-flows leftover hours into
// open capacity when an assembly's Build % is lower than the original plan
// assumed - but only when you're looking at it, and it never saves anything.
// Nothing previously compared "today's date" against the plan on its own, so
// a tile that quietly falls behind (percent not updated, or updated but still
// short) never pushed anything downstream until a person noticed and dragged
// it manually.
//
// This module adds that missing comparison as an explicit, reviewable
// preview/apply flow (same shape as Smart Assign): previewScheduleSlippage
// finds assemblies where today has passed further into the Build window than
// the entered percent supports, and computes what pushing the remaining
// hours forward (starting today, into real open capacity) would look like.
// applyScheduleSlippageToData writes the accepted suggestions the same way a
// manual drag does - manualWorkSegments/manuallyScheduled for Build, direct
// manualStartDate fields for Finalizing/Shipping, and a parent top-level
// push when a sub assembly slips - so nothing here bypasses the normal
// scheduling rules.

export type SlippageSuggestion = {
  id: string;
  assemblyId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  partNumber: string;
  description: string;
  employeeIds: string[];
  employeeNames: string;
  shipDate: string;
  originalBuildEnd: string;
  expectedPercent: number;
  actualPercent: number;
  remainingHours: number;
  newBuildSegments: { id: string; employeeId: string; date: string; hours: number; phase: 'Build' }[];
  newBuildEnd: string;
  newFinalizingStart?: string;
  newShippingStart?: string;
  estimatedCompletion: string;
  daysSlipped: number;
  willBeLate: boolean;
  parentAssemblyId?: string;
  reason: string;
};

export type SlippageApplyItem = SlippageSuggestion & {
  applyStatus: 'applied' | 'skipped' | 'failed';
  applyReason: string;
};

export type SlippageApplyResult = {
  data: AppData;
  applied: SlippageApplyItem[];
  skipped: SlippageApplyItem[];
  failed: SlippageApplyItem[];
};

const MS_DAY = 86400000;

function splitIds(value: string) {
  return (value || '').split(/[\n,;\s]+/).map(x => x.trim()).filter(Boolean);
}

function dateOnly(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string) {
  const base = (value || '').slice(0, 10);
  const d = base ? new Date(base + 'T00:00:00') : new Date();
  return isNaN(+d) ? new Date() : d;
}

function nextDate(value: string) {
  return dateOnly(new Date(+parseDate(value) + MS_DAY));
}

function isBusinessDay(data: AppData, date: string) {
  const d = parseDate(date);
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  if ((data.holidays || []).some(h => h.date === date)) return false;
  return true;
}

function nextBusinessDay(data: AppData, date: string) {
  let cursor = nextDate(date);
  let guard = 0;
  while (!isBusinessDay(data, cursor) && guard++ < 400) cursor = nextDate(cursor);
  return cursor;
}

function projectLabel(project: any) {
  if (!project) return 'Project';
  if (project.projectId && project.name) return `${project.projectId} — ${project.name}`;
  return project.projectId || project.name || 'Project';
}

function taskHours(assembly: ProjectAssembly) {
  return Math.max(0, Number(assembly?.qty || 1) * Number(assembly?.hoursEach || 0));
}

// How much of the Build window's available capacity has already elapsed by
// today, weighted by each assigned employee's actual daily capacity (so
// weekends, holidays, time off, and custom schedules all count correctly
// instead of a flat calendar-day ratio).
function expectedPercentByToday(
  data: AppData,
  build: ScheduledItem,
  assigneeIds: string[],
  today: string
): number {
  if (!build) return 0;
  if (today >= build.scheduledEnd) return 100;
  if (today < build.scheduledStart) return 0;
  const ids = assigneeIds.length ? assigneeIds : [''];
  let planned = 0;
  let elapsed = 0;
  for (const empId of ids) {
    let cursor = build.scheduledStart;
    let guard = 0;
    while (cursor <= build.scheduledEnd && guard++ < 400) {
      const cap = capacityForDate(data, empId, cursor);
      planned += cap;
      if (cursor <= today) elapsed += cap;
      cursor = nextDate(cursor);
    }
  }
  if (planned <= 0) return 100;
  return Math.min(100, (elapsed / planned) * 100);
}

// Builds a per-employee-per-day "already committed" map from the full
// current schedule, so pushed-forward hours land in genuinely open capacity
// instead of piling onto a day another assembly already occupies. The
// assembly being pushed is excluded since its own placement is what we're
// replacing.
function buildUsedCapacityMap(data: AppData, schedule: ScheduledItem[], excludeAssemblyId: string) {
  const used: Record<string, number> = {};
  for (const item of schedule) {
    const sourceId = item.sourceAssemblyId || String(item.id).split('|')[0];
    if (sourceId === excludeAssemblyId) continue;
    const assembly: any = (data.projectAssemblies || []).find(a => a.id === sourceId);
    const manualSegments = (item.phase === 'Build' || !item.phase) && Array.isArray(assembly?.manualWorkSegments)
      ? assembly.manualWorkSegments.filter((seg: any) => (seg.phase || 'Build') === 'Build' && Number(seg.hours) > 0)
      : [];
    if (manualSegments.length) {
      for (const seg of manualSegments) {
        const key = `${seg.employeeId || ''}|${seg.date}`;
        used[key] = (used[key] || 0) + (Number(seg.hours) || 0);
      }
      continue;
    }
    const assignees = splitIds(item.assignedTo || '');
    const ids = assignees.length ? assignees : [''];
    let cursor = item.scheduledStart;
    let remaining = Number(item.hoursPerEmployee) || 0;
    let guard = 0;
    while (remaining > 0.01 && guard++ < 400) {
      for (const empId of ids) {
        const key = `${empId}|${cursor}`;
        const cap = Math.max(0, capacityForDate(data, empId, cursor) - (used[key] || 0));
        if (cap > 0) {
          const hrs = Math.min(remaining, cap);
          used[key] = (used[key] || 0) + hrs;
        }
      }
      cursor = nextDate(cursor);
    }
  }
  return used;
}

function placeRemainingHours(
  data: AppData,
  used: Record<string, number>,
  assemblyId: string,
  employeeIds: string[],
  startFrom: string,
  totalRemainingHours: number
) {
  const segments: { id: string; employeeId: string; date: string; hours: number; phase: 'Build' }[] = [];
  const ids = employeeIds.length ? employeeIds : [''];
  const hoursPerEmployee = totalRemainingHours / ids.length;
  let latestEnd = startFrom;
  let idx = 0;
  for (const empId of ids) {
    let remaining = hoursPerEmployee;
    let cursor = startFrom;
    let guard = 0;
    while (remaining > 0.01 && guard++ < 400) {
      const key = `${empId}|${cursor}`;
      const cap = Math.max(0, capacityForDate(data, empId, cursor) - (used[key] || 0));
      if (cap > 0) {
        const hrs = Math.min(remaining, cap);
        segments.push({ id: `slip-${assemblyId}-${idx++}`, employeeId: empId, date: cursor, hours: hrs, phase: 'Build' });
        used[key] = (used[key] || 0) + hrs;
        remaining -= hrs;
        latestEnd = cursor;
      }
      cursor = nextDate(cursor);
    }
  }
  return { segments, end: latestEnd };
}

// Rough estimate of when finalizing/shipping would realistically start after
// a pushed build finish - advances past the test wait (if any) to the next
// shop business day. This mirrors the shape of scheduler.ts's own test-gate
// handling closely enough to give a sane manual start date for the operator
// to review, without duplicating its full backward-planning logic.
function estimateReleaseAfterBuild(data: AppData, assembly: ProjectAssembly, buildEnd: string) {
  const testHours = Number((assembly as any).testHours || 0);
  const hasTest = !!(assembly as any).testRequired || testHours > 0;
  if (!hasTest) return buildEnd;
  const manualReturn = (assembly as any).testReturnDateTime ? String((assembly as any).testReturnDateTime).slice(0, 10) : '';
  if (manualReturn) return manualReturn > buildEnd ? manualReturn : nextBusinessDay(data, buildEnd);
  // Estimate the return date by walking forward roughly testHours/dailyHours business days.
  const perDay = 10;
  let daysNeeded = Math.max(1, Math.ceil(testHours / perDay));
  let cursor = buildEnd;
  while (daysNeeded > 0) {
    cursor = nextBusinessDay(data, cursor);
    daysNeeded--;
  }
  return cursor;
}

function estimatePhaseEnd(data: AppData, start: string, hours: number) {
  if (hours <= 0) return start;
  const perDay = 10;
  let daysNeeded = Math.max(1, Math.ceil(hours / perDay));
  let cursor = start;
  while (daysNeeded > 1) {
    cursor = nextBusinessDay(data, cursor);
    daysNeeded--;
  }
  return cursor;
}

function calendarDaysBetween(a: string, b: string) {
  return Math.round((+parseDate(b) - +parseDate(a)) / MS_DAY);
}

export function previewScheduleSlippage(
  data: AppData,
  schedule: ScheduledItem[],
  today: string,
  toleranceMargin = 2
): SlippageSuggestion[] {
  const projects = Object.fromEntries((data.projects || []).map(p => [p.id, p]));
  const employees = Object.fromEntries((data.employees || []).map(e => [e.id, e]));
  const assemblies = (data.projectAssemblies || data.assemblies || []) as ProjectAssembly[];
  const suggestions: SlippageSuggestion[] = [];

  for (const assembly of assemblies) {
    if (assembly.status === 'On Hold' || String(assembly.holdReason || '').trim()) continue;
    if (assembly.locked || (assembly as any).smartAssignProtected) continue;
    if (taskHours(assembly) <= 0) continue;
    if (assembly.status === 'Complete' || Number(assembly.percent || 0) >= 100) continue;

    const build = schedule.find(s => (s.sourceAssemblyId || String(s.id).split('|')[0]) === assembly.id && (s.phase || 'Build') === 'Build');
    if (!build) continue;
    if (today < build.scheduledStart) continue; // hasn't even started yet - not behind

    const assigneeIds = splitIds(build.assignedTo || '');
    const expectedPercent = expectedPercentByToday(data, build, assigneeIds, today);
    const actualPercent = Number(assembly.percent || 0);
    if (actualPercent >= expectedPercent - toleranceMargin) continue; // on pace or ahead

    const remainingHours = taskHours(assembly) * (1 - actualPercent / 100);
    if (remainingHours <= 0.01) continue;

    const used = buildUsedCapacityMap(data, schedule, assembly.id);
    const { segments, end } = placeRemainingHours(data, used, assembly.id, assigneeIds, today, remainingHours);
    if (!segments.length) continue;

    let estimatedCompletion = end;
    let newFinalizingStart: string | undefined;
    let newShippingStart: string | undefined;
    if (assembly.finalizingRequired) {
      const release = estimateReleaseAfterBuild(data, assembly, end);
      newFinalizingStart = nextBusinessDay(data, release) < release ? release : release;
      estimatedCompletion = estimatePhaseEnd(data, newFinalizingStart, Number(assembly.finalizingHours || 0));
    }
    if (assembly.shippingRequired) {
      const shipStartFrom = newFinalizingStart ? estimatedCompletion : estimateReleaseAfterBuild(data, assembly, end);
      newShippingStart = nextBusinessDay(data, shipStartFrom) < shipStartFrom ? shipStartFrom : shipStartFrom;
      estimatedCompletion = estimatePhaseEnd(data, newShippingStart, Number(assembly.shippingHours || 0));
    }

    const project = projects[assembly.projectId];
    const shipDate = assembly.shipDate || project?.dueDate || '';
    const willBeLate = !!(shipDate && estimatedCompletion > shipDate && !assembly.lateAllowed);
    const daysSlipped = calendarDaysBetween(build.scheduledEnd, end);
    const employeeNames = (assigneeIds.length ? assigneeIds : []).map(id => employees[id]?.name || id).join(', ') || 'Unassigned';

    const parent = assembly.type === 'Sub Assembly'
      ? (assembly.parentAssemblyId
        ? assemblies.find(a => a.id === assembly.parentAssemblyId)
        : assemblies.find(a => a.type === 'Top Level Assembly' && a.buildGroupId && a.buildGroupId === assembly.buildGroupId && a.projectId === assembly.projectId))
      : undefined;

    suggestions.push({
      id: `slip-${assembly.id}`,
      assemblyId: assembly.id,
      projectId: assembly.projectId,
      projectName: projectLabel(project),
      projectCode: project?.projectId || project?.name || '',
      partNumber: assembly.partNumber,
      description: assembly.description,
      employeeIds: assigneeIds,
      employeeNames,
      shipDate,
      originalBuildEnd: build.scheduledEnd,
      expectedPercent,
      actualPercent,
      remainingHours,
      newBuildSegments: segments,
      newBuildEnd: end,
      newFinalizingStart,
      newShippingStart,
      estimatedCompletion,
      daysSlipped: Math.max(0, daysSlipped),
      willBeLate,
      parentAssemblyId: parent?.id,
      reason: `Expected about ${Math.round(expectedPercent)}% complete by today based on the plan, but only ${Math.round(actualPercent)}% is marked done. Pushing the remaining ${remainingHours.toFixed(1)} hrs forward moves the build finish from ${build.scheduledEnd} to ${end}${daysSlipped > 0 ? ` (${daysSlipped} day${daysSlipped === 1 ? '' : 's'} later)` : ''}${willBeLate ? ', which lands after the ship date' : ''}.`,
    });
  }

  return suggestions;
}

export function applyScheduleSlippageToData(
  data: AppData,
  selectedIds: string[],
  suggestions: SlippageSuggestion[]
): SlippageApplyResult {
  const chosen = new Set(selectedIds);
  const bySuggestionId = Object.fromEntries(suggestions.map(s => [s.id, s]));
  let rows = [...(data.projectAssemblies || [])];
  const applied: SlippageApplyItem[] = [];
  const skipped: SlippageApplyItem[] = [];
  const failed: SlippageApplyItem[] = [];

  for (const id of selectedIds) {
    const suggestion = bySuggestionId[id];
    if (!suggestion) continue;
    if (!chosen.has(id)) continue;
    const current = rows.find(a => a.id === suggestion.assemblyId);
    if (!current) {
      failed.push({ ...suggestion, applyStatus: 'failed', applyReason: 'Assembly no longer exists.' });
      continue;
    }
    if (current.status === 'On Hold' || String(current.holdReason || '').trim() || current.locked) {
      skipped.push({ ...suggestion, applyStatus: 'skipped', applyReason: 'Assembly is now locked or on hold.' });
      continue;
    }
    if (Number(current.percent || 0) >= 100) {
      skipped.push({ ...suggestion, applyStatus: 'skipped', applyReason: 'Build was already marked complete.' });
      continue;
    }

    rows = rows.map(a => {
      if (a.id !== suggestion.assemblyId) return a;
      const patch: any = { manualWorkSegments: suggestion.newBuildSegments, manuallyScheduled: true };
      if (suggestion.newFinalizingStart) patch.finalizingManualStartDate = suggestion.newFinalizingStart;
      if (suggestion.newShippingStart) patch.shippingManualStartDate = suggestion.newShippingStart;
      return { ...a, ...patch };
    });

    // A sub assembly slipping can push its parent top-level assembly's start,
    // the same way manually dragging a build chunk does.
    if (suggestion.parentAssemblyId) {
      rows = rows.map(a => {
        if (a.id !== suggestion.parentAssemblyId) return a;
        const currentParentStart = a.manualStartDate || a.shipDate || '';
        if (!currentParentStart || suggestion.newBuildEnd > currentParentStart) {
          return { ...a, manualStartDate: suggestion.newBuildEnd, manuallyScheduled: true };
        }
        return a;
      });
    }

    applied.push({ ...suggestion, applyStatus: 'applied', applyReason: `Build pushed to finish ${suggestion.newBuildEnd}.` });
  }

  return {
    data: { ...data, projectAssemblies: rows },
    applied,
    skipped,
    failed,
  };
}
