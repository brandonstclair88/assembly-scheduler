'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {dateOnly,fmtDate,matchesAssemblySearch,splitIds} from '../../lib/format';
import {applyAssemblyPatch} from '../../lib/mutations';
import {ProjectHealthRecord} from '../../lib/projectHealth';
import {capacityForDate,dailyHours} from '../../lib/scheduler';
import {employeePrefersProject,previewSmartAssignSuggestions,smartAssignQualifiedEmployees} from '../../lib/smartAssign';
import {AssemblyTemplate,ProjectAssembly} from '../../lib/types';
import {BufferedPercentInput,CollapsibleSection,EmployeePicker,HealthBadge,HoldReasonInput,PROJECT_HEALTH_OPTIONS,ProjectTimelinePanel,ScheduleWarningsPanel,StableDateInput,batchCompletion,makeAsm,phaseBadgeLabel,projectCompletion,rolledCompletion,uid} from '../shared/common';

export function Projects({data,setData,schedule,warnings,projectHealth,projectHealthById,panelIntent,onFocusBoard}:any){
 const [selected,setSelected]=useState(data.projects[0]?.id||'');
 const [healthFilter,setHealthFilter]=useState('All');
 const [holdsOnly,setHoldsOnly]=useState(false);
 const [templateId,setTemplateId]=useState(data.assemblyTemplates.find((t:any)=>!t.archived)?.id||data.assemblyTemplates[0]?.id||'');
 const [addQty,setAddQty]=useState(1);
 const [assemblySearch,setAssemblySearch]=useState('');
 const [selectedTopId,setSelectedTopId]=useState('');
 const [projectMonth,setProjectMonth]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`});
 const [calendarDrafts,setCalendarDrafts]=useState<any>({});
 const [projectCalendarOpen,setProjectCalendarOpen]=useState(true);
 function projectHasOpenHold(p:any){return (data.holds||[]).some((h:any)=>h.projectId===p.id&&h.status!=='Closed')||(data.projectAssemblies||[]).some((a:any)=>a.projectId===p.id&&(a.status==='On Hold'||String(a.holdReason||'').trim()))}
 const openHoldProjectCount=(data.projects||[]).filter((p:any)=>!p.archived&&projectHasOpenHold(p)).length;
 const visibleProjects=(data.projects||[]).filter((p:any)=>!p.archived&&(healthFilter==='All'||projectHealthById?.[p.id]?.status===healthFilter)&&(!holdsOnly||projectHasOpenHold(p)));
 useEffect(()=>{if(panelIntent?.token){if(panelIntent.healthFilter)setHealthFilter(panelIntent.healthFilter);if(panelIntent.projectId)setSelected(panelIntent.projectId)}},[panelIntent?.token]);
 useEffect(()=>{if(!selected&&visibleProjects[0])setSelected(visibleProjects[0].id);if(selected&&!visibleProjects.some((p:any)=>p.id===selected))setSelected(visibleProjects[0]?.id||data.projects[0]?.id||'')},[visibleProjects,selected,data.projects]);
 const empty={id:uid('proj'),projectId:'',name:'',customer:'',priority:5,dueDate:'',status:'Active',projectType:'New Build',sequencingEnabled:true,notes:''};
 const project=visibleProjects.find((p:any)=>p.id===selected)||data.projects.find((p:any)=>p.id===selected)||visibleProjects[0]||data.projects[0];
 const projectRecord:ProjectHealthRecord|undefined=projectHealthById?.[project?.id||''];
 const qualifiedBuilders=project?smartAssignQualifiedEmployees(data,project.id,'Build'):[];
 const qualifiedInspectors=project?smartAssignQualifiedEmployees(data,project.id,'Inspection'):[];
 const qualifiedShippers=project?smartAssignQualifiedEmployees(data,project.id,'Shipping'):[];
 const preferredBuilders=project?qualifiedBuilders.filter((employee:any)=>employeePrefersProject(employee,project.id)):[];
 const preferredInspectors=project?qualifiedInspectors.filter((employee:any)=>employeePrefersProject(employee,project.id)):[];
 const preferredShippers=project?qualifiedShippers.filter((employee:any)=>employeePrefersProject(employee,project.id)):[];
 const otherBuilders=project?qualifiedBuilders.filter((employee:any)=>!employeePrefersProject(employee,project.id)):[];
 const otherInspectors=project?qualifiedInspectors.filter((employee:any)=>!employeePrefersProject(employee,project.id)):[];
 const otherShippers=project?qualifiedShippers.filter((employee:any)=>!employeePrefersProject(employee,project.id)):[];
 const projectAssemblies=data.projectAssemblies.filter((a:any)=>a.projectId===(project?.id||''));
 const topLevels=projectAssemblies.filter((a:any)=>a.type==='Top Level Assembly').sort((a:any,b:any)=>(a.instanceNumber||0)-(b.instanceNumber||0));
 const standaloneSubs=projectAssemblies.filter((a:any)=>a.type==='Sub Assembly'&&!a.parentAssemblyId&&!a.buildGroupId).sort((a:any,b:any)=>(a.shipDate||'').localeCompare(b.shipDate||'')||(a.partNumber||'').localeCompare(b.partNumber||'')||((a.instanceNumber||0)-(b.instanceNumber||0)));
 const selectedTop=topLevels.find((t:any)=>t.id===selectedTopId)||topLevels[0];
 useEffect(()=>{if(topLevels.length&&!topLevels.some((t:any)=>t.id===selectedTopId))setSelectedTopId(topLevels[0].id);if(!topLevels.length&&selectedTopId)setSelectedTopId('')},[project?.id,topLevels,selectedTopId]);
 useEffect(()=>{setCalendarDrafts({})},[project?.id]);
 const batches=(data.shipmentBatches||[]).filter((b:any)=>b.projectId===(project?.id||'')).sort((a:any,b:any)=>(a.sequence||0)-(b.sequence||0));
 const libraryAll=data.assemblyTemplates.filter((t:any)=>!t.archived);
 const addableAssemblies=libraryAll.filter((t:any)=>matchesAssemblySearch(t,assemblySearch));
 const selectedTemplate=libraryAll.find((t:any)=>t.id===templateId)||data.assemblyTemplates.find((t:any)=>t.id===templateId);
 useEffect(()=>{if(libraryAll.length&&(!templateId||!libraryAll.some((t:any)=>t.id===templateId)))setTemplateId(libraryAll[0].id)},[libraryAll,templateId]);
 const projectWarnings=useMemo(()=>project?(warnings||[]).filter((warning:any)=>warning.projectId===project.id):[],[warnings,project?.id]);
 const projectAutoAssignSuggestions=useMemo(()=>project?previewSmartAssignSuggestions(data,schedule,{assignBlanksOnly:true,improveExistingUnlockedAssignments:true,balanceThisWeek:true,prioritizeShipDates:true,reduceOverloads:true}).filter((suggestion:any)=>suggestion.projectId===project.id):[],[data,schedule,project?.id]);
 function updateProject(k:string,v:any){if(!project)return;setData((d:any)=>({...d,projects:d.projects.map((p:any)=>p.id===project.id?{...p,[k]:v}:p)}))}
 function addProject(){const row={...empty,id:uid('proj')};setData((d:any)=>({...d,projects:[...d.projects,row]}));setSelected(row.id)}
 function deleteProject(id:string){if(!confirm('Delete this project and its project assemblies?'))return;setData((d:any)=>({...d,projects:d.projects.filter((p:any)=>p.id!==id),projectAssemblies:d.projectAssemblies.filter((a:any)=>a.projectId!==id),holds:d.holds.filter((h:any)=>h.projectId!==id),shipmentBatches:(d.shipmentBatches||[]).filter((b:any)=>b.projectId!==id)}));setSelected(data.projects.find((p:any)=>p.id!==id)?.id||'')}
 function copyProject(){if(!project)return;const newProj={...project,id:uid('proj'),projectId:project.projectId+'-COPY',name:project.name+' Copy'};const oldToNew:any={};const groupMap:any={};const copies=projectAssemblies.map((a:any)=>{const id=uid('asm');oldToNew[a.id]=id;if(a.buildGroupId&&!groupMap[a.buildGroupId])groupMap[a.buildGroupId]=uid('grp');return {...a,id,projectId:newProj.id,buildGroupId:a.buildGroupId?groupMap[a.buildGroupId]:'',status:'Not Started',percent:0,holdReason:''}}).map((a:any)=>({...a,parentAssemblyId:oldToNew[a.parentAssemblyId]||a.parentAssemblyId,dependsOn:splitIds(a.dependsOn).map((id:string)=>oldToNew[id]||id).join(',')}));setData((d:any)=>({...d,projects:[...d.projects,newProj],projectAssemblies:[...d.projectAssemblies,...copies]}));setSelected(newProj.id)}
 function nextNumbers(tid:string,type:string){const used=projectAssemblies.filter((a:any)=>a.templateId===tid&&a.type===type).map((a:any)=>Number(a.instanceNumber)||0);let n=1;const out:number[]=[];for(let i=0;i<Math.max(1,Number(addQty)||1);i++){while(used.includes(n)||out.includes(n))n++;out.push(n)}return out}
 function findSubs(t:AssemblyTemplate){const ids=splitIds(t.defaultDependsOn);return ids.map((id:string)=>data.assemblyTemplates.find((x:any)=>x.id===id||x.partNumber===id)).filter(Boolean)}
 function previousProjectWorkday(date:string){
  if(!date)return '';
  let d=new Date(date+'T00:00:00');
  let guard=0;
  do{d.setDate(d.getDate()-1);guard++;}while(guard<90&&capacityForDate(data,'',dateOnly(d))<=0);
  return dateOnly(d);
 }
 function estimatedTopBuildStart(t:AssemblyTemplate,shipDate:string){
  if(!shipDate)return '';
  const hours=Math.max(0,Number(t.defaultQty||1)*Number(t.hoursEach||0));
  const dayHours=Math.max(1,dailyHours(data)||10);
  let start=shipDate;
  let remaining=Math.max(0,hours-dayHours);
  while(remaining>0){start=previousProjectWorkday(start);remaining-=dayHours;}
  return start;
 }
 function subInitialShipDateForTop(t:AssemblyTemplate,shipDate:string){
  const topStart=estimatedTopBuildStart(t,shipDate)||shipDate;
  return previousProjectWorkday(topStart)||shipDate;
 }
 function addFromLibrary(mode:'withSubs'|'topOnly'|'standaloneSub'){
  const t=data.assemblyTemplates.find((x:any)=>x.id===templateId);
  if(!t||!project)return;
  const shipDate=project.dueDate||'';
  const rows:ProjectAssembly[]=[];
  if(t.type==='Sub Assembly'){
   for(const n of nextNumbers(t.id,'Sub Assembly')){
    rows.push({...makeAsm(t,project.id,shipDate,n,'','',''),buildGroupId:'',buildGroupLabel:'',parentAssemblyId:'',dependsOn:''});
   }
  }else{
   for(const n of nextNumbers(t.id,'Top Level Assembly')){
    const groupId=uid('grp');
    const groupLabel=`${t.partNumber||'Top Level'} #${n}`;
    const main=makeAsm(t,project.id,shipDate,n,groupId,groupLabel,'');
    if(mode==='withSubs'){
     // Initial population only: place sub assemblies on the prior available shop day
     // before the top-level build starts. Manual board edits can still override this later.
     const subShipDate=subInitialShipDateForTop(t,shipDate);
     const subs=findSubs(t).map((st:any,idx:number)=>makeAsm(st,project.id,subShipDate,idx+1,groupId,groupLabel,main.id));
     main.dependsOn=subs.map((s:any)=>s.id).join(',');
     rows.push(main,...subs);
    }else rows.push(main);
   }
  }
  setData((d:any)=>({...d,projectAssemblies:[...d.projectAssemblies,...rows]}))
 }
 function addBatch(){if(!project)return;const n=batches.length+1;const row={id:uid('batch'),projectId:project.id,name:'Shipment Batch '+n,shipDate:project.dueDate||'',lateAllowed:false,sequence:n,notes:''};setData((d:any)=>({...d,shipmentBatches:[...(d.shipmentBatches||[]),row]}))}
 function updateBatch(id:string,patch:any){setData((d:any)=>({...d,shipmentBatches:(d.shipmentBatches||[]).map((b:any)=>b.id===id?{...b,...patch}:b)}))}
 function deleteBatch(id:string){if(!confirm('Delete this batch? Assemblies will be unbatched, not deleted.'))return;setData((d:any)=>({...d,shipmentBatches:(d.shipmentBatches||[]).filter((b:any)=>b.id!==id),projectAssemblies:d.projectAssemblies.map((a:any)=>a.batchId===id?{...a,batchId:''}:a)}))}
 function applyBatchDate(batch:any){setData((d:any)=>({...d,projectAssemblies:d.projectAssemblies.map((a:any)=>a.projectId===project.id&&a.batchId===batch.id?{...a,shipDate:batch.shipDate,lateAllowed:!!batch.lateAllowed}:a)}))}
function changeAsm(id:string,patch:any){setData((d:any)=>applyAssemblyPatch(d,id,patch))}
 function deleteGroup(top:any){if(!confirm('Delete this top level assembly and its subs from this project?'))return;setData((d:any)=>({...d,projectAssemblies:d.projectAssemblies.filter((a:any)=>a.id!==top.id&&a.parentAssemblyId!==top.id&&a.buildGroupId!==top.buildGroupId),holds:d.holds.filter((h:any)=>!projectAssemblies.some((a:any)=>(a.id===top.id||a.parentAssemblyId===top.id||a.buildGroupId===top.buildGroupId)&&a.id===h.assemblyId))}))}
 function deleteAssembly(id:string){
  const row=projectAssemblies.find((a:any)=>a.id===id);
  if(!row)return;
  if(row.type==='Top Level Assembly'){deleteGroup(row);return;}
  if(!confirm(`Delete ${row.partNumber||'this sub assembly'} from this project?`))return;
  setData((d:any)=>({...d,projectAssemblies:d.projectAssemblies.filter((a:any)=>a.id!==id).map((a:any)=>({...a,dependsOn:splitIds(a.dependsOn).filter((depId:string)=>depId!==id).join(',')})),holds:d.holds.filter((h:any)=>h.assemblyId!==id)}))
 }
 function topOptions(top:any){return topLevels.filter((x:any)=>x.id!==top.id).map((x:any)=>({id:x.id,label:`${x.buildGroupLabel||x.partNumber+' '+(x.instanceLabel||'')} — ${x.description||''}`}))}
 function subOptions(sub:any,subs:any[]){return subs.filter((x:any)=>x.id!==sub.id).map((x:any)=>({id:x.id,label:`${x.partNumber} ${x.instanceLabel||''} — ${x.description||''}`}))}
 function hasHeldSubs(top:any){return projectAssemblies.some((s:any)=>s.type==='Sub Assembly'&&((s.buildGroupId&&s.buildGroupId===(top.buildGroupId||top.id))||s.parentAssemblyId===top.id)&&(s.status==='On Hold'||String(s.holdReason||'').trim()))}
 function completionCap(top:any){return hasHeldSubs(top)?Number(top.maxTopPercentWhenSubHeld||80):100}
 function safeChange(r:any,patch:any){if('percent' in patch&&r.type==='Top Level Assembly'){patch={...patch,percent:Math.min(Number(patch.percent)||0,completionCap(r))}}changeAsm(r.id,patch)}
 function projectMonthDays(month:string){const [y,m]=month.split('-').map(Number);const first=new Date(y,m-1,1);const start=new Date(first);const day=first.getDay();const diff=day===0?-6:1-day;start.setDate(first.getDate()+diff);const out:string[]=[];for(let w=0;w<6;w++){for(let i=0;i<5;i++){const d=new Date(start);d.setDate(start.getDate()+w*7+i);out.push(dateOnly(d));}}return out}
 function moveTopToDate(top:any,date:string){if(!top)return;changeAsm(top.id,{shipDate:date});setSelectedTopId(top.id)}
 function ProjectMonthCalendar(){
  const days=projectMonthDays(projectMonth);
  const [y,m]=projectMonth.split('-').map(Number);
  const draftCount=Object.keys(calendarDrafts||{}).length;
  function effectiveShipDate(top:any){return calendarDrafts[top.id] || top.shipDate || project?.dueDate || ''}
  function dayItems(date:string){return topLevels.filter((t:any)=>effectiveShipDate(t)===date).sort((a:any,b:any)=>(a.instanceNumber||0)-(b.instanceNumber||0))}
  function dragStart(e:any,top:any){e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('projectTopId',top.id);e.dataTransfer.setData('text/plain',top.id)}
  function dropOnDay(e:any,date:string){e.preventDefault();const id=e.dataTransfer.getData('projectTopId')||e.dataTransfer.getData('text/plain');const top=topLevels.find((t:any)=>t.id===id);if(top){setCalendarDrafts((prev:any)=>({...prev,[top.id]:date}));setSelectedTopId(top.id)}}
  function applyDrafts(){
    if(!draftCount)return;
    setData((d:any)=>({...d,projectAssemblies:d.projectAssemblies.map((a:any)=>{
      const nextDate=calendarDrafts[a.id];
      if(nextDate)return {...a,shipDate:nextDate};
      const parent=topLevels.find((t:any)=>t.buildGroupId&&a.buildGroupId&&t.buildGroupId===a.buildGroupId);
      if(parent && calendarDrafts[parent.id])return {...a,shipDate:calendarDrafts[parent.id]};
      return a;
    })}));
    setCalendarDrafts({});
  }
  function discardDrafts(){setCalendarDrafts({})}
  return <div className="card projectCalendarCard"><div className="sectionHeaderRow"><div><h2>Project Monthly Calendar</h2><p className="muted">Drag top level assembly tiles to try schedule changes for grouped builds. Calendar shows Monday through Friday only.</p></div><div className="projectCalendarActions"><button className="btn" onClick={()=>setProjectCalendarOpen(!projectCalendarOpen)}>{projectCalendarOpen?'Minimize':'Show Calendar'}</button>{projectCalendarOpen&&<><div className="field monthPick"><label>Month</label><input type="month" value={projectMonth} onChange={e=>setProjectMonth(e.target.value)}/></div><button className="btn primary" disabled={!draftCount} onClick={applyDrafts}>Apply Changes {draftCount?`(${draftCount})`:''}</button><button className="btn" disabled={!draftCount} onClick={discardDrafts}>Discard</button></>}</div></div>{projectCalendarOpen&&<>{draftCount>0&&<div className="draftNotice">Draft mode: {draftCount} calendar change{draftCount===1?'':'s'} pending. Weekly board and dashboard will not update until you apply.</div>}<div className="projectMonthCalendar"><div className="calHead">Mon</div><div className="calHead">Tue</div><div className="calHead">Wed</div><div className="calHead">Thu</div><div className="calHead">Fri</div>{days.map((date:string,idx:number)=>{const d=new Date(date+'T00:00:00');const inMonth=d.getMonth()===(m-1);const cards=dayItems(date);const weekStart=idx%5===0;return <div key={date} className={'projectCalDay '+(!inMonth?'calMuted ':'')+(weekStart?'weekStart ':'')} onDragOver={e=>e.preventDefault()} onDrop={e=>dropOnDay(e,date)}><div className="calDate"><span>{d.getDate()}</span>{weekStart&&<em>Week {Math.floor(idx/5)+1}</em>}</div>{cards.map((top:any)=>{const subs=projectAssemblies.filter((s:any)=>s.type==='Sub Assembly'&&((s.buildGroupId&&s.buildGroupId===top.buildGroupId)||s.parentAssemblyId===top.id));const isDraft=!!calendarDrafts[top.id];return <button key={top.id} type="button" draggable className={'projectCalTile '+(isDraft?'draftTile':'')} onDragStart={e=>dragStart(e,top)} onClick={()=>setSelectedTopId(top.id)}><b>{top.description||'No description'}</b><span>{top.buildGroupLabel||top.partNumber} {top.instanceLabel||''}</span><small>{subs.length} subs · {rolledCompletion(data,top)}%{isDraft?' · draft':''}</small></button>})}</div>})}</div></>}</div>
 }
 function TopLevelCard({top}:any){
  const subs=projectAssemblies.filter((s:any)=>s.type==='Sub Assembly'&&((s.buildGroupId&&s.buildGroupId===top.buildGroupId)||s.parentAssemblyId===top.id));
  const batch=batches.find((b:any)=>b.id===top.batchId);
  const topSeq=splitIds(top.dependsOn).filter((id:string)=>topOptions(top).some((o:any)=>o.id===id))[0]||'';
  const statusClass=top.status==='On Hold'?'hold':rolledCompletion(data,top)>=100?'complete':topSeq?'sequenced':batch?'batched':'independent';
  const employeeSummary=splitIds(top.assignedTo||'').map((id:string)=>data.employees.find((e:any)=>e.id===id)?.name).filter(Boolean).join(', ');
  return <div className={`buildCard buildCardRedesign ${statusClass}`}>
    <div className="buildCardBanner">
      <div className="buildTreeStripe">TOP</div>
      <div className="buildIdentity"><span className="buildKicker">TOP LEVEL BUILD SET</span><h3>{top.buildGroupLabel||`${top.partNumber} ${top.instanceLabel||''}`}</h3><p>{top.description||'No description'}</p></div>
      <div className="buildBadges"><span className="pill strongPill">{rolledCompletion(data,top)}% Overall</span><span className="pill">Build {Math.min(top.percent||0,completionCap(top))}%</span><span className="pill">{subs.length} Sub{subs.length===1?'':'s'}</span>{batch&&<span className="pill warn">{batch.name}</span>}{topSeq&&<span className="pill warn">Sequenced</span>}{top.status==='On Hold'&&<span className="pill dangerPill">On Hold</span>}</div>
      <div className="buildHeaderActions"><button className="btn danger" onClick={()=>deleteGroup(top)}>Delete Group</button></div>
    </div>
    <div className="buildSummaryStrip"><div><label>Ship By</label><b>{top.shipDate||'Not set'}</b></div><div><label>Batch</label><b>{batch?.name||'Independent'}</b></div><div><label>Sequence After</label><b>{topSeq?(topOptions(top).find((x:any)=>x.id===topSeq)?.label||'Selected assembly'):'None'}</b></div><div><label>Build Employee</label><b>{employeeSummary||'Unassigned'}</b></div></div>
    <div className="buildControls">
      <div className="field"><label>Assembly Ship By</label><StableDateInput className="largeInput" type="date" value={top.shipDate||''} onCommit={(value:any)=>safeChange(top,{shipDate:value})}/><div className="fieldHelp">This date belongs only to this top level group.</div></div>
      <div className="field"><label>Build Employee(s)</label><EmployeePicker data={data} value={top.assignedTo||''} onChange={(v:any)=>safeChange(top,{assignedTo:v})} row={top}/></div>
      <div className="field"><label>Build % Complete</label><BufferedPercentInput className="largeInput" max={completionCap(top)} value={Math.min(top.percent||0,completionCap(top))} onCommit={(value:any)=>safeChange(top,{percent:value})}/>{completionCap(top)<100&&<div className="capNote">Overall capped at {completionCap(top)}% because a sub is on hold.</div>}</div>
      <div className="field"><label>Status</label><select className="largeInput" value={top.status||'Not Started'} onChange={e=>safeChange(top,{status:e.target.value,holdReason:e.target.value==='On Hold'?(top.holdReason||'On hold'):top.holdReason})}><option>Not Started</option><option>In Progress</option><option>Complete</option><option>On Hold</option></select></div>
      <div className="field wide"><label>Hold Reason</label><HoldReasonInput row={top} className="largeInput" onCommit={(patch:any)=>safeChange(top,patch)}/></div>
    </div>
    <CollapsibleSection storageKey={`top-${top.id}-advanced`} title="Advanced Scheduling" subtitle="Batching, sequencing, test return, and inspection / shipping crews." defaultOpen={false} summary={`${batch?.name||'No batch'} • ${topSeq?'Sequenced':'No sequencing'} • ${top.lateAllowed?'Late allowed':'On-time required'}${top.testRequired?' • Test gate':''}`}>
    <div className="buildControls">
      <div className="field"><label>Late Allowed</label><label className="checkLine"><input type="checkbox" checked={!!top.lateAllowed} onChange={e=>safeChange(top,{lateAllowed:e.target.checked})}/> Allow late</label></div>
      <div className="field"><label>Shipment Batch</label><select className="largeInput" value={top.batchId||''} onChange={e=>safeChange(top,{batchId:e.target.value})}><option value="">No batch / ships alone</option>{batches.map((b:any)=><option key={b.id} value={b.id}>{b.name}</option>)}</select>{batch&&<div className="fieldHelp">Batch: {batch.name} ships {batch.shipDate||'not set'}.</div>}</div>
      <div className="field wide"><label>Sequence This Top Level After</label><select className="largeInput" value={topSeq} onChange={e=>safeChange(top,{dependsOn:e.target.value,overrideDependencies:!e.target.value})}><option value="">No sequencing / independent</option>{topOptions(top).map((x:any)=><option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
      {top.testRequired&&<div className="field"><label>Expected Test Return</label><StableDateInput className="largeInput" type="datetime-local" value={top.testReturnDateTime||''} onCommit={(value:any)=>safeChange(top,{testReturnDateTime:value})}/></div>}
      {top.inspectionRequired&&<div className="field"><label>Inspection Employee(s)</label><EmployeePicker data={data} value={top.inspectionAssignedTo||''} onChange={(v:any)=>safeChange(top,{inspectionAssignedTo:v})} row={top} phase="Inspection"/><label className="checkLine"><input type="checkbox" checked={!!top.inspectionComplete} onChange={e=>safeChange(top,{inspectionComplete:e.target.checked})}/> Inspection complete</label></div>}
      {top.shippingRequired&&<div className="field"><label>Shipping Employee(s)</label><EmployeePicker data={data} value={top.shippingAssignedTo||''} onChange={(v:any)=>safeChange(top,{shippingAssignedTo:v})} row={top} phase="Shipping"/><label className="checkLine"><input type="checkbox" checked={!!top.shippingComplete} onChange={e=>safeChange(top,{shippingComplete:e.target.checked})}/> Shipping complete</label></div>}
    </div>
    </CollapsibleSection>
    <div className="subPanel redesignedSubs"><div className="subPanelTitle"><div><h4>Nested Sub Assemblies</h4><p className="muted">These subs belong only to {top.buildGroupLabel||top.partNumber}.</p></div><span className="pill">{subs.length} total</span></div><div className="subCards">{subs.length===0&&<div className="emptySubCard muted">No subs assigned to this top level.</div>}{subs.map((s:any,idx:number)=>{const subSeq=splitIds(s.dependsOn).filter((id:string)=>subOptions(s,subs).some((o:any)=>o.id===id))[0]||'';const subEmps=splitIds(s.assignedTo||'').map((id:string)=>data.employees.find((e:any)=>e.id===id)?.name).filter(Boolean).join(', ');return <CollapsibleSection key={s.id} storageKey={`sub-${s.id}`} title={`SUB #${idx+1} · ${s.partNumber} ${s.instanceLabel||''}`} subtitle={s.description||'No description'} defaultOpen={false} summary={`${subEmps||'Unassigned'} • ${rolledCompletion(data,s)}% • ${s.status||'Not Started'}${s.holdReason?' — '+s.holdReason:''}`}><div className={`subAssemblyCard ${s.status==='On Hold'?'holdSub':''}`}><div className="subCardHeader"><div><b>{s.partNumber} {s.instanceLabel||''}</b><input value={s.description||''} onChange={e=>safeChange(s,{description:e.target.value})}/></div><span className="pill">{rolledCompletion(data,s)}%</span></div><div className="subCardGrid"><label>Qty<input className="tiny" type="number" value={s.qty||0} onChange={e=>safeChange(s,{qty:Number(e.target.value)})}/></label><label>Hrs Each<input className="tiny" type="number" value={s.hoursEach||0} onChange={e=>safeChange(s,{hoursEach:Number(e.target.value)})}/></label><label>Build Employee<EmployeePicker data={data} value={s.assignedTo||''} onChange={(v:any)=>safeChange(s,{assignedTo:v})} row={s}/></label><label>Status<select value={s.status||'Not Started'} onChange={e=>safeChange(s,{status:e.target.value,holdReason:e.target.value==='On Hold'?(s.holdReason||'On hold'):s.holdReason})}><option>Not Started</option><option>In Progress</option><option>Complete</option><option>On Hold</option></select></label><label>Build %<BufferedPercentInput className="tiny" value={s.percent||0} onCommit={(value:any)=>safeChange(s,{percent:value})}/></label><label>Sequence After<select value={subSeq} onChange={e=>safeChange(s,{dependsOn:e.target.value,overrideDependencies:!e.target.value})}><option value="">No sequencing</option>{subOptions(s,subs).map((x:any)=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>{s.testRequired&&<label>Test Return<StableDateInput type="datetime-local" value={s.testReturnDateTime||''} onCommit={(value:any)=>safeChange(s,{testReturnDateTime:value})}/></label>}{s.inspectionRequired&&<label>Inspection Employee<EmployeePicker data={data} value={s.inspectionAssignedTo||''} onChange={(v:any)=>safeChange(s,{inspectionAssignedTo:v})} row={s} phase="Inspection"/></label>}{s.shippingRequired&&<label>Shipping Employee<EmployeePicker data={data} value={s.shippingAssignedTo||''} onChange={(v:any)=>safeChange(s,{shippingAssignedTo:v})} row={s} phase="Shipping"/></label>}<label className="wideSub">Hold Reason<HoldReasonInput row={s} onCommit={(patch:any)=>safeChange(s,patch)}/></label></div><div className="subChecks">{s.inspectionRequired&&<label><input type="checkbox" checked={!!s.inspectionComplete} onChange={e=>safeChange(s,{inspectionComplete:e.target.checked})}/> Inspection complete</label>}{s.shippingRequired&&<label><input type="checkbox" checked={!!s.shippingComplete} onChange={e=>safeChange(s,{shippingComplete:e.target.checked})}/> Shipping complete</label>}</div></div></CollapsibleSection>})}</div></div>
  </div>
 }
 function updateHold(id:string,patch:any){setData((d:any)=>({...d,holds:d.holds.map((h:any)=>h.id===id?{...h,...patch}:h)}))}
 function clearHold(h:any){setData((d:any)=>({...d,holds:d.holds.map((x:any)=>x.id===h.id?{...x,status:'Closed'}:x),projectAssemblies:d.projectAssemblies.map((a:any)=>a.id===h.assemblyId?{...a,status:a.status==='On Hold'?'Not Started':a.status,holdReason:''}:a)}))}
 function holdAsmName(id:string){const a=(data.projectAssemblies||[]).find((x:any)=>x.id===id);return a?`${a.partNumber} ${a.instanceLabel||''} — ${a.description}`:id}
 const projectOpenHolds=(data.holds||[]).filter((h:any)=>h.projectId===(project?.id||'')&&h.status!=='Closed');
 const sectionBase=`project-${project?.id||'none'}`;
 const assembliesSummary=`${projectAssemblies.length} assembly item${projectAssemblies.length===1?'':'s'} • ${topLevels.length} top level group${topLevels.length===1?'':'s'} • ${standaloneSubs.length} standalone sub${standaloneSubs.length===1?'':'s'}`;
 const qualifiedSummary=`${preferredBuilders.length} preferred builder${preferredBuilders.length===1?'':'s'} • ${otherBuilders.length} other builder${otherBuilders.length===1?'':'s'} • ${qualifiedShippers.length} shipper${qualifiedShippers.length===1?'':'s'}`;
 const warningSummary=projectWarnings.length?`${projectWarnings.length} warning${projectWarnings.length===1?'':'s'} need review.`:'No current project warnings.';
 const autoAssignSummary=projectAutoAssignSuggestions.length?`${projectAutoAssignSuggestions.filter((item:any)=>item.status==='suggested').length} suggested • ${projectAutoAssignSuggestions.filter((item:any)=>item.status==='blocked').length} blocked`:'No current Smart Assign suggestions.';
 const noteSummary=String(project?.notes||'').trim()||'No project notes yet.';
 const selectedTopSummary=selectedTop?`${selectedTop.partNumber||'Top Level'} ${selectedTop.instanceLabel||''} • Ship ${selectedTop.shipDate||'not set'}`:'No top level selected yet.';
 return <div className="projectRedesign">
   <div className="projectSidebar card">
     <h2>Projects</h2>
     <p className="muted">Pick one project, filter by health, then manage assemblies and shipment timing on the right.</p>
     <div className="field full">
       <label>Health Filter</label>
       <select className="largeInput" value={healthFilter} onChange={e=>setHealthFilter(e.target.value)}>
         {PROJECT_HEALTH_OPTIONS.map((option:any)=><option key={option} value={option}>{option}</option>)}
       </select>
     </div>
     <button type="button" className={'btn holdFilterChip'+(holdsOnly?' primary':'')} onClick={()=>setHoldsOnly((v:boolean)=>!v)}>On Hold ({openHoldProjectCount})</button>
     <div className="actions">
       <button className="btn primary" onClick={addProject}>Add Project</button>
       {project&&<button className="btn" onClick={copyProject}>Duplicate</button>}
     </div>
     <div className="projectList">
       {visibleProjects.map((p:any)=>{
         const record=projectHealthById?.[p.id];
         return <button key={p.id} onClick={()=>setSelected(p.id)} className={p.id===project?.id?'selectedProject':''}><div className="projectListTop"><b>{p.projectId||'New Project'}</b>{record&&<HealthBadge status={record.status}/>}</div><small><span className={'typeTag '+String(p.projectType||'New Build').toLowerCase().replace(/[^a-z0-9]+/g,'')}>{p.projectType||'New Build'}</span> {p.status}</small>{record&&<span className="projectListReason">{record.reason}</span>}</button>
       })}
       {visibleProjects.length===0&&<p className="muted">No projects match this health filter.</p>}
     </div>
     {project&&<button className="btn danger fullWidth" onClick={()=>deleteProject(project.id)}>Delete Selected Project</button>}
   </div>
   {project&&<div className="projectMain">
     <div className="card projectHeroCard">
       <div className="projectHeaderRow">
         <h2>{project.projectId||'New Project'} <span className={'typeTag '+String(project.projectType||'New Build').toLowerCase().replace(/[^a-z0-9]+/g,'')}>{project.projectType||'New Build'}</span> <span className="pill">Project {projectCompletion(data,project.id)}%</span></h2>
         {projectRecord&&<HealthBadge status={projectRecord.status}/>}
       </div>
       {projectRecord&&<p className="muted projectHealthReason">{projectRecord.reason}</p>}
     </div>
     <CollapsibleSection storageKey={`${sectionBase}-details`} title="Project Details" subtitle="Core project fields and due-date defaults." defaultOpen summary={`${project.customer||'No customer'} • ${project.status||'Active'} • Due ${project.dueDate||'not set'}`}>
       <div className="projectForm">
         <div className="field"><label>Project ID</label><input className="largeInput" value={project.projectId||''} placeholder="10000.000.0000" onChange={e=>updateProject('projectId',e.target.value)}/></div>
         <div className="field"><label>Customer</label><input className="largeInput" value={project.customer||''} onChange={e=>updateProject('customer',e.target.value)}/></div>
         <div className="field"><label>Project Type</label><select className="largeInput" value={project.projectType||'New Build'} onChange={e=>updateProject('projectType',e.target.value)}><option>New Build</option><option>Spare</option><option>Repair/Warranty</option></select></div>
         <div className="field"><label>Default Ship By</label><input className="largeInput" type="date" value={project.dueDate||''} onChange={e=>updateProject('dueDate',e.target.value)}/><div className="fieldHelp">Used as the default when adding grouped top levels or standalone subs. Grouped top levels keep their own Assembly Ship By below.</div></div>
         <div className="field"><label>Status</label><select className="largeInput" value={project.status||'Active'} onChange={e=>updateProject('status',e.target.value)}><option>Active</option><option>On Hold</option><option>Complete</option><option>Cancelled</option></select></div>
         <div className="field"><label>Priority</label><input className="largeInput" type="number" value={project.priority??5} onChange={e=>updateProject('priority',Number(e.target.value)||0)}/></div>
       </div>
     </CollapsibleSection>
     {projectRecord&&<CollapsibleSection storageKey={`${sectionBase}-timeline`} title="Project Timeline" subtitle="Subs to final shipping, based on current schedule data." defaultOpen={false} summary={projectRecord.reason}><ProjectTimelinePanel record={projectRecord} onFocusBoard={onFocusBoard}/></CollapsibleSection>}
     <CollapsibleSection storageKey={`${sectionBase}-warnings`} title="Schedule Warnings" subtitle="Informational only. Review and adjust where needed." defaultOpen summary={warningSummary}>
       <ScheduleWarningsPanel warnings={projectWarnings} maxItems={12} title="Schedule Warnings" subtitle="These warnings do not auto-change the saved schedule." onAction={(warning:any)=>onFocusBoard?.(warning.projectId||project.id,warning.date||project.dueDate||'')} getActionLabel={(warning:any)=>warning.projectId||warning.date?'Jump to item':''}/>
     </CollapsibleSection>
     <CollapsibleSection storageKey={`${sectionBase}-holds`} title="Holds" subtitle="Open holds on this project. Put an assembly on hold by setting its status or entering a hold reason." defaultOpen={false} summary={projectOpenHolds.length?`${projectOpenHolds.length} open hold${projectOpenHolds.length===1?'':'s'}`:'No open holds.'}>
       <div className="tablewrap"><table><thead><tr>{['Assembly','Reason','Owner','Status','Notes','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{projectOpenHolds.length===0&&<tr><td colSpan={6} className="muted">No open holds on this project.</td></tr>}{projectOpenHolds.map((h:any)=><tr key={h.id}><td>{holdAsmName(h.assemblyId)}</td><td><input value={h.reason||''} onChange={e=>updateHold(h.id,{reason:e.target.value})}/></td><td><input value={h.owner||''} onChange={e=>updateHold(h.id,{owner:e.target.value})}/></td><td><select value={h.status||'Open'} onChange={e=>updateHold(h.id,{status:e.target.value})}><option>Open</option><option>Waiting on Parts</option><option>Waiting on Engineering</option><option>Waiting on Customer</option><option>Closed</option></select></td><td><input value={h.notes||''} onChange={e=>updateHold(h.id,{notes:e.target.value})}/></td><td><button className="btn" onClick={()=>clearHold(h)}>Clear Hold</button></td></tr>)}</tbody></table></div>
     </CollapsibleSection>
     <CollapsibleSection storageKey={`${sectionBase}-qualified`} title="Preferred / Available Employees" subtitle="Preferred people first, then other active people who fit the role and current availability rules." defaultOpen={false} summary={qualifiedSummary}>
       <section className="qualifiedEmployeesPanel">
         <div className="qualifiedEmployeeGrid">
           <div className="qualifiedEmployeeCol"><h3>Preferred Builders</h3>{preferredBuilders.length===0?<p className="muted">No preferred builders right now.</p>:preferredBuilders.map((employee:any)=><span key={employee.id} className="qualifiedEmployeeChip preferredEmployeeChip">{employee.name}</span>)}
             <h4>Other Available Builders</h4>{otherBuilders.length===0?<p className="muted small">No other builders available.</p>:otherBuilders.map((employee:any)=><span key={employee.id} className="qualifiedEmployeeChip">{employee.name}</span>)}</div>
           <div className="qualifiedEmployeeCol"><h3>Preferred Inspectors</h3>{preferredInspectors.length===0?<p className="muted">No preferred inspectors right now.</p>:preferredInspectors.map((employee:any)=><span key={employee.id} className="qualifiedEmployeeChip preferredEmployeeChip">{employee.name}</span>)}
             <h4>Other Available Inspectors</h4>{otherInspectors.length===0?<p className="muted small">No other inspectors available.</p>:otherInspectors.map((employee:any)=><span key={employee.id} className="qualifiedEmployeeChip">{employee.name}</span>)}</div>
           <div className="qualifiedEmployeeCol"><h3>Preferred Shippers</h3>{preferredShippers.length===0?<p className="muted">No preferred shippers right now.</p>:preferredShippers.map((employee:any)=><span key={employee.id} className="qualifiedEmployeeChip preferredEmployeeChip">{employee.name}</span>)}
             <h4>Other Available Shippers</h4>{otherShippers.length===0?<p className="muted small">No other shippers available.</p>:otherShippers.map((employee:any)=><span key={employee.id} className="qualifiedEmployeeChip">{employee.name}</span>)}</div>
         </div>
       </section>
     </CollapsibleSection>
     <CollapsibleSection storageKey={`${sectionBase}-autoassign`} title="Smart Assign Suggestions" subtitle="Preview-only assignment suggestions for this project." defaultOpen={false} summary={autoAssignSummary}>
       <div className="autoAssignPreviewPanel projectAutoAssignPanel">
         <div className="autoAssignPreviewList">
           {projectAutoAssignSuggestions.length===0&&<p className="muted">No Smart Assign suggestions for this project right now.</p>}
           {projectAutoAssignSuggestions.map((suggestion:any)=><article key={suggestion.id} className={`warningCard ${suggestion.status==='suggested'?'info':'critical'}`}><div className="warningCardTop"><span className={`warningLevel ${suggestion.status==='suggested'?'info':'critical'}`}>{phaseBadgeLabel(suggestion.phase)}</span><span className="warningDate">{fmtDate(suggestion.date)}</span></div><b>{suggestion.projectCode}</b><span>{suggestion.partNumber} — {suggestion.description}</span><div className="warningMetaRow">{suggestion.employeeName&&<small>{suggestion.employeeName}</small>}{suggestion.shipDate&&<small>Ship By {fmtDate(suggestion.shipDate)}</small>}</div><small>{suggestion.reason}</small></article>)}
         </div>
       </div>
     </CollapsibleSection>
     <CollapsibleSection storageKey={`${sectionBase}-notes`} title="Notes" subtitle="Project notes stay separate so they are easier to collapse." defaultOpen={false} summary={noteSummary}>
       <div className="field full">
         <label>Project Notes</label>
         <textarea className="largeInput" value={project.notes||''} onChange={e=>updateProject('notes',e.target.value)}/>
       </div>
     </CollapsibleSection>
     <CollapsibleSection storageKey={`${sectionBase}-calendar`} title="Project Calendar" subtitle="Try top-level date moves without changing saved data until you apply." defaultOpen={false} summary={selectedTopSummary}>
       <ProjectMonthCalendar/>
     </CollapsibleSection>
     <CollapsibleSection storageKey={`${sectionBase}-add-library`} title="Add Assemblies from Library" subtitle="Search the library, then add grouped top levels or standalone subs." defaultOpen={false} summary={selectedTemplate?`${selectedTemplate.partNumber||'No P/N'} — ${selectedTemplate.description||'No description'}`:'No library item selected'}>
       <div className="assemblyPicker">
         <div className="field full"><label>Search Library by P/N or Description</label><input className="largeInput" value={assemblySearch} placeholder="Type part number or description..." onChange={e=>setAssemblySearch(e.target.value)}/></div>
         <div className="assemblySearchResults">{addableAssemblies.length===0&&<div className="muted noResults">No matching active assemblies.</div>}{addableAssemblies.slice(0,60).map((t:any)=><button key={t.id} type="button" className={t.id===templateId?'assemblyResult selectedAssemblyResult':'assemblyResult'} onClick={()=>setTemplateId(t.id)}><b>{t.partNumber||'No P/N'}</b><span>{t.description||'No description'}</span><small>{t.type}{t.type==='Top Level Assembly'?` • ${splitIds(t.defaultDependsOn).length} sub${splitIds(t.defaultDependsOn).length===1?'':'s'}`:''}</small></button>)}</div>
         <div className="selectedAssemblyBox"><div><label>Selected Assembly</label><b>{selectedTemplate?`${selectedTemplate.partNumber||'No P/N'} — ${selectedTemplate.description||'No description'}`:'None selected'}</b><span className="muted">{selectedTemplate?.type||'No type selected'}</span></div><div><label>How Many</label><input className="largeInput qtyInput" type="number" min="1" value={addQty} onChange={e=>setAddQty(Math.max(1,Number(e.target.value)||1))}/></div>{selectedTemplate?.type==='Sub Assembly'?<button className="btn primary tallBtn" disabled={!templateId} onClick={()=>addFromLibrary('standaloneSub')}>Add Standalone Sub</button>:<><button className="btn primary tallBtn" disabled={!templateId} onClick={()=>addFromLibrary('withSubs')}>Add Top Level + Subs</button><button className="btn tallBtn" disabled={!templateId} onClick={()=>addFromLibrary('topOnly')}>Add Top Level</button></>}</div>
       </div>
     </CollapsibleSection>
     <CollapsibleSection storageKey={`${sectionBase}-batches`} title="Shipment Batches" subtitle="Optional shipment group labels for top-level builds." defaultOpen={false} summary={`${batches.length} batch${batches.length===1?'':'es'}`}>
       <button className="btn primary" onClick={addBatch}>Add Shipment Batch</button>
       <div className="batchGrid">{batches.length===0&&<p className="muted">No batches yet. Assemblies can still be scheduled individually.</p>}{batches.map((b:any)=><div className="batchCard" key={b.id}><p><span className="pill">Batch {batchCompletion(data,b.id)}%</span></p><label>Batch Name</label><input value={b.name||''} onChange={e=>updateBatch(b.id,{name:e.target.value})}/><label>Batch Ship By</label><input type="date" value={b.shipDate||''} onChange={e=>updateBatch(b.id,{shipDate:e.target.value})}/><label className="checkLine"><input type="checkbox" checked={!!b.lateAllowed} onChange={e=>updateBatch(b.id,{lateAllowed:e.target.checked})}/> Late allowed for this batch</label><label>Sequence</label><input type="number" value={b.sequence||1} onChange={e=>updateBatch(b.id,{sequence:Number(e.target.value)||1})}/><label>Notes</label><input value={b.notes||''} onChange={e=>updateBatch(b.id,{notes:e.target.value})}/><div className="actions"><button className="mini" onClick={()=>applyBatchDate(b)}>Apply Date to Assemblies</button><button className="mini danger" onClick={()=>deleteBatch(b.id)}>Delete / Unbatch</button></div></div>)}</div>
     </CollapsibleSection>
     <CollapsibleSection storageKey={`${sectionBase}-assemblies`} title="Project Assemblies" subtitle="Top-level groups, standalone subs, and detailed assembly rows." defaultOpen summary={assembliesSummary}>
       <div className="projectTileSection">
         <p className="muted">Grouped builds are shown as compact tiles here. Click a top level tile to edit its Ship By, batch, sequencing, employees, holds, and nested subs below. Standalone subs can be added from the library and scheduled without a top level.</p>
         {topLevels.length===0&&<p className="muted">{standaloneSubs.length?'No top level assembly groups on this project yet.':'No top level assemblies added to this project yet.'}</p>}
         {topLevels.length>0&&<><div className="topAssemblyTileGrid">{topLevels.map((top:any)=>{const subs=projectAssemblies.filter((s:any)=>s.type==='Sub Assembly'&&((s.buildGroupId&&s.buildGroupId===top.buildGroupId)||s.parentAssemblyId===top.id));const batch=batches.find((b:any)=>b.id===top.batchId);const held=top.status==='On Hold'||String(top.holdReason||'').trim()||subs.some((s:any)=>s.status==='On Hold'||String(s.holdReason||'').trim());return <button key={top.id} type="button" className={'topAssemblyTile '+(selectedTop?.id===top.id?'selectedTopAssemblyTile ':'')+(held?'tileHold ':'')+(rolledCompletion(data,top)>=100?'tileComplete ':'')} onClick={()=>setSelectedTopId(top.id)}><div className="tileTitleRow"><b className="topTileDescription">{top.description||'No description'}</b><span>{rolledCompletion(data,top)}%</span></div><div className="tileDesc">{top.partNumber||'No P/N'} {top.instanceLabel||''}</div><div className="tileFacts"><span>{top.buildGroupLabel||'Top Level'}</span><span>{project.projectType||'New Build'}</span><span>Ship: {top.shipDate||'—'}</span><span>{subs.length} subs</span>{batch&&<span>{batch.name}</span>}{held&&<span>Hold</span>}</div></button>})}</div><div className="selectedTopEditor">{selectedTop?<TopLevelCard key={selectedTop.id} top={selectedTop}/>:<p className="muted">Select a top level assembly tile to edit.</p>}</div></>}
         {standaloneSubs.length>0&&<div className="selectedAssemblyBox standaloneSubSummary"><label>Standalone Subs</label><b>{standaloneSubs.length} standalone sub assembly item{standaloneSubs.length===1?'':'s'}</b><span className="muted">These schedule normally and stay outside top-level groups.</span></div>}
       </div>
     </CollapsibleSection>
   </div>}
 </div>
}
