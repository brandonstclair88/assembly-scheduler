import { dailyHours } from './scheduler';
import { ScheduleWarning } from './scheduleWarnings';
import { AppData, ProjectAssembly, ScheduledItem } from './types';

export type ProjectHealthStatus =
  | 'On Track'
  | 'At Risk'
  | 'Late'
  | 'Missing Assignment'
  | 'Over Capacity'
  | 'Waiting on Test'
  | 'Waiting on Finalizing'
  | 'Ready to Ship';

export type ProjectHealthTone = 'good' | 'warn' | 'late' | 'info';

export type ProjectTimelineStepStatus =
  | 'Complete'
  | 'Scheduled'
  | 'Waiting'
  | 'Blocked'
  | 'Pending'
  | 'Not Needed';

export type ProjectTimelineStep = {
  key: 'subs' | 'top' | 'test' | 'finalize' | 'ship';
  label: string;
  status: ProjectTimelineStepStatus;
  date?: string;
  employeeName?: string;
  note?: string;
  warningCount: number;
};

export type ProjectHealthRecord = {
  projectId: string;
  projectCode: string;
  projectName: string;
  dueDate: string;
  status: ProjectHealthStatus;
  tone: ProjectHealthTone;
  reason: string;
  warningCount: number;
  criticalWarnings: number;
  capacityWarnings: number;
  infoWarnings: number;
  topLevelCount: number;
  standaloneSubCount: number;
  readyToShipCount: number;
  lateItemCount: number;
  missingAssignmentCount: number;
  overCapacityCount: number;
  waitingOnTestCount: number;
  waitingOnFinalizingCount: number;
  relatedAssemblyIds: string[];
  timeline: ProjectTimelineStep[];
};

function splitIds(value: string) {
  return (value || '').split(/[\n,;\s]+/).map(x => x.trim()).filter(Boolean);
}

function dateOnly(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function parseDate(value: string) {
  const base = (value || '').slice(0, 10);
  const date = base ? new Date(`${base}T00:00:00`) : new Date();
  return isNaN(+date) ? new Date() : date;
}

function maxDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return a > b ? a : b;
}

function minDate(a: string, b: string) {
  if (!a) return b;
  if (!b) return a;
  return a < b ? a : b;
}

function uniqueNames(names: string[]) {
  const unique = Array.from(new Set(names.filter(Boolean)));
  if (unique.length <= 2) return unique.join(', ');
  return `${unique.slice(0, 2).join(', ')} +${unique.length - 2}`;
}

function projectLabel(project: any) {
  return project?.projectId || project?.name || 'Project';
}

function projectName(project: any) {
  return project?.name || project?.projectId || 'Project';
}

function isHoliday(data: AppData, date: string) {
  return !!(data.holidays || []).some(holiday => holiday.date === date);
}

function isStandaloneSub(assembly: any) {
  return assembly?.type === 'Sub Assembly' && !assembly?.parentAssemblyId && !assembly?.buildGroupId;
}

function shippingExpected(assembly: any) {
  return !!assembly?.shippingRequired || (!!assembly?.shipDate && (assembly?.type === 'Top Level Assembly' || isStandaloneSub(assembly)));
}

function taskHours(assembly: any) {
  return Math.max(0, Number(assembly?.qty || 1) * Number(assembly?.hoursEach || 0));
}

function phaseAssignments(assembly: any, phase: 'Build' | 'Finalizing' | 'Shipping') {
  const raw = phase === 'Finalizing'
    ? (assembly?.finalizingAssignedTo || assembly?.assignedTo)
    : phase === 'Shipping'
      ? (assembly?.shippingAssignedTo || assembly?.assignedTo)
      : assembly?.assignedTo;
  return splitIds(raw || '');
}

function nextProductionDay(date: string, data: AppData) {
  let cursor = new Date(+parseDate(date) + 86400000);
  let guard = 0;
  while (guard++ < 120) {
    const ds = dateOnly(cursor);
    const day = cursor.getDay();
    if (day >= 1 && day <= 4 && !isHoliday(data, ds)) return ds;
    cursor = new Date(+cursor + 86400000);
  }
  return dateOnly(cursor);
}

function addExternalWaitHours(afterFinish: string, hours: number, data: AppData) {
  if ((Number(hours) || 0) <= 0) return afterFinish;
  let cursor = new Date(+parseDate(afterFinish) + 86400000);
  let remaining = Number(hours) || 0;
  let last = afterFinish;
  let guard = 0;
  while (remaining > 0.01 && guard++ < 240) {
    const ds = dateOnly(cursor);
    const day = cursor.getDay();
    if (day >= 1 && day <= 4 && !isHoliday(data, ds)) {
      remaining -= Math.max(0.1, dailyHours(data));
      last = ds;
    }
    cursor = new Date(+cursor + 86400000);
  }
  return last;
}

function testReleaseDate(buildFinish: string, assembly: any, data: AppData) {
  if (!buildFinish) return '';
  const hasTest = !!assembly?.testRequired || Number(assembly?.testHours || 0) > 0 || !!assembly?.testReturnDateTime;
  if (!hasTest) return buildFinish;
  const testHours = Number(assembly?.testHours || 0);
  const estimatedGateEnd = testHours > 0 ? addExternalWaitHours(buildFinish, testHours, data) : buildFinish;
  const manualReturn = assembly?.testReturnDateTime ? String(assembly.testReturnDateTime).slice(0, 10) : '';
  const gateDate = manualReturn ? maxDate(estimatedGateEnd, manualReturn) : estimatedGateEnd;
  if (testHours > 0 && !manualReturn) return nextProductionDay(gateDate, data);
  return gateDate;
}

function buildScheduleMap(schedule: ScheduledItem[]) {
  const byKey: Record<string, ScheduledItem> = {};
  for (const item of schedule) {
    const sourceId = item.sourceAssemblyId || String(item.id).split('|')[0];
    const phase = (item.phase || 'Build') as 'Build' | 'Finalizing' | 'Shipping';
    byKey[`${sourceId}|${phase}`] = item;
  }
  return byKey;
}

function allDone(assemblies: ProjectAssembly[]) {
  return assemblies.every(assembly => {
    const buildDone = assembly.status === 'Complete' || Number(assembly.percent || 0) >= 100 || taskHours(assembly) <= 0;
    const finalizeDone = !assembly.finalizingRequired || !!assembly.finalizingComplete;
    const shipDone = !shippingExpected(assembly) || !!assembly.shippingComplete;
    return buildDone && finalizeDone && shipDone;
  });
}

function phaseEmployees(assemblies: ProjectAssembly[], employeesById: Record<string, any>, phase: 'Build' | 'Finalizing' | 'Shipping') {
  return uniqueNames(
    assemblies.flatMap(assembly =>
      phaseAssignments(assembly, phase).map(id => employeesById[id]?.name || id)
    )
  );
}

function phaseWarningCount(warnings: ScheduleWarning[], phase?: 'Build' | 'Finalizing' | 'Shipping') {
  return warnings.filter(warning => {
    if (phase) return warning.phase === phase;
    return !warning.phase;
  }).length;
}

function stepStatusFromFlags(options: {
  needed: boolean;
  complete: boolean;
  blocked: boolean;
  scheduled: boolean;
  waiting?: boolean;
}) {
  if (!options.needed) return 'Not Needed' as ProjectTimelineStepStatus;
  if (options.complete) return 'Complete' as ProjectTimelineStepStatus;
  if (options.blocked) return 'Blocked' as ProjectTimelineStepStatus;
  if (options.waiting) return 'Waiting' as ProjectTimelineStepStatus;
  if (options.scheduled) return 'Scheduled' as ProjectTimelineStepStatus;
  return 'Pending' as ProjectTimelineStepStatus;
}

export function healthTone(status: ProjectHealthStatus): ProjectHealthTone {
  if (status === 'On Track' || status === 'Ready to Ship') return 'good';
  if (status === 'Late' || status === 'Missing Assignment') return 'late';
  if (status === 'Over Capacity') return 'warn';
  return 'info';
}

export function buildProjectTimeline(
  data: AppData,
  projectId: string,
  schedule: ScheduledItem[],
  warnings: ScheduleWarning[]
) {
  const assemblies = (data.projectAssemblies || []).filter(assembly => assembly.projectId === projectId);
  const employeesById = Object.fromEntries((data.employees || []).map(employee => [employee.id, employee]));
  const scheduleMap = buildScheduleMap(schedule);
  const projectWarnings = warnings.filter(warning => warning.projectId === projectId);

  const subs = assemblies.filter(assembly => assembly.type === 'Sub Assembly');
  const tops = assemblies.filter(assembly => assembly.type === 'Top Level Assembly');
  const tests = assemblies.filter(assembly => !!assembly.testRequired || Number(assembly.testHours || 0) > 0 || !!assembly.testReturnDateTime);
  const finalizings = assemblies.filter(assembly => !!assembly.finalizingRequired);
  const shipping = assemblies.filter(assembly => shippingExpected(assembly));

  const latestSubDate = subs.map(assembly => scheduleMap[`${assembly.id}|Build`]?.scheduledEnd || '').filter(Boolean).sort().slice(-1)[0] || '';
  const latestTopDate = tops.map(assembly => scheduleMap[`${assembly.id}|Build`]?.scheduledEnd || '').filter(Boolean).sort().slice(-1)[0] || '';
  const latestTestRelease = tests.map(assembly => {
    const buildFinish = scheduleMap[`${assembly.id}|Build`]?.scheduledEnd || '';
    return testReleaseDate(buildFinish, assembly, data);
  }).filter(Boolean).sort().slice(-1)[0] || '';
  const latestFinalizingDate = finalizings.map(assembly => scheduleMap[`${assembly.id}|Finalizing`]?.scheduledEnd || '').filter(Boolean).sort().slice(-1)[0] || '';
  const latestShippingDate = shipping.map(assembly => scheduleMap[`${assembly.id}|Shipping`]?.scheduledEnd || assembly.shipDate || '').filter(Boolean).sort().slice(-1)[0] || '';

  const subsBlocked = subs.some(assembly => assembly.status === 'On Hold' || !!String(assembly.holdReason || '').trim());
  const topsBlocked = tops.some(assembly => assembly.status === 'On Hold' || !!String(assembly.holdReason || '').trim());
  const testBlocked = tests.some(assembly => {
    const buildFinish = scheduleMap[`${assembly.id}|Build`]?.scheduledEnd || '';
    const release = testReleaseDate(buildFinish, assembly, data);
    return !!assembly.shipDate && !!release && release > assembly.shipDate;
  });
  const finalizingBlocked = finalizings.some(assembly => !phaseAssignments(assembly, 'Finalizing').length);
  const shippingBlocked = shipping.some(assembly => !phaseAssignments(assembly, 'Shipping').length);

  const subsComplete = subs.length > 0 && subs.every(assembly => Number(assembly.percent || 0) >= 100 || assembly.status === 'Complete');
  const topsComplete = tops.length > 0 && tops.every(assembly => Number(assembly.percent || 0) >= 100 || assembly.status === 'Complete');
  const finalizingComplete = finalizings.length > 0 && finalizings.every(assembly => !!assembly.finalizingComplete);
  const shippingComplete = shipping.length > 0 && shipping.every(assembly => !!assembly.shippingComplete);

  const testWaiting = tests.some(assembly => {
    const buildFinish = scheduleMap[`${assembly.id}|Build`]?.scheduledEnd || '';
    if (!buildFinish) return false;
    const release = testReleaseDate(buildFinish, assembly, data);
    return !!release && !assembly.finalizingComplete && !assembly.shippingComplete;
  });

  const steps: ProjectTimelineStep[] = [
    {
      key: 'subs',
      label: 'Subs',
      status: stepStatusFromFlags({
        needed: subs.length > 0,
        complete: subsComplete,
        blocked: subsBlocked || phaseWarningCount(projectWarnings, 'Build') > 0,
        scheduled: subs.some(assembly => !!scheduleMap[`${assembly.id}|Build`]),
      }),
      date: latestSubDate,
      employeeName: phaseEmployees(subs, employeesById, 'Build'),
      note: subs.length ? `${subs.length} sub assembly${subs.length === 1 ? '' : 'ies'}` : 'No sub assemblies on this project.',
      warningCount: phaseWarningCount(projectWarnings, 'Build'),
    },
    {
      key: 'top',
      label: 'Top Level',
      status: stepStatusFromFlags({
        needed: tops.length > 0,
        complete: topsComplete,
        blocked: topsBlocked || phaseWarningCount(projectWarnings, 'Build') > 0,
        scheduled: tops.some(assembly => !!scheduleMap[`${assembly.id}|Build`]),
      }),
      date: latestTopDate,
      employeeName: phaseEmployees(tops, employeesById, 'Build'),
      note: tops.length ? `${tops.length} top level build${tops.length === 1 ? '' : 's'}` : 'No top level assemblies on this project.',
      warningCount: phaseWarningCount(projectWarnings, 'Build'),
    },
    {
      key: 'test',
      label: 'Test',
      status: stepStatusFromFlags({
        needed: tests.length > 0,
        complete: tests.length > 0 && tests.every(assembly => {
          const buildFinish = scheduleMap[`${assembly.id}|Build`]?.scheduledEnd || '';
          const release = testReleaseDate(buildFinish, assembly, data);
          const finalizingStart = scheduleMap[`${assembly.id}|Finalizing`]?.scheduledStart || scheduleMap[`${assembly.id}|Shipping`]?.scheduledStart || '';
          return !!release && (!!finalizingStart ? finalizingStart >= release : !!assembly.finalizingComplete || !!assembly.shippingComplete);
        }),
        blocked: testBlocked,
        waiting: testWaiting,
        scheduled: tests.some(assembly => {
          const buildFinish = scheduleMap[`${assembly.id}|Build`]?.scheduledEnd || '';
          return !!testReleaseDate(buildFinish, assembly, data);
        }),
      }),
      date: latestTestRelease,
      employeeName: '',
      note: tests.length ? 'External gate between build and finalizing.' : 'No test gate required.',
      warningCount: projectWarnings.filter(warning => warning.reason.toLowerCase().includes('test')).length,
    },
    {
      key: 'finalize',
      label: 'Finalize',
      status: stepStatusFromFlags({
        needed: finalizings.length > 0,
        complete: finalizingComplete,
        blocked: finalizingBlocked || phaseWarningCount(projectWarnings, 'Finalizing') > 0,
        waiting: finalizings.some(assembly => {
          const buildFinish = scheduleMap[`${assembly.id}|Build`]?.scheduledEnd || '';
          const release = testReleaseDate(buildFinish, assembly, data);
          return !!release && !assembly.finalizingComplete && !scheduleMap[`${assembly.id}|Finalizing`];
        }),
        scheduled: finalizings.some(assembly => !!scheduleMap[`${assembly.id}|Finalizing`]),
      }),
      date: latestFinalizingDate,
      employeeName: phaseEmployees(finalizings, employeesById, 'Finalizing'),
      note: finalizings.length ? 'Finalizing must finish before shipping.' : 'No finalizing required.',
      warningCount: phaseWarningCount(projectWarnings, 'Finalizing'),
    },
    {
      key: 'ship',
      label: 'Ship',
      status: stepStatusFromFlags({
        needed: shipping.length > 0,
        complete: shippingComplete,
        blocked: shippingBlocked || phaseWarningCount(projectWarnings, 'Shipping') > 0,
        scheduled: shipping.some(assembly => !!scheduleMap[`${assembly.id}|Shipping`] || !!assembly.shipDate),
      }),
      date: latestShippingDate,
      employeeName: phaseEmployees(shipping, employeesById, 'Shipping'),
      note: shipping.length ? 'Final shipping completion is anchored to Ship By.' : 'No shipping step required.',
      warningCount: phaseWarningCount(projectWarnings, 'Shipping'),
    },
  ];

  return steps;
}

export function calculateProjectHealth(
  data: AppData,
  schedule: ScheduledItem[],
  warnings: ScheduleWarning[]
) {
  const today = dateOnly(new Date());
  const projects = (data.projects || []).filter(project => !project.archived);
  const scheduleMap = buildScheduleMap(schedule);

  const results: ProjectHealthRecord[] = projects.map(project => {
    const assemblies = (data.projectAssemblies || []).filter(assembly => assembly.projectId === project.id);
    const relevantAssemblies = assemblies.filter(assembly => assembly.type === 'Top Level Assembly' || isStandaloneSub(assembly));
    const topLevels = assemblies.filter(assembly => assembly.type === 'Top Level Assembly');
    const standaloneSubs = assemblies.filter(assembly => isStandaloneSub(assembly));
    const projectWarnings = warnings.filter(warning => warning.projectId === project.id);
    const projectSchedule = schedule.filter(item => item.projectId === project.id);
    const timeline = buildProjectTimeline(data, project.id, schedule, warnings);

    const lateItemsFromSchedule = projectSchedule.filter(item => item.isLate).length;
    const overdueIncomplete = assemblies.filter(assembly => {
      if (!assembly.shipDate || assembly.lateAllowed) return false;
      const buildDone = assembly.status === 'Complete' || Number(assembly.percent || 0) >= 100 || taskHours(assembly) <= 0;
      const finalizeDone = !assembly.finalizingRequired || !!assembly.finalizingComplete;
      const shipDone = !shippingExpected(assembly) || !!assembly.shippingComplete;
      return assembly.shipDate < today && !(buildDone && finalizeDone && shipDone);
    }).length;
    const lateItemCount = lateItemsFromSchedule + overdueIncomplete;

    const missingAssignmentCount = projectWarnings.filter(warning => warning.code === 'missing_build_assignment' || warning.code === 'missing_finalizing_assignment' || warning.code === 'missing_shipping_assignment').length;
    const overCapacityCount = projectWarnings.filter(warning => warning.code === 'over_capacity' || warning.code === 'non_working_day').length;

    const waitingOnTestAssemblies = assemblies.filter(assembly => {
      const hasTest = !!assembly.testRequired || Number(assembly.testHours || 0) > 0 || !!assembly.testReturnDateTime;
      if (!hasTest) return false;
      const buildItem = scheduleMap[`${assembly.id}|Build`];
      const buildReady = Number(assembly.percent || 0) >= 90 || assembly.status === 'Complete' || (!!buildItem && buildItem.scheduledEnd <= today);
      if (!buildReady || assembly.finalizingComplete || assembly.shippingComplete) return false;
      const release = testReleaseDate(buildItem?.scheduledEnd || '', assembly, data);
      return !!release && (!scheduleMap[`${assembly.id}|Finalizing`] || release >= today);
    });
    const waitingOnTestCount = waitingOnTestAssemblies.length;

    const waitingOnFinalizingAssemblies = assemblies.filter(assembly => {
      if (!assembly.finalizingRequired || assembly.finalizingComplete) return false;
      const buildItem = scheduleMap[`${assembly.id}|Build`];
      const buildReady = Number(assembly.percent || 0) >= 90 || assembly.status === 'Complete' || (!!buildItem && buildItem.scheduledEnd <= today);
      if (!buildReady) return false;
      const release = testReleaseDate(buildItem?.scheduledEnd || '', assembly, data);
      return !release || release <= today;
    });
    const waitingOnFinalizingCount = waitingOnFinalizingAssemblies.length;

    const readyToShipAssemblies = relevantAssemblies.filter(assembly => {
      if (!shippingExpected(assembly) || assembly.shippingComplete) return false;
      if (!phaseAssignments(assembly, 'Shipping').length) return false;
      const buildItem = scheduleMap[`${assembly.id}|Build`];
      if (!buildItem) return false;
      const buildReady = Number(assembly.percent || 0) >= 90 || assembly.status === 'Complete' || buildItem.scheduledEnd <= today;
      if (!buildReady) return false;
      const release = testReleaseDate(buildItem.scheduledEnd || '', assembly, data);
      const finalizingReady = !assembly.finalizingRequired || assembly.finalizingComplete || !!scheduleMap[`${assembly.id}|Finalizing`];
      const beforeShip = !assembly.shipDate || (maxDate(release || buildItem.scheduledEnd, scheduleMap[`${assembly.id}|Finalizing`]?.scheduledEnd || '') <= assembly.shipDate);
      return finalizingReady && beforeShip;
    });
    const readyToShipCount = readyToShipAssemblies.length;

    const anyHold = assemblies.some(assembly => assembly.status === 'On Hold' || !!String(assembly.holdReason || '').trim());
    const allRelevantDone = relevantAssemblies.length > 0 && allDone(relevantAssemblies);

    let status: ProjectHealthStatus = 'On Track';
    let reason = 'No current schedule warnings.';
    if (lateItemCount > 0) {
      status = 'Late';
      reason = `${lateItemCount} late or overdue schedule item${lateItemCount === 1 ? '' : 's'}.`;
    } else if (missingAssignmentCount > 0) {
      status = 'Missing Assignment';
      reason = `${missingAssignmentCount} required assignment warning${missingAssignmentCount === 1 ? '' : 's'}.`;
    } else if (overCapacityCount > 0) {
      status = 'Over Capacity';
      reason = `${overCapacityCount} capacity warning${overCapacityCount === 1 ? '' : 's'} tied to this project.`;
    } else if (waitingOnFinalizingCount > 0) {
      status = 'Waiting on Finalizing';
      reason = `${waitingOnFinalizingCount} item${waitingOnFinalizingCount === 1 ? '' : 's'} ready for finalizing.`;
    } else if (waitingOnTestCount > 0) {
      status = 'Waiting on Test';
      reason = `${waitingOnTestCount} item${waitingOnTestCount === 1 ? '' : 's'} waiting on test return or release.`;
    } else if (readyToShipCount > 0 && !projectWarnings.length && !anyHold) {
      status = 'Ready to Ship';
      reason = `${readyToShipCount} item${readyToShipCount === 1 ? '' : 's'} ready for final shipping.`;
    } else if (projectWarnings.length > 0 || anyHold || (!allRelevantDone && project.status === 'On Hold')) {
      status = 'At Risk';
      reason = projectWarnings.length
        ? `${projectWarnings.length} schedule warning${projectWarnings.length === 1 ? '' : 's'} need review.`
        : 'Project has an active hold or timeline concern.';
    }

    return {
      projectId: project.id,
      projectCode: projectLabel(project),
      projectName: projectName(project),
      dueDate: project.dueDate || '',
      status,
      tone: healthTone(status),
      reason,
      warningCount: projectWarnings.length,
      criticalWarnings: projectWarnings.filter(warning => warning.level === 'critical').length,
      capacityWarnings: projectWarnings.filter(warning => warning.level === 'capacity').length,
      infoWarnings: projectWarnings.filter(warning => warning.level === 'info').length,
      topLevelCount: topLevels.length,
      standaloneSubCount: standaloneSubs.length,
      readyToShipCount,
      lateItemCount,
      missingAssignmentCount,
      overCapacityCount,
      waitingOnTestCount,
      waitingOnFinalizingCount,
      relatedAssemblyIds: assemblies.map(assembly => assembly.id),
      timeline,
    };
  });

  return results.sort((a, b) => a.projectCode.localeCompare(b.projectCode) || a.projectName.localeCompare(b.projectName));
}

export function summarizeProjectHealth(records: ProjectHealthRecord[]) {
  return {
    onTrack: records.filter(record => record.status === 'On Track').length,
    atRisk: records.filter(record => record.status === 'At Risk').length,
    late: records.filter(record => record.status === 'Late').length,
    missingAssignment: records.filter(record => record.status === 'Missing Assignment').length,
    readyToShip: records.filter(record => record.status === 'Ready to Ship').length,
  };
}
