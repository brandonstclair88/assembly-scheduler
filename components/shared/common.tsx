'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {canEmployeeForPhase} from '../../lib/employeeRoles';
import {fmtDate,splitIds} from '../../lib/format';
import {clampPercentInput} from '../../lib/mutations';
import {healthTone} from '../../lib/projectHealth';
import {suggestEmployees} from '../../lib/scheduler';
import {AssemblyTemplate,ProjectAssembly} from '../../lib/types';

export const uid=(p:string)=>p+'-'+Math.random().toString(36).slice(2,9);

export function projectAccentColor(projectId:string){
  const palette=['#2563eb','#0f766e','#7c3aed','#d97706','#dc2626','#0891b2','#65a30d','#c2410c'];
  const hash=String(projectId||'').split('').reduce((sum,ch)=>sum+ch.charCodeAt(0),0);
  return palette[hash%palette.length];
}

export function sessionCollapseKey(storageKey:string){
  return `assembly-scheduler-collapse-${storageKey}`;
}

export function CollapsibleSection({storageKey,title,subtitle,summary,defaultOpen=false,actions,children,tone=''}:any){
  const [open,setOpen]=useState(()=>{
    if(typeof window==='undefined')return defaultOpen;
    try{
      const raw=sessionStorage.getItem(sessionCollapseKey(storageKey));
      if(raw===null)return defaultOpen;
      return raw==='open';
    }catch{
      return defaultOpen;
    }
  });
  useEffect(()=>{
    try{sessionStorage.setItem(sessionCollapseKey(storageKey),open?'open':'closed')}catch{}
  },[storageKey,open]);
  return <section className={`collapsibleSection ${open?'open':'collapsed'} ${tone}`.trim()}><div className="collapsibleHeader"><button type="button" className="collapsibleToggle" onClick={()=>setOpen((value:boolean)=>!value)}><span className={`chevron ${open?'open':''}`}>▾</span><span><b>{title}</b>{subtitle&&<small>{subtitle}</small>}</span></button>{actions&&<div className="collapsibleActions">{actions}</div>}</div>{!open&&summary&&<div className="collapsibleSummary">{summary}</div>}{open&&<div className="collapsibleBody">{children}</div>}</section>
}

export function makeAsm(t:AssemblyTemplate,projectId:string,shipDate:string,instanceNumber=1,buildGroupId='',buildGroupLabel='',parentAssemblyId='',batchId=''):ProjectAssembly{return {id:uid('asm'),projectId,templateId:t.id,partNumber:t.partNumber,description:t.description,type:t.type,instanceNumber,instanceLabel:'#'+instanceNumber,buildGroupId,buildGroupLabel,parentAssemblyId,batchId,qty:t.defaultQty||1,hoursEach:t.hoursEach||1,testRequired:!!t.testRequired,testHours:t.testHours||0,inspectionRequired:!!t.inspectionRequired,inspectionHours:t.inspectionHours||0,shippingRequired:!!t.shippingRequired,shippingHours:t.shippingHours||0,testReturnDateTime:'',inspectionAssignedTo:'',shippingAssignedTo:'',inspectionManualStartDate:'',shippingManualStartDate:'',inspectionComplete:false,shippingComplete:false,maxTopPercentWhenSubHeld:t.maxTopPercentWhenSubHeld||80,dependsOn:'',assignedTo:'',startAfter:'',status:'Not Started',percent:0,holdReason:'',shipDate,lateAllowed:false,overrideDependencies:false,manuallyScheduled:false,manualStartDate:'',locked:false,smartAssignProtected:false}}

export function taskHours(a:any){return Math.max(0,Number(a.qty||1)*Number(a.hoursEach||0))}

export function baseTaskCompletion(a:any){
  const buildHours=taskHours(a); const inspectHours=a.inspectionRequired?Number(a.inspectionHours||0):0; const shipHours=a.shippingRequired?Number(a.shippingHours||0):0;
  const total=Math.max(1,buildHours+inspectHours+shipHours);
  const buildPct=a.status==='Complete'?100:Math.max(0,Math.min(100,Number(a.percent||0)));
  const inspectPct=a.inspectionRequired?(a.inspectionComplete?100:0):100;
  const shipPct=a.shippingRequired?(a.shippingComplete?100:0):100;
  return Math.round(((buildPct/100*buildHours)+(inspectPct/100*inspectHours)+(shipPct/100*shipHours))/total*100);
}

export function rolledCompletion(data:any,a:any){
  if(!a)return 0;
  if(a.type!=='Top Level Assembly')return baseTaskCompletion(a);
  const children=(data.projectAssemblies||[]).filter((x:any)=>x.parentAssemblyId===a.id);
  let weighted=baseTaskCompletion(a)*Math.max(1,taskHours(a)); let weight=Math.max(1,taskHours(a));
  for(const c of children){const w=Math.max(1,taskHours(c));weighted+=rolledCompletion(data,c)*w;weight+=w;}
  let pct=Math.round(weighted/Math.max(1,weight));
  const hasHeld=children.some((c:any)=>c.status==='On Hold'||c.holdReason);
  if(hasHeld)pct=Math.min(pct,Number(a.maxTopPercentWhenSubHeld||80));
  return pct;
}

export function projectCompletion(data:any,projectId:string){
 const rows=(data.projectAssemblies||[]).filter((a:any)=>a.projectId===projectId&&(a.type==='Top Level Assembly'||(a.type==='Sub Assembly'&&!a.parentAssemblyId&&!a.buildGroupId)));
 if(!rows.length)return 0;
 return Math.round(rows.reduce((s:number,a:any)=>s+rolledCompletion(data,a),0)/rows.length)
}

export function batchCompletion(data:any,batchId:string){const tops=(data.projectAssemblies||[]).filter((a:any)=>a.batchId===batchId&&a.type==='Top Level Assembly');if(!tops.length)return 0;return Math.round(tops.reduce((s:number,a:any)=>s+rolledCompletion(data,a),0)/tops.length)}

export const PROJECT_HEALTH_OPTIONS=['All','On Track','At Risk','Late','Missing Assignment','Over Capacity','Waiting on Test','Waiting on Inspection','Ready to Ship'];

export function phaseBadgeLabel(phase:string){return phase==='Inspection'?'INSPECT':phase==='Shipping'?'SHIP':phase==='Test'?'TEST':'BUILD'}

export function phaseToneKey(phase:string){return phase==='Inspection'?'inspect':phase==='Shipping'?'ship':phase==='Test'?'test':'build'}

export function warningActionTarget(warning:any){
  const projectAction=warning?.code==='missing_build_assignment'||warning?.code==='missing_inspection_assignment'||warning?.code==='missing_shipping_assignment';
  if(projectAction&&warning?.projectId)return {tab:'Projects',label:'View project'};
  if(warning?.projectId||warning?.date)return {tab:'Weekly Board',label:'Jump to item'};
  return null;
}

export function StableDateInput({value,onCommit,type='date',className=''}:any){
  const [local,setLocal]=useState(value||'');
  const [focused,setFocused]=useState(false);
  useEffect(()=>{if(!focused)setLocal(value||'')},[value,focused]);
  function commit(){
    const next=String(local||'');
    if(next!==String(value||''))onCommit(next);
    setFocused(false);
  }
  return <input className={className} type={type} value={local} onFocus={()=>setFocused(true)} onChange={e=>setLocal(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){(e.target as HTMLInputElement).blur()} if(e.key==='Escape'){setLocal(value||'');(e.target as HTMLInputElement).blur()}}}/>
}

export function BufferedPercentInput({value,max=100,onCommit,className=''}:any){
  const [local,setLocal]=useState(value===null||value===undefined?'':String(value));
  const [focused,setFocused]=useState(false);
  useEffect(()=>{if(!focused)setLocal(value===null||value===undefined?'':String(value))},[value,focused]);
  function commit(){
    const parsed=clampPercentInput(local);
    const safeValue=parsed===null?0:Math.min(max,parsed);
    onCommit(safeValue);
    setFocused(false);
  }
  return <input className={className} type="number" min="0" max={max} value={local} onFocus={()=>setFocused(true)} onChange={e=>setLocal(e.target.value)} onBlur={commit} onKeyDown={e=>{if(e.key==='Enter'){(e.target as HTMLInputElement).blur()} if(e.key==='Escape'){setLocal(value===null||value===undefined?'':String(value));(e.target as HTMLInputElement).blur()}}}/>
}

export function HoldReasonInput({row,onCommit,className=''}:any){
  const [value,setValue]=useState(row?.holdReason||'');
  useEffect(()=>{setValue(row?.holdReason||'')},[row?.id,row?.holdReason]);
  function commit(next=value){
    const reason=String(next||'');
    onCommit({holdReason:reason,status:reason?'On Hold':(row?.status==='On Hold'?'Not Started':row?.status)});
  }
  return <input className={className} value={value} onChange={e=>setValue(e.target.value)} onBlur={()=>commit()} onKeyDown={e=>{if(e.key==='Enter'){(e.target as HTMLInputElement).blur()}}}/>
}

export function HealthBadge({status}:any){return <span className={`healthBadge tone-${healthTone(status)}`}>{status}</span>}

export function TimelineStepBadge({status}:any){return <span className={`timelineStepBadge state-${String(status||'Pending').toLowerCase().replace(/\s+/g,'-')}`}>{status}</span>}

export function ProjectTimelinePanel({record,onFocusBoard}:any){
  if(!record)return null;
  return <section className="projectTimelinePanel"><div className="projectTimelineHeader"><div><h3>Project Timeline</h3><p className="muted">Subs to final shipping, based on current schedule data and warning state.</p></div><div className="projectTimelineActions"><HealthBadge status={record.status}/>{record.dueDate&&<span className="timelineDuePill">Due {fmtDate(record.dueDate)}</span>}{onFocusBoard&&<button className="btn" onClick={()=>onFocusBoard(record.projectId,record.dueDate||record.timeline.find((step:any)=>step.date)?.date||'')}>Open Weekly Board</button>}</div></div><div className="projectTimelineFlow">{record.timeline.map((step:any,idx:number)=><React.Fragment key={step.key}><article className={`timelineStepCard state-${String(step.status||'pending').toLowerCase().replace(/\s+/g,'-')}`}><div className="timelineStepTop"><span className="timelineStepLabel">{step.label}</span><TimelineStepBadge status={step.status}/></div>{step.date&&<b>{fmtDate(step.date)}</b>}{!step.date&&<b className="muted">No date yet</b>}{step.employeeName&&<span>{step.employeeName}</span>}{step.note&&<small>{step.note}</small>}{step.warningCount>0&&<span className="timelineWarningTag">{step.warningCount} warning{step.warningCount===1?'':'s'}</span>}</article>{idx<record.timeline.length-1&&<span className="timelineArrow">→</span>}</React.Fragment>)}</div><p className="muted small">{record.reason}</p></section>
}

export function ScheduleWarningsPanel({warnings,maxItems=8,title='Schedule Warnings',subtitle='Informational only. Review and adjust the schedule where needed.',getActionLabel,onAction}:any){
  const items=(warnings||[]).slice(0,maxItems);
  const counts={critical:(warnings||[]).filter((w:any)=>w.level==='critical').length,capacity:(warnings||[]).filter((w:any)=>w.level==='capacity').length,info:(warnings||[]).filter((w:any)=>w.level==='info').length};
  function tone(level:string){return level==='critical'?'critical':level==='capacity'?'capacity':'info'}
  return <section className="scheduleWarningsPanel"><div className="scheduleWarningsHeader"><div><h3>{title}</h3><p className="muted">{subtitle}</p></div><div className="scheduleWarningCounts"><span className="warningCount critical">{counts.critical} critical</span><span className="warningCount capacity">{counts.capacity} capacity</span><span className="warningCount info">{counts.info} info</span></div></div><div className="warningList">{items.length===0?<p className="muted">No current schedule warnings.</p>:items.map((warning:any)=>{const actionLabel=getActionLabel?getActionLabel(warning):'';return <article key={warning.id} className={`warningCard ${tone(warning.level)}`}><div className="warningCardTop"><span className={`warningLevel ${tone(warning.level)}`}>{warning.level}</span>{warning.date&&<span className="warningDate">{fmtDate(warning.date)}</span>}</div><b>{warning.projectName}</b><span>{warning.partNumber} — {warning.description}</span><div className="warningMetaRow">{warning.employeeName&&<small>{warning.employeeName}</small>}{warning.phase&&<small>{phaseBadgeLabel(warning.phase)}</small>}</div><small>{warning.reason}</small>{actionLabel&&onAction&&<div className="warningActionRow"><button className="warningActionButton" onClick={()=>onAction(warning)}>{actionLabel}</button></div>}</article>})}</div>{(warnings||[]).length>items.length&&<p className="muted small">Showing {items.length} of {(warnings||[]).length} warnings.</p>}</section>
}

export function EmployeePicker({data,value,onChange,row,phase='Build'}:any){const selected=splitIds(value);const visible=data?.employees?.filter((e:any)=>selected.includes(e.id)||(e.active!==false&&canEmployeeForPhase(e,phase)))||[];return <div className="empPick compactEmpPick employeePickerNoScroll"><div className="empPickGrid noScrollEmpGrid">{visible.map((e:any)=>{const eligible=e.active!==false&&canEmployeeForPhase(e,phase);return <label key={e.id} title={e.name} className={selected.includes(e.id)?'selectedEmpChip':''}><input type="checkbox" checked={selected.includes(e.id)} onChange={ev=>{const next=ev.target.checked?[...selected,e.id]:selected.filter((id:string)=>id!==e.id);onChange(next.join(','))}}/> <span>{e.name}</span>{e.active===false&&<small className="capNote">inactive</small>}{e.active!==false&&!eligible&&<small className="capNote">saved only</small>}</label>})}</div><div className="empPickActions"><button type="button" className="mini" onClick={()=>onChange(suggestEmployees(data,row?.id,1,phase).map((e:any)=>e.id).join(','))}>suggest 1</button><button type="button" className="mini" onClick={()=>onChange(suggestEmployees(data,row?.id,2,phase).map((e:any)=>e.id).join(','))}>suggest 2</button><button type="button" className="mini" onClick={()=>onChange('')}>clear</button></div></div>}

export function GlobalSearchPanel({data,query,setTab,clear,onOpenProject}:any){
 const q=String(query||'').toLowerCase().trim();
 const projects=(data.projects||[]).filter((p:any)=>`${p.projectId||''} ${p.name||''} ${p.customer||''}`.toLowerCase().includes(q)).slice(0,6);
 const library=(data.assemblyTemplates||[]).filter((a:any)=>`${a.partNumber||''} ${a.description||''} ${a.type||''}`.toLowerCase().includes(q)).slice(0,6);
 const projectAssemblies=(data.projectAssemblies||[]).filter((a:any)=>`${a.partNumber||''} ${a.description||''} ${a.instanceLabel||''}`.toLowerCase().includes(q)).slice(0,8);
 const employees=(data.employees||[]).filter((e:any)=>`${e.name||''} ${e.email||''} ${e.skills||''}`.toLowerCase().includes(q)).slice(0,6);
 const projectById=(id:string)=>(data.projects||[]).find((p:any)=>p.id===id)?.projectId||'';
 return <div className="globalSearchPanel"><div className="searchPanelHeader"><b>Search Results</b><button className="mini" onClick={clear}>Close</button></div><div className="searchResultsGrid"><div><h4>Projects</h4>{projects.length?projects.map((p:any)=><button key={p.id} onClick={()=>{onOpenProject?onOpenProject(p.id):setTab('Projects');clear()}}><b>{p.projectId}</b><span>{p.customer||p.name||'Project'}</span></button>):<p className="muted">No projects</p>}</div><div><h4>Library</h4>{library.length?library.map((a:any)=><button key={a.id} onClick={()=>{setTab('Assembly Library');clear()}}><b>{a.partNumber}</b><span>{a.description}</span></button>):<p className="muted">No library items</p>}</div><div><h4>Scheduled Assemblies</h4>{projectAssemblies.length?projectAssemblies.map((a:any)=><button key={a.id} onClick={()=>{onOpenProject?onOpenProject(a.projectId):setTab('Projects');clear()}}><b>{projectById(a.projectId)} · {a.partNumber} {a.instanceLabel||''}</b><span>{a.description}</span></button>):<p className="muted">No scheduled assemblies</p>}</div><div><h4>Employees</h4>{employees.length?employees.map((e:any)=><button key={e.id} onClick={()=>{setTab('People');clear()}}><b>{e.name}</b><span>{e.skills||e.email}</span></button>):<p className="muted">No employees</p>}</div></div></div>
}

export function Table({rows,cols}:any){return <div className="tablewrap"><table><thead><tr>{cols.map((c:string)=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r:any,i:number)=><tr key={r.id||i}>{cols.map((c:string)=><td key={c}>{String(r[c]??'')}</td>)}</tr>)}</tbody></table></div>}

// ─── In-app confirm dialog + toasts (replaces window.confirm / window.alert) ───
let toastListener:((t:any)=>void)|null=null;
let confirmListener:((req:any)=>void)|null=null;
export function toast(message:string,tone:'info'|'good'|'bad'='info'){if(toastListener)toastListener({message,tone,id:'t'+Date.now()+Math.random()});}
export function confirmDialog(message:string):Promise<boolean>{return new Promise(resolve=>{if(!confirmListener){resolve(typeof window!=='undefined'?window.confirm(message):false);return;}confirmListener({message,resolve});});}
export function NotificationHost(){
 const [toasts,setToasts]=useState<any[]>([]);
 const [confirmReq,setConfirmReq]=useState<any>(null);
 useEffect(()=>{
  toastListener=(t:any)=>{setToasts((v:any[])=>[...v,t]);setTimeout(()=>setToasts((v:any[])=>v.filter((x:any)=>x.id!==t.id)),4500)};
  confirmListener=(req:any)=>setConfirmReq(req);
  return()=>{toastListener=null;confirmListener=null};
 },[]);
 function answer(v:boolean){confirmReq?.resolve(v);setConfirmReq(null)}
 return <>
  <div className="toastStack">{toasts.map((t:any)=><div key={t.id} className={'toast '+t.tone}>{t.message}</div>)}</div>
  {confirmReq&&<div className="confirmOverlay" onClick={()=>answer(false)}><div className="confirmBox" onClick={(e:any)=>e.stopPropagation()}><p>{confirmReq.message}</p><div className="actions"><button className="btn primary" onClick={()=>answer(true)}>OK</button><button className="btn" onClick={()=>answer(false)}>Cancel</button></div></div></div>}
 </>;
}

export function assemblyAccentColor(id:string){let h=0;const str=String(id||'');for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))>>>0;return `hsl(${h%360} 62% 42%)`}
