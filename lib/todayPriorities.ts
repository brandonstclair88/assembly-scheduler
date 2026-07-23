import { AppData, ProjectAssembly, ScheduledItem } from './types';
import { ScheduleWarning } from './scheduleWarnings';
import { ProjectHealthRecord } from './projectHealth';

export type TodayPriorityTone = 'critical' | 'capacity' | 'info';
export type TodayPriorityAction =
  | { kind: 'project'; projectId: string }
  | { kind: 'project-filter'; healthFilter: string }
  | { kind: 'board'; date: string; projectId?: string }
  | { kind: 'warning'; warningId: string; date?: string; projectId?: string };

export type TodayPriority = {
  id: string;
  tone: TodayPriorityTone;
  title: string;
  detail: string;
  count: number;
  action?: TodayPriorityAction;
};

function parseDate(value: string) {
  const base = (value || '').slice(0, 10);
  const date = base ? new Date(`${base}T00:00:00`) : new Date();
  return isNaN(+date) ? new Date() : date;
}

function dateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function addDays(value: string, amount: number) {
  const date = parseDate(value);
  date.setDate(date.getDate() + amount);
  return dateOnly(date);
}

function splitIds(value: string) {
  return (value || '').split(/[\n,;\s]+/).map(x => x.trim()).filter(Boolean);
}

function projectLabel(project: any) {
  return project?.projectId || project?.name || 'Project';
}

function assemblyLabel(assembly: any) {
  if (!assembly) return 'assembly';
  return `${assembly.partNumber || 'Assembly'} ${assembly.instanceLabel || ''}`.trim();
}

function scheduleMap(schedule: ScheduledItem[]) {
  const byKey: Record<string, ScheduledItem> = {};
  for (const item of schedule) {
    const sourceId = item.sourceAssemblyId || String(item.id).split('|')[0];
    const phase = item.phase || 'Build';
    byKey[`${sourceId}|${phase}`] = item;
  }
  return byKey;
}

function isStandaloneSub(assembly: ProjectAssembly) {
  return assembly.type === 'Sub Assembly' && !assembly.parentAssemblyId && !assembly.buildGroupId;
}

function shippingExpected(assembly: ProjectAssembly) {
  return !!assembly.shippingRequired || (!!assembly.shipDate && (assembly.type === 'Top Level Assembly' || isStandaloneSub(assembly)));
}

export function calculateTodayPriorities(
  data: AppData,
  schedule: ScheduledItem[],
  warnings: ScheduleWarning[],
  projectHealth: ProjectHealthRecord[],
  fromDate: string
) {
  const scheduleByKey = scheduleMap(schedule);
  const projectsById = Object.fromEntries((data.projects || []).map(project => [project.id, project]));
  const assemblies = (data.projectAssemblies || []) as ProjectAssembly[];
  const weekEnd = addDays(fromDate, 6);
  const priorities: TodayPriority[] = [];

  const overdueFinalizings = assemblies
    .filter(assembly => assembly.finalizingRequired && !assembly.finalizingComplete)
    .map(assembly => ({
      assembly,
      item: scheduleByKey[`${assembly.id}|Finalizing`],
    }))
    .filter(row => row.item?.scheduledEnd && row.item.scheduledEnd < fromDate)
    .sort((a, b) => String(a.item?.scheduledEnd || '').localeCompare(String(b.item?.scheduledEnd || '')));
  if (overdueFinalizings.length) {
    const first = overdueFinalizings[0];
    priorities.push({
      id: 'overdue-finalizings',
      tone: 'critical',
      title: 'Overdue finalizings',
      count: overdueFinalizings.length,
      detail: `${overdueFinalizings.length} item${overdueFinalizings.length === 1 ? '' : 's'} overdue. First: ${projectLabel(projectsById[first.assembly.projectId])} · ${assemblyLabel(first.assembly)}`,
      action: {
        kind: 'board',
        projectId: first.assembly.projectId,
        date: first.item?.scheduledEnd || first.assembly.shipDate || fromDate,
      },
    });
  }

  const shippingThisWeek = assemblies
    .filter(assembly => shippingExpected(assembly) && assembly.shipDate && assembly.shipDate >= fromDate && assembly.shipDate <= weekEnd)
    .sort((a, b) => String(a.shipDate || '').localeCompare(String(b.shipDate || '')));
  if (shippingThisWeek.length) {
    const first = shippingThisWeek[0];
    const uniqueProjects = Array.from(new Set(shippingThisWeek.map(assembly => assembly.projectId).filter(Boolean)));
    priorities.push({
      id: 'shipping-this-week',
      tone: 'info',
      title: 'Projects shipping this week',
      count: shippingThisWeek.length,
      detail: `${shippingThisWeek.length} ship candidate${shippingThisWeek.length === 1 ? '' : 's'} due this week across ${uniqueProjects.length} project${uniqueProjects.length === 1 ? '' : 's'}.`,
      action: uniqueProjects.length === 1
        ? { kind: 'project', projectId: uniqueProjects[0] }
        : { kind: 'board', date: first.shipDate || fromDate, projectId: first.projectId },
    });
  }

  const overCapacityWarnings = warnings
    .filter(warning => warning.code === 'over_capacity' && warning.date >= fromDate && warning.date <= weekEnd)
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (overCapacityWarnings.length) {
    const first = overCapacityWarnings[0];
    const employeeDays = Array.from(new Set(overCapacityWarnings.map(warning => `${warning.employeeId || warning.employeeName}|${warning.date}`)));
    priorities.push({
      id: 'over-capacity',
      tone: 'capacity',
      title: 'Employees over capacity',
      count: employeeDays.length,
      detail: `${employeeDays.length} overloaded employee day${employeeDays.length === 1 ? '' : 's'} this week. First: ${first.employeeName || 'Employee'} on ${first.date}.`,
      action: { kind: 'warning', warningId: first.id, projectId: first.projectId, date: first.date },
    });
  }

  const blockedProjectIds = new Set<string>();
  let blockedReference: { projectId?: string; date?: string; warningId?: string } | null = null;
  for (const warning of warnings) {
    if (warning.code === 'sub_after_parent') {
      if (warning.projectId) blockedProjectIds.add(warning.projectId);
      if (!blockedReference) blockedReference = { projectId: warning.projectId, date: warning.date, warningId: warning.id };
    }
  }
  for (const assembly of assemblies) {
    if (assembly.type !== 'Sub Assembly') continue;
    if (assembly.status !== 'On Hold' && !String(assembly.holdReason || '').trim()) continue;
    if (assembly.projectId) blockedProjectIds.add(assembly.projectId);
    if (!blockedReference) blockedReference = { projectId: assembly.projectId, date: assembly.shipDate };
  }
  if (blockedProjectIds.size) {
    const firstProjectId = Array.from(blockedProjectIds)[0];
    priorities.push({
      id: 'blocked-by-subs',
      tone: 'critical',
      title: 'Blocked by missing subs',
      count: blockedProjectIds.size,
      detail: `${blockedProjectIds.size} project${blockedProjectIds.size === 1 ? '' : 's'} blocked by sub/dependency issues.`,
      action: blockedReference?.warningId
        ? { kind: 'warning', warningId: blockedReference.warningId, projectId: blockedReference.projectId, date: blockedReference.date }
        : { kind: 'project', projectId: firstProjectId },
    });
  }

  const readyToShip = projectHealth.filter(record => record.status === 'Ready to Ship');
  if (readyToShip.length) {
    const first = readyToShip[0];
    priorities.push({
      id: 'ready-to-ship',
      tone: 'info',
      title: 'Projects ready to ship',
      count: readyToShip.length,
      detail: `${readyToShip.length} project${readyToShip.length === 1 ? '' : 's'} ready for final shipping.`,
      action: readyToShip.length === 1
        ? { kind: 'project', projectId: first.projectId }
        : { kind: 'project-filter', healthFilter: 'Ready to Ship' },
    });
  }

  const missingAssignments = warnings
    .filter(warning => warning.code === 'missing_build_assignment' || warning.code === 'missing_finalizing_assignment' || warning.code === 'missing_shipping_assignment')
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (missingAssignments.length) {
    const first = missingAssignments[0];
    priorities.push({
      id: 'missing-assignments',
      tone: 'critical',
      title: 'Missing assignments',
      count: missingAssignments.length,
      detail: `${missingAssignments.length} assignment warning${missingAssignments.length === 1 ? '' : 's'} still need owners.`,
      action: missingAssignments.length === 1
        ? { kind: 'warning', warningId: first.id, projectId: first.projectId, date: first.date }
        : { kind: 'project-filter', healthFilter: 'Missing Assignment' },
    });
  }

  const smartAssignAvailable = warnings
    .filter(warning => warning.code === 'smart_assign_available')
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (smartAssignAvailable.length) {
    const first = smartAssignAvailable[0];
    priorities.push({
      id: 'smart-assign-ready',
      tone: 'info',
      title: 'Unassigned work ready for Smart Assign',
      count: smartAssignAvailable.length,
      detail: `${smartAssignAvailable.length} unassigned item${smartAssignAvailable.length === 1 ? '' : 's'} can be safely suggested right now.`,
      action: { kind: 'warning', warningId: first.id, projectId: first.projectId, date: first.date },
    });
  }

  const blockedSmartAssign = warnings
    .filter(warning => warning.code === 'no_preferred_employee_available' || warning.code === 'no_qualified_builder_available' || warning.code === 'no_qualified_finalizer_available' || warning.code === 'no_qualified_shipper_available' || warning.code === 'employee_unavailable' || warning.code === 'over_capacity_smart_assign')
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (blockedSmartAssign.length) {
    const first = blockedSmartAssign[0];
    priorities.push({
      id: 'smart-assign-blocked',
      tone: 'critical',
      title: 'Work Smart Assign cannot place yet',
      count: blockedSmartAssign.length,
      detail: `${blockedSmartAssign.length} item${blockedSmartAssign.length === 1 ? '' : 's'} still need staffing, preference coverage, or capacity before Smart Assign can help.`,
      action: { kind: 'warning', warningId: first.id, projectId: first.projectId, date: first.date },
    });
  }

  const nonPreferredAssignments = warnings
    .filter(warning => warning.code === 'assigned_to_non_preferred_employee')
    .sort((a, b) => String(a.date || '').localeCompare(String(b.date || '')));
  if (nonPreferredAssignments.length) {
    const first = nonPreferredAssignments[0];
    priorities.push({
      id: 'smart-assign-non-preferred',
      tone: 'info',
      title: 'Non-preferred assignments used',
      count: nonPreferredAssignments.length,
      detail: `${nonPreferredAssignments.length} item${nonPreferredAssignments.length === 1 ? '' : 's'} needed a qualified backup employee to protect schedule dates.`,
      action: { kind: 'warning', warningId: first.id, projectId: first.projectId, date: first.date },
    });
  }

  return priorities;
}
