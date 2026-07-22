'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {expandChunks} from '../../lib/chunks';
import {dateOnly,fmtDate,fmtDateTime,splitIds} from '../../lib/format';
import {healthTone} from '../../lib/projectHealth';
import {capacityForDate} from '../../lib/scheduler';
import {calculateTodayPriorities} from '../../lib/todayPriorities';

export function Dashboard({data,schedule,health,warnings,projectHealth,projectHealthSummary,onProjectFilter,onWarningAction,onPriorityAction}:any){
 const [lookAhead,setLookAhead]=useState(false);
 const actualToday=dateOnly(new Date());
 const employees=(data.employees||[]).filter((e:any)=>e.active!==false);
 function nextDate(s:string){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+1);return dateOnly(d)}
 function addDays(s:string,n:number){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return dateOnly(d)}
 function nextProductionDay(from:string){let d=nextDate(from);let guard=0;while(guard++<21){if(employees.some((e:any)=>capacityForDate(data,e.id,d)>0))return d;d=nextDate(d)}return d}
 const dashboardDate=lookAhead?nextProductionDay(actualToday):actualToday;
 function splitAssigned(s:string){return splitIds(s)}
 function sourceAssembly(sourceId:string){return (data.projectAssemblies||[]).find((a:any)=>a.id===sourceId)}
 function projectFor(id:string){return (data.projects||[]).find((p:any)=>p.id===id)||{projectId:'Project'}}
 function expandChunksForRange(startDate:string,endDate:string){return expandChunks(data,schedule,{startDate,endDate})}
 const weekEnd=addDays(dashboardDate,6);
 const selectedDayChunks=expandChunksForRange(dashboardDate,dashboardDate);
 const weekChunks=expandChunksForRange(dashboardDate,weekEnd);
 function rowsForEmployee(emp:any){return selectedDayChunks.filter((x:any)=>x.employeeChunkId===emp.id)}
 const unassigned=selectedDayChunks.filter((x:any)=>!x.employeeChunkId);
 const overloads:any[]=[];
 const activeEmployees=employees;
 for(const e of activeEmployees){for(let i=0;i<7;i++){const date=addDays(dashboardDate,i);const hrs=weekChunks.filter((c:any)=>c.employeeChunkId===e.id&&c.chunkDate===date).reduce((n:number,c:any)=>n+(Number(c.chunkHours)||0),0);const cap=capacityForDate(data,e.id,date);if(hrs>cap)overloads.push({employee:e.name,date,hrs,cap});}}
 const now = dashboardDate;
 const atRisk=schedule.filter((s:any)=>{const src=sourceAssembly(s.sourceAssemblyId||String(s.id).split('|')[0]); if(!src||src.status==='Complete')return false; if(src.holdReason||src.status==='On Hold')return true; if(s.isLate)return true; if(src.shipDate){const days=(new Date(src.shipDate+'T00:00:00').getTime()-new Date(now+'T00:00:00').getTime())/86400000; return days<=5 && Number(src.percent||0)<90;} return false;}).slice(0,12);
 const testReturns=(data.projectAssemblies||[]).filter((a:any)=>a.testRequired&&a.testReturnDateTime).sort((a:any,b:any)=>String(a.testReturnDateTime).localeCompare(String(b.testReturnDateTime))).slice(0,8);
 const upcomingWindowEnd=addDays(dashboardDate,14);
 const upcomingBatches=(data.shipmentBatches||[]).filter((b:any)=>b.shipDate>=dashboardDate&&b.shipDate<=upcomingWindowEnd).sort((a:any,b:any)=>String(a.shipDate).localeCompare(String(b.shipDate)));
 const upcomingIndividualTops=(data.projectAssemblies||[]).filter((a:any)=>a.type==='Top Level Assembly'&&!a.batchId&&a.shipDate>=dashboardDate&&a.shipDate<=upcomingWindowEnd).sort((a:any,b:any)=>String(a.shipDate).localeCompare(String(b.shipDate)));
 const selectedDayHours=employees.reduce((n:number,e:any)=>n+rowsForEmployee(e).reduce((m:number,r:any)=>m+(Number(r.chunkHours)||0),0),0);
 const openHolds=(data.holds||[]).filter((h:any)=>h.status!=='Cleared').length+(data.projectAssemblies||[]).filter((a:any)=>a.holdReason||a.status==='On Hold').length;
 function employeeDateList(raw:string){return String(raw||'').split(/[\n,;\s]+/).map(x=>x.trim()).filter(Boolean)}
 const next30=addDays(dashboardDate,30);
 const upcomingAbsences:any[]=[];
 (data.holidays||[]).forEach((h:any)=>{if(h.date>=dashboardDate&&h.date<=next30)upcomingAbsences.push({date:h.date,employee:'All Employees',reason:h.name||'Company Holiday',type:'Holiday'});});
 employees.forEach((e:any)=>employeeDateList(e.timeOffDates||e.pto||'').forEach((d:string)=>{if(d>=dashboardDate&&d<=next30)upcomingAbsences.push({date:d,employee:e.name,reason:'Scheduled Out',type:'Employee'});}));
 upcomingAbsences.sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date))||String(a.employee).localeCompare(String(b.employee)));
 const selectedDayAbsences=upcomingAbsences.filter((a:any)=>a.date===dashboardDate);
 const typeCounts={newBuild:data.projects.filter((p:any)=>(p.projectType||'New Build')==='New Build').length,spare:data.projects.filter((p:any)=>p.projectType==='Spare').length,repair:data.projects.filter((p:any)=>p.projectType==='Repair/Warranty').length};
 const healthCards=[
  {label:'On Track',count:projectHealthSummary?.onTrack||0},
  {label:'At Risk',count:projectHealthSummary?.atRisk||0},
  {label:'Late',count:projectHealthSummary?.late||0},
  {label:'Missing Assignment',count:projectHealthSummary?.missingAssignment||0},
  {label:'Ready to Ship',count:projectHealthSummary?.readyToShip||0},
 ];
 const priorities=calculateTodayPriorities(data,schedule,warnings,projectHealth,dashboardDate);
 const sevRank:any={critical:0,blocked:1,warn:2,info:3};
 const attentionFeed=[
  ...overloads.map((o:any,i:number)=>({key:'ov'+i,severity:'critical',title:`Overloaded: ${o.employee}`,detail:`${fmtDate(o.date)} — ${o.hrs.toFixed(1)} / ${o.cap.toFixed(1)} hrs assigned`,onClick:()=>onWarningAction?.({date:o.date})})),
  ...atRisk.map((s:any,i:number)=>{const src=sourceAssembly(s.sourceAssemblyId||String(s.id).split('|')[0])||s;return {key:'ar'+i,severity:src.holdReason?'blocked':(s.isLate?'critical':'warn'),title:s.projectName,detail:`${src.description||src.partNumber} ${src.instanceLabel||''} — ${src.holdReason?'On hold: '+src.holdReason:(s.isLate?'Late':'At risk')}`,onClick:()=>onWarningAction?.({projectId:src.projectId,date:s.scheduledStart})};}),
  ...(warnings||[]).filter((w:any)=>w.code!=='over_capacity').map((w:any)=>({key:'w'+w.id,severity:w.level==='critical'?'critical':(w.level==='capacity'?'warn':'info'),title:`${w.projectName||'Schedule'}${w.date?' — '+fmtDate(w.date):''}`,detail:`${w.partNumber?w.partNumber+' — ':''}${w.reason}`,onClick:()=>onWarningAction?.(w)})),
 ].sort((a:any,b:any)=>(sevRank[a.severity]??9)-(sevRank[b.severity]??9));
 return <div className="dashboardCompact">
  <div className="dashTopBar"><div><span className="eyebrow">Daily Production Control</span><h2>{lookAhead?'Next Production Day':'Today'} · {fmtDate(dashboardDate)}</h2><div className="dashDateToggle"><button className={!lookAhead?'active':''} onClick={()=>setLookAhead(false)}>Today</button><button className={lookAhead?'active':''} onClick={()=>setLookAhead(true)}>Next Production Day</button></div></div><div className="dashKpis"><div><b>{selectedDayHours.toFixed(1)}</b><span>hrs selected day</span></div><div><b>{overloads.length}</b><span>overloads</span></div><div><b>{atRisk.length}</b><span>at risk</span></div><div><b>{selectedDayAbsences.length}</b><span>out selected day</span></div><div><b>{upcomingBatches.length+upcomingIndividualTops.length}</b><span>shipments</span></div></div></div>
  <div className="dashPanels">
    <section className="dashPanel attentionPanel"><div className="dashSectionHeader"><div><h3>Needs Attention</h3><p className="muted">One prioritized feed: overloads, at-risk and held work, and schedule warnings. Click any line to jump to it.</p></div><div className="scheduleWarningCounts"><span className="warningCount critical">{attentionFeed.filter((f:any)=>f.severity==='critical'||f.severity==='blocked').length} critical</span><span className="warningCount capacity">{attentionFeed.filter((f:any)=>f.severity==='warn').length} warning</span><span className="warningCount info">{attentionFeed.filter((f:any)=>f.severity==='info').length} info</span></div></div>
      <div className="priorityList">{priorities.length===0&&<p className="muted">No urgent priority items for the selected production day.</p>}{priorities.map((priority:any)=><button key={priority.id} className={`priorityCard tone-${priority.tone}`} onClick={()=>onPriorityAction?.(priority)}><div className="priorityCardTop"><span className="priorityTitle">{priority.title}</span><span className="priorityCount">{priority.count}</span></div><small>{priority.detail}</small></button>)}</div>
      <div className="compactList attentionList">{attentionFeed.length===0&&<p className="muted">Nothing needs attention right now.</p>}{attentionFeed.slice(0,16).map((f:any)=><button key={f.key} type="button" className={'alertLine '+(f.severity==='critical'?'bad':f.severity==='blocked'?'blocked':f.severity==='warn'?'warn':'')} onClick={f.onClick}><b>{f.title}</b><span>{f.detail}</span></button>)}{attentionFeed.length>16&&<p className="muted small">Showing 16 of {attentionFeed.length} items.</p>}</div>
    </section>
    <section className="dashPanel projectHealthDashPanel"><div className="dashSectionHeader"><div><h3>Project Health</h3><p className="muted">Click a status to open the filtered project list.</p></div></div><div className="projectHealthSummaryGrid">{healthCards.map((card:any)=><button key={card.label} className={`projectHealthSummaryCard tone-${healthTone(card.label as any)}`} onClick={()=>onProjectFilter?.(card.label)}><b>{card.count}</b><span>{card.label}</span></button>)}</div></section>
    <section className="dashPanel todayOps"><h3>Today&apos;s Crew</h3><div className="miniEmployeeList">{employees.map((emp:any)=>{const rows=rowsForEmployee(emp);const hrs=rows.reduce((n:number,r:any)=>n+(Number(r.chunkHours)||0),0);const isOut=selectedDayAbsences.some((a:any)=>a.employee===emp.name||a.employee==='All Employees');return <div className={"miniEmployee "+(isOut?'isOut':'')} key={emp.id}><div><b>{emp.name}</b><span>{isOut?'Scheduled Out':`${hrs.toFixed(1)} hrs`}</span></div>{rows.slice(0,3).map((r:any,i:number)=><p key={r.scheduleId+i}><strong>{r.description||r.partNumber}</strong> <em>{r.projectName}</em> {Number(r.chunkHours||0).toFixed(1)}h</p>)}{rows.length>3&&<small>+{rows.length-3} more</small>}{!rows.length&&!isOut&&<small>No work scheduled</small>}</div>})}</div></section>
    <section className="dashPanel comingUp"><h3>Coming Up</h3>
      <h4>Shipments · next 2 weeks</h4><div className="compactList">{(upcomingBatches.length+upcomingIndividualTops.length)===0?<p className="muted">No shipments due in the next two weeks.</p>:<>{upcomingBatches.map((b:any)=>{const ass=(data.projectAssemblies||[]).filter((a:any)=>a.batchId===b.id);return <div className="alertLine" key={b.id}><b>{fmtDate(b.shipDate)} • {b.name}</b><span>{projectFor(b.projectId).projectId} — {ass.length} assembly group{ass.length===1?'':'s'}</span></div>})}{upcomingIndividualTops.map((a:any)=>{const pr=projectFor(a.projectId);return <div className="alertLine" key={a.id}><b>{fmtDate(a.shipDate)} • {a.description||a.partNumber} {a.instanceLabel||''}</b><span>{pr.projectId} — P/N {a.partNumber}</span></div>})}</>}</div>
      <h4>Expected test returns</h4><div className="compactList">{testReturns.length===0?<p className="muted">No manual test returns entered.</p>:testReturns.slice(0,5).map((a:any)=><div className="alertLine" key={a.id}><b>{fmtDateTime(a.testReturnDateTime)}</b><span>{projectFor(a.projectId).projectId} — {a.description||a.partNumber} {a.instanceLabel||''}</span></div>)}</div>
      <h4>Absences · next 30 days</h4><div className="compactList">{upcomingAbsences.length===0?<p className="muted">No upcoming employee absences or company holidays.</p>:upcomingAbsences.slice(0,6).map((a:any,i:number)=><div className="alertLine blocked" key={i}><b>{fmtDate(a.date)}</b><span>{a.employee} — {a.reason}</span></div>)}</div>
    </section>
  </div>
 </div>}
