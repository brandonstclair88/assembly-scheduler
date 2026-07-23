'use client';

import React, { useEffect, useMemo, useState } from 'react';
import { AppData } from '../lib/types';
import { APP_VERSION, migrate } from '../lib/migrate';
import { splitIds, dateOnly, fmtDate, fmtDateTime } from '../lib/format';
import { defaultData, STORAGE_KEY } from '../lib/defaultData';
import { buildSchedule, capacityForDate, dailyHours, scheduleHealth } from '../lib/scheduler';
import { expandChunks, sortChunksByDate } from '../lib/chunks';
import { calculateScheduleWarnings } from '../lib/scheduleWarnings';
import { calculateProjectHealth, healthTone } from '../lib/projectHealth';
import { calculateTodayPriorities } from '../lib/todayPriorities';
import { previewSmartAssignSuggestions, smartAssignSuggestionMapByAssemblyPhase } from '../lib/smartAssign';

type MobileTab = 'today' | 'week' | 'projects' | 'detail' | 'people';

function nextDate(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + 1);
  return dateOnly(date);
}

function addDays(value: string, amount: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + amount);
  return dateOnly(date);
}

function mondayOfDate(date: Date) {
  const next = new Date(date);
  const day = next.getDay() || 7;
  next.setDate(next.getDate() - day + 1);
  return dateOnly(next);
}

function mondayOfValue(value: string) {
  return mondayOfDate(new Date(`${value}T00:00:00`));
}

function statusTone(source: any, item: any) {
  if (source?.status === 'On Hold' || source?.holdReason) return 'blocked';
  if (item?.isLate) return 'late';
  if (Number(source?.percent || 0) >= 100 || source?.status === 'Complete') return 'good';
  return 'neutral';
}

function taskHours(assembly: any) {
  return Math.max(0, Number(assembly?.qty || 1) * Number(assembly?.hoursEach || 0));
}

function projectCompletion(data: AppData, projectId: string) {
  const rows = (data.projectAssemblies || []).filter(row => row.projectId === projectId);
  if (!rows.length) return 0;
  const total = rows.reduce((sum, row) => sum + Number(row.percent || 0), 0);
  return Math.round(total / rows.length);
}

function loadLocal() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return migrate(JSON.parse(raw));
  } catch {}
  return migrate(defaultData);
}

async function loadFromApi() {
  try {
    const response = await fetch('/api/data', { cache: 'no-store' });
    const json = await response.json().catch(() => null);
    if (response.ok && json?.ok && json?.data) {
      return { data: migrate(json.data), source: 'SQLite data' };
    }
    throw new Error(json?.error || 'Unable to load scheduler data.');
  } catch (error: any) {
    return { data: loadLocal(), source: 'Browser fallback cache', error: error?.message || 'Unable to load scheduler data.' };
  }
}

function dayLabel(date: string) {
  return new Date(`${date}T00:00:00`).toLocaleDateString(undefined, { weekday: 'short' });
}

function employeeDateList(value: string) {
  return splitIds(String(value || '')).filter(token => /^\d{4}-\d{2}-\d{2}$/.test(token)).sort();
}

function badgeText(item: any, source: any) {
  if (source?.status === 'On Hold' || source?.holdReason) return 'Hold';
  if (item?.isLate) return source?.lateAllowed ? 'Late Allowed' : 'Late';
  return item?.phase || 'Build';
}

function warningTone(level: string) {
  if (level === 'critical') return 'late';
  if (level === 'capacity') return 'blocked';
  return 'neutral';
}

function phaseLabel(phase: string) {
  if (phase === 'Finalizing') return 'FINALIZE';
  if (phase === 'Shipping') return 'SHIP';
  if (phase === 'Test') return 'TEST';
  return 'BUILD';
}

function phaseTone(phase: string) {
  if (phase === 'Finalizing') return 'finalize';
  if (phase === 'Shipping') return 'ship';
  if (phase === 'Test') return 'test';
  return 'build';
}

function MobileHealthBadge({ status }: { status: string }) {
  return <span className={`mobileHealthBadge tone-${healthTone(status as any)}`}>{status}</span>;
}

export default function MobileViewer() {
  const [tab, setTab] = useState<MobileTab>('today');
  const [data, setData] = useState<AppData>(defaultData);
  const [loaded, setLoaded] = useState(false);
  const [sourceLabel, setSourceLabel] = useState('Loading');
  const [loadError, setLoadError] = useState('');
  const [updatedAt, setUpdatedAt] = useState('');
  const [selectedProjectId, setSelectedProjectId] = useState('');
  const [selectedEmployeeId, setSelectedEmployeeId] = useState('');
  const [weeklyProjectFocusId, setWeeklyProjectFocusId] = useState('All');
  const [weekStart, setWeekStart] = useState(() => mondayOfDate(new Date()));

  async function refresh() {
    const result = await loadFromApi();
    setData(result.data);
    setSourceLabel(result.source);
    setLoadError(result.error || '');
    setUpdatedAt(new Date().toISOString());
    setLoaded(true);
  }

  useEffect(() => {
    refresh();
  }, []);

  const schedule = useMemo(() => buildSchedule(data), [data]);
  const health = useMemo(() => scheduleHealth(data), [data]);
  const warnings = useMemo(() => calculateScheduleWarnings(data, schedule), [data, schedule]);
  const projectHealth = useMemo(() => calculateProjectHealth(data, schedule, warnings), [data, schedule, warnings]);
  const today = dateOnly(new Date());
  const priorities = useMemo(() => calculateTodayPriorities(data, schedule, warnings, projectHealth, today), [data, schedule, warnings, projectHealth, today]);
  const autoAssignSuggestions = useMemo(() => previewSmartAssignSuggestions(data, schedule, { assignBlanksOnly: true, prioritizeShipDates: true }), [data, schedule]);
  const autoAssignSuggestionMap = useMemo(() => smartAssignSuggestionMapByAssemblyPhase(autoAssignSuggestions), [autoAssignSuggestions]);
  const activeEmployees = useMemo(() => (data.employees || []).filter(employee => employee.active !== false), [data.employees]);
  const visibleProjects = useMemo(() => (data.projects || []).filter(project => !project.archived), [data.projects]);
  const projectMap = useMemo(() => Object.fromEntries(visibleProjects.map(project => [project.id, project])), [visibleProjects]);
  const projectHealthMap = useMemo(() => Object.fromEntries(projectHealth.map(record => [record.projectId, record])), [projectHealth]);
  const assemblyMap = useMemo(() => Object.fromEntries((data.projectAssemblies || []).map(assembly => [assembly.id, assembly])), [data.projectAssemblies]);

  useEffect(() => {
    if (!selectedProjectId && visibleProjects[0]) setSelectedProjectId(visibleProjects[0].id);
    if (selectedProjectId && !visibleProjects.some(project => project.id === selectedProjectId)) {
      setSelectedProjectId(visibleProjects[0]?.id || '');
    }
  }, [selectedProjectId, visibleProjects]);

  useEffect(() => {
    if (!selectedEmployeeId && activeEmployees[0]) setSelectedEmployeeId(activeEmployees[0].id);
    if (selectedEmployeeId && !activeEmployees.some(employee => employee.id === selectedEmployeeId)) {
      setSelectedEmployeeId(activeEmployees[0]?.id || '');
    }
  }, [selectedEmployeeId, activeEmployees]);

  function sourceAssembly(item: any) {
    const sourceId = item?.sourceAssemblyId || String(item?.id || '').split('|')[0];
    return assemblyMap[sourceId];
  }

  function autoAssignSuggestionFor(item: any) {
    const sourceId = item?.sourceAssemblyId || String(item?.id || '').split('|')[0];
    const phase = item?.phase || 'Build';
    return autoAssignSuggestionMap[`${sourceId}|${phase}`];
  }

  function projectFor(projectId: string) {
    return projectMap[projectId] || { projectId: 'Project', name: 'Project' };
  }

  function expandChunksForRange(startDate: string, endDate: string) {
    return sortChunksByDate(expandChunks(data, schedule, { startDate, endDate }));
  }

  const todayChunks = useMemo(() => expandChunksForRange(today, today), [data, schedule, today]);
  const weekWindowEnd = addDays(weekStart, 6);
  const weekChunks = useMemo(() => expandChunksForRange(weekStart, weekWindowEnd), [data, schedule, weekStart, weekWindowEnd]);
  const fridayDate = addDays(weekStart, 4);
  const boardDates = [
    { label: 'Mon', date: weekStart },
    { label: 'Tue', date: addDays(weekStart, 1) },
    { label: 'Wed', date: addDays(weekStart, 2) },
    { label: 'Thu', date: addDays(weekStart, 3) },
    { label: 'Fri', date: fridayDate },
  ];

  const todayHours = todayChunks.reduce((sum, chunk) => sum + (Number(chunk.chunkHours) || 0), 0);
  const unassignedToday = todayChunks.filter(chunk => !chunk.employeeChunkId);
  const warningCounts = {
    critical: warnings.filter(warning => warning.level === 'critical').length,
    capacity: warnings.filter(warning => warning.level === 'capacity').length,
    info: warnings.filter(warning => warning.level === 'info').length,
  };
  const employeeTodayCards = activeEmployees.map(employee => {
    const cards = todayChunks.filter(chunk => chunk.employeeChunkId === employee.id);
    const hours = cards.reduce((sum, chunk) => sum + (Number(chunk.chunkHours) || 0), 0);
    return { employee, cards, hours };
  });

  const next30 = addDays(today, 30);
  const absenceEvents: any[] = [];
  (data.holidays || []).forEach(holiday => {
    if (holiday.date >= today && holiday.date <= next30) {
      absenceEvents.push({ date: holiday.date, employee: 'All Employees', reason: holiday.name || 'Company Holiday', type: 'Holiday' });
    }
  });
  activeEmployees.forEach(employee => {
    employeeDateList(employee.timeOffDates || employee.pto || '').forEach(date => {
      if (date >= today && date <= next30) {
        absenceEvents.push({ date, employee: employee.name, reason: 'Scheduled Out', type: 'Employee' });
      }
    });
  });
  absenceEvents.sort((a, b) => a.date.localeCompare(b.date) || a.employee.localeCompare(b.employee));
  const todaysAbsences = absenceEvents.filter(event => event.date === today);

  const upcomingShipWindow = addDays(today, 14);
  const upcomingBatches = (data.shipmentBatches || [])
    .filter(batch => batch.shipDate >= today && batch.shipDate <= upcomingShipWindow)
    .sort((a, b) => String(a.shipDate).localeCompare(String(b.shipDate)));
  const upcomingSingles = (data.projectAssemblies || [])
    .filter(assembly => assembly.type === 'Top Level Assembly' && !assembly.batchId && assembly.shipDate >= today && assembly.shipDate <= upcomingShipWindow)
    .sort((a, b) => String(a.shipDate).localeCompare(String(b.shipDate)));

  const atRisk = schedule
    .filter(item => {
      const source = sourceAssembly(item);
      if (!source || source.status === 'Complete') return false;
      if (source.holdReason || source.status === 'On Hold') return true;
      if (item.isLate) return true;
      if (source.shipDate) {
        const daysAway = (new Date(`${source.shipDate}T00:00:00`).getTime() - new Date(`${today}T00:00:00`).getTime()) / 86400000;
        return daysAway <= 5 && Number(source.percent || 0) < 90;
      }
      return false;
    })
    .slice(0, 8);

  const selectedProject = visibleProjects.find(project => project.id === selectedProjectId) || visibleProjects[0];
  const projectAssemblies = (data.projectAssemblies || []).filter(assembly => assembly.projectId === selectedProject?.id);
  const topLevelAssemblies = projectAssemblies
    .filter(assembly => assembly.type === 'Top Level Assembly')
    .sort((a, b) => (Number(a.instanceNumber) || 0) - (Number(b.instanceNumber) || 0));
  const standaloneSubs = projectAssemblies
    .filter(assembly => assembly.type === 'Sub Assembly' && !assembly.parentAssemblyId && !assembly.buildGroupId)
    .sort((a, b) => String(a.shipDate || '').localeCompare(String(b.shipDate || '')) || String(a.partNumber || '').localeCompare(String(b.partNumber || '')));

  const selectedEmployee = activeEmployees.find(employee => employee.id === selectedEmployeeId) || activeEmployees[0];
  const employeeWeekHours = (employeeId: string) => weekChunks.filter(chunk => chunk.employeeChunkId === employeeId).reduce((sum, chunk) => sum + (Number(chunk.chunkHours) || 0), 0);
  const employeeTodayHours = (employeeId: string) => todayChunks.filter(chunk => chunk.employeeChunkId === employeeId).reduce((sum, chunk) => sum + (Number(chunk.chunkHours) || 0), 0);
  const currentWeekEnd = boardDates[boardDates.length - 1]?.date || addDays(weekStart, 3);
  const selectedProjectRecord = selectedProject ? projectHealthMap[selectedProject.id] : undefined;

  function chunkProjectId(chunk: any) {
    return sourceAssembly(chunk)?.projectId || chunk?.projectId || '';
  }

  const visibleWeekChunks = weeklyProjectFocusId === 'All'
    ? weekChunks
    : weekChunks.filter(chunk => chunkProjectId(chunk) === weeklyProjectFocusId);

  function projectOpenHolds(projectId: string) {
    return (data.holds || []).filter(hold => hold.projectId === projectId && hold.status !== 'Closed').length
      + (data.projectAssemblies || []).filter(assembly => assembly.projectId === projectId && (assembly.status === 'On Hold' || !!String(assembly.holdReason || '').trim())).length;
  }

  function nextTimeOff(employee: any) {
    return employeeDateList(employee?.timeOffDates || employee?.pto || '').find(date => date >= today) || '';
  }

  function employeeFridayOtThisWeek(employee: any) {
    return splitIds(employee?.fridayOvertimeDates || '').filter(date => date >= weekStart && date <= currentWeekEnd);
  }

  function employeeCardsForDay(employeeId: string, date: string) {
    return visibleWeekChunks.filter(chunk => chunk.employeeChunkId === employeeId && chunk.chunkDate === date);
  }

  function unassignedCardsForDay(date: string) {
    return visibleWeekChunks.filter(chunk => !chunk.employeeChunkId && chunk.chunkDate === date);
  }

  function testItemsForDay(date: string) {
    const rows: any[] = [];
    for (const assembly of (data.projectAssemblies || [])) {
      const hasTest = !!assembly.testRequired || Number(assembly.testHours || 0) > 0 || !!assembly.testReturnDateTime;
      if (!hasTest || assembly.finalizingComplete || assembly.shippingComplete) continue;
      if (weeklyProjectFocusId !== 'All' && assembly.projectId !== weeklyProjectFocusId) continue;
      const buildEnd = schedule.find(item => (item.sourceAssemblyId || String(item.id).split('|')[0]) === assembly.id && (item.phase || 'Build') === 'Build')?.scheduledEnd || '';
      if (!buildEnd) continue;
      let estimated = buildEnd;
      let remaining = Number(assembly.testHours || 0);
      let cursor = nextDate(buildEnd);
      let guard = 0;
      while (remaining > 0 && guard++ < 240) {
        const day = new Date(`${cursor}T00:00:00`).getDay();
        const holiday = (data.holidays || []).some(holidayRow => holidayRow.date === cursor);
        if (day >= 1 && day <= 4 && !holiday) {
          remaining -= Math.max(0.1, dailyHours(data));
          estimated = cursor;
        }
        cursor = nextDate(cursor);
      }
      const manualReturn = assembly.testReturnDateTime ? String(assembly.testReturnDateTime).slice(0, 10) : '';
      const testEnd = manualReturn && manualReturn > estimated ? manualReturn : estimated;
      if (date > buildEnd && date <= testEnd) rows.push(assembly);
    }
    return rows.sort((a, b) => String(a.shipDate || '').localeCompare(String(b.shipDate || '')) || String(a.partNumber || '').localeCompare(String(b.partNumber || '')));
  }

  function phaseLine(assembly: any) {
    const parts = [`Build ${taskHours(assembly).toFixed(1)}h`];
    if (assembly.testRequired || Number(assembly.testHours || 0) > 0) parts.push(`Test ${Number(assembly.testHours || 0).toFixed(1)}h`);
    if (assembly.finalizingRequired) parts.push(`Finalizing ${Number(assembly.finalizingHours || 0).toFixed(1)}h`);
    if (assembly.shippingRequired) parts.push(`Shipping ${Number(assembly.shippingHours || 0).toFixed(1)}h`);
    return parts.join(' • ');
  }

  function openProject(projectId: string) {
    setSelectedProjectId(projectId);
    setTab('detail');
  }

  return (
    <main className="mobileViewer">
      <section className="mobileHero">
        <div>
          <span className="mobileEyebrow">Shop Floor Viewer</span>
          <h1>Assembly Scheduler Mobile</h1>
          <p>Read-only phone view using the same SQLite scheduler data as the main app.</p>
        </div>
        <button className="mobileActionButton" onClick={refresh}>Refresh</button>
      </section>

      <section className="mobileStatusBar">
        <span className="mobileBadge mobileReadOnly">Read Only</span>
        <span className="mobileBadge">v{APP_VERSION}</span>
        <span className="mobileBadge">{sourceLabel}</span>
        <span className="mobileBadge">{updatedAt ? `Updated ${fmtDateTime(updatedAt)}` : 'Waiting for data'}</span>
      </section>

      {loadError && <section className="mobileWarning"><b>Data warning:</b> {loadError}</section>}

      <nav className="mobileNav" aria-label="Mobile viewer navigation">
        <button className={tab === 'today' ? 'active' : ''} onClick={() => setTab('today')}>Today</button>
        <button className={tab === 'week' ? 'active' : ''} onClick={() => setTab('week')}>Weekly Board</button>
        <button className={tab === 'projects' ? 'active' : ''} onClick={() => setTab('projects')}>Projects</button>
        <button className={tab === 'detail' ? 'active' : ''} onClick={() => setTab('detail')}>Project Detail</button>
        <button className={tab === 'people' ? 'active' : ''} onClick={() => setTab('people')}>People</button>
      </nav>

      {!loaded ? (
        <section className="mobilePanel">
          <h2>Loading</h2>
          <p className="muted">Pulling the latest scheduler data for mobile view.</p>
        </section>
      ) : (
        <>
          {tab === 'today' && (
            <section className="mobileStack">
              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Today Dashboard</h2>
                    <p>{fmtDate(today)} • live read-only snapshot</p>
                  </div>
                </div>
                <div className="mobileKpiGrid">
                  <div className="mobileKpiCard"><b>{todayHours.toFixed(1)}</b><span>scheduled hrs</span></div>
                  <div className="mobileKpiCard"><b>{todaysAbsences.length}</b><span>out today</span></div>
                  <div className="mobileKpiCard"><b>{health.late}</b><span>late items</span></div>
                  <div className="mobileKpiCard"><b>{health.onHold}</b><span>open holds</span></div>
                </div>
              </section>

              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Today&apos;s Priorities</h2>
                    <p>Compact read-only list for finalizings, shipping, capacity, dependencies, and assignments.</p>
                  </div>
                </div>
                <div className="mobileMiniList">
                  {priorities.length === 0 && <p className="muted">No urgent priority items for today.</p>}
                  {priorities.map(priority => (
                    <div className={`mobileMiniItem tone-${priority.tone === 'critical' ? 'late' : priority.tone === 'capacity' ? 'blocked' : 'neutral'}`} key={priority.id}>
                      <b>{priority.title} • {priority.count}</b>
                      <span>{priority.detail}</span>
                    </div>
                  ))}
                </div>
              </section>

              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Work by Employee</h2>
                    <p>Touch-friendly daily view with no edit actions.</p>
                  </div>
                </div>
                <div className="mobileCardList">
                  {employeeTodayCards.map(({ employee, cards, hours }) => {
                    const outToday = todaysAbsences.some(event => event.employee === employee.name || event.employee === 'All Employees');
                    return (
                      <article className={`mobileInfoCard ${outToday ? 'isOut' : ''}`} key={employee.id}>
                        <div className="mobileInfoTop">
                          <div>
                            <h3>{employee.name}</h3>
                            <p>{employee.skills || 'Production'}</p>
                          </div>
                          <span className="mobilePill">{outToday ? 'Out' : `${hours.toFixed(1)}h`}</span>
                        </div>
                        {cards.length ? (
                          <div className="mobileMiniList">
                            {cards.slice(0, 3).map((card: any, index: number) => {
                              const source = sourceAssembly(card);
                              return (
                                <div className={`mobileMiniItem tone-${statusTone(source, card)}`} key={`${card.id}-${index}`}>
                                  <b>{card.partNumber} {source?.instanceLabel || ''}</b>
                                  <span>{card.projectName} • {badgeText(card, source)} • {Number(card.chunkHours || 0).toFixed(1)}h</span>
                                </div>
                              );
                            })}
                            {cards.length > 3 && <div className="mobileMiniItem"><span>+{cards.length - 3} more tasks</span></div>}
                          </div>
                        ) : (
                          <p className="muted">{outToday ? 'Unavailable for production today.' : 'No work scheduled today.'}</p>
                        )}
                      </article>
                    );
                  })}
                  {unassignedToday.length > 0 && (
                    <article className="mobileInfoCard">
                      <div className="mobileInfoTop">
                        <div>
                          <h3>Unassigned</h3>
                          <p>Work that still needs an employee</p>
                        </div>
                        <span className="mobilePill">{unassignedToday.length}</span>
                      </div>
                      <div className="mobileMiniList">
                        {unassignedToday.map((card: any, index: number) => {
                          const source = sourceAssembly(card);
                          return (
                            <div className={`mobileMiniItem tone-${statusTone(source, card)}`} key={`${card.id}-u-${index}`}>
                              <b>{card.partNumber} {source?.instanceLabel || ''}</b>
                              <span>{card.projectName} • {badgeText(card, source)} • {Number(card.chunkHours || 0).toFixed(1)}h</span>
                            </div>
                          );
                        })}
                      </div>
                    </article>
                  )}
                </div>
              </section>

              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Needs Attention</h2>
                    <p>Late, held, or approaching-ship work.</p>
                  </div>
                </div>
                <div className="mobileMiniList">
                  {atRisk.length === 0 && <p className="muted">No urgent issues found.</p>}
                  {atRisk.map((item: any, index: number) => {
                    const source = sourceAssembly(item) || item;
                    return (
                      <div className={`mobileMiniItem tone-${statusTone(source, item)}`} key={`${item.id}-risk-${index}`}>
                        <b>{item.projectName}</b>
                        <span>{source.description || source.partNumber} {source.instanceLabel || ''}</span>
                        <small>{source.holdReason ? 'On hold' : item.isLate ? 'Late / at risk' : `Ship By ${fmtDate(source.shipDate)}`}</small>
                      </div>
                    );
                  })}
                </div>
              </section>

              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Schedule Warnings</h2>
                    <p>Read-only warning list for assignments, capacity, and dependency timing.</p>
                  </div>
                </div>
                <div className="mobileStatusBar">
                  <span className="mobileBadge">{warningCounts.critical} critical</span>
                  <span className="mobileBadge">{warningCounts.capacity} capacity</span>
                  <span className="mobileBadge">{warningCounts.info} info</span>
                </div>
                <div className="mobileMiniList">
                  {warnings.length === 0 && <p className="muted">No current schedule warnings.</p>}
                  {warnings.slice(0, 6).map(warning => (
                    <div className={`mobileMiniItem tone-${warningTone(warning.level)}`} key={warning.id}>
                      <b>{warning.projectName}</b>
                      <span>{warning.partNumber} — {warning.description}</span>
                      <small>{warning.date ? `${fmtDate(warning.date)} • ` : ''}{warning.employeeName ? `${warning.employeeName} • ` : ''}{warning.reason}</small>
                    </div>
                  ))}
                  {warnings.length > 6 && <p className="muted small">Showing 6 of {warnings.length} warnings.</p>}
                </div>
              </section>

              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Upcoming Shipments</h2>
                    <p>Next two production weeks.</p>
                  </div>
                </div>
                <div className="mobileMiniList">
                  {upcomingBatches.length === 0 && upcomingSingles.length === 0 && <p className="muted">No shipments due in the next two weeks.</p>}
                  {upcomingBatches.map(batch => {
                    const linked = (data.projectAssemblies || []).filter(assembly => assembly.batchId === batch.id);
                    return (
                      <div className="mobileMiniItem" key={batch.id}>
                        <b>{fmtDate(batch.shipDate)} • {batch.name}</b>
                        <span>{projectFor(batch.projectId).projectId} • {linked.length} assembly group{linked.length === 1 ? '' : 's'}</span>
                      </div>
                    );
                  })}
                  {upcomingSingles.map(assembly => (
                    <div className="mobileMiniItem" key={assembly.id}>
                      <b>{fmtDate(assembly.shipDate)} • {assembly.description || assembly.partNumber} {assembly.instanceLabel || ''}</b>
                      <span>{projectFor(assembly.projectId).projectId} • P/N {assembly.partNumber}</span>
                    </div>
                  ))}
                </div>
              </section>
            </section>
          )}

          {tab === 'week' && (
            <section className="mobileStack">
              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Weekly Schedule Board</h2>
                    <p>{fmtDate(weekStart)} through {fmtDate(currentWeekEnd)}</p>
                  </div>
                </div>
                <div className="mobileWeekNav">
                  <button className="mobileActionButton secondary" onClick={() => setWeekStart(addDays(weekStart, -7))}>Previous</button>
                  <button className="mobileActionButton secondary" onClick={() => setWeekStart(mondayOfValue(today))}>Current Week</button>
                  <button className="mobileActionButton secondary" onClick={() => setWeekStart(addDays(weekStart, 7))}>Next</button>
                </div>
                <div className="mobileField">
                  <label>Project Focus</label>
                  <select value={weeklyProjectFocusId} onChange={event => setWeeklyProjectFocusId(event.target.value)}>
                    <option value="All">All Projects</option>
                    {visibleProjects.map(project => (
                      <option key={project.id} value={project.id}>{project.projectId} • {project.name}</option>
                    ))}
                  </select>
                </div>
              </section>

              {boardDates.map(day => {
                const dayCards = visibleWeekChunks.filter(chunk => chunk.chunkDate === day.date);
                const testCards = testItemsForDay(day.date);
                return (
                  <section className="mobilePanel mobileDayPanel" key={day.date}>
                    <div className="mobilePanelHeader">
                      <div>
                        <h2>{day.label} • {fmtDate(day.date)}</h2>
                        <p>{dayCards.reduce((sum, chunk) => sum + (Number(chunk.chunkHours) || 0), 0).toFixed(1)} scheduled hours</p>
                      </div>
                    </div>

                    {dayCards.length === 0 ? (
                      <p className="muted">No scheduled work on this production day.</p>
                    ) : (
                      <div className="mobileBoardDay">
                        {activeEmployees.map(employee => {
                          const cards = employeeCardsForDay(employee.id, day.date);
                          if (!cards.length) return null;
                          const capacity = capacityForDate(data, employee.id, day.date);
                          const hours = cards.reduce((sum, chunk) => sum + (Number(chunk.chunkHours) || 0), 0);
                          return (
                            <article className="mobileLane" key={`${employee.id}-${day.date}`}>
                              <div className="mobileLaneHeader">
                                <div>
                                  <b>{employee.name}</b>
                                  <span>{employee.skills || 'Production'}</span>
                                </div>
                                <span className={`mobilePill ${hours > capacity ? 'late' : ''}`}>{hours.toFixed(1)} / {capacity.toFixed(1)}h</span>
                              </div>
                              <div className="mobileTaskList">
                                {cards.map((card: any, index: number) => {
                                  const source = sourceAssembly(card);
                                  const suggestion = autoAssignSuggestionFor(card);
                                  return (
                                    <div className={`mobileTaskCard tone-${statusTone(source, card)} phase-${phaseTone(card.phase || 'Build')}`} key={`${card.id}-${index}`}>
                                      <div className="mobileTaskTop">
                                        <b>{card.partNumber} {source?.instanceLabel || ''}</b>
                                        <div className="mobileInfoBadgeStack">
                                          <span className={`mobileTaskBadge phase-${phaseTone(card.phase || 'Build')}`}>{phaseLabel(card.phase || 'Build')}</span>
                                          {source?.locked && <span className="mobileTaskBadge phase-slate">LOCK</span>}
                                        </div>
                                      </div>
                                      <span>{card.description || source?.description || 'Assembly work'}</span>
                                      {!card.employeeChunkId && suggestion?.employeeName && <small>Suggested: {suggestion.employeeName}</small>}
                                      {suggestion?.nonPreferredButNecessary && <small>Non-preferred but necessary</small>}
                                      <small>{card.projectName} • {Number(card.chunkHours || 0).toFixed(1)}h • Ship By {fmtDate(source?.shipDate || '')}</small>
                                    </div>
                                  );
                                })}
                              </div>
                            </article>
                          );
                        })}

                        {unassignedCardsForDay(day.date).length > 0 && (
                          <article className="mobileLane">
                            <div className="mobileLaneHeader">
                              <div>
                                <b>Unassigned</b>
                                <span>Needs employee assignment in desktop app</span>
                              </div>
                              <span className="mobilePill">{unassignedCardsForDay(day.date).length}</span>
                            </div>
                            <div className="mobileTaskList">
                              {unassignedCardsForDay(day.date).map((card: any, index: number) => {
                                const source = sourceAssembly(card);
                                const suggestion = autoAssignSuggestionFor(card);
                                return (
                                  <div className={`mobileTaskCard tone-${statusTone(source, card)} phase-${phaseTone(card.phase || 'Build')}`} key={`${card.id}-u-${index}`}>
                                    <div className="mobileTaskTop">
                                      <b>{card.partNumber} {source?.instanceLabel || ''}</b>
                                      <div className="mobileInfoBadgeStack">
                                        <span className={`mobileTaskBadge phase-${phaseTone(card.phase || 'Build')}`}>{phaseLabel(card.phase || 'Build')}</span>
                                        {source?.locked && <span className="mobileTaskBadge phase-slate">LOCK</span>}
                                      </div>
                                    </div>
                                    <span>{card.description || source?.description || 'Assembly work'}</span>
                                    {suggestion?.employeeName && <small>Suggested: {suggestion.employeeName}</small>}
                                    {suggestion?.nonPreferredButNecessary && <small>Non-preferred but necessary</small>}
                                    <small>{card.projectName} • {Number(card.chunkHours || 0).toFixed(1)}h • Ship By {fmtDate(source?.shipDate || '')}</small>
                                  </div>
                                );
                              })}
                            </div>
                          </article>
                        )}

                        {testCards.length > 0 && (
                          <article className="mobileLane">
                            <div className="mobileLaneHeader">
                              <div>
                                <b>In Test</b>
                                <span>External gate</span>
                              </div>
                              <span className="mobilePill">{testCards.length}</span>
                            </div>
                            <div className="mobileTaskList">
                              {testCards.map(testAssembly => (
                                <div className="mobileTaskCard phase-test tone-neutral" key={`${testAssembly.id}-test-${day.date}`}>
                                  <div className="mobileTaskTop">
                                    <b>{testAssembly.partNumber} {testAssembly.instanceLabel || ''}</b>
                                    <span className="mobileTaskBadge phase-test">{phaseLabel('Test')}</span>
                                  </div>
                                  <span>{testAssembly.description || 'Assembly in test'}</span>
                                  <small>{projectFor(testAssembly.projectId).projectId} • {testAssembly.testReturnDateTime ? `Expected return ${fmtDateTime(testAssembly.testReturnDateTime)}` : `Test gate ${Number(testAssembly.testHours || 0).toFixed(1)}h`}</small>
                                </div>
                              ))}
                            </div>
                          </article>
                        )}
                      </div>
                    )}
                  </section>
                );
              })}
            </section>
          )}

          {tab === 'projects' && (
            <section className="mobileStack">
              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Projects</h2>
                    <p>Read-only project list. Tap any card for summary details.</p>
                  </div>
                </div>
                <div className="mobileCardList">
                  {visibleProjects.map(project => {
                    const rows = (data.projectAssemblies || []).filter(assembly => assembly.projectId === project.id);
                    const tops = rows.filter(assembly => assembly.type === 'Top Level Assembly').length;
                    const looseSubs = rows.filter(assembly => assembly.type === 'Sub Assembly' && !assembly.parentAssemblyId && !assembly.buildGroupId).length;
                    const record = projectHealthMap[project.id];
                    return (
                      <article className="mobileInfoCard" key={project.id}>
                        <div className="mobileInfoTop">
                          <div>
                            <h3>{project.projectId}</h3>
                            <p>{project.name || 'Project'} • {project.customer || 'No customer'}</p>
                          </div>
                          <div className="mobileInfoBadgeStack">
                            {record && <MobileHealthBadge status={record.status} />}
                            <span className="mobilePill">{projectCompletion(data, project.id)}%</span>
                          </div>
                        </div>
                        <div className="mobileMetaGrid">
                          <span>Due {fmtDate(project.dueDate)}</span>
                          <span>{project.status}</span>
                          <span>{tops} top level</span>
                          <span>{looseSubs} standalone sub</span>
                          <span>{rows.length} assemblies</span>
                          <span>{projectOpenHolds(project.id)} holds</span>
                        </div>
                        {record && <p className="muted small">{record.reason}</p>}
                        <button className="mobileActionButton secondary" onClick={() => openProject(project.id)}>Open Summary</button>
                      </article>
                    );
                  })}
                  {visibleProjects.length === 0 && <p className="muted">No active projects found.</p>}
                </div>
              </section>
            </section>
          )}

          {tab === 'detail' && (
            <section className="mobileStack">
              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Project Detail</h2>
                    <p>Summary only. No edit or scheduling actions on mobile.</p>
                  </div>
                </div>
                <div className="mobileField">
                  <label>Project</label>
                  <select value={selectedProject?.id || ''} onChange={event => setSelectedProjectId(event.target.value)}>
                    {visibleProjects.map(project => (
                      <option key={project.id} value={project.id}>{project.projectId} • {project.name}</option>
                    ))}
                  </select>
                </div>
                {selectedProject ? (
                  <>
                    <article className="mobileInfoCard">
                      <div className="mobileInfoTop">
                        <div>
                          <h3>{selectedProject.projectId}</h3>
                          <p>{selectedProject.name || 'Project'} • {selectedProject.customer || 'No customer'}</p>
                        </div>
                        <div className="mobileInfoBadgeStack">
                          {selectedProjectRecord && <MobileHealthBadge status={selectedProjectRecord.status} />}
                          <span className="mobilePill">{projectCompletion(data, selectedProject.id)}%</span>
                        </div>
                      </div>
                      <div className="mobileMetaGrid">
                        <span>Due {fmtDate(selectedProject.dueDate)}</span>
                        <span>{selectedProject.status}</span>
                        <span>{selectedProject.projectType || 'New Build'}</span>
                        <span>{projectAssemblies.length} assemblies</span>
                        <span>{projectOpenHolds(selectedProject.id)} holds</span>
                        <span>{selectedProject.notes || 'No notes'}</span>
                      </div>
                    </article>

                    {selectedProjectRecord && (
                      <section className="mobileGroup">
                        <h3>Timeline</h3>
                        <div className="mobileTimeline">
                          {selectedProjectRecord.timeline.map(step => (
                            <article className={`mobileTimelineStep state-${String(step.status || 'Pending').toLowerCase().replace(/\s+/g, '-')}`} key={step.key}>
                              <div className="mobileTimelineTop">
                                <b>{step.label}</b>
                                <span className="mobileTaskBadge phase-slate">{step.status}</span>
                              </div>
                              <span>{step.date ? fmtDate(step.date) : 'No date yet'}</span>
                              {step.employeeName && <small>{step.employeeName}</small>}
                              {step.note && <small>{step.note}</small>}
                              {step.warningCount > 0 && <small>{step.warningCount} warning{step.warningCount === 1 ? '' : 's'}</small>}
                            </article>
                          ))}
                        </div>
                      </section>
                    )}

                    <section className="mobileGroup">
                      <h3>Top Level Builds</h3>
                      {topLevelAssemblies.length === 0 && <p className="muted">No top level assemblies on this project.</p>}
                      {topLevelAssemblies.map(top => {
                        const subs = projectAssemblies.filter(assembly => assembly.type === 'Sub Assembly' && ((assembly.parentAssemblyId && assembly.parentAssemblyId === top.id) || (assembly.buildGroupId && assembly.buildGroupId === top.buildGroupId)));
                        return (
                          <article className="mobileInfoCard" key={top.id}>
                            <div className="mobileInfoTop">
                              <div>
                                <h3>{top.partNumber} {top.instanceLabel || ''}</h3>
                                <p>{top.description || 'Top level assembly'}</p>
                              </div>
                              <div className="mobileInfoBadgeStack">
                                <span className={`mobileTaskBadge phase-${phaseTone('Build')}`}>{phaseLabel('Build')}</span>
                                {top.locked && <span className="mobileTaskBadge phase-slate">LOCK</span>}
                                <span className={`mobilePill ${statusTone(top, top)}`}>{top.percent || 0}%</span>
                              </div>
                            </div>
                            <div className="mobileMetaGrid">
                              <span>Ship By {fmtDate(top.shipDate)}</span>
                              <span>{top.status}</span>
                              <span>{phaseLine(top)}</span>
                              <span>{splitIds(top.assignedTo).length ? `${splitIds(top.assignedTo).length} assigned` : 'Unassigned'}</span>
                            </div>
                            {top.testReturnDateTime && <div className="mobileMiniItem"><span>Expected test return {fmtDateTime(top.testReturnDateTime)}</span></div>}
                            {subs.length > 0 && (
                              <div className="mobileSubList">
                                {subs.map(sub => (
                                  <div className={`mobileSubItem tone-${statusTone(sub, sub)}`} key={sub.id}>
                                    <b>{sub.partNumber} {sub.instanceLabel || ''}</b>
                                    <span>{sub.description || 'Sub assembly'}</span>
                                    <small>{sub.status} • {sub.percent || 0}% • Ship By {fmtDate(sub.shipDate)}</small>
                                  </div>
                                ))}
                              </div>
                            )}
                          </article>
                        );
                      })}
                    </section>

                    <section className="mobileGroup">
                      <h3>Standalone Subs</h3>
                      {standaloneSubs.length === 0 && <p className="muted">No standalone sub assemblies on this project.</p>}
                      {standaloneSubs.map(sub => (
                        <article className="mobileInfoCard" key={sub.id}>
                          <div className="mobileInfoTop">
                            <div>
                              <h3>{sub.partNumber} {sub.instanceLabel || ''}</h3>
                              <p>{sub.description || 'Sub assembly'}</p>
                            </div>
                            <div className="mobileInfoBadgeStack">
                              <span className={`mobileTaskBadge phase-${phaseTone('Build')}`}>{phaseLabel('Build')}</span>
                              {sub.locked && <span className="mobileTaskBadge phase-slate">LOCK</span>}
                              <span className={`mobilePill ${statusTone(sub, sub)}`}>{sub.percent || 0}%</span>
                            </div>
                          </div>
                          <div className="mobileMetaGrid">
                            <span>Ship By {fmtDate(sub.shipDate)}</span>
                            <span>{sub.status}</span>
                            <span>{phaseLine(sub)}</span>
                            <span>{splitIds(sub.assignedTo).length ? `${splitIds(sub.assignedTo).length} assigned` : 'Unassigned'}</span>
                          </div>
                        </article>
                      ))}
                    </section>
                  </>
                ) : (
                  <p className="muted">No project selected.</p>
                )}
              </section>
            </section>
          )}

          {tab === 'people' && (
            <section className="mobileStack">
              <section className="mobilePanel">
                <div className="mobilePanelHeader">
                  <div>
                    <h2>Employee Availability & Workload</h2>
                    <p>Daily and weekly workload with read-only availability signals.</p>
                  </div>
                </div>
                <div className="mobileCardList">
                  {activeEmployees.map(employee => {
                    const nextOut = nextTimeOff(employee);
                    const weekOt = employeeFridayOtThisWeek(employee);
                    return (
                      <button
                        type="button"
                        className={`mobileInfoCard mobileSelectable ${selectedEmployee?.id === employee.id ? 'selected' : ''}`}
                        key={employee.id}
                        onClick={() => setSelectedEmployeeId(employee.id)}
                      >
                        <div className="mobileInfoTop">
                          <div>
                            <h3>{employee.name}</h3>
                            <p>{employee.skills || 'Production'}</p>
                          </div>
                          <span className="mobilePill">{employeeWeekHours(employee.id).toFixed(1)}h</span>
                        </div>
                        <div className="mobileMetaGrid">
                          <span>{employeeTodayHours(employee.id).toFixed(1)}h today</span>
                          <span>{employeeWeekHours(employee.id).toFixed(1)}h this week</span>
                          <span>{nextOut ? `Next out ${fmtDate(nextOut)}` : 'No time off set'}</span>
                          <span>{weekOt.length ? `${weekOt.length} Friday OT` : 'No Friday OT this week'}</span>
                        </div>
                      </button>
                    );
                  })}
                </div>
              </section>

              {selectedEmployee && (
                <section className="mobilePanel">
                  <div className="mobilePanelHeader">
                    <div>
                      <h2>{selectedEmployee.name}</h2>
                      <p>{selectedEmployee.skills || 'Production'} • selected employee details</p>
                    </div>
                  </div>

                  <article className="mobileInfoCard">
                    <div className="mobileMetaGrid">
                      <span>{employeeTodayHours(selectedEmployee.id).toFixed(1)}h scheduled today</span>
                      <span>{employeeWeekHours(selectedEmployee.id).toFixed(1)}h scheduled this week</span>
                      <span>{selectedEmployee.canBuild === false ? 'Build off' : 'Build on'}</span>
                      <span>{selectedEmployee.canFinalize === false ? 'Finalize off' : 'Finalize on'}</span>
                      <span>{selectedEmployee.canShip === false ? 'Ship off' : 'Ship on'}</span>
                      <span>{nextTimeOff(selectedEmployee) ? `Next time off ${fmtDate(nextTimeOff(selectedEmployee))}` : 'No upcoming time off'}</span>
                    </div>
                  </article>

                  <div className="mobileDualList">
                    <div className="mobileMiniList">
                      <h3>Today's Tasks</h3>
                      {todayChunks.filter(chunk => chunk.employeeChunkId === selectedEmployee.id).length === 0 && <p className="muted">No scheduled work today.</p>}
                      {todayChunks.filter(chunk => chunk.employeeChunkId === selectedEmployee.id).map((chunk: any, index: number) => {
                        const source = sourceAssembly(chunk);
                        return (
                          <div className={`mobileMiniItem tone-${statusTone(source, chunk)}`} key={`${chunk.id}-detail-${index}`}>
                            <b>{chunk.partNumber} {source?.instanceLabel || ''}</b>
                            <span>{chunk.projectName} • {badgeText(chunk, source)} • {Number(chunk.chunkHours || 0).toFixed(1)}h</span>
                          </div>
                        );
                      })}
                    </div>

                    <div className="mobileMiniList">
                      <h3>Upcoming Availability</h3>
                      {employeeDateList(selectedEmployee.timeOffDates || selectedEmployee.pto || '').filter(date => date >= today).slice(0, 5).length === 0 && splitIds(selectedEmployee.fridayOvertimeDates || '').filter(date => date >= today).slice(0, 5).length === 0 && (
                        <p className="muted">No upcoming time off or Friday OT dates.</p>
                      )}
                      {employeeDateList(selectedEmployee.timeOffDates || selectedEmployee.pto || '').filter(date => date >= today).slice(0, 5).map(date => (
                        <div className="mobileMiniItem tone-blocked" key={`off-${date}`}>
                          <b>{fmtDate(date)}</b>
                          <span>Scheduled out</span>
                        </div>
                      ))}
                      {splitIds(selectedEmployee.fridayOvertimeDates || '').filter(date => date >= today).slice(0, 5).map(date => (
                        <div className="mobileMiniItem tone-good" key={`ot-${date}`}>
                          <b>{fmtDate(date)}</b>
                          <span>Friday overtime enabled</span>
                        </div>
                      ))}
                    </div>
                  </div>
                </section>
              )}
            </section>
          )}
        </>
      )}
    </main>
  );
}
