import { AppData, ProjectAssembly, ScheduledItem } from './types';
import { buildSchedule, capacityForDate } from './scheduler';
import { canEmployeeBuild, canEmployeeFinalize, canEmployeeShip } from './employeeRoles';

export type SmartAssignPhase = 'Build' | 'Finalizing' | 'Shipping';
export type SmartAssignDiagnostic =
  | 'smart_assign_available'
  | 'no_preferred_employee_available'
  | 'no_qualified_builder_available'
  | 'no_qualified_finalizer_available'
  | 'no_qualified_shipper_available'
  | 'employee_unavailable'
  | 'over_capacity_smart_assign'
  | 'assigned_to_non_preferred_employee'
  | 'skipped_locked'
  | 'already_good';

export type SmartAssignSuggestionStatus = 'suggested' | 'blocked' | 'kept' | 'locked';

export type SmartAssignOptions = {
  assignBlanksOnly?: boolean;
  improveExistingUnlockedAssignments?: boolean;
  balanceThisWeek?: boolean;
  prioritizeShipDates?: boolean;
  reduceOverloads?: boolean;
};

export type SmartAssignSuggestion = {
  id: string;
  assemblyId: string;
  projectId: string;
  projectName: string;
  projectCode: string;
  partNumber: string;
  description: string;
  phase: SmartAssignPhase;
  date: string;
  shipDate: string;
  currentEmployeeId?: string;
  currentEmployeeName?: string;
  employeeId?: string;
  employeeName?: string;
  reason: string;
  diagnostic: SmartAssignDiagnostic;
  status: SmartAssignSuggestionStatus;
  changeType: 'assign' | 'reassign' | 'keep' | 'skip';
  preferredMatch?: boolean;
  nonPreferredButNecessary?: boolean;
  score?: number;
  overloadResolved?: boolean;
};

export type SmartAssignApplyItem = SmartAssignSuggestion & {
  applyStatus: 'applied' | 'skipped' | 'failed';
  applyReason: string;
};

export type SmartAssignApplyResult = {
  data: AppData;
  applied: SmartAssignApplyItem[];
  skipped: SmartAssignApplyItem[];
  failed: SmartAssignApplyItem[];
  appliedKeys: string[];
};

type WorkChunk = {
  date: string;
  hours: number;
  employeeId: string;
  sourceAssemblyId: string;
  phase: SmartAssignPhase;
};

type TaskCandidate = {
  assembly: ProjectAssembly;
  item: ScheduledItem;
  phase: SmartAssignPhase;
  chunks: WorkChunk[];
  project: any;
  shipDate: string;
  currentIds: string[];
  protected: boolean;
  urgentScore: number;
};

const MS_DAY = 86400000;

function splitIds(value: string) {
  return (value || '').split(/[\n,;\s]+/).map(x => x.trim()).filter(Boolean);
}

function dateOnly(value: Date) {
  return `${value.getFullYear()}-${String(value.getMonth() + 1).padStart(2, '0')}-${String(value.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string) {
  const base = (value || '').slice(0, 10);
  const date = base ? new Date(`${base}T00:00:00`) : new Date();
  return isNaN(+date) ? new Date() : date;
}

function nextDate(value: string) {
  return dateOnly(new Date(+parseDate(value) + MS_DAY));
}

function mondayOfValue(value: string) {
  const date = parseDate(value);
  const day = date.getDay() || 7;
  date.setDate(date.getDate() - day + 1);
  return dateOnly(date);
}

function taskHours(assembly: ProjectAssembly) {
  return Math.max(0, Number(assembly?.qty || 1) * Number(assembly?.hoursEach || 0));
}

function shippingExpected(assembly: ProjectAssembly) {
  return !!assembly.shippingRequired || (!!assembly.shipDate && (assembly.type === 'Top Level Assembly' || (assembly.type === 'Sub Assembly' && !assembly.parentAssemblyId && !assembly.buildGroupId)));
}

function projectLabel(project: any) {
  if (!project) return 'Project';
  if (project.projectId && project.name) return `${project.projectId} — ${project.name}`;
  return project.projectId || project.name || 'Project';
}

function phaseRoleKey(phase: SmartAssignPhase) {
  if (phase === 'Finalizing') return 'finalizer';
  if (phase === 'Shipping') return 'shipper';
  return 'builder';
}

function phaseOrder(phase: SmartAssignPhase) {
  if (phase === 'Shipping') return 0;
  if (phase === 'Finalizing') return 1;
  return 2;
}

function phaseAssignmentIds(assembly: ProjectAssembly, phase: SmartAssignPhase) {
  const raw = phase === 'Finalizing'
    ? (assembly.finalizingAssignedTo || assembly.assignedTo)
    : phase === 'Shipping'
      ? (assembly.shippingAssignedTo || assembly.assignedTo)
      : assembly.assignedTo;
  return splitIds(raw || '');
}

function needsWork(assembly: ProjectAssembly, item: ScheduledItem | undefined, phase: SmartAssignPhase) {
  if (!item) return false;
  if (assembly.status === 'On Hold' || String(assembly.holdReason || '').trim()) return false;
  if (phase === 'Build') return taskHours(assembly) > 0 && assembly.status !== 'Complete' && Number(assembly.percent || 0) < 100;
  if (phase === 'Finalizing') return !!assembly.finalizingRequired && !assembly.finalizingComplete;
  return shippingExpected(assembly) && !assembly.shippingComplete;
}

function buildScheduleChunks(data: AppData, schedule: ScheduledItem[]) {
  const assemblies = Object.fromEntries((data.projectAssemblies || []).map(assembly => [assembly.id, assembly]));
  const chunks: WorkChunk[] = [];
  for (const item of schedule) {
    const sourceId = item.sourceAssemblyId || String(item.id).split('|')[0];
    const assembly: any = assemblies[sourceId];
    const phase = (item.phase || 'Build') as SmartAssignPhase;
    const manualSegments = phase === 'Build' && Array.isArray(assembly?.manualWorkSegments)
      ? assembly.manualWorkSegments.filter((segment: any) => (segment.phase || 'Build') === 'Build' && Number(segment.hours) > 0)
      : [];
    if (manualSegments.length) {
      manualSegments.forEach((segment: any) => {
        chunks.push({
          date: segment.date,
          hours: Number(segment.hours) || 0,
          employeeId: segment.employeeId || '',
          sourceAssemblyId: sourceId,
          phase,
        });
      });
      continue;
    }
    const assignees = splitIds(item.assignedTo || '');
    if (!assignees.length) {
      let date = item.scheduledStart;
      let remaining = Number(item.hoursPerEmployee) || Number(item.totalHours) || 0;
      let guard = 0;
      while (remaining > 0.01 && guard < 180) {
        const cap = capacityForDate(data, '', date);
        if (cap > 0) {
          const hours = Math.min(remaining, cap);
          chunks.push({ date, hours, employeeId: '', sourceAssemblyId: sourceId, phase });
          remaining -= hours;
        }
        date = nextDate(date);
        guard++;
      }
      continue;
    }
    for (const employeeId of assignees) {
      let date = item.scheduledStart;
      let remaining = Number(item.hoursPerEmployee) || 0;
      let guard = 0;
      while (remaining > 0.01 && guard < 180) {
        const cap = capacityForDate(data, employeeId, date);
        if (cap > 0) {
          const hours = Math.min(remaining, cap);
          chunks.push({ date, hours, employeeId, sourceAssemblyId: sourceId, phase });
          remaining -= hours;
        }
        date = nextDate(date);
        guard++;
      }
    }
  }
  return chunks;
}

function chunkPlanForItem(data: AppData, item: ScheduledItem, assembly: ProjectAssembly) {
  const phase = (item.phase || 'Build') as SmartAssignPhase;
  const manualSegments = phase === 'Build' && Array.isArray((assembly as any)?.manualWorkSegments) && (assembly as any).manualWorkSegments.length
    ? (assembly as any).manualWorkSegments.filter((segment: any) => (segment.phase || 'Build') === 'Build' && Number(segment.hours) > 0)
    : [];
  if (manualSegments.length) {
    return manualSegments.map((segment: any) => ({
      date: segment.date,
      hours: Number(segment.hours) || 0,
      employeeId: segment.employeeId || '',
      sourceAssemblyId: assembly.id,
      phase,
    }));
  }
  const chunks: WorkChunk[] = [];
  let date = item.scheduledStart;
  let remaining = Number(item.hoursPerEmployee) || Number(item.totalHours) || 0;
  let guard = 0;
  while (remaining > 0.01 && guard < 180) {
    const cap = capacityForDate(data, '', date);
    if (cap > 0) {
      const hours = Math.min(remaining, cap);
      chunks.push({ date, hours, employeeId: '', sourceAssemblyId: assembly.id, phase });
      remaining -= hours;
    }
    date = nextDate(date);
    guard++;
  }
  return chunks;
}

function cloneManualSegments(assembly: ProjectAssembly) {
  return Array.isArray(assembly?.manualWorkSegments)
    ? assembly.manualWorkSegments.map(segment => ({ ...segment }))
    : [];
}

function buildSuggestionFallback(id: string, phase: SmartAssignPhase = 'Build'): SmartAssignSuggestion {
  return {
    id,
    assemblyId: '',
    projectId: '',
    projectName: 'Project',
    projectCode: 'Project',
    partNumber: '—',
    description: 'Unknown item',
    phase,
    date: '',
    shipDate: '',
    reason: '',
    diagnostic: 'already_good',
    status: 'blocked',
    changeType: 'skip',
  };
}

function phaseQualified(employee: any, phase: SmartAssignPhase) {
  if (phase === 'Finalizing') return canEmployeeFinalize(employee);
  if (phase === 'Shipping') return canEmployeeShip(employee);
  return canEmployeeBuild(employee);
}

function usageKey(employeeId: string, date: string) {
  return `${employeeId}|${date}`;
}

function firstChunkDate(chunks: WorkChunk[]) {
  return chunks.map(chunk => chunk.date).filter(Boolean).sort()[0] || '';
}

function hoursForPhase(assembly: ProjectAssembly, phase: SmartAssignPhase) {
  if (phase === 'Finalizing') return Math.max(0, Number(assembly.finalizingHours || 0));
  if (phase === 'Shipping') return Math.max(0, Number(assembly.shippingHours || 0));
  return taskHours(assembly);
}

function buildChunkMap(chunks: WorkChunk[]) {
  const byKey = new Map<string, WorkChunk[]>();
  for (const chunk of chunks) {
    const key = `${chunk.sourceAssemblyId}|${chunk.phase}`;
    const group = byKey.get(key) || [];
    group.push(chunk);
    byKey.set(key, group);
  }
  return byKey;
}

function buildUsageMap(chunks: WorkChunk[]) {
  const usage = new Map<string, number>();
  for (const chunk of chunks) {
    if (!chunk.employeeId) continue;
    const key = usageKey(chunk.employeeId, chunk.date);
    usage.set(key, (usage.get(key) || 0) + Number(chunk.hours || 0));
  }
  return usage;
}

function chunksFitEmployee(data: AppData, chunks: WorkChunk[], usage: Map<string, number>, employeeId: string) {
  if (!employeeId) return false;
  for (const chunk of chunks) {
    const cap = capacityForDate(data, employeeId, chunk.date);
    if (cap <= 0) return false;
    const existing = usage.get(usageKey(employeeId, chunk.date)) || 0;
    const ownHours = chunk.employeeId === employeeId ? Number(chunk.hours || 0) : 0;
    if (Math.max(0, existing - ownHours) + Number(chunk.hours || 0) > cap + 0.01) return false;
  }
  return true;
}

function sameBuildSegments(existing: any[], nextSegments: any[]) {
  const left = (existing || [])
    .filter(segment => (segment.phase || 'Build') === 'Build')
    .map(segment => ({ employeeId: segment.employeeId || '', date: segment.date || '', hours: Number(segment.hours || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId) || a.hours - b.hours);
  const right = (nextSegments || [])
    .filter(segment => (segment.phase || 'Build') === 'Build')
    .map(segment => ({ employeeId: segment.employeeId || '', date: segment.date || '', hours: Number(segment.hours || 0) }))
    .sort((a, b) => a.date.localeCompare(b.date) || a.employeeId.localeCompare(b.employeeId) || a.hours - b.hours);
  return JSON.stringify(left) === JSON.stringify(right);
}

function applyItem(suggestion: SmartAssignSuggestion, reason: string, applyStatus: 'applied' | 'skipped' | 'failed'): SmartAssignApplyItem {
  return { ...suggestion, applyReason: reason, applyStatus };
}

export function applySmartAssignSuggestionsToData(
  data: AppData,
  selectionIds: string[],
  suggestionsInput?: SmartAssignSuggestion[],
  scheduleInput?: ScheduledItem[]
) {
  const schedule = scheduleInput || buildSchedule(data);
  const suggestions = suggestionsInput || previewSmartAssignSuggestions(data, schedule);
  const suggestionsById = new Map(suggestions.map(suggestion => [suggestion.id, suggestion]));
  const chunks = buildScheduleChunks(data, schedule);
  const chunkMap = buildChunkMap(chunks);
  const usage = buildUsageMap(chunks);
  const employeesById = Object.fromEntries((data.employees || []).map(employee => [employee.id, employee]));
  const nextAssemblies = (data.projectAssemblies || []).map(assembly => ({
    ...assembly,
    manualWorkSegments: cloneManualSegments(assembly),
  }));
  const assemblyIndexById = new Map(nextAssemblies.map((assembly, index) => [assembly.id, index]));
  const applied: SmartAssignApplyItem[] = [];
  const skipped: SmartAssignApplyItem[] = [];
  const failed: SmartAssignApplyItem[] = [];
  const appliedKeys: string[] = [];

  for (const selectionId of selectionIds || []) {
    const suggestion = suggestionsById.get(selectionId) || buildSuggestionFallback(selectionId);

    if (!suggestion.assemblyId) {
      failed.push(applyItem(suggestion, 'Missing target id.', 'failed'));
      continue;
    }
    if (!suggestion.phase) {
      failed.push(applyItem(suggestion, 'Missing target phase.', 'failed'));
      continue;
    }
    if (!suggestion.employeeId) {
      failed.push(applyItem(suggestion, 'No employee selected.', 'failed'));
      continue;
    }

    const assemblyIndex = assemblyIndexById.get(suggestion.assemblyId);
    if (assemblyIndex === undefined) {
      failed.push(applyItem(suggestion, 'Item no longer exists.', 'failed'));
      continue;
    }

    const currentAssembly = nextAssemblies[assemblyIndex];
    if (!['Build', 'Finalizing', 'Shipping'].includes(suggestion.phase)) {
      failed.push(applyItem(suggestion, 'Missing target id or unsupported phase.', 'failed'));
      continue;
    }
    if (currentAssembly.locked) {
      skipped.push(applyItem(suggestion, 'Skipped because the tile is locked.', 'skipped'));
      continue;
    }
    if (currentAssembly.smartAssignProtected || currentAssembly.manuallyScheduled) {
      skipped.push(applyItem(suggestion, 'Skipped because the work is manual-protected.', 'skipped'));
      continue;
    }
    if (suggestion.status !== 'suggested') {
      skipped.push(applyItem(suggestion, suggestion.reason || 'Suggestion is stale.', 'skipped'));
      continue;
    }

    const employee: any = employeesById[suggestion.employeeId];
    if (!employee || employee.active === false || !phaseQualified(employee, suggestion.phase)) {
      skipped.push(applyItem(suggestion, 'Skipped because the employee is no longer qualified.', 'skipped'));
      continue;
    }

    const phaseChunks = (chunkMap.get(`${currentAssembly.id}|${suggestion.phase}`) || []).map(chunk => ({ ...chunk }));
    const fallbackDate = suggestion.date
      || (suggestion.phase === 'Finalizing'
        ? currentAssembly.finalizingManualStartDate
        : suggestion.phase === 'Shipping'
          ? currentAssembly.shippingManualStartDate
          : currentAssembly.manualStartDate)
      || currentAssembly.shipDate
      || '';
    const effectiveChunks = phaseChunks.length
      ? phaseChunks
      : [{
          date: fallbackDate,
          hours: hoursForPhase(currentAssembly, suggestion.phase),
          employeeId: suggestion.currentEmployeeId || '',
          sourceAssemblyId: currentAssembly.id,
          phase: suggestion.phase,
        }];

    if (!effectiveChunks.length || !firstChunkDate(effectiveChunks)) {
      failed.push(applyItem(suggestion, 'Suggestion is stale. Missing current schedule dates.', 'failed'));
      continue;
    }
    if (!chunksFitEmployee(data, effectiveChunks, usage, suggestion.employeeId)) {
      skipped.push(applyItem(suggestion, 'Suggestion is stale. The employee is no longer available for these dates.', 'skipped'));
      continue;
    }

    if (suggestion.phase === 'Build') {
      const existingBuildSegments = (currentAssembly.manualWorkSegments || []).filter(segment => (segment.phase || 'Build') === 'Build');
      const nonBuildSegments = (currentAssembly.manualWorkSegments || []).filter(segment => (segment.phase || 'Build') !== 'Build');
      const nextBuildSegments = effectiveChunks.map((chunk, index) => ({
        id: existingBuildSegments[index]?.id || `smart-${currentAssembly.id}-${index}`,
        employeeId: suggestion.employeeId!,
        date: chunk.date,
        hours: Number(chunk.hours || 0),
        phase: 'Build',
      }));
      const alreadyAssigned = currentAssembly.assignedTo === suggestion.employeeId && sameBuildSegments(currentAssembly.manualWorkSegments || [], nextBuildSegments);
      if (alreadyAssigned) {
        skipped.push(applyItem(suggestion, 'Skipped because the item is already assigned that way.', 'skipped'));
        continue;
      }
      nextAssemblies[assemblyIndex] = {
        ...currentAssembly,
        assignedTo: suggestion.employeeId,
        manualStartDate: firstChunkDate(nextBuildSegments.map(segment => ({
          date: segment.date,
          hours: segment.hours,
          employeeId: segment.employeeId,
          sourceAssemblyId: currentAssembly.id,
          phase: 'Build' as SmartAssignPhase,
        }))),
        manualWorkSegments: [...nonBuildSegments, ...nextBuildSegments],
      };
      for (const chunk of effectiveChunks) {
        if (chunk.employeeId) {
          const oldKey = usageKey(chunk.employeeId, chunk.date);
          usage.set(oldKey, Math.max(0, (usage.get(oldKey) || 0) - Number(chunk.hours || 0)));
        }
        const newKey = usageKey(suggestion.employeeId, chunk.date);
        usage.set(newKey, (usage.get(newKey) || 0) + Number(chunk.hours || 0));
      }
      applied.push(applyItem(suggestion, `Applied build assignment to ${suggestion.employeeName || suggestion.employeeId}.`, 'applied'));
      appliedKeys.push(`${suggestion.assemblyId}|${suggestion.phase}`);
      continue;
    }

    const manualDate = firstChunkDate(effectiveChunks) || suggestion.date;
    if (!manualDate) {
      failed.push(applyItem(suggestion, 'Suggestion is stale. Missing phase date.', 'failed'));
      continue;
    }

    if (suggestion.phase === 'Finalizing') {
      const alreadyAssigned = (currentAssembly.finalizingAssignedTo || currentAssembly.assignedTo || '') === suggestion.employeeId
        && (currentAssembly.finalizingManualStartDate || manualDate) === manualDate;
      if (alreadyAssigned) {
        skipped.push(applyItem(suggestion, 'Skipped because the item is already assigned that way.', 'skipped'));
        continue;
      }
      nextAssemblies[assemblyIndex] = {
        ...currentAssembly,
        finalizingAssignedTo: suggestion.employeeId,
        finalizingManualStartDate: manualDate,
      };
    } else {
      const alreadyAssigned = (currentAssembly.shippingAssignedTo || currentAssembly.assignedTo || '') === suggestion.employeeId
        && (currentAssembly.shippingManualStartDate || manualDate) === manualDate;
      if (alreadyAssigned) {
        skipped.push(applyItem(suggestion, 'Skipped because the item is already assigned that way.', 'skipped'));
        continue;
      }
      nextAssemblies[assemblyIndex] = {
        ...currentAssembly,
        shippingAssignedTo: suggestion.employeeId,
        shippingManualStartDate: manualDate,
      };
    }

    for (const chunk of effectiveChunks) {
      if (chunk.employeeId) {
        const oldKey = usageKey(chunk.employeeId, chunk.date);
        usage.set(oldKey, Math.max(0, (usage.get(oldKey) || 0) - Number(chunk.hours || 0)));
      }
      const newKey = usageKey(suggestion.employeeId, chunk.date);
      usage.set(newKey, (usage.get(newKey) || 0) + Number(chunk.hours || 0));
    }
    applied.push(applyItem(suggestion, `Applied ${suggestion.phase.toLowerCase()} assignment to ${suggestion.employeeName || suggestion.employeeId}.`, 'applied'));
    appliedKeys.push(`${suggestion.assemblyId}|${suggestion.phase}`);
  }

  return {
    data: { ...data, projectAssemblies: nextAssemblies },
    applied,
    skipped,
    failed,
    appliedKeys,
  };
}

function rawRoleQualifiedEmployees(data: AppData, phase: SmartAssignPhase) {
  return (data.employees || []).filter(employee => {
    if (!employee || employee.active === false) return false;
    if (phase === 'Finalizing') return canEmployeeFinalize(employee);
    if (phase === 'Shipping') return canEmployeeShip(employee);
    return canEmployeeBuild(employee);
  });
}

export function preferredProjectIds(employee: any) {
  return new Set(splitIds(employee?.preferredProjectIds || employee?.trainedProjectIds || ''));
}

export function employeePrefersProject(employee: any, projectId: string) {
  return !!employee && !!projectId && preferredProjectIds(employee).has(projectId);
}

export function employeePrefersPreferredProjects(employee: any) {
  return !!(employee?.preferPreferredProjects ?? employee?.limitAutoAssignToTrainedProjects);
}

function urgencyScore(shipDate: string) {
  if (!shipDate) return 25;
  const today = dateOnly(new Date());
  const diff = Math.round((+parseDate(shipDate) - +parseDate(today)) / MS_DAY);
  if (diff < 0) return 140;
  if (diff <= 1) return 120;
  if (diff <= 6) return 95;
  if (diff <= 13) return 70;
  return 35;
}

function weeklyKey(employeeId: string, date: string) {
  return `${employeeId}|${mondayOfValue(date)}`;
}

function isProtected(assembly: any) {
  return !!(assembly?.locked || assembly?.smartAssignProtected || assembly?.manuallyScheduled);
}

function currentAssignmentName(data: AppData, currentIds: string[]) {
  return currentIds.map(id => data.employees.find(employee => employee.id === id)?.name || id).filter(Boolean).join(', ');
}

function modeDefaults(options?: SmartAssignOptions) {
  return {
    assignBlanksOnly: options?.assignBlanksOnly !== false,
    improveExistingUnlockedAssignments: !!options?.improveExistingUnlockedAssignments,
    balanceThisWeek: !!options?.balanceThisWeek,
    prioritizeShipDates: options?.prioritizeShipDates !== false,
    reduceOverloads: !!options?.reduceOverloads,
  };
}

function buildTaskCandidates(data: AppData, schedule: ScheduledItem[], prioritizeShipDates: boolean) {
  const projectsById = Object.fromEntries((data.projects || []).map(project => [project.id, project]));
  const assemblies = (data.projectAssemblies || []) as ProjectAssembly[];
  const scheduleByKey = Object.fromEntries(schedule.map(item => [`${item.sourceAssemblyId || String(item.id).split('|')[0]}|${item.phase || 'Build'}`, item]));
  const tasks: TaskCandidate[] = [];
  for (const assembly of assemblies) {
    const project = projectsById[assembly.projectId];
    const shipDate = assembly.shipDate || project?.dueDate || '';
    const urgent = urgencyScore(shipDate) + (Number(project?.priority ?? 5) <= 2 ? 8 : 0);
    const buildItem = scheduleByKey[`${assembly.id}|Build`];
    const finalizingItem = scheduleByKey[`${assembly.id}|Finalizing`];
    const shippingItem = scheduleByKey[`${assembly.id}|Shipping`];
    if (needsWork(assembly, buildItem, 'Build')) tasks.push({ assembly, item: buildItem!, phase: 'Build', chunks: chunkPlanForItem(data, buildItem!, assembly), project, shipDate, currentIds: phaseAssignmentIds(assembly, 'Build'), protected: isProtected(assembly), urgentScore: urgent });
    if (needsWork(assembly, finalizingItem, 'Finalizing')) tasks.push({ assembly, item: finalizingItem!, phase: 'Finalizing', chunks: chunkPlanForItem(data, finalizingItem!, assembly), project, shipDate, currentIds: phaseAssignmentIds(assembly, 'Finalizing'), protected: isProtected(assembly), urgentScore: urgent });
    if (needsWork(assembly, shippingItem, 'Shipping')) tasks.push({ assembly, item: shippingItem!, phase: 'Shipping', chunks: chunkPlanForItem(data, shippingItem!, assembly), project, shipDate, currentIds: phaseAssignmentIds(assembly, 'Shipping'), protected: isProtected(assembly), urgentScore: urgent });
  }
  return tasks.sort((a, b) => {
    // "Prioritize ship dates" now genuinely changes behavior: it controls
    // which tasks get processed - and therefore claim any given employee's
    // capacity - first. (Previously this only added an identical bonus to
    // every candidate for a task, which never changed which employee won,
    // since ranking within a task is always relative.) With it off, tasks
    // are ordered neutrally so urgency doesn't quietly dominate who gets
    // suggested first.
    if (prioritizeShipDates) {
      const urgencyCompare = Number(b.urgentScore || 0) - Number(a.urgentScore || 0);
      if (urgencyCompare) return urgencyCompare;
      const shipCompare = String(a.shipDate || '9999-12-31').localeCompare(String(b.shipDate || '9999-12-31'));
      if (shipCompare) return shipCompare;
    }
    const phaseCompare = phaseOrder(a.phase) - phaseOrder(b.phase);
    if (phaseCompare) return phaseCompare;
    const startCompare = String(a.item?.scheduledStart || '').localeCompare(String(b.item?.scheduledStart || ''));
    if (startCompare) return startCompare;
    const partCompare = String(a.assembly.partNumber || '').localeCompare(String(b.assembly.partNumber || ''));
    if (partCompare) return partCompare;
    return String(a.assembly.id).localeCompare(String(b.assembly.id));
  });
}

export function smartAssignQualifiedEmployees(data: AppData, projectId: string, phase: SmartAssignPhase) {
  return rawRoleQualifiedEmployees(data, phase).slice().sort((a: any, b: any) => {
    const aPreferred = employeePrefersProject(a, projectId) ? 0 : 1;
    const bPreferred = employeePrefersProject(b, projectId) ? 0 : 1;
    return aPreferred - bPreferred || String(a.name || '').localeCompare(String(b.name || ''));
  });
}

export function previewSmartAssignSuggestions(data: AppData, scheduleInput?: ScheduledItem[], options?: SmartAssignOptions) {
  const schedule = scheduleInput || buildSchedule(data);
  const mode = modeDefaults(options);
  const usage = new Map<string, number>();
  const weeklyUsage = new Map<string, number>();
  for (const chunk of buildScheduleChunks(data, schedule)) {
    if (!chunk.employeeId) continue;
    const dayKey = `${chunk.employeeId}|${chunk.date}`;
    usage.set(dayKey, (usage.get(dayKey) || 0) + Number(chunk.hours || 0));
    const weekKey = weeklyKey(chunk.employeeId, chunk.date);
    weeklyUsage.set(weekKey, (weeklyUsage.get(weekKey) || 0) + Number(chunk.hours || 0));
  }
  // Counts how many fresh suggestions each employee has already picked up
  // within this single preview pass. Used to gently spread similar/blank
  // work across multiple qualified people instead of stacking it all on
  // whoever scores highest first, purely because they were on top of the
  // list before anyone else had any hours reserved against them.
  const suggestedCount = new Map<string, number>();

  const suggestions: SmartAssignSuggestion[] = [];
  const tasks = buildTaskCandidates(data, schedule, mode.prioritizeShipDates);
  const thisWeek = mondayOfValue(dateOnly(new Date()));

  for (const task of tasks) {
    const currentIds = task.currentIds;
    const currentEmployeeId = currentIds.length === 1 ? currentIds[0] : '';
    const currentName = currentAssignmentName(data, currentIds);
    const wantsAssignment = currentIds.length === 0;
    const candidateWeek = mondayOfValue(task.chunks[0]?.date || task.item?.scheduledStart || task.shipDate || dateOnly(new Date()));
    const shouldReviewAssigned = currentIds.length > 0 && (mode.improveExistingUnlockedAssignments || mode.balanceThisWeek || mode.reduceOverloads);
    // "Assign blanks only" is now the sole, literal gate for unassigned work.
    // Previously this was OR'd with balanceThisWeek/reduceOverloads/prioritizeShipDates,
    // and prioritizeShipDates defaults true - so unchecking "Assign blanks only"
    // never actually stopped blank assignment. Reassignment of already-assigned
    // work is still gated separately by shouldReviewAssigned.
    const shouldReview = wantsAssignment
      ? mode.assignBlanksOnly
      : (shouldReviewAssigned && (!mode.balanceThisWeek || candidateWeek === thisWeek));
    if (!shouldReview) continue;

    if (task.protected || currentIds.length > 1) {
      suggestions.push({
        id: `${task.assembly.id}|${task.phase}`,
        assemblyId: task.assembly.id,
        projectId: task.assembly.projectId,
        projectName: projectLabel(task.project),
        projectCode: task.project?.projectId || task.project?.name || 'Project',
        partNumber: task.assembly.partNumber || '—',
        description: task.assembly.description || task.assembly.partNumber || 'Assembly',
        phase: task.phase,
        date: task.chunks[0]?.date || task.item?.scheduledStart || task.shipDate || '',
        shipDate: task.shipDate,
        currentEmployeeId: currentEmployeeId || undefined,
        currentEmployeeName: currentName || undefined,
        employeeId: currentEmployeeId || undefined,
        employeeName: currentName || undefined,
        reason: task.protected
          ? 'Skipped because this tile is locked or manually protected.'
          : 'Skipped because this work already has multiple assigned employees and Smart Assign will not rewrite that setup.',
        diagnostic: 'skipped_locked',
        status: 'locked',
        changeType: 'skip',
      });
      continue;
    }

    const roleQualified = rawRoleQualifiedEmployees(data, task.phase);
    const preferredQualified = roleQualified.filter(employee => employeePrefersProject(employee, task.assembly.projectId));
    const candidates = roleQualified.map(employee => {
      const openAcrossTask = task.chunks.reduce((sum, chunk) => {
        const key = `${employee.id}|${chunk.date}`;
        const cap = capacityForDate(data, employee.id, chunk.date);
        const existing = usage.get(key) || 0;
        const ownHours = employee.id === currentEmployeeId
          ? task.chunks.filter(currentChunk => currentChunk.date === chunk.date).reduce((n, currentChunk) => n + Number(currentChunk.hours || 0), 0)
          : 0;
        return sum + Math.max(0, cap - Math.max(0, existing - ownHours));
      }, 0);
      const fits = task.chunks.every(chunk => {
        const key = `${employee.id}|${chunk.date}`;
        const cap = capacityForDate(data, employee.id, chunk.date);
        const existing = usage.get(key) || 0;
        const ownHours = employee.id === currentEmployeeId
          ? task.chunks.filter(currentChunk => currentChunk.date === chunk.date).reduce((n, currentChunk) => n + Number(currentChunk.hours || 0), 0)
          : 0;
        return cap > 0 && Math.max(0, existing - ownHours) + Number(chunk.hours || 0) <= cap + 0.01;
      });
      const anyWorkingDay = task.chunks.some(chunk => capacityForDate(data, employee.id, chunk.date) > 0);
      const weekKey = weeklyKey(employee.id, task.chunks[0]?.date || task.item?.scheduledStart || task.shipDate || dateOnly(new Date()));
      const weeklyLoad = weeklyUsage.get(weekKey) || 0;
      const weeklyCapacity = task.chunks.reduce((sum, chunk) => sum + Math.max(capacityForDate(data, employee.id, chunk.date), 0), 0) || 1;
      const preferred = employeePrefersProject(employee, task.assembly.projectId);
      const preferredBonus = preferred ? 16 : (employeePrefersPreferredProjects(employee) ? -5 : 0);
      const stabilityBonus = employee.id === currentEmployeeId && fits ? 12 : 0;
      const loadBonus = Math.max(0, 10 - (weeklyLoad / weeklyCapacity) * 8);
      const openBonus = Math.min(18, openAcrossTask * 1.4);
      // Worst-case day utilization this task would push the employee to,
      // used below for the "reduce overloads" penalty. Computed once here
      // so it stays in lockstep with the fits/openAcrossTask math above.
      const worstUtilization = task.chunks.reduce((max, chunk) => {
        const cap = capacityForDate(data, employee.id, chunk.date);
        if (cap <= 0) return max;
        const key = `${employee.id}|${chunk.date}`;
        const existing = usage.get(key) || 0;
        const ownHours = employee.id === currentEmployeeId
          ? task.chunks.filter(currentChunk => currentChunk.date === chunk.date).reduce((n, currentChunk) => n + Number(currentChunk.hours || 0), 0)
          : 0;
        const projected = Math.max(0, existing - ownHours) + Number(chunk.hours || 0);
        return Math.max(max, projected / cap);
      }, 0);
      // Only bites once "Reduce overloads" is checked, and only past 75%
      // utilization - so it nudges scoring toward candidates with real
      // slack instead of ones who just barely fit, without overriding the
      // preferred/stability bonuses on its own.
      const overloadPenalty = mode.reduceOverloads ? Math.max(0, worstUtilization - 0.75) * 32 : 0;
      // Grows every time this employee has already been freshly suggested
      // elsewhere in this same preview pass, so near-identical blank tasks
      // spread across the team instead of all landing on whoever scored
      // highest before anyone else had hours reserved against them.
      const spreadPenalty = (suggestedCount.get(employee.id) || 0) * 6;
      const score = preferredBonus + stabilityBonus + loadBonus + openBonus - overloadPenalty - spreadPenalty;
      return { employee, fits, anyWorkingDay, preferred, openAcrossTask, weeklyLoad, score };
    });

    const viable = candidates.filter(candidate => candidate.fits).sort((a, b) => Number(b.score || 0) - Number(a.score || 0) || String(a.employee.name || '').localeCompare(String(b.employee.name || '')));
    const preferredViable = viable.filter(candidate => candidate.preferred);
    const currentCandidate = candidates.find(candidate => candidate.employee.id === currentEmployeeId);
    const overloadedNow = !!(currentCandidate && !currentCandidate.fits);
    const best = viable[0];
    const noPreferredAvailable = !preferredViable.length && preferredQualified.length > 0;

    if (best) {
      const keepCurrent = !!currentCandidate && currentCandidate.fits && (
        best.employee.id === currentEmployeeId
        || (!mode.improveExistingUnlockedAssignments && !mode.balanceThisWeek && !mode.reduceOverloads)
        || (Number(best.score || 0) <= Number(currentCandidate.score || 0) + 8 && !overloadedNow && currentCandidate.preferred === best.preferred)
      );
      if (!wantsAssignment && keepCurrent) {
        suggestions.push({
          id: `${task.assembly.id}|${task.phase}`,
          assemblyId: task.assembly.id,
          projectId: task.assembly.projectId,
          projectName: projectLabel(task.project),
          projectCode: task.project?.projectId || task.project?.name || 'Project',
          partNumber: task.assembly.partNumber || '—',
          description: task.assembly.description || task.assembly.partNumber || 'Assembly',
          phase: task.phase,
          date: task.chunks[0]?.date || task.item?.scheduledStart || task.shipDate || '',
          shipDate: task.shipDate,
          currentEmployeeId: currentEmployeeId || undefined,
          currentEmployeeName: currentName || undefined,
          employeeId: currentEmployeeId || undefined,
          employeeName: currentName || undefined,
          reason: overloadedNow
            ? `Kept ${currentName || 'the current assignment'} because no safer reassignment fit was available.`
            : `Kept ${currentName || 'the current assignment'} because it is already balanced.`,
          diagnostic: currentCandidate?.preferred ? 'already_good' : 'assigned_to_non_preferred_employee',
          status: 'kept',
          changeType: 'keep',
          preferredMatch: !!currentCandidate?.preferred,
          nonPreferredButNecessary: !currentCandidate?.preferred,
          score: currentCandidate?.score,
        });
        continue;
      }

      const urgencyNote = mode.prioritizeShipDates && task.urgentScore >= 95 ? ' This item was reviewed early because it ships soon.' : '';
      const preferredNote = best.preferred
        ? ` ${best.employee.name || 'Employee'} prefers this project.`
        : noPreferredAvailable
          ? ` No preferred ${phaseRoleKey(task.phase)} was available, so Smart Assign used the best qualified backup.`
          : '';
      const reason = wantsAssignment
        ? `Suggested ${best.employee.name || 'employee'} because ${best.employee.name || 'they'} ${best.preferred ? 'prefer this project and ' : ''}have ${best.openAcrossTask.toFixed(1)} hrs available on the scheduled day${task.chunks.length === 1 ? '' : 's'}.${urgencyNote}${preferredNote}`
        : `Suggested ${best.employee.name || 'employee'} instead of ${currentName || 'the current assignment'} because the fit is better for workload and urgency.${urgencyNote}${preferredNote}`;
      suggestions.push({
        id: `${task.assembly.id}|${task.phase}`,
        assemblyId: task.assembly.id,
        projectId: task.assembly.projectId,
        projectName: projectLabel(task.project),
        projectCode: task.project?.projectId || task.project?.name || 'Project',
        partNumber: task.assembly.partNumber || '—',
        description: task.assembly.description || task.assembly.partNumber || 'Assembly',
        phase: task.phase,
        date: task.chunks[0]?.date || task.item?.scheduledStart || task.shipDate || '',
        shipDate: task.shipDate,
        currentEmployeeId: currentEmployeeId || undefined,
        currentEmployeeName: currentName || undefined,
        employeeId: best.employee.id,
        employeeName: best.employee.name || best.employee.id,
        reason,
        diagnostic: best.preferred ? 'smart_assign_available' : 'assigned_to_non_preferred_employee',
        status: 'suggested',
        changeType: wantsAssignment ? 'assign' : 'reassign',
        preferredMatch: best.preferred,
        nonPreferredButNecessary: !best.preferred,
        score: best.score,
        overloadResolved: overloadedNow && best.employee.id !== currentEmployeeId,
      });
      suggestedCount.set(best.employee.id, (suggestedCount.get(best.employee.id) || 0) + 1);
      // Reserve this employee's hours against the shared usage/weeklyUsage
      // tallies right away. Without this, every task in this preview pass
      // is scored against the *original* schedule only, so the same
      // in-demand employee gets suggested for far more work on the same
      // day than they actually have capacity for. Apply-time then has to
      // silently skip most of them as "stale," which is what made Smart
      // Assign look broken: 21 suggestions in preview, 4 actually applied.
      for (const chunk of task.chunks) {
        const dayKey = `${best.employee.id}|${chunk.date}`;
        usage.set(dayKey, (usage.get(dayKey) || 0) + Number(chunk.hours || 0));
        const weekKey = weeklyKey(best.employee.id, chunk.date);
        weeklyUsage.set(weekKey, (weeklyUsage.get(weekKey) || 0) + Number(chunk.hours || 0));
        if (!wantsAssignment && currentEmployeeId && currentEmployeeId !== best.employee.id) {
          const oldDayKey = `${currentEmployeeId}|${chunk.date}`;
          usage.set(oldDayKey, Math.max(0, (usage.get(oldDayKey) || 0) - Number(chunk.hours || 0)));
          const oldWeekKey = weeklyKey(currentEmployeeId, chunk.date);
          weeklyUsage.set(oldWeekKey, Math.max(0, (weeklyUsage.get(oldWeekKey) || 0) - Number(chunk.hours || 0)));
        }
      }
      continue;
    }

    const availableBySchedule = roleQualified.filter(employee => task.chunks.every(chunk => capacityForDate(data, employee.id, chunk.date) > 0));
    const blockedDiagnostic: SmartAssignDiagnostic = !roleQualified.length
      ? task.phase === 'Finalizing'
        ? 'no_qualified_finalizer_available'
        : task.phase === 'Shipping'
          ? 'no_qualified_shipper_available'
          : 'no_qualified_builder_available'
      : !availableBySchedule.length
        ? 'employee_unavailable'
        : 'over_capacity_smart_assign';
    const blockedReason = !roleQualified.length
      ? `No active ${phaseRoleKey(task.phase)} is enabled for this phase.`
      : !availableBySchedule.length
        ? `Qualified ${phaseRoleKey(task.phase)}s exist, but they are unavailable on the scheduled day${task.chunks.length === 1 ? '' : 's'} because of time off, holidays, Friday limits, or weekly work-day settings.`
        : `Qualified ${phaseRoleKey(task.phase)}s exist, but none can take the work without pushing past available capacity.`;
    suggestions.push({
      id: `${task.assembly.id}|${task.phase}`,
      assemblyId: task.assembly.id,
      projectId: task.assembly.projectId,
      projectName: projectLabel(task.project),
      projectCode: task.project?.projectId || task.project?.name || 'Project',
      partNumber: task.assembly.partNumber || '—',
      description: task.assembly.description || task.assembly.partNumber || 'Assembly',
      phase: task.phase,
      date: task.chunks[0]?.date || task.item?.scheduledStart || task.shipDate || '',
      shipDate: task.shipDate,
      currentEmployeeId: currentEmployeeId || undefined,
      currentEmployeeName: currentName || undefined,
      reason: noPreferredAvailable && roleQualified.length
        ? `No preferred ${phaseRoleKey(task.phase)} is available, and ${blockedReason.toLowerCase()}`
        : blockedReason,
      diagnostic: noPreferredAvailable && roleQualified.length ? 'no_preferred_employee_available' : blockedDiagnostic,
      status: 'blocked',
      changeType: 'skip',
    });
  }

  return suggestions;
}

export function smartAssignSuggestionMapByAssemblyPhase(suggestions: SmartAssignSuggestion[]) {
  return Object.fromEntries((suggestions || []).map(suggestion => [`${suggestion.assemblyId}|${suggestion.phase}`, suggestion]));
}

// Compatibility exports while older modules are still being migrated to Smart Assign wording.
export const autoAssignQualifiedEmployees = smartAssignQualifiedEmployees;
export const previewAutoAssignSuggestions = previewSmartAssignSuggestions;
export const suggestionMapByAssemblyPhase = smartAssignSuggestionMapByAssemblyPhase;
