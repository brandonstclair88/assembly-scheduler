'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {expandChunks,sortChunksByDate} from '../../lib/chunks';
import {dateOnly,fmtDate} from '../../lib/format';
import {load} from '../../lib/persistence';
import {healthTone} from '../../lib/projectHealth';
import {capacityByEmployee,capacityForDate,weeklyCapacity} from '../../lib/scheduler';
import {HealthBadge,ScheduleWarningsPanel,Table,rolledCompletion} from '../shared/common';

export function Plan({data,setData,schedule,warnings,projectHealth,setTab}:any){
 const [view,setView]=useState('Planner');
 const views=[['Planner','Planner'],['Calendar','Calendar'],['Timeline','Timeline'],['Capacity','Capacity'],['Table','Master Schedule']];
 return <div className="subTabPage">
  <div className="subTabBar">{views.map(([id,label]:any)=><button key={id} type="button" className={view===id?'active':''} onClick={()=>setView(id)}>{label}</button>)}</div>
  {view==='Planner'&&<Planner data={data} setData={setData} schedule={schedule} warnings={warnings} projectHealth={projectHealth} setTab={setTab}/>}
  {view==='Calendar'&&<MonthlyCalendar data={data} schedule={schedule}/>}
  {view==='Timeline'&&<GanttTimeline data={data} schedule={schedule}/>}
  {view==='Capacity'&&<Capacity data={data}/>}
  {view==='Table'&&<Schedule data={data} schedule={schedule}/>}
 </div>
}

export function Planner({data,setData,schedule,warnings,projectHealth,setTab}:any){
 const [query,setQuery]=useState('');
 const [plannerView,setPlannerView]=useState<'capacity'|'risk'|'employee'|'shipments'|'dependencies'>('capacity');
 const [plannerHorizon,setPlannerHorizon]=useState<'2w'|'1m'|'3m'|'6m'|'1y'>('1m');
 const employees=(data.employees||[]).filter((e:any)=>e.active!==false);
 const assemblies=data.projectAssemblies||[];
 const projects=Object.fromEntries((data.projects||[]).map((p:any)=>[p.id,p]));
 const horizonDaysMap={ '2w':13,'1m':34,'3m':89,'6m':179,'1y':364 };
 function parse(s:string){return new Date((s||'').slice(0,10)+'T00:00:00')}
 function addDays(s:string,n:number){const d=parse(s);d.setDate(d.getDate()+n);return dateOnly(d)}
 function srcId(s:any){return s.sourceAssemblyId||String(s.id).split('|')[0]}
 function asm(id:string){return assemblies.find((a:any)=>a.id===id)}
 function projectLabel(pid:string){const p:any=projects[pid]||{};return p.projectId||p.name||pid}
 function taskLabel(a:any){return a?`${projectLabel(a.projectId)} · ${a.partNumber} ${a.instanceLabel||''} · ${a.description}`:'Unknown item'}
 function getItem(aid:string,phase='Build'){return schedule.find((s:any)=>srcId(s)===aid&&(s.phase||'Build')===phase)}
 function buildChunks(startDate:string,endDate:string){return sortChunksByDate(expandChunks(data,schedule,{startDate,endDate}))}
 const today=dateOnly(new Date());
 const rangeEnd=addDays(today,horizonDaysMap[plannerHorizon]);
 const chunks=buildChunks(today,rangeEnd);
 const byCell:Record<string,any>={};
 for(const c of chunks){if(!c.employeeChunkId)continue;const key=c.employeeChunkId+'|'+c.chunkDate;if(!byCell[key])byCell[key]={employeeId:c.employeeChunkId,date:c.chunkDate,hours:0,cards:[]};byCell[key].hours+=Number(c.chunkHours)||0;byCell[key].cards.push(c)}
 function weekOf(date:string){const d=parse(date);const day=d.getDay()||7;d.setDate(d.getDate()-day+1);return dateOnly(d)}
 function roleAllowed(emp:any,phase:string){if(phase==='Inspection')return emp.canInspect!==false;if(phase==='Shipping')return emp.canShip!==false;return emp.canBuild!==false}
 const weeklyRoleLoad:Record<string,any>={};
 const employeeLoad:Record<string,any>={};
 const weekShipCounts:Record<string,number>={};
 for(const date of Array.from({length:horizonDaysMap[plannerHorizon]+1},(_,i)=>addDays(today,i))){
   const week=weekOf(date);
   if(!weeklyRoleLoad[week])weeklyRoleLoad[week]={week,buildScheduled:0,buildAvailable:0,inspectionScheduled:0,inspectionAvailable:0,shippingScheduled:0,shippingAvailable:0,overloads:0};
   for(const employee of employees){
     const cap=capacityForDate(data,employee.id,date);
     const key=`${employee.id}|${date}`;
     const scheduled=(byCell[key]?.hours)||0;
     if(!employeeLoad[employee.id])employeeLoad[employee.id]={employeeId:employee.id,employeeName:employee.name||employee.id,scheduled:0,available:0,overloads:0};
     employeeLoad[employee.id].scheduled+=scheduled;
     employeeLoad[employee.id].available+=cap;
     if(scheduled>cap+0.01)employeeLoad[employee.id].overloads++;
     if(roleAllowed(employee,'Build'))weeklyRoleLoad[week].buildAvailable+=cap;
     if(roleAllowed(employee,'Inspection'))weeklyRoleLoad[week].inspectionAvailable+=cap;
     if(roleAllowed(employee,'Shipping'))weeklyRoleLoad[week].shippingAvailable+=cap;
   }
 }
 for(const c of chunks){
   const week=weekOf(c.chunkDate);
   if(!weeklyRoleLoad[week])continue;
   const phase=c.phase||'Build';
   if(phase==='Inspection')weeklyRoleLoad[week].inspectionScheduled+=Number(c.chunkHours)||0;
   else if(phase==='Shipping')weeklyRoleLoad[week].shippingScheduled+=Number(c.chunkHours)||0;
   else weeklyRoleLoad[week].buildScheduled+=Number(c.chunkHours)||0;
 }
 for(const cell of Object.values(byCell)){const cap=capacityForDate(data,(cell as any).employeeId,(cell as any).date);if((cell as any).hours>cap+0.01)weeklyRoleLoad[weekOf((cell as any).date)].overloads++;}
 for(const assembly of assemblies){if(assembly.shipDate&&assembly.shipDate>=today&&assembly.shipDate<=rangeEnd){const week=weekOf(assembly.shipDate);weekShipCounts[week]=(weekShipCounts[week]||0)+1}}
 const weeklyCapacityRows=Object.values(weeklyRoleLoad).sort((a:any,b:any)=>String(a.week).localeCompare(String(b.week))).map((row:any)=>({...row,shipments:weekShipCounts[row.week]||0,buildPct:row.buildAvailable?row.buildScheduled/row.buildAvailable:0,inspectionPct:row.inspectionAvailable?row.inspectionScheduled/row.inspectionAvailable:0,shippingPct:row.shippingAvailable?row.shippingScheduled/row.shippingAvailable:0}));
 const roleSummary=[['Build','buildScheduled','buildAvailable'],['Inspection','inspectionScheduled','inspectionAvailable'],['Shipping','shippingScheduled','shippingAvailable']].map(([label,scheduledKey,availableKey])=>{const scheduled=weeklyCapacityRows.reduce((sum:number,row:any)=>sum+Number(row[scheduledKey]||0),0);const available=weeklyCapacityRows.reduce((sum:number,row:any)=>sum+Number(row[availableKey]||0),0);const pct=available?scheduled/available:0;return {label,scheduled,available,pct};});
 const employeeForecast=Object.values(employeeLoad).sort((a:any,b:any)=>Number(b.scheduled)-Number(a.scheduled));
 const warningsByProject=(warnings||[]).reduce((map:any,warning:any)=>{if(!warning.projectId)return map;map[warning.projectId]=(map[warning.projectId]||0)+1;return map;},{});
 function plannerRiskLabel(record:any){
   const warningCount=warningsByProject[record.projectId]||0;
   if(record.status==='Late')return 'Late';
   if(record.status==='Over Capacity'||record.status==='Missing Assignment'||warningCount>=3)return 'High Risk';
   if(record.status==='At Risk'||warningCount>0)return 'At Risk';
   return 'On Track';
 }
 const riskProjects=(projectHealth||[]).map((record:any)=>({...record,plannerRisk:plannerRiskLabel(record),warningCount:warningsByProject[record.projectId]||0})).sort((a:any,b:any)=>({Late:0,'High Risk':1,'At Risk':2,'On Track':3}[a.plannerRisk]-{Late:0,'High Risk':1,'At Risk':2,'On Track':3}[b.plannerRisk]||String(a.dueDate||'9999-12-31').localeCompare(String(b.dueDate||'9999-12-31'))));
 const overdueInspections=(warnings||[]).filter((warning:any)=>warning.code==='missing_inspection_assignment'||warning.code==='sub_after_parent').slice(0,8);
 const blockedProjects=riskProjects.filter((record:any)=>record.status==='Waiting on Test'||record.status==='Waiting on Inspection'||record.reason?.toLowerCase().includes('warning')).slice(0,8);
 const readyToShip=(projectHealth||[]).filter((record:any)=>record.status==='Ready to Ship').slice(0,8);
 const missingPreferredWarnings=(warnings||[]).filter((warning:any)=>warning.code==='no_preferred_employee_available').slice(0,8);
 function toneForPct(pct:number){return pct>=1?'critical':pct>=0.8?'capacity':'info'}
 return <div className="grid">
   <div className="card span12 plannerHeroCard">
     <div className="boardHeader">
       <div><h2>Planner</h2><p className="muted">Forecast capacity, risk, employee load, shipments, and dependencies over a longer planning horizon.</p></div>
       <div className="boardTools">
         <div className="modeToggle compactToggle">
           <button className={plannerView==='capacity'?'active':''} onClick={()=>setPlannerView('capacity')}>Capacity View</button>
           <button className={plannerView==='risk'?'active':''} onClick={()=>setPlannerView('risk')}>Risk View</button>
           <button className={plannerView==='employee'?'active':''} onClick={()=>setPlannerView('employee')}>Employee Load View</button>
           <button className={plannerView==='shipments'?'active':''} onClick={()=>setPlannerView('shipments')}>Shipments View</button>
           <button className={plannerView==='dependencies'?'active':''} onClick={()=>setPlannerView('dependencies')}>Dependencies View</button>
         </div>
         <div className="field monthPick"><label>Planning Horizon</label><select value={plannerHorizon} onChange={e=>setPlannerHorizon(e.target.value as any)}><option value="2w">2 weeks</option><option value="1m">1 month</option><option value="3m">3 months</option><option value="6m">6 months</option><option value="1y">1 year</option></select></div>
         <div className="field monthPick"><label>Search</label><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Project ID / P/N / employee"/></div>
         <button className="btn" onClick={()=>setTab('Weekly Board')}>Open Weekly Board</button>
       </div>
     </div>
     <div className="plannerSummary"><span className="pill bad">{(warnings||[]).filter((w:any)=>w.level==='critical').length} critical</span><span className="pill warn">{(warnings||[]).filter((w:any)=>w.level==='capacity').length} capacity</span><span className="pill">{(warnings||[]).filter((w:any)=>w.level==='info').length} info</span><span className="pill">Horizon: {fmtDate(today)} to {fmtDate(rangeEnd)}</span></div>
   </div>
   {plannerView==='capacity'&&<>
     <div className="card span12"><h2>Capacity Forecast</h2><div className="projectHealthSummaryGrid">{roleSummary.map((row:any)=><div key={row.label} className={`projectHealthSummaryCard tone-${toneForPct(row.pct)}`}><b>{Math.round(row.pct*100)}%</b><span>{row.label} Capacity</span><small>{row.scheduled.toFixed(1)} scheduled / {row.available.toFixed(1)} available hrs</small></div>)}</div></div>
     <div className="card span12"><h2>Planner Heatmap</h2><div className="plannerHeatmap">{weeklyCapacityRows.map((row:any)=><div key={row.week} className={`heatCell tone-${toneForPct(Math.max(row.buildPct,row.inspectionPct,row.shippingPct))}`}><b>{fmtDate(row.week)}</b><span>Build {Math.round(row.buildPct*100)}%</span><span>Inspect {Math.round(row.inspectionPct*100)}%</span><span>Ship {Math.round(row.shippingPct*100)}%</span><small>{row.overloads} overloaded cell{row.overloads===1?'':'s'} • {row.shipments} shipments</small></div>)}</div></div>
   </>}
   {plannerView==='risk'&&<>
     <div className="card span12"><h2>Ship Date Risk Forecasting</h2><div className="projectHealthPreviewList">{riskProjects.filter((record:any)=>!query||(`${record.projectCode} ${record.projectName} ${record.reason}`.toLowerCase().includes(query.toLowerCase()))).slice(0,18).map((record:any)=><div key={record.projectId} className="projectHealthPreviewCard"><div><span className={`healthBadge tone-${healthTone(record.plannerRisk==='High Risk'?'At Risk':record.plannerRisk)}`}>{record.plannerRisk}</span><b>{record.projectCode}</b></div><span>{record.projectName}</span><small>{record.reason}</small><small>{record.warningCount} warning{record.warningCount===1?'':'s'} • Due {record.dueDate?fmtDate(record.dueDate):'not set'}</small></div>)}</div></div>
     <div className="card span6"><h2>Most At-Risk Projects</h2><div className="issueList">{riskProjects.filter((record:any)=>record.plannerRisk!=='On Track').slice(0,12).map((record:any)=><button key={record.projectId} className={`issueRow ${record.plannerRisk==='Late'?'red':'yellow'}`} onClick={()=>setTab('Projects')}><b>{record.plannerRisk}</b><span>{record.projectCode} — {record.projectName}</span><small>{record.reason}</small></button>)}</div></div>
     <div className="card span6"><h2>Priority Ranking</h2><div className="warningList">{overdueInspections.map((warning:any)=><article key={warning.id} className="warningCard critical"><b>{warning.projectName}</b><span>{warning.partNumber} — {warning.description}</span><small>{warning.reason}</small></article>)}{blockedProjects.map((record:any)=><article key={record.projectId} className="warningCard capacity"><b>{record.projectCode}</b><span>{record.projectName}</span><small>{record.reason}</small></article>)}{readyToShip.map((record:any)=><article key={record.projectId} className="warningCard info"><b>{record.projectCode}</b><span>{record.projectName}</span><small>Ready to ship.</small></article>)}{missingPreferredWarnings.map((warning:any)=><article key={warning.id} className="warningCard capacity"><b>{warning.projectName}</b><span>{warning.partNumber} — {warning.description}</span><small>{warning.reason}</small></article>)}</div></div>
   </>}
   {plannerView==='employee'&&<>
     <div className="card span12"><h2>Employee Load Forecast</h2><div className="plannerHeatmap">{employeeForecast.filter((row:any)=>!query||(`${row.employeeName}`.toLowerCase().includes(query.toLowerCase()))).map((row:any)=>{const pct=row.available?row.scheduled/row.available:0;return <div key={row.employeeId} className={`heatCell tone-${toneForPct(pct)}`}><b>{row.employeeName}</b><span>{row.scheduled.toFixed(1)} scheduled hrs</span><span>{row.available.toFixed(1)} available hrs</span><small>{Math.round(pct*100)}% load • {row.overloads} overloaded day{row.overloads===1?'':'s'}</small></div>})}</div></div>
   </>}
   {plannerView==='shipments'&&<>
     <div className="card span12"><h2>Shipment Forecast</h2><div className="plannerHeatmap">{weeklyCapacityRows.map((row:any)=><div key={row.week} className={`heatCell tone-${row.shipments>=8?'critical':row.shipments>=4?'capacity':'info'}`}><b>{fmtDate(row.week)}</b><span>{row.shipments} shipment due{row.shipments===1?'':'s'}</span><span>Shipping load {Math.round(row.shippingPct*100)}%</span><small>Build {Math.round(row.buildPct*100)}% • Inspect {Math.round(row.inspectionPct*100)}%</small></div>)}</div></div>
     <div className="card span12"><h2>Ready to Ship</h2><div className="projectHealthPreviewList">{readyToShip.length===0&&<p className="muted">No projects are marked ready to ship in this horizon.</p>}{readyToShip.map((record:any)=><div key={record.projectId} className="projectHealthPreviewCard"><div><HealthBadge status={record.status}/><b>{record.projectCode}</b></div><span>{record.projectName}</span><small>{record.reason}</small></div>)}</div></div>
   </>}
   {plannerView==='dependencies'&&<>
     <div className="card span12"><ScheduleWarningsPanel warnings={warnings} maxItems={24} title="Dependency & Schedule Conflicts" subtitle="Computed by the shared warnings engine — the same list the Dashboard and Weekly Board show, so the views always agree." onAction={()=>setTab('Weekly Board')} getActionLabel={(w:any)=>w.projectId||w.date?'Open Weekly Board':''}/></div>
   </>}
 </div>
}

export function MonthlyCalendar({data,schedule}:any){
 const [selectedMonth,setSelectedMonth]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`});
 const [showSubs,setShowSubs]=useState(true);
 function pad(n:number){return String(n).padStart(2,'0')}
 function dateOnly(d:Date){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
 function parseDate(s:string){return new Date((s||'').slice(0,10)+'T00:00:00')}
 function monthDays(month:string){const [y,m]=month.split('-').map(Number);const first=new Date(y,m-1,1);const start=new Date(first);start.setDate(first.getDate()-first.getDay());const out:string[]=[];for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);out.push(dateOnly(d));}return out}
 const days=monthDays(selectedMonth);
 const projects=Object.fromEntries(data.projects.map((p:any)=>[p.id,p]));
 const byId=Object.fromEntries((data.projectAssemblies||[]).map((a:any)=>[a.id,a]));
 const topLevels=(data.projectAssemblies||[]).filter((a:any)=>a.type==='Top Level Assembly');
 function groupItems(top:any){const related=(data.projectAssemblies||[]).filter((a:any)=>a.id===top.id||a.parentAssemblyId===top.id||((a.buildGroupId&&a.buildGroupId===top.buildGroupId)&&a.projectId===top.projectId));const ids=new Set(related.map((a:any)=>a.id));return schedule.filter((s:any)=>ids.has(s.sourceAssemblyId||String(s.id).split('|')[0]));}
 const groups=topLevels.map((top:any)=>{const items=groupItems(top);const starts=items.map((x:any)=>x.scheduledStart).filter(Boolean).sort();const ends=items.map((x:any)=>x.scheduledEnd).filter(Boolean).sort();const project:any=projects[top.projectId]||{};return {top,items,project,start:starts[0]||top.shipDate,end:ends[ends.length-1]||top.shipDate,ship:top.shipDate,subs:(data.projectAssemblies||[]).filter((a:any)=>a.parentAssemblyId===top.id),pct:rolledCompletion(data,top),late:items.some((x:any)=>x.isLate)}}).filter((g:any)=>g.start||g.ship);
 function onDate(date:string){return groups.filter((g:any)=>date>=g.start&&date<=g.end).sort((a:any,b:any)=>(a.ship||'').localeCompare(b.ship||'')||a.top.partNumber.localeCompare(b.top.partNumber));}
 const [y,m]=selectedMonth.split('-').map(Number);
 return <div className="card"><div className="boardHeader"><div><h2>Monthly Calendar</h2><p className="muted">High-level planning view. Top level assemblies are shown as grouped calendar items; sub assemblies are listed inside their parent when enabled.</p></div><div className="actions"><div className="field monthPick"><label>Month</label><input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}/></div><label className="checkLine"><input type="checkbox" checked={showSubs} onChange={e=>setShowSubs(e.target.checked)}/> Show subs</label></div></div><div className="monthCalendar"><div className="calHead">Sun</div><div className="calHead">Mon</div><div className="calHead">Tue</div><div className="calHead">Wed</div><div className="calHead">Thu</div><div className="calHead">Fri</div><div className="calHead">Sat</div>{days.map(date=>{const d=parseDate(date);const inMonth=d.getMonth()===(m-1);const cards=onDate(date);return <div key={date} className={'calDay '+(!inMonth?'calMuted':'')}><div className="calDate">{d.getDate()}</div>{cards.slice(0,5).map((g:any)=><div key={g.top.id+date} className={'calCard '+(g.late?'calLate':'')}><b>{g.project.projectId||g.project.name||'Project'}</b><span>{g.top.partNumber} {g.top.instanceLabel||''}</span><small>{g.top.buildGroupLabel||g.top.description}</small><small>{g.pct}% complete · Ship {g.ship||'not set'}</small>{showSubs&&g.subs.length>0&&<details><summary>{g.subs.length} sub assembly item(s)</summary>{g.subs.map((sub:any)=><div key={sub.id} className="calSub">↳ {sub.partNumber} {sub.instanceLabel||''}</div>)}</details>}</div>)}{cards.length>5&&<div className="calMore">+{cards.length-5} more</div>}</div>})}</div></div>
}

export function GanttTimeline({data,schedule}:any){
 const [selectedMonth,setSelectedMonth]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`});
 const [mode,setMode]=useState('Top Levels');
 const [query,setQuery]=useState('');
 function pad(n:number){return String(n).padStart(2,'0')}
 function fmt(d:Date){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
 function parse(s:string){return new Date((s||'').slice(0,10)+'T00:00:00')}
 function addDays(s:string,n:number){const d=parse(s);d.setDate(d.getDate()+n);return fmt(d)}
 const start=`${selectedMonth}-01`;
 const startD=parse(start);
 const endD=new Date(startD.getFullYear(),startD.getMonth()+1,0);
 const end=fmt(endD);
 const days:string[]=[];for(let d=new Date(startD);d<=endD;d.setDate(d.getDate()+1))days.push(fmt(new Date(d)));
 const dayIndex=(date:string)=>Math.max(0,Math.min(days.length-1,Math.round((+parse(date)-+startD)/86400000)));
 const projects=Object.fromEntries((data.projects||[]).map((p:any)=>[p.id,p]));
 const batches=Object.fromEntries((data.shipmentBatches||[]).map((b:any)=>[b.id,b]));
 const byId=Object.fromEntries((data.projectAssemblies||[]).map((a:any)=>[a.id,a]));
 function projectLabel(projectId:string){const p:any=projects[projectId]||{};return p.projectId||p.name||'Project'}
 function itemsForSource(id:string){return schedule.filter((s:any)=>(s.sourceAssemblyId||String(s.id).split('|')[0])===id)}
 function spanForItems(items:any[],fallback:string){const starts=items.map(x=>x.scheduledStart).filter(Boolean).sort();const ends=items.map(x=>x.scheduledEnd).filter(Boolean).sort();return {start:starts[0]||fallback,end:ends[ends.length-1]||fallback}}
 function statusFor(top:any,items:any[]){if(top.status==='On Hold'||top.holdReason)return 'Blocked'; if(items.some((x:any)=>x.isLate))return 'Late'; if(rolledCompletion(data,top)>=100)return 'Complete'; const ship=top.batchId?(batches[top.batchId] as any)?.shipDate:top.shipDate; const end=spanForItems(items,ship).end; if(ship&&end>ship)return 'At Risk'; return 'Scheduled'}
 const topLevels=(data.projectAssemblies||[]).filter((a:any)=>a.type==='Top Level Assembly');
 let rows:any[]=[];
 if(mode==='Batches'){
   rows=(data.shipmentBatches||[]).map((b:any)=>{const tops=topLevels.filter((t:any)=>t.batchId===b.id);const ids=new Set(tops.map((t:any)=>t.id));const items=schedule.filter((s:any)=>ids.has(s.sourceAssemblyId||String(s.id).split('|')[0]));const sp=spanForItems(items,b.shipDate);return {id:b.id,label:b.name,sub:`${projectLabel(b.projectId)} · ${tops.length} top level(s)`,start:sp.start,end:sp.end,ship:b.shipDate,status:items.some((x:any)=>x.isLate)?'Late':'Scheduled',items,tops,kind:'Batch'}}).filter((r:any)=>r.tops.length);
 } else {
   rows=topLevels.map((top:any)=>{const direct=itemsForSource(top.id);const children=(data.projectAssemblies||[]).filter((a:any)=>a.parentAssemblyId===top.id);const ids=new Set([top.id,...children.map((c:any)=>c.id)]);const all=schedule.filter((s:any)=>ids.has(s.sourceAssemblyId||String(s.id).split('|')[0]));const ship=top.batchId?(batches[top.batchId] as any)?.shipDate:top.shipDate;const sp=spanForItems(all,ship);return {id:top.id,label:`${top.partNumber} ${top.instanceLabel||''}`,sub:`${projectLabel(top.projectId)} · ${top.description}`,start:sp.start,end:sp.end,ship,status:statusFor(top,all),items:all,top,children,kind:'Top'}});
 }
 rows=rows.filter((r:any)=>r.start<=end&&r.end>=start).filter((r:any)=>!query||(`${r.label} ${r.sub} ${r.ship}`.toLowerCase().includes(query.toLowerCase()))).sort((a:any,b:any)=>a.start.localeCompare(b.start)||a.ship.localeCompare(b.ship));
 function barStyle(r:any){const left=dayIndex(r.start)/days.length*100;const right=(dayIndex(addDays(r.end,1)))/days.length*100;return {left:`${left}%`,width:`${Math.max(2,right-left)}%`}}
 function shipStyle(r:any){const left=dayIndex(r.ship)/days.length*100;return {left:`${left}%`}}
 return <div className="card"><div className="boardHeader"><div><h2>Timeline / Gantt View</h2><p className="muted">High-level planning view for top level assemblies, shipment batches, test/inspection/shipping windows, and ship dates.</p></div><div className="boardTools"><div className="field monthPick"><label>Month</label><input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}/></div><div className="field monthPick"><label>View</label><select value={mode} onChange={e=>setMode(e.target.value)}><option>Top Levels</option><option>Batches</option></select></div><div className="field monthPick"><label>Search</label><input value={query} onChange={e=>setQuery(e.target.value)} placeholder="Project ID / P/N"/></div></div></div><div className="ganttWrap"><div className="ganttGrid" style={{gridTemplateColumns:`280px repeat(${days.length}, 34px)`}}><div className="ganttCorner">Item</div>{days.map(d=><div key={d} className={'ganttDay '+([0,6].includes(parse(d).getDay())?'ganttWeekend':'')}><b>{parse(d).getDate()}</b><span>{['S','M','T','W','T','F','S'][parse(d).getDay()]}</span></div>)}{rows.map((r:any)=><React.Fragment key={r.id}><div className="ganttLabel"><b>{r.label}</b><span>{r.sub}</span><small>Ship {fmtDate(r.ship)||'not set'} · {r.status}</small></div><div className="ganttRow" style={{gridColumn:`2 / span ${days.length}`}}><div className={'ganttBar '+('gantt'+r.status.replace(/\s/g,''))} style={barStyle(r)}><span>{r.kind}</span></div>{r.ship&&<div className="ganttShip" style={shipStyle(r)} title={'Ship '+fmtDate(r.ship)}>◆</div>}{r.items.filter((x:any)=>x.phase==='Inspection'||x.phase==='Shipping').map((x:any,i:number)=><div key={x.scheduleId||x.id+i} className={'ganttMilestone '+(x.phase==='Inspection'?'inspect':'ship')} style={{left:`${dayIndex(x.scheduledStart)/days.length*100}%`}} title={`${x.phase} ${fmtDate(x.scheduledStart)}`}>{x.phase==='Inspection'?'I':'S'}</div>)}</div></React.Fragment>)}</div>{!rows.length&&<p className="muted emptyState">No timeline items in this month/filter.</p>}</div><div className="ganttLegend"><span className="legend scheduled">Scheduled</span><span className="legend risk">At Risk</span><span className="legend late">Late</span><span className="legend blocked">Blocked</span><span className="legend complete">Complete</span><span>◆ Ship date</span><span>I Inspection</span><span>S Shipping</span></div></div>
}

export function Capacity({data}:any){const rows=capacityByEmployee(data);const weekly=weeklyCapacity(data);return <div className="grid"><div className="card span6"><h2>Total Workload</h2><table><thead><tr><th>Employee</th><th>Scheduled Hours</th><th>Items</th><th>Load</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td>{r.employee}</td><td>{r.hours}</td><td>{r.items}</td><td><div className="bar"><span style={{width:Math.min(100,r.hours)+'%'}}/></div></td></tr>)}</tbody></table></div><div className="card span6"><h2>Weekly Workload</h2><Table rows={weekly} cols={['week','employee','hours','items']}/></div></div>}

export function Schedule({data,schedule}:any){
 return <div className="card"><h2>Master Schedule</h2><p className="muted">Read-only computed schedule. Edit assemblies from the Projects page or move work on the Weekly Board.</p><div className="tablewrap"><table><thead><tr>{['Week','Project','Phase','Part #','#','Description','Deps','Employees','Start','Finish / Ship','Hours','Test','Inspection','Shipping','%','Status','Late','Assembly Ship By'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{schedule.map((r:any)=><tr key={r.id} className={r.isLate?'late':''}><td>{fmtDate(r.week)}</td><td>{r.projectName}</td><td>{r.phase||'Build'}</td><td>{r.partNumber}</td><td>{r.instanceLabel||''}</td><td>{r.description}</td><td>{r.dependencyNames}</td><td>{r.assignedEmployeeNames}</td><td>{fmtDate(r.scheduledStart)}</td><td>{fmtDate(r.scheduledEnd)}</td><td>{r.totalHours} total / {r.hoursPerEmployee.toFixed(1)} ea</td><td>{r.testRequired?`${r.testHours||0} hrs`:''}</td><td>{r.inspectionRequired?`${r.inspectionHours||0} hrs`:''}</td><td>{r.shippingRequired?`${r.shippingHours||0} hrs`:''}</td><td>{r.phase==='Build'?`${r.percent||0}%`:(r.phase==='Inspection'?(r.inspectionComplete?'Done':'Open'):(r.shippingComplete?'Done':'Open'))}</td><td>{r.status}</td><td>{r.isLate?'Yes':''}</td><td>{fmtDate(r.shipDate)}</td></tr>)}</tbody></table></div></div>
}
