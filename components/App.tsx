'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {AppData,ProjectAssembly,AssemblyTemplate} from '../lib/types';
import AIAgent from './AIAgent';
import {defaultData,STORAGE_KEY} from '../lib/defaultData';
import {buildSchedule,capacityByEmployee,weeklyCapacity,scheduleHealth,suggestEmployees,capacityForDate,dailyHours} from '../lib/scheduler';
import {canEmployeeForPhase} from '../lib/employeeRoles';
import {calculateScheduleWarnings} from '../lib/scheduleWarnings';
import {calculateProjectHealth,healthTone,summarizeProjectHealth,ProjectHealthRecord} from '../lib/projectHealth';
import {calculateTodayPriorities,TodayPriority} from '../lib/todayPriorities';
import {smartAssignQualifiedEmployees,previewSmartAssignSuggestions,smartAssignSuggestionMapByAssemblyPhase,employeePrefersProject,employeePrefersPreferredProjects,applySmartAssignSuggestionsToData} from '../lib/smartAssign';

const APP_VERSION=91;
let remoteSaveQueue:Promise<void>=Promise.resolve();
const uid=(p:string)=>p+'-'+Math.random().toString(36).slice(2,9);
function splitIds(s:string){return (s||'').split(/[\n,;\s]+/).map(x=>x.trim()).filter(Boolean)}
function normalizeSearchQuery(value:any){return String(value||'').toLowerCase().replace(/\s+/g,' ').trim()}
function assemblySearchText(item:any){return normalizeSearchQuery(`${item?.partNumber||''} ${item?.description||''} ${item?.notes||''} ${item?.type||item?.category||''}`)}
function projectSearchText(item:any){return normalizeSearchQuery(`${item?.projectId||''} ${item?.name||''} ${item?.customer||''}`)}
function matchesAssemblySearch(item:any,query:string){const q=normalizeSearchQuery(query);if(!q)return true;const hay=assemblySearchText(item);return q.split(' ').every(token=>hay.includes(token))}
function dateOnly(d:Date){return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`}
function fmtDate(value:any){if(!value)return '';const raw=String(value);const datePart=raw.includes('T')?raw.split('T')[0]:raw;const m=datePart.match(/^(\d{4})-(\d{2})-(\d{2})$/);if(!m)return raw;return `${Number(m[2])}/${Number(m[3])}/${m[1]}`}
function fmtDateTime(value:any){if(!value)return '';const raw=String(value);const [d,t='']=raw.split('T');const hhmm=t.slice(0,5);return hhmm?`${fmtDate(d)} ${hhmm}`:fmtDate(d)}
function migrate(raw:any):AppData{
  const d={...defaultData,...raw};
  if(!d.assemblyTemplates)d.assemblyTemplates=[];
  if(!d.holidays)d.holidays=[];
  if(!d.shipmentBatches)d.shipmentBatches=[];
  if(!d.projectAssemblies)d.projectAssemblies=d.assemblies||defaultData.projectAssemblies;
  if(!d.assemblyTemplates.length&&d.projectAssemblies?.length){
    const seen=new Set();
    d.assemblyTemplates=d.projectAssemblies.filter((a:any)=>{if(seen.has(a.partNumber))return false;seen.add(a.partNumber);return true}).map((a:any)=>({id:uid('tpl'),partNumber:a.partNumber,description:a.description,type:a.type,defaultQty:a.qty||1,hoursEach:a.hoursEach||1,testRequired:a.testRequired||false,testHours:a.testHours||0,inspectionRequired:a.inspectionRequired||false,inspectionHours:a.inspectionHours||0,shippingRequired:a.shippingRequired||false,shippingHours:a.shippingHours||0,defaultDependsOn:a.dependsOn||'',notes:'Created from older project assembly.'}))
  }
  delete d.assemblies;
  d.assemblyTemplates=(d.assemblyTemplates||[]).map((t:any)=>({testRequired:false,testHours:0,inspectionRequired:false,inspectionHours:0,shippingRequired:false,shippingHours:0,testReturnDateTime:'',inspectionAssignedTo:'',shippingAssignedTo:'',inspectionManualStartDate:'',shippingManualStartDate:'',inspectionComplete:false,shippingComplete:false,maxTopPercentWhenSubHeld:80,defaultDependsOn:'',archived:false,...t,type:t.type==='Tool Level Assembly'?'Top Level Assembly':t.type}));
  d.employees=(d.employees||[]).map((e:any)=>({timeOffDates:e.timeOffDates||e.pto||'',fridayOvertimeDates:e.fridayOvertimeDates||'',workDays:e.workDays||'',workHoursByDay:e.workHoursByDay||'',canBuild:e.canBuild!==false,canInspect:e.canInspect!==false,canShip:e.canShip!==false,trainedProjectIds:e.trainedProjectIds||'',limitAutoAssignToTrainedProjects:!!e.limitAutoAssignToTrainedProjects,preferredProjectIds:e.preferredProjectIds||e.trainedProjectIds||'',preferPreferredProjects:typeof e.preferPreferredProjects==='boolean'?e.preferPreferredProjects:!!e.limitAutoAssignToTrainedProjects,...e}));
  d.projects=(d.projects||[]).map((p:any)=>({projectType:p.projectType||'New Build',sequencingEnabled:p.sequencingEnabled!==false,...p}));
  d.projectAssemblies=(d.projectAssemblies||[]).map((a:any)=>({testRequired:false,testHours:0,inspectionRequired:false,inspectionHours:0,shippingRequired:false,shippingHours:0,testReturnDateTime:'',inspectionAssignedTo:'',shippingAssignedTo:'',inspectionManualStartDate:'',shippingManualStartDate:'',inspectionComplete:false,shippingComplete:false,maxTopPercentWhenSubHeld:80,instanceNumber:a.instanceNumber||1,instanceLabel:a.instanceLabel||'#1',shipDate:a.shipDate||a.manualStart||'',lateAllowed:!!a.lateAllowed,manuallyScheduled:!!a.manuallyScheduled,manualStartDate:a.manualStartDate||'',buildGroupId:a.buildGroupId||'',buildGroupLabel:a.buildGroupLabel||'',parentAssemblyId:a.parentAssemblyId||'',locked:!!a.locked,smartAssignProtected:!!a.smartAssignProtected,...a,type:a.type==='Tool Level Assembly'?'Top Level Assembly':a.type,manualStart:undefined}));
  return {...d,version:APP_VERSION,settings:{...defaultData.settings,...d.settings}};
}
function load():AppData{try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)return migrate(JSON.parse(raw));}catch{}return defaultData}
async function loadFromDatabase():Promise<AppData>{
  try{
    const res=await fetch('/api/data',{cache:'no-store'});
    const json=await res.json();
    if(json?.ok&&json?.data)return migrate(json.data);
  }catch{}
  return load();
}
function save(d:AppData){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}catch{}
  remoteSaveQueue=remoteSaveQueue.catch(()=>undefined).then(async()=>{
    const res=await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(d)});
    if(!res.ok){
      const json=await res.json().catch(()=>null);
      throw new Error(json?.error||'Failed to save scheduler database.');
    }
  });
  return remoteSaveQueue;
}
function download(name:string,text:string){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}

const BACKUP_KEY='assembly-scheduler-backup-history-v1';
function backupName(reason:string){const stamp=new Date().toISOString().replace(/[:.]/g,'-');return `scheduler-${reason}-${stamp}.json`}
function readBackups(){try{return JSON.parse(localStorage.getItem(BACKUP_KEY)||'[]')}catch{return []}}
function writeBackups(backups:any[]){localStorage.setItem(BACKUP_KEY,JSON.stringify(backups.slice(0,30)))}
function validateBackup(raw:any){
  const problems:string[]=[];
  if(!raw||typeof raw!=='object')problems.push('File is not a valid scheduler backup.');
  if(!Array.isArray(raw.employees))problems.push('Missing employees list.');
  if(!Array.isArray(raw.projects))problems.push('Missing projects list.');
  if(!Array.isArray(raw.assemblyTemplates))problems.push('Missing assembly library list.');
  if(!Array.isArray(raw.projectAssemblies)&&!Array.isArray(raw.assemblies))problems.push('Missing project assemblies list.');
  return problems;
}
function createBackupSnapshot(data:AppData,reason='manual'){
  const backups=readBackups();
  const snapshot={id:uid('bak'),createdAt:new Date().toISOString(),reason,appVersion:APP_VERSION,itemCounts:{employees:data.employees?.length||0,projects:data.projects?.length||0,library:data.assemblyTemplates?.length||0,projectAssemblies:data.projectAssemblies?.length||0,holds:data.holds?.length||0},data:{...data,version:APP_VERSION}};
  writeBackups([snapshot,...backups]);
  return snapshot;
}
function projectAccentColor(projectId:string){
  const palette=['#2563eb','#0f766e','#7c3aed','#d97706','#dc2626','#0891b2','#65a30d','#c2410c'];
  const hash=String(projectId||'').split('').reduce((sum,ch)=>sum+ch.charCodeAt(0),0);
  return palette[hash%palette.length];
}
function sessionCollapseKey(storageKey:string){
  return `assembly-scheduler-collapse-${storageKey}`;
}
function CollapsibleSection({storageKey,title,subtitle,summary,defaultOpen=false,actions,children,tone=''}:any){
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
function maybeAutoBackup(data:AppData){
  try{
    const backups=readBackups();
    const last=backups.find((b:any)=>b.reason==='auto');
    const lastTime=last?new Date(last.createdAt).getTime():0;
    if(Date.now()-lastTime>1000*60*30)createBackupSnapshot(data,'auto');
  }catch{}
}
function makeAsm(t:AssemblyTemplate,projectId:string,shipDate:string,instanceNumber=1,buildGroupId='',buildGroupLabel='',parentAssemblyId='',batchId=''):ProjectAssembly{return {id:uid('asm'),projectId,templateId:t.id,partNumber:t.partNumber,description:t.description,type:t.type,instanceNumber,instanceLabel:'#'+instanceNumber,buildGroupId,buildGroupLabel,parentAssemblyId,batchId,qty:t.defaultQty||1,hoursEach:t.hoursEach||1,testRequired:!!t.testRequired,testHours:t.testHours||0,inspectionRequired:!!t.inspectionRequired,inspectionHours:t.inspectionHours||0,shippingRequired:!!t.shippingRequired,shippingHours:t.shippingHours||0,testReturnDateTime:'',inspectionAssignedTo:'',shippingAssignedTo:'',inspectionManualStartDate:'',shippingManualStartDate:'',inspectionComplete:false,shippingComplete:false,maxTopPercentWhenSubHeld:t.maxTopPercentWhenSubHeld||80,dependsOn:'',assignedTo:'',startAfter:'',status:'Not Started',percent:0,holdReason:'',shipDate,lateAllowed:false,overrideDependencies:false,manuallyScheduled:false,manualStartDate:'',locked:false,smartAssignProtected:false}}

function taskHours(a:any){return Math.max(0,Number(a.qty||1)*Number(a.hoursEach||0))}
function baseTaskCompletion(a:any){
  const buildHours=taskHours(a); const inspectHours=a.inspectionRequired?Number(a.inspectionHours||0):0; const shipHours=a.shippingRequired?Number(a.shippingHours||0):0;
  const total=Math.max(1,buildHours+inspectHours+shipHours);
  const buildPct=a.status==='Complete'?100:Math.max(0,Math.min(100,Number(a.percent||0)));
  const inspectPct=a.inspectionRequired?(a.inspectionComplete?100:0):100;
  const shipPct=a.shippingRequired?(a.shippingComplete?100:0):100;
  return Math.round(((buildPct/100*buildHours)+(inspectPct/100*inspectHours)+(shipPct/100*shipHours))/total*100);
}
function rolledCompletion(data:any,a:any){
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
function projectCompletion(data:any,projectId:string){
 const rows=(data.projectAssemblies||[]).filter((a:any)=>a.projectId===projectId&&(a.type==='Top Level Assembly'||(a.type==='Sub Assembly'&&!a.parentAssemblyId&&!a.buildGroupId)));
 if(!rows.length)return 0;
 return Math.round(rows.reduce((s:number,a:any)=>s+rolledCompletion(data,a),0)/rows.length)
}
function clampPercentInput(value:any){
 const trimmed=String(value??'').trim();
 if(trimmed==='')return null;
 const num=Number(trimmed);
 if(!Number.isFinite(num))return 0;
 return Math.max(0,Math.min(100,num));
}
function syncAssemblyPercentStatus(current:any,patch:any){
 if(!('percent' in patch))return patch;
 const nextPercent=clampPercentInput(patch.percent);
 const percentValue=nextPercent===null?0:nextPercent;
 const nextPatch:any={...patch,percent:percentValue};
 if(percentValue>=100)nextPatch.status='Complete';
 else if(percentValue>0&&percentValue<100)nextPatch.status='In Progress';
 else if(percentValue===0&&patch.status==='Complete')nextPatch.status=current?.status==='Complete'?'Not Started':current?.status;
 return nextPatch;
}
function batchCompletion(data:any,batchId:string){const tops=(data.projectAssemblies||[]).filter((a:any)=>a.batchId===batchId&&a.type==='Top Level Assembly');if(!tops.length)return 0;return Math.round(tops.reduce((s:number,a:any)=>s+rolledCompletion(data,a),0)/tops.length)}
const PROJECT_HEALTH_OPTIONS=['All','On Track','At Risk','Late','Missing Assignment','Over Capacity','Waiting on Test','Waiting on Inspection','Ready to Ship'];
function phaseBadgeLabel(phase:string){return phase==='Inspection'?'INSPECT':phase==='Shipping'?'SHIP':phase==='Test'?'TEST':'BUILD'}
function phaseToneKey(phase:string){return phase==='Inspection'?'inspect':phase==='Shipping'?'ship':phase==='Test'?'test':'build'}
function warningActionTarget(warning:any){
  const projectAction=warning?.code==='missing_build_assignment'||warning?.code==='missing_inspection_assignment'||warning?.code==='missing_shipping_assignment';
  if(projectAction&&warning?.projectId)return {tab:'Projects',label:'View project'};
  if(warning?.projectId||warning?.date)return {tab:'Weekly Board',label:'Jump to item'};
  return null;
}


export default function App(){
 const [data,setData]=useState<AppData>(defaultData);
 const [tab,setTab]=useState('Dashboard');
 const [showAIAgent,setShowAIAgent]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [globalSearch,setGlobalSearch]=useState('');
 const [darkMode,setDarkMode]=useState(false);
 const [saveError,setSaveError]=useState('');
 const [projectPanelIntent,setProjectPanelIntent]=useState<any>(null);
 const [weeklyBoardIntent,setWeeklyBoardIntent]=useState<any>(null);
 const [showMobileAccess,setShowMobileAccess]=useState(false);

 useEffect(()=>{
  let alive=true;
  loadFromDatabase().then(d=>{if(alive){setData(d);setLoaded(true)}});
  try{setDarkMode(localStorage.getItem('assembly-scheduler-theme')==='dark')}catch{}
  return()=>{alive=false}
 },[]);
 useEffect(()=>{
  if(typeof document!=='undefined'){
   document.documentElement.setAttribute('data-theme',darkMode?'dark':'light');
   try{localStorage.setItem('assembly-scheduler-theme',darkMode?'dark':'light')}catch{}
  }
 },[darkMode]);
 useEffect(()=>{
  if(typeof window!=='undefined'&&loaded){
   const versionedData={...data,version:APP_VERSION};
   save(versionedData).then(()=>setSaveError('')).catch(err=>{
    console.error('Scheduler database save failed:',err);
    setSaveError(err?.message||'Database save failed. Browser cache was updated, but the SQLite file may be out of date.');
   });
   maybeAutoBackup(versionedData);
  }
 },[data,loaded]);

 const schedule=useMemo(()=>buildSchedule(data),[data]);
 const health=useMemo(()=>scheduleHealth(data),[data]);
 const warnings=useMemo(()=>calculateScheduleWarnings(data,schedule),[data,schedule]);
 const projectHealth=useMemo(()=>calculateProjectHealth(data,schedule,warnings),[data,schedule,warnings]);
 const projectHealthById=useMemo(()=>Object.fromEntries(projectHealth.map(record=>[record.projectId,record])),[projectHealth]);
 const activeProjectHealth=useMemo(()=>projectHealth.filter((record:any)=>data.projects.some((project:any)=>project.id===record.projectId&&project.status==='Active'&&!project.archived)),[projectHealth,data.projects]);
 const projectHealthSummary=useMemo(()=>summarizeProjectHealth(activeProjectHealth),[activeProjectHealth]);

 function update<K extends keyof AppData>(key:K,value:AppData[K]){setData(d=>({...d,[key]:value}))}
 function reset(){if(confirm('Reset all local data back to sample data?')){localStorage.removeItem(STORAGE_KEY);setData(defaultData)}}
 function importFile(e:any){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const parsed=JSON.parse(String(r.result));const problems=validateBackup(parsed);if(problems.length&&!confirm('Backup warning:\n'+problems.join('\n')+'\n\nTry importing anyway?'))return;setData(migrate(parsed));createBackupSnapshot(migrate(parsed),'imported');alert('Import complete.')}catch{alert('Could not import that file.')}};r.readAsText(f)}
 function openProjectPanel(projectId:string,healthFilter='All'){setProjectPanelIntent({token:Date.now(),projectId,healthFilter});setTab('Projects')}
 function openProjectsFilter(healthFilter:string){setProjectPanelIntent({token:Date.now(),projectId:'',healthFilter});setTab('Projects')}
 function focusWeeklyBoard(projectId:string,date:string){setWeeklyBoardIntent({token:Date.now(),projectId,date});setTab('Weekly Board')}
 function handleDashboardWarningAction(warning:any){
  const target=warningActionTarget(warning);
  if(!target)return;
  if(target.tab==='Projects')openProjectPanel(warning.projectId||'',warning.code==='missing_build_assignment'||warning.code==='missing_inspection_assignment'||warning.code==='missing_shipping_assignment'?'Missing Assignment':'All');
  else focusWeeklyBoard(warning.projectId||'',warning.date||'');
 }
 function handlePriorityAction(priority:TodayPriority){
  const action=priority?.action;
  if(!action)return;
  if(action.kind==='project')openProjectPanel(action.projectId,'All');
  else if(action.kind==='project-filter')openProjectsFilter(action.healthFilter);
  else if(action.kind==='board')focusWeeklyBoard(action.projectId||'',action.date||'');
  else{
   const warning=warnings.find((row:any)=>row.id===action.warningId);
   handleDashboardWarningAction(warning||{projectId:action.projectId,date:action.date});
  }
 }
 const primaryNav=[{tab:'Dashboard',label:'Dashboard'},{tab:'Weekly Board',label:'Weekly Board'},{tab:'Monthly Calendar',label:'Monthly Calendar'},{tab:'Projects',label:'Projects'},{tab:'Assembly Library',label:'Assembly Library'},{tab:'Employees',label:'Employees'},{tab:'Availability',label:'Availability'},{tab:'Backups',label:'Reports / Backup'},{tab:'Settings',label:'Settings'}];
 const secondaryNav=[{tab:'Planner',label:'Planner'},{tab:'Master Schedule',label:'Master Schedule'},{tab:'Timeline',label:'Timeline'},{tab:'Holds',label:'Holds'},{tab:'Capacity',label:'Capacity'}];
 return <main className="shell"><div className="top"><div className="brand" style={{display:'flex',alignItems:'center',gap:14}}><img src="/logo.png" alt="RPM/PSI" style={{height:46,width:'auto'}} onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/><h1>Production Scheduler</h1></div><div className="actions topUtilityActions"><input className="globalSearchInput" value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} placeholder="Search project ID, P/N, assembly, employee..."/><button className="btn" onClick={()=>setShowMobileAccess(true)}>Open Mobile Viewer</button><button className="btn" onClick={()=>setShowAIAgent(v=>!v)} style={showAIAgent?{background:'#2563eb',color:'#fff'}:{}}>{showAIAgent?'Close AI Agent':'🤖 AI Agent'}</button><button className="btn" onClick={()=>setDarkMode(v=>!v)}>{darkMode?'Light Mode':'Dark Mode'}</button></div></div>{saveError&&<div className="backupWarning"><b>Database save warning:</b> {saveError}</div>}{showMobileAccess&&<MobileAccessPanel onClose={()=>setShowMobileAccess(false)}/>} {globalSearch.trim()&&<GlobalSearchPanel data={data} query={globalSearch} setTab={setTab} clear={()=>setGlobalSearch('')}/>}<div className="navStack"><div className="nav navPrimary">{[...primaryNav,...secondaryNav].map(item=><button key={item.tab} onClick={()=>setTab(item.tab)} className={tab===item.tab?'active':''}>{item.label}</button>)}</div><div className="headerActionRow"><button className="btn" onClick={()=>download(backupName('manual'),JSON.stringify({...data,version:APP_VERSION},null,2))}>Export Backup</button><label className="btn">Import Backup<input type="file" accept="application/json" onChange={importFile} style={{display:'none'}}/></label><button className="btn danger" onClick={reset}>Reset</button></div></div>{tab==='Dashboard'&&<Dashboard data={data} schedule={schedule} health={health} warnings={warnings} projectHealth={activeProjectHealth} projectHealthSummary={projectHealthSummary} onProjectFilter={openProjectsFilter} onWarningAction={handleDashboardWarningAction} onPriorityAction={handlePriorityAction}/>} {tab==='Planner'&&<Planner data={data} setData={setData} schedule={schedule} warnings={warnings} projectHealth={projectHealth} setTab={setTab}/>} {tab==='Projects'&&<Projects data={data} setData={setData} schedule={schedule} warnings={warnings} projectHealth={projectHealth} projectHealthById={projectHealthById} panelIntent={projectPanelIntent} onFocusBoard={focusWeeklyBoard}/>} {tab==='Assembly Library'&&<AssemblyLibrary data={data} setData={setData}/>} {tab==='Master Schedule'&&<Schedule data={data} setData={setData} schedule={schedule}/>} {tab==='Weekly Board'&&<WeeklyBoard data={data} setData={setData} schedule={schedule} warnings={warnings} projectHealthById={projectHealthById} boardIntent={weeklyBoardIntent} onOpenProject={openProjectPanel}/>} {tab==='Monthly Calendar'&&<MonthlyCalendar data={data} schedule={schedule}/>} {tab==='Timeline'&&<GanttTimeline data={data} schedule={schedule}/>} {tab==='Employees'&&<Employees data={data} setData={setData}/>} {tab==='Availability'&&<Availability data={data} setData={setData}/>} {tab==='Holds'&&<Holds data={data} setData={setData}/>} {tab==='Capacity'&&<Capacity data={data}/>} {tab==='Backups'&&<BackupCenter data={data} setData={setData}/>} {tab==='Settings'&&<Settings data={data} update={update}/>}{showAIAgent&&<AIAgent data={data} schedule={schedule} onClose={()=>setShowAIAgent(false)}/>}</main>
}
function MobileAccessPanel({onClose}:any){
 const [mobileUrl,setMobileUrl]=useState('');
 const [localhostUrl,setLocalhostUrl]=useState('http://localhost:3000/mobile');
 const [lanCandidates,setLanCandidates]=useState<any[]>([]);
 const [copyState,setCopyState]=useState('');
 const [qrFailed,setQrFailed]=useState(false);
 const [statusMessage,setStatusMessage]=useState('Looking for this Mac’s LAN address...');
 useEffect(()=>{setQrFailed(false)},[mobileUrl]);
 useEffect(()=>{
  if(typeof window==='undefined')return;
  let alive=true;
  const currentUrl=`${window.location.protocol}//${window.location.host}/mobile`;
  const currentHost=window.location.hostname;
  const isLocal=currentHost==='localhost'||currentHost==='127.0.0.1'||currentHost==='::1';
  setLocalhostUrl(`${window.location.protocol}//localhost:${window.location.port||'3000'}/mobile`);
  if(!isLocal){
   setMobileUrl(currentUrl);
   setStatusMessage('Using the current network address shown in your browser.');
   return;
  }
  fetch('/api/mobile-host',{cache:'no-store'}).then(res=>res.json()).then(json=>{
   if(!alive)return;
   const lanUrl=String(json?.lanUrl||'');
   const localUrl=String(json?.localhostUrl||localhostUrl);
   setLanCandidates(Array.isArray(json?.lanCandidates)?json.lanCandidates:[]);
   setLocalhostUrl(localUrl);
   if(lanUrl){
    setMobileUrl(lanUrl);
    setStatusMessage(Array.isArray(json?.lanCandidates)&&json.lanCandidates.length>1?'Multiple LAN addresses detected. Use the first Wi-Fi address below if the QR does not open on your phone.':'Phone must be on the same Wi-Fi.');
   }else{
    setMobileUrl('');
    setStatusMessage('Could not detect LAN IP. Run `ipconfig getifaddr en0` on Mac and use http://YOUR-IP:3000/mobile.');
   }
  }).catch(()=>{
   if(!alive)return;
   setMobileUrl('');
   setStatusMessage('Could not detect LAN IP. Run `ipconfig getifaddr en0` on Mac and use http://YOUR-IP:3000/mobile.');
  });
  return()=>{alive=false};
 },[]);
 async function copyUrl(){
  try{
   await navigator.clipboard.writeText(mobileUrl||localhostUrl);
   setCopyState('Copied');
   setTimeout(()=>setCopyState(''),1500);
  }catch{
   setCopyState('Copy failed');
   setTimeout(()=>setCopyState(''),1500);
  }
 }
 const qrUrl=mobileUrl?`https://api.qrserver.com/v1/create-qr-code/?size=240x240&data=${encodeURIComponent(mobileUrl)}`:'';
 return <div className="mobileAccessOverlay" onClick={onClose}><section className="card mobileAccessPanel" onClick={e=>e.stopPropagation()}><div className="mobileAccessHeader"><div><h2>Open Mobile Viewer</h2><p className="muted">Share the read-only shop-floor view at <code>/mobile</code>. The QR preview uses the detected LAN URL shown below, and your phone needs to be on the same Wi-Fi.</p></div><button className="btn" onClick={onClose}>Close</button></div><div className="mobileAccessBody"><div className="mobileAccessQr">{mobileUrl&&!qrFailed?<img src={qrUrl} alt="QR code for mobile viewer" onError={()=>setQrFailed(true)}/>:<div className="mobileAccessQrFallback">{mobileUrl?'QR preview unavailable right now. Copy the LAN URL below instead.':'LAN QR unavailable until we detect your Wi-Fi address.'}</div>}</div><div className="mobileAccessDetails"><label>Mobile URL</label><input className="largeInput" readOnly value={mobileUrl||'No LAN address detected yet'}/><div className="actions"><button className="btn primary" onClick={copyUrl}>Copy Mobile URL</button><button className="btn" disabled={!mobileUrl} onClick={()=>mobileUrl&&window.open(mobileUrl,'_blank')}>Open Mobile Viewer</button>{copyState&&<span className="muted">{copyState}</span>}</div><p className="mobileAccessCallout">{statusMessage}</p>{lanCandidates.length>1&&<div className="mobileAccessCandidates"><label>Other detected LAN URLs</label>{lanCandidates.map((candidate:any)=><div key={candidate.url} className="mobileAccessCandidate"><b>{candidate.interface||'Network'}</b><span>{candidate.url}</span></div>)}</div>}<label>Mac only URL</label><input className="largeInput" readOnly value={localhostUrl}/><p className="muted small">Use the LAN URL above for your phone. The localhost link only works on this Mac.</p></div></div></section></div>
}
function BackupCenter({data,setData}:any){
 const [backups,setBackups]=useState<any[]>([]);
 const [importProblems,setImportProblems]=useState<string[]>([]);
 function refresh(){setBackups(readBackups())}
 useEffect(()=>refresh(),[]);
 function createNow(){createBackupSnapshot(data,'manual');refresh();alert('Backup saved locally. Use Download if you want a file copy outside the browser.');}
 function restore(b:any){if(!confirm('Restore this backup? Current data will be replaced, but a safety backup will be created first.'))return;createBackupSnapshot(data,'before-restore');setData(migrate(b.data));setTimeout(refresh,50);}
 function remove(id:string){if(!confirm('Delete this backup from local backup history?'))return;writeBackups(backups.filter((b:any)=>b.id!==id));refresh();}
 function downloadOne(b:any){download(backupName(b.reason||'backup'),JSON.stringify(b.data,null,2));}
 function downloadAll(){download(`assembly-scheduler-backup-history-v${APP_VERSION}.json`,JSON.stringify({exportedAt:new Date().toISOString(),backups},null,2));}
 function importHistory(e:any){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const parsed=JSON.parse(String(r.result));if(Array.isArray(parsed.backups)){writeBackups([...parsed.backups,...readBackups()]);setImportProblems([]);refresh();alert('Backup history imported.')}else{const problems=validateBackup(parsed);setImportProblems(problems);if(problems.length&&!confirm('Backup warning:\n'+problems.join('\n')+'\n\nTry importing this as app data anyway?'))return;createBackupSnapshot(data,'before-import');setData(migrate(parsed));createBackupSnapshot(migrate(parsed),'imported');refresh();alert('App data imported.')}}catch{setImportProblems(['Could not read that file as JSON.']);alert('Could not import that backup file.')}};r.readAsText(f)}
 const latest=backups[0];
 return <div className="grid"><div className="card span12"><h2>Backups & Restore</h2><p className="muted">Backups are saved in this browser on this Mac. Download a backup file regularly if you want a copy outside the app folder/browser storage.</p><div className="actions"><button className="btn primary" onClick={createNow}>Create Local Backup</button><button className="btn" onClick={()=>download(backupName('manual'),JSON.stringify({...data,version:APP_VERSION},null,2))}>Download Current Data</button><button className="btn" disabled={!backups.length} onClick={downloadAll}>Download Backup History</button><label className="btn">Import Backup / History<input type="file" accept="application/json" onChange={importHistory} style={{display:'none'}}/></label></div>{latest&&<p className="small muted">Latest backup: {new Date(latest.createdAt).toLocaleString()} ({latest.reason})</p>}{importProblems.length>0&&<div className="backupWarning"><b>Import validation warnings:</b><ul>{importProblems.map((p:string)=><li key={p}>{p}</li>)}</ul></div>}</div><div className="card span12"><h2>Backup History</h2><div className="tablewrap"><table><thead><tr><th>Created</th><th>Type</th><th>Counts</th><th>App Version</th><th>Actions</th></tr></thead><tbody>{backups.length===0&&<tr><td colSpan={5}><p className="muted">No local backups yet.</p></td></tr>}{backups.map((b:any)=><tr key={b.id}><td>{new Date(b.createdAt).toLocaleString()}</td><td><span className={b.reason==='auto'?'pill good':'pill warn'}>{b.reason}</span></td><td className="small">Employees {b.itemCounts?.employees||0}<br/>Projects {b.itemCounts?.projects||0}<br/>Library {b.itemCounts?.library||0}<br/>Project Assemblies {b.itemCounts?.projectAssemblies||0}</td><td>v{b.appVersion||b.data?.version||'?'}</td><td><div className="actions"><button className="btn" onClick={()=>restore(b)}>Restore</button><button className="btn" onClick={()=>downloadOne(b)}>Download</button><button className="btn danger" onClick={()=>remove(b.id)}>Delete</button></div></td></tr>)}</tbody></table></div></div><div className="card span12"><h2>Version Safety Notes</h2><ul className="muted"><li>The app creates automatic local snapshots about every 30 minutes while you are working.</li><li>Manual backups are recommended before switching versions.</li><li>Restore creates a safety backup first, so you can undo a bad restore.</li><li>Imported files are checked for the core scheduler lists before loading.</li></ul></div></div>
}


function GlobalSearchPanel({data,query,setTab,clear}:any){
 const q=String(query||'').toLowerCase().trim();
 const projects=(data.projects||[]).filter((p:any)=>`${p.projectId||''} ${p.name||''} ${p.customer||''}`.toLowerCase().includes(q)).slice(0,6);
 const library=(data.assemblyTemplates||[]).filter((a:any)=>`${a.partNumber||''} ${a.description||''} ${a.type||''}`.toLowerCase().includes(q)).slice(0,6);
 const projectAssemblies=(data.projectAssemblies||[]).filter((a:any)=>`${a.partNumber||''} ${a.description||''} ${a.instanceLabel||''}`.toLowerCase().includes(q)).slice(0,8);
 const employees=(data.employees||[]).filter((e:any)=>`${e.name||''} ${e.email||''} ${e.skills||''}`.toLowerCase().includes(q)).slice(0,6);
 const projectById=(id:string)=>(data.projects||[]).find((p:any)=>p.id===id)?.projectId||'';
 return <div className="globalSearchPanel"><div className="searchPanelHeader"><b>Search Results</b><button className="mini" onClick={clear}>Close</button></div><div className="searchResultsGrid"><div><h4>Projects</h4>{projects.length?projects.map((p:any)=><button key={p.id} onClick={()=>{setTab('Projects');clear()}}><b>{p.projectId}</b><span>{p.customer||p.name||'Project'}</span></button>):<p className="muted">No projects</p>}</div><div><h4>Library</h4>{library.length?library.map((a:any)=><button key={a.id} onClick={()=>{setTab('Assembly Library');clear()}}><b>{a.partNumber}</b><span>{a.description}</span></button>):<p className="muted">No library items</p>}</div><div><h4>Scheduled Assemblies</h4>{projectAssemblies.length?projectAssemblies.map((a:any)=><button key={a.id} onClick={()=>{setTab('Projects');clear()}}><b>{projectById(a.projectId)} · {a.partNumber} {a.instanceLabel||''}</b><span>{a.description}</span></button>):<p className="muted">No scheduled assemblies</p>}</div><div><h4>Employees</h4>{employees.length?employees.map((e:any)=><button key={e.id} onClick={()=>{setTab('Employees');clear()}}><b>{e.name}</b><span>{e.skills||e.email}</span></button>):<p className="muted">No employees</p>}</div></div></div>
}

function Planner({data,setData,schedule,warnings,projectHealth,setTab}:any){
 const [query,setQuery]=useState('');
 const [selectedIssue,setSelectedIssue]=useState<any>(null);
 const [preview,setPreview]=useState<any>(null);
 const [undo,setUndo]=useState<any>(null);
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
 function buildChunks(startDate:string,endDate:string){
   const chunks:any[]=[];
   for(const s of schedule){
     const source=asm(srcId(s));
     const manualSegments=(s.phase==='Build'&&Array.isArray(source?.manualWorkSegments))?source.manualWorkSegments.filter((seg:any)=>(seg.phase||'Build')==='Build'&&Number(seg.hours)>0):[];
     if(manualSegments.length){manualSegments.forEach((seg:any,idx:number)=>{if(seg.date>=startDate&&seg.date<=endDate)chunks.push({...s,employeeChunkId:seg.employeeId||'',chunkDate:seg.date,chunkHours:Number(seg.hours)||0,segmentIndex:idx,manualSegmentId:seg.id})});continue;}
     const ids=splitIds(s.assignedTo);
     for(const empId of (ids.length?ids:[''])){
       let date=s.scheduledStart;let remaining=Number(s.hoursPerEmployee)||Number(s.totalHours)||0;let guard=0;let idx=0;
       while(remaining>0&&guard<240){
         const cap=empId?capacityForDate(data,empId,date):capacityForDate(data,'',date);
         if(cap>0){
           const hrs=Math.min(remaining,cap);
           if(date>=startDate&&date<=endDate)chunks.push({...s,employeeChunkId:empId,chunkDate:date,chunkHours:hrs,segmentIndex:idx++});
           remaining-=hrs;
         }
         date=addDays(date,1);guard++;
       }
     }
   }
   return chunks.sort((a:any,b:any)=>String(a.chunkDate).localeCompare(String(b.chunkDate))||String(a.projectName||'').localeCompare(String(b.projectName||'')));
 }
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
 const issues:any[]=[];
 for(const s of schedule){
   const a=asm(srcId(s)); if(!a)continue;
   if(s.isLate)issues.push({type:'Late',severity:'red',assemblyId:a.id,phase:s.phase||'Build',date:s.scheduledEnd,title:`Late: ${taskLabel(a)}`,why:[`Scheduled to finish ${fmtDate(s.scheduledEnd)}.`,`Ship By is ${fmtDate(a.shipDate)||'not set'}.`,a.lateAllowed?'Late Allowed is checked.':'Late Allowed is not checked.'],suggestions:['Move earlier work into open capacity before the ship date.','Add another employee to the build/inspection/shipping task.','If this is acceptable, check Late Allowed.']});
 }
 for(const a of assemblies){
   if(a.status==='On Hold'||a.holdReason)issues.push({type:'Blocked',severity:'gray',assemblyId:a.id,phase:'Build',date:a.shipDate,title:`Blocked: ${taskLabel(a)}`,why:[`Status/hold reason: ${a.holdReason||a.status}`],suggestions:['Clear the hold when the issue is resolved.','If a held sub blocks a top level, expect the top level completion cap to apply.']});
   if(a.type==='Top Level Assembly'){
     const topBuild=getItem(a.id,'Build');
     const subs=assemblies.filter((x:any)=>x.parentAssemblyId===a.id||((x.buildGroupId&&x.buildGroupId===a.buildGroupId)&&x.projectId===a.projectId&&x.type==='Sub Assembly'));
     for(const sub of subs){const subBuild=getItem(sub.id,'Build');if(topBuild&&subBuild&&subBuild.scheduledEnd>topBuild.scheduledStart){issues.push({type:'Dependency Conflict',severity:'yellow',assemblyId:a.id,phase:'Build',date:topBuild.scheduledStart,title:`Sub finishes after top starts: ${taskLabel(a)}`,why:[`${sub.partNumber} ${sub.instanceLabel||''} finishes ${fmtDate(subBuild.scheduledEnd)}.`,`Top level starts ${fmtDate(topBuild.scheduledStart)}.`],suggestions:['Move the sub assembly earlier.','Push the top level later.','Add another employee to the sub assembly if capacity exists.']});}}
     const build=getItem(a.id,'Build'), inspection=getItem(a.id,'Inspection');
     if(build&&inspection&&a.testRequired&&Number(a.testHours||0)>0){
       const minReturn=a.testReturnDateTime?dateOnly(parse(a.testReturnDateTime)):addDays(build.scheduledEnd, Math.max(1,Math.ceil(Number(a.testHours||0)/10)));
       if(inspection.scheduledStart<minReturn)issues.push({type:'Test Gate',severity:'yellow',assemblyId:a.id,phase:'Inspection',date:inspection.scheduledStart,title:`Inspection starts before test gate: ${taskLabel(a)}`,why:[`Build finishes ${fmtDate(build.scheduledEnd)}.`,`Test requires ${a.testHours} hours${a.testReturnDateTime?` and expected return is ${fmtDateTime(a.testReturnDateTime)}`:''}.`,`Inspection starts ${fmtDate(inspection.scheduledStart)}.`],suggestions:['Move inspection after the expected test return.','Enter/update Expected Test Return if test will take longer.']});
     }
   }
 }
 function openCapacityFor(empId:string,date:string,ignore:any=null){const used=chunks.filter((x:any)=>x.employeeChunkId===empId&&x.chunkDate===date&&!(ignore&&srcId(x)===srcId(ignore)&&x.segmentIndex===ignore.segmentIndex&&(x.phase||'Build')===(ignore.phase||'Build'))).reduce((n:number,x:any)=>n+(Number(x.chunkHours)||0),0);return capacityForDate(data,empId,date)-used;}
 function sameAssemblySameEmpDayExists(sourceId:string,segmentIndex:any,empId:string,date:string){return chunks.some((x:any)=>srcId(x)===sourceId&&x.segmentIndex!==segmentIndex&&(x.phase||'Build')==='Build'&&x.employeeChunkId===empId&&x.chunkDate===date);}
 function suggestOpenMoves(cell:any){
   const out:any[]=[]; const emp=employees.find((e:any)=>e.id===cell.employeeId);
   for(const c of cell.cards){
     const sourceId=srcId(c); const phase=c.phase||'Build';
     for(const e of employees){
       for(let i=0;i<21;i++){
         const date=addDays(cell.date,i);
         if(phase==='Build'&&sameAssemblySameEmpDayExists(sourceId,c.segmentIndex,e.id,date))continue;
         const open=openCapacityFor(e.id,date,c);
         if(open>=Number(c.chunkHours||0)&&!(e.id===cell.employeeId&&date===cell.date)){out.push({label:`Move ${c.partNumber} ${c.instanceLabel||''} (${Number(c.chunkHours||0).toFixed(1)} hrs) from ${emp?.name||'employee'} ${cell.date} to ${e.name} ${date}.`,sourceId,phase,segmentIndex:c.segmentIndex,employeeId:e.id,date,hours:Number(c.chunkHours)||0});return out;}
       }
     }
   }
   if(!out.length)out.push({label:'No obvious open-capacity move found in the next 3 weeks. Consider splitting the task, enabling Friday OT, or assigning another employee.'});
   return out;
 }
 Object.values(byCell).forEach((cell:any)=>{const cap=capacityForDate(data,cell.employeeId,cell.date);if(cell.hours>cap){const emp=employees.find((e:any)=>e.id===cell.employeeId);const opts=suggestOpenMoves(cell);issues.push({type:'Overloaded',severity:'red',date:cell.date,employeeId:cell.employeeId,title:`Overloaded: ${emp?.name||cell.employeeId} on ${cell.date}`,why:[`${cell.hours.toFixed(1)} hours assigned.`,`Capacity is ${cap.toFixed(1)} hours.`],suggestions:opts.map((x:any)=>x.label||x),actions:opts.filter((x:any)=>x.sourceId).slice(0,5)})}});
 function defaultSegmentsFor(sourceId:string,phase:string){return chunks.filter((c:any)=>srcId(c)===sourceId&&(c.phase||'Build')===phase).map((c:any,i:number)=>({id:c.manualSegmentId||`seg_${Date.now()}_${i}`,employeeId:c.employeeChunkId||'',date:c.chunkDate,hours:Number(c.chunkHours)||0,phase}));}
 function updateWithAction(d:any,action:any){return d.projectAssemblies.map((a:any)=>{if(a.id!==action.sourceId)return a;if(action.phase==='Inspection')return {...a,inspectionAssignedTo:action.employeeId,inspectionManualStartDate:action.date};if(action.phase==='Shipping')return {...a,shippingAssignedTo:action.employeeId,shippingManualStartDate:action.date};const existing=Array.isArray(a.manualWorkSegments)&&a.manualWorkSegments.length?a.manualWorkSegments:defaultSegmentsFor(action.sourceId,action.phase);const idx=Number.isFinite(Number(action.segmentIndex))?Number(action.segmentIndex):0;const segs=existing.map((seg:any,i:number)=>i===idx?{...seg,employeeId:action.employeeId,date:action.date}:seg);return {...a,assignedTo:action.employeeId||a.assignedTo,manualWorkSegments:segs,manuallyScheduled:true};});}
 function applyMove(action:any){if(!action?.sourceId)return;setUndo(JSON.parse(JSON.stringify(data)));setPreview(null);setData((d:any)=>({...d,projectAssemblies:updateWithAction(d,action)}));}
 function balanceThisWeek(){const actions:any[]=[];const end=addDays(today,7);const cells=Object.values(byCell).filter((cell:any)=>cell.date>=today&&cell.date<=end&&cell.hours>capacityForDate(data,cell.employeeId,cell.date));for(const cell of cells as any[]){const opts=suggestOpenMoves(cell).filter((x:any)=>x.sourceId);if(opts[0])actions.push(opts[0]);}setPreview({title:'Smart Assign Rebalance Preview',actions});}
 function applyPreview(){if(!preview?.actions?.length)return;setUndo(JSON.parse(JSON.stringify(data)));let next=JSON.parse(JSON.stringify(data));for(const action of preview.actions){next={...next,projectAssemblies:updateWithAction(next,action)}}setData(next);setPreview(null)}
 function undoLast(){if(!undo)return;setData(undo);setUndo(null);setPreview(null)}
 const filtered=issues.filter(i=>!query||(`${i.type} ${i.title} ${i.date} ${i.why?.join(' ')} ${i.suggestions?.join(' ')}`.toLowerCase().includes(query.toLowerCase())));
 const counts={red:issues.filter(i=>i.severity==='red').length,yellow:issues.filter(i=>i.severity==='yellow').length,gray:issues.filter(i=>i.severity==='gray').length};
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
         <button className="btn" onClick={balanceThisWeek}>Preview Smart Assign Rebalance</button>
         <button className="btn" disabled={!undo} onClick={undoLast}>Undo Last Change</button>
         <button className="btn" onClick={()=>setTab('Weekly Board')}>Open Weekly Board</button>
       </div>
     </div>
     <div className="plannerSummary"><span className="pill bad">{counts.red} high priority</span><span className="pill warn">{counts.yellow} warnings</span><span className="pill">{counts.gray} blocked</span><span className="pill">Horizon: {fmtDate(today)} to {fmtDate(rangeEnd)}</span></div>
   </div>
   {preview&&<div className="card span12"><h2>{preview.title}</h2>{preview.actions?.length?<><p className="muted">Review these moves before applying.</p><ul>{preview.actions.map((a:any,i:number)=><li key={i}>{a.label}</li>)}</ul><div className="actions"><button className="btn primary" onClick={applyPreview}>Apply Previewed Moves</button><button className="btn" onClick={()=>setPreview(null)}>Cancel</button></div></>:<p className="muted">No safe open-capacity moves found for this week.</p>}</div>}
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
     <div className="card span5"><h2>Issues</h2><div className="issueList">{filtered.length===0&&<p className="muted">No conflicts found in this planning horizon.</p>}{filtered.map((i:any,idx:number)=><button key={idx} className={'issueRow '+i.severity} onClick={()=>setSelectedIssue(i)}><b>{i.type}</b><span>{i.title}</span><small>{fmtDate(i.date)||''}</small></button>)}</div></div>
     <div className="card span7"><h2>Conflict Details</h2>{!selectedIssue?<p className="muted">Select an issue to see why it is happening and suggested moves.</p>:<div className="issueDetails"><h3>{selectedIssue.title}</h3><p><span className={'pill '+(selectedIssue.severity==='red'?'bad':selectedIssue.severity==='yellow'?'warn':'')}>{selectedIssue.type}</span></p><h4>Why</h4><ul>{(selectedIssue.why||[]).map((w:string)=><li key={w}>{w}</li>)}</ul><h4>Suggested options</h4><ul>{(selectedIssue.suggestions||[]).map((w:string)=><li key={w}>{w}</li>)}</ul>{selectedIssue.actions?.length>0&&<><h4>Safe actions</h4><div className="actions">{selectedIssue.actions.map((a:any,i:number)=><button key={i} className="btn primary" onClick={()=>applyMove(a)}>Apply Move {i+1}</button>)}</div></>}</div>}</div>
   </>}
 </div>
}

function Dashboard({data,schedule,health,warnings,projectHealth,projectHealthSummary,onProjectFilter,onWarningAction,onPriorityAction}:any){
 const [lookAhead,setLookAhead]=useState(false);
 const actualToday=dateOnly(new Date());
 const employees=(data.employees||[]).filter((e:any)=>e.active!==false);
 function nextDate(s:string){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+1);return dateOnly(d)}
 function addDays(s:string,n:number){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+n);return dateOnly(d)}
 function nextProductionDay(from:string){let d=nextDate(from);let guard=0;while(guard++<10){const day=new Date(d+'T00:00:00').getDay();if(day>=1&&day<=4)return d;d=nextDate(d)}return d}
 const dashboardDate=lookAhead?nextProductionDay(actualToday):actualToday;
 function splitAssigned(s:string){return splitIds(s)}
 function sourceAssembly(sourceId:string){return (data.projectAssemblies||[]).find((a:any)=>a.id===sourceId)}
 function projectFor(id:string){return (data.projects||[]).find((p:any)=>p.id===id)||{projectId:'Project'}}
 function expandChunksForRange(startDate:string,endDate:string){
   const chunks:any[]=[];
   for(const s of schedule){
     const src=sourceAssembly(s.sourceAssemblyId||String(s.id).split('|')[0]);
     const manualSegments=(s.phase==='Build'&&Array.isArray(src?.manualWorkSegments))?src.manualWorkSegments.filter((seg:any)=>(seg.phase||'Build')==='Build'&&Number(seg.hours)>0):[];
     if(manualSegments.length){manualSegments.forEach((seg:any,idx:number)=>{if(seg.date>=startDate&&seg.date<=endDate)chunks.push({...s,employeeChunkId:seg.employeeId||'',chunkDate:seg.date,chunkHours:Number(seg.hours)||0,segmentIndex:idx})});continue;}
     const ids=splitAssigned(s.assignedTo);
     if(!ids.length){let date=s.scheduledStart;let remaining=Number(s.hoursPerEmployee)||Number(s.totalHours)||0;let guard=0;while(remaining>0&&guard<120){const cap=capacityForDate(data,'',date);if(cap>0){const hrs=Math.min(remaining,cap);if(date>=startDate&&date<=endDate)chunks.push({...s,employeeChunkId:'',chunkDate:date,chunkHours:hrs});remaining-=hrs;}date=nextDate(date);guard++;}}
     else{for(const empId of ids){let date=s.scheduledStart;let remaining=Number(s.hoursPerEmployee)||0;let guard=0;while(remaining>0&&guard<120){const cap=capacityForDate(data,empId,date);if(cap>0){const hrs=Math.min(remaining,cap);if(date>=startDate&&date<=endDate)chunks.push({...s,employeeChunkId:empId,chunkDate:date,chunkHours:hrs});remaining-=hrs;}date=nextDate(date);guard++;}}}
   }
   return chunks;
 }
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
 return <div className="dashboardCompact">
  <div className="dashTopBar"><div><span className="eyebrow">Daily Production Control</span><h2>{lookAhead?'Next Production Day':'Today'} · {fmtDate(dashboardDate)}</h2><div className="dashDateToggle"><button className={!lookAhead?'active':''} onClick={()=>setLookAhead(false)}>Today</button><button className={lookAhead?'active':''} onClick={()=>setLookAhead(true)}>Next Production Day</button></div></div><div className="dashKpis"><div><b>{selectedDayHours.toFixed(1)}</b><span>hrs selected day</span></div><div><b>{overloads.length}</b><span>overloads</span></div><div><b>{atRisk.length}</b><span>at risk</span></div><div><b>{selectedDayAbsences.length}</b><span>out selected day</span></div><div><b>{upcomingBatches.length+upcomingIndividualTops.length}</b><span>shipments</span></div></div></div>
  <div className="dashPanels">
    <section className="dashPanel prioritiesPanel"><div className="dashSectionHeader"><div><h3>Today&apos;s Priorities</h3><p className="muted">Compact morning-planning view for inspections, shipping, capacity, dependencies, and assignment gaps.</p></div></div><div className="priorityList">{priorities.length===0&&<p className="muted">No urgent priority items for the selected production day.</p>}{priorities.map((priority:any)=><button key={priority.id} className={`priorityCard tone-${priority.tone}`} onClick={()=>onPriorityAction?.(priority)}><div className="priorityCardTop"><span className="priorityTitle">{priority.title}</span><span className="priorityCount">{priority.count}</span></div><small>{priority.detail}</small></button>)}</div></section>
    <section className="dashPanel projectHealthDashPanel"><div className="dashSectionHeader"><div><h3>Project Health</h3><p className="muted">Computed from warnings, ship timing, assignments, capacity, and downstream gates.</p></div></div><div className="projectHealthSummaryGrid">{healthCards.map((card:any)=><button key={card.label} className={`projectHealthSummaryCard tone-${healthTone(card.label as any)}`} onClick={()=>onProjectFilter?.(card.label)}><b>{card.count}</b><span>{card.label}</span></button>)}</div><div className="projectHealthPreviewList">{(projectHealth||[]).slice(0,6).map((record:any)=><button key={record.projectId} className="projectHealthPreviewCard" onClick={()=>onProjectFilter?.(record.status)}><div><HealthBadge status={record.status}/><b>{record.projectCode}</b></div><span>{record.projectName}</span><small>{record.reason}</small></button>)}{!(projectHealth||[]).length&&<p className="muted">No active projects to summarize right now.</p>}</div></section>
    <section className="dashPanel todayOps"><h3>Work by Employee</h3><div className="miniEmployeeList">{employees.map((emp:any)=>{const rows=rowsForEmployee(emp);const hrs=rows.reduce((n:number,r:any)=>n+(Number(r.chunkHours)||0),0);const isOut=selectedDayAbsences.some((a:any)=>a.employee===emp.name||a.employee==='All Employees');return <div className={"miniEmployee "+(isOut?'isOut':'')} key={emp.id}><div><b>{emp.name}</b><span>{isOut?'Scheduled Out':`${hrs.toFixed(1)} hrs`}</span></div>{rows.slice(0,3).map((r:any,i:number)=><p key={r.scheduleId+i}><strong>{r.description||r.partNumber}</strong> <em>{r.projectName}</em> {Number(r.chunkHours||0).toFixed(1)}h</p>)}{rows.length>3&&<small>+{rows.length-3} more</small>}{!rows.length&&!isOut&&<small>No work scheduled</small>}</div>})}</div></section>
    <section className="dashPanel problems"><h3>Needs Attention</h3><div className="compactList">{overloads.slice(0,4).map((o:any,i:number)=><div className="alertLine bad" key={'o'+i}><b>{o.employee}</b><span>{fmtDate(o.date)}: {o.hrs.toFixed(1)} / {o.cap.toFixed(1)} hrs</span></div>)}{atRisk.slice(0,6).map((s:any,i:number)=>{const src=sourceAssembly(s.sourceAssemblyId||String(s.id).split('|')[0])||s;return <div className={"alertLine "+(src.holdReason?'blocked':s.isLate?'bad':'warn')} key={'r'+i}><b>{s.projectName}</b><span>{src.description||src.partNumber} {src.instanceLabel||''} — {src.holdReason?'On hold':s.isLate?'Late':'At risk'}</span></div>})}{!overloads.length&&!atRisk.length&&<p className="muted">No urgent issues found.</p>}</div></section>
    <section className="dashPanel scheduleWarningsDashPanel"><ScheduleWarningsPanel warnings={warnings} maxItems={6} subtitle="Informational only. Missing assignments and timing conflicts stay visible here until resolved." onAction={onWarningAction} getActionLabel={(warning:any)=>warningActionTarget(warning)?.label||''}/></section>
    <section className="dashPanel"><h3>Expected Test Returns</h3><div className="compactList">{testReturns.length===0?<p className="muted">No manual test returns entered.</p>:testReturns.slice(0,7).map((a:any)=><div className="alertLine" key={a.id}><b>{fmtDateTime(a.testReturnDateTime)}</b><span>{projectFor(a.projectId).projectId} — {a.description||a.partNumber} {a.instanceLabel||''}</span></div>)}</div></section>
    <section className="dashPanel"><h3>Upcoming Shipments · Next 2 Weeks</h3><div className="compactList">{(upcomingBatches.length+upcomingIndividualTops.length)===0?<p className="muted">No shipments due in the next two weeks.</p>:<>{upcomingBatches.map((b:any)=>{const ass=(data.projectAssemblies||[]).filter((a:any)=>a.batchId===b.id);return <div className="alertLine" key={b.id}><b>{fmtDate(b.shipDate)} • {b.name}</b><span>{projectFor(b.projectId).projectId} — {ass.length} assembly group{ass.length===1?'':'s'}</span></div>})}{upcomingIndividualTops.map((a:any)=>{const p=projectFor(a.projectId);return <div className="alertLine" key={a.id}><b>{fmtDate(a.shipDate)} • {a.description||a.partNumber} {a.instanceLabel||''}</b><span>{p.projectId} — P/N {a.partNumber}</span></div>})}</>}</div></section>
    <section className="dashPanel"><h3>Upcoming Absences</h3><div className="compactList">{upcomingAbsences.length===0?<p className="muted">No upcoming employee absences or company holidays.</p>:upcomingAbsences.slice(0,8).map((a:any,i:number)=><div className="alertLine blocked" key={i}><b>{fmtDate(a.date)}</b><span>{a.employee} — {a.reason}</span></div>)}</div></section>
      </div>
 </div>}

function K({title,v}:any){return <div className="card span3"><div className="muted">{title}</div><div className="kpi">{v}</div></div>}

function Projects({data,setData,schedule,warnings,projectHealth,projectHealthById,panelIntent,onFocusBoard}:any){
 const [selected,setSelected]=useState(data.projects[0]?.id||'');
 const [healthFilter,setHealthFilter]=useState('All');
 const [templateId,setTemplateId]=useState(data.assemblyTemplates.find((t:any)=>!t.archived)?.id||data.assemblyTemplates[0]?.id||'');
 const [addQty,setAddQty]=useState(1);
 const [assemblySearch,setAssemblySearch]=useState('');
 const [selectedTopId,setSelectedTopId]=useState('');
 const [projectMonth,setProjectMonth]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`});
 const [calendarDrafts,setCalendarDrafts]=useState<any>({});
 const [projectCalendarOpen,setProjectCalendarOpen]=useState(true);
 const visibleProjects=(data.projects||[]).filter((p:any)=>!p.archived&&(healthFilter==='All'||projectHealthById?.[p.id]?.status===healthFilter));
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
function changeAsm(id:string,patch:any){setData((d:any)=>{
  const current=d.projectAssemblies.find((a:any)=>a.id===id);
  const nextPatch=syncAssemblyPercentStatus(current,patch);
  let updated=d.projectAssemblies.map((a:any)=>a.id===id?{...a,...nextPatch,instanceLabel:nextPatch.instanceNumber?'#'+nextPatch.instanceNumber:(nextPatch.instanceLabel??a.instanceLabel)}:a);
  const changed=updated.find((a:any)=>a.id===id);
  if(changed?.type==='Top Level Assembly' && ('shipDate' in nextPatch || 'lateAllowed' in nextPatch || 'batchId' in nextPatch)){
    updated=updated.map((a:any)=>a.buildGroupId&&a.buildGroupId===changed.buildGroupId&&a.id!==id?{...a,...(('shipDate' in nextPatch)?{shipDate:nextPatch.shipDate}:{}),...(('lateAllowed' in nextPatch)?{lateAllowed:nextPatch.lateAllowed}: {}),...(('batchId' in nextPatch)?{batchId:nextPatch.batchId}: {})}:a);
  }
  const nextAsm=updated.find((a:any)=>a.id===id);
  let holds=d.holds||[];
  const wantsHold=nextAsm&&(nextAsm.status==='On Hold'||String(nextAsm.holdReason||'').trim());
  if(nextAsm&&wantsHold){const existing=holds.find((h:any)=>h.assemblyId===id&&h.status!=='Closed');const reason=nextAsm.holdReason||'On hold';if(existing){holds=holds.map((h:any)=>h.id===existing.id?{...h,projectId:nextAsm.projectId,reason,status:'Open'}:h)}else holds=[...holds,{id:uid('hold'),projectId:nextAsm.projectId,assemblyId:id,reason,owner:'',status:'Open',notes:''}];}
  else if(current&&(nextPatch.status&&nextPatch.status!=='On Hold')){holds=holds.map((h:any)=>h.assemblyId===id&&h.status!=='Closed'?{...h,status:'Closed'}:h)}
  return {...d,projectAssemblies:updated,holds};
 })}
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
    <div className="sequenceHint"><b>Scheduling for this specific assembly:</b> set Ship By, batch, and sequencing on this build set only. Subs are nested below and stay visually tied to this top level.</div>
    <div className="buildControls">
      <div className="field"><label>Assembly Ship By</label><StableDateInput className="largeInput" type="date" value={top.shipDate||''} onCommit={(value:any)=>safeChange(top,{shipDate:value})}/><div className="fieldHelp">This date belongs only to this top level group.</div></div>
      <div className="field"><label>Late Allowed</label><label className="checkLine"><input type="checkbox" checked={!!top.lateAllowed} onChange={e=>safeChange(top,{lateAllowed:e.target.checked})}/> Allow late</label></div>
      <div className="field"><label>Shipment Batch</label><select className="largeInput" value={top.batchId||''} onChange={e=>safeChange(top,{batchId:e.target.value})}><option value="">No batch / ships alone</option>{batches.map((b:any)=><option key={b.id} value={b.id}>{b.name}</option>)}</select>{batch&&<div className="fieldHelp">Batch: {batch.name} ships {batch.shipDate||'not set'}.</div>}</div>
      <div className="field wide"><label>Sequence This Top Level After</label><select className="largeInput" value={topSeq} onChange={e=>safeChange(top,{dependsOn:e.target.value,overrideDependencies:!e.target.value})}><option value="">No sequencing / independent</option>{topOptions(top).map((x:any)=><option key={x.id} value={x.id}>{x.label}</option>)}</select></div>
      <div className="field"><label>Build Employee(s)</label><EmployeePicker data={data} value={top.assignedTo||''} onChange={(v:any)=>safeChange(top,{assignedTo:v})} row={top}/></div>
      {top.testRequired&&<div className="field"><label>Expected Test Return</label><StableDateInput className="largeInput" type="datetime-local" value={top.testReturnDateTime||''} onCommit={(value:any)=>safeChange(top,{testReturnDateTime:value})}/></div>}
      {top.inspectionRequired&&<div className="field"><label>Inspection Employee(s)</label><EmployeePicker data={data} value={top.inspectionAssignedTo||''} onChange={(v:any)=>safeChange(top,{inspectionAssignedTo:v})} row={top} phase="Inspection"/><label className="checkLine"><input type="checkbox" checked={!!top.inspectionComplete} onChange={e=>safeChange(top,{inspectionComplete:e.target.checked})}/> Inspection complete</label></div>}
      {top.shippingRequired&&<div className="field"><label>Shipping Employee(s)</label><EmployeePicker data={data} value={top.shippingAssignedTo||''} onChange={(v:any)=>safeChange(top,{shippingAssignedTo:v})} row={top} phase="Shipping"/><label className="checkLine"><input type="checkbox" checked={!!top.shippingComplete} onChange={e=>safeChange(top,{shippingComplete:e.target.checked})}/> Shipping complete</label></div>}
      <div className="field"><label>Build % Complete</label><BufferedPercentInput className="largeInput" max={completionCap(top)} value={Math.min(top.percent||0,completionCap(top))} onCommit={(value:any)=>safeChange(top,{percent:value})}/>{completionCap(top)<100&&<div className="capNote">Overall capped at {completionCap(top)}% because a sub is on hold.</div>}</div>
      <div className="field"><label>Status</label><select className="largeInput" value={top.status||'Not Started'} onChange={e=>safeChange(top,{status:e.target.value,holdReason:e.target.value==='On Hold'?(top.holdReason||'On hold'):top.holdReason})}><option>Not Started</option><option>In Progress</option><option>Complete</option><option>On Hold</option></select></div>
      <div className="field wide"><label>Hold Reason</label><HoldReasonInput row={top} className="largeInput" onCommit={(patch:any)=>safeChange(top,patch)}/></div>
    </div>
    <div className="subPanel redesignedSubs"><div className="subPanelTitle"><div><h4>Nested Sub Assemblies</h4><p className="muted">These subs belong only to {top.buildGroupLabel||top.partNumber}.</p></div><span className="pill">{subs.length} total</span></div><div className="subCards">{subs.length===0&&<div className="emptySubCard muted">No subs assigned to this top level.</div>}{subs.map((s:any,idx:number)=>{const subSeq=splitIds(s.dependsOn).filter((id:string)=>subOptions(s,subs).some((o:any)=>o.id===id))[0]||'';return <div className={`subAssemblyCard ${s.status==='On Hold'?'holdSub':''}`} key={s.id}><div className="subCardHeader"><span className="subNumber">SUB #{idx+1}</span><div><b>{s.partNumber} {s.instanceLabel||''}</b><input value={s.description||''} onChange={e=>safeChange(s,{description:e.target.value})}/></div><span className="pill">{rolledCompletion(data,s)}%</span></div><div className="subCardGrid"><label>Qty<input className="tiny" type="number" value={s.qty||0} onChange={e=>safeChange(s,{qty:Number(e.target.value)})}/></label><label>Hrs Each<input className="tiny" type="number" value={s.hoursEach||0} onChange={e=>safeChange(s,{hoursEach:Number(e.target.value)})}/></label><label>Build Employee<EmployeePicker data={data} value={s.assignedTo||''} onChange={(v:any)=>safeChange(s,{assignedTo:v})} row={s}/></label><label>Status<select value={s.status||'Not Started'} onChange={e=>safeChange(s,{status:e.target.value,holdReason:e.target.value==='On Hold'?(s.holdReason||'On hold'):s.holdReason})}><option>Not Started</option><option>In Progress</option><option>Complete</option><option>On Hold</option></select></label><label>Build %<BufferedPercentInput className="tiny" value={s.percent||0} onCommit={(value:any)=>safeChange(s,{percent:value})}/></label><label>Sequence After<select value={subSeq} onChange={e=>safeChange(s,{dependsOn:e.target.value,overrideDependencies:!e.target.value})}><option value="">No sequencing</option>{subOptions(s,subs).map((x:any)=><option key={x.id} value={x.id}>{x.label}</option>)}</select></label>{s.testRequired&&<label>Test Return<StableDateInput type="datetime-local" value={s.testReturnDateTime||''} onCommit={(value:any)=>safeChange(s,{testReturnDateTime:value})}/></label>}{s.inspectionRequired&&<label>Inspection Employee<EmployeePicker data={data} value={s.inspectionAssignedTo||''} onChange={(v:any)=>safeChange(s,{inspectionAssignedTo:v})} row={s} phase="Inspection"/></label>}{s.shippingRequired&&<label>Shipping Employee<EmployeePicker data={data} value={s.shippingAssignedTo||''} onChange={(v:any)=>safeChange(s,{shippingAssignedTo:v})} row={s} phase="Shipping"/></label>}<label className="wideSub">Hold Reason<HoldReasonInput row={s} onCommit={(patch:any)=>safeChange(s,patch)}/></label></div><div className="subChecks">{s.inspectionRequired&&<label><input type="checkbox" checked={!!s.inspectionComplete} onChange={e=>safeChange(s,{inspectionComplete:e.target.checked})}/> Inspection complete</label>}{s.shippingRequired&&<label><input type="checkbox" checked={!!s.shippingComplete} onChange={e=>safeChange(s,{shippingComplete:e.target.checked})}/> Shipping complete</label>}</div></div>})}</div></div>
  </div>
 }
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
function ProjectAssemblyTable({rows,data,batches,onChange,onDelete}:any){
 const groups:any[]=[];const seen=new Set<string>();
 function hasHeldSubs(top:any){return rows.some((s:any)=>s.type==='Sub Assembly'&&((s.buildGroupId&&s.buildGroupId===(top.buildGroupId||top.id))||s.parentAssemblyId===top.id)&&(s.status==='On Hold'||String(s.holdReason||'').trim()))}
 function completionCap(top:any){return hasHeldSubs(top)?Number(top.maxTopPercentWhenSubHeld||80):100}
 function safeChange(r:any,patch:any){if('percent' in patch&&r.type==='Top Level Assembly'){patch={...patch,percent:Math.min(Number(patch.percent)||0,completionCap(r))}}onChange(r.id,patch)}
 const loose:any[]=[];
 rows.forEach((r:any)=>{if(r.type==='Top Level Assembly'){const gid=r.buildGroupId||r.id;if(!seen.has(gid)){seen.add(gid);groups.push({id:gid,label:r.buildGroupLabel||`${r.partNumber||'Top Level'} ${r.instanceLabel||''}`,top:r,subs:rows.filter((s:any)=>s.type==='Sub Assembly'&&((s.buildGroupId&&s.buildGroupId===gid)||s.parentAssemblyId===r.id))})}}else if(!r.buildGroupId&&!r.parentAssemblyId){loose.push(r)}});
 function sequenceOptions(r:any){
  return rows.filter((x:any)=>x.id!==r.id && x.type===r.type).map((x:any)=>({id:x.id,label:`${x.buildGroupLabel?x.buildGroupLabel+' — ':''}${x.partNumber} ${x.instanceLabel||''} — ${x.description||''}`}));
 }
 function standaloneSub(r:any){return r.type==='Sub Assembly'&&!r.parentAssemblyId&&!r.buildGroupId}
 const renderRow=(r:any,indent=false)=>{
  const looseSub=standaloneSub(r);
  return <tr key={r.id} className={indent?'subAssemblyRow':''}><td>{indent?<span className="indent">↳</span>:null}<input value={r.partNumber||''} onChange={e=>safeChange(r,{partNumber:e.target.value})}/></td><td><input className="tiny" type="number" value={r.instanceNumber||1} onChange={e=>safeChange(r,{instanceNumber:Number(e.target.value),instanceLabel:'#'+Number(e.target.value)})}/></td><td><input value={r.description||''} onChange={e=>safeChange(r,{description:e.target.value})}/></td><td><select value={r.type} onChange={e=>safeChange(r,{type:e.target.value,dependsOn:''})}><option>Top Level Assembly</option><option>Sub Assembly</option></select></td><td><input className="tiny" type="number" value={r.qty||0} onChange={e=>safeChange(r,{qty:Number(e.target.value)})}/></td><td><input className="tiny" type="number" value={r.hoursEach||0} onChange={e=>safeChange(r,{hoursEach:Number(e.target.value)})}/></td><td><input type="checkbox" checked={!!r.testRequired} onChange={e=>safeChange(r,{testRequired:e.target.checked})}/><input className="tiny" type="number" value={r.testHours||0} onChange={e=>safeChange(r,{testHours:Number(e.target.value)})}/></td><td><input type="checkbox" checked={!!r.inspectionRequired} onChange={e=>safeChange(r,{inspectionRequired:e.target.checked})}/><input className="tiny" type="number" value={r.inspectionHours||0} onChange={e=>safeChange(r,{inspectionHours:Number(e.target.value)})}/></td><td><input type="checkbox" checked={!!r.shippingRequired} onChange={e=>safeChange(r,{shippingRequired:e.target.checked})}/><input className="tiny" type="number" value={r.shippingHours||0} onChange={e=>safeChange(r,{shippingHours:Number(e.target.value)})}/></td><td><select multiple value={splitIds(r.dependsOn)} onChange={e=>safeChange(r,{dependsOn:Array.from(e.target.selectedOptions).map((o:any)=>o.value).join(',')})}>{sequenceOptions(r).map((x:any)=><option key={x.id} value={x.id}>{x.label}</option>)}</select><div className="capNote">{r.type==='Top Level Assembly'?'Top levels can be sequenced after other top levels.':'Subs can be sequenced after other subs.'}</div></td><td><EmployeePicker data={data} value={r.assignedTo||''} onChange={(v:any)=>safeChange(r,{assignedTo:v})} row={r}/></td><td>{r.type==='Top Level Assembly'?<BatchPicker r={r} batches={batches||[]} onChange={safeChange}/>:<span className="muted">{looseSub?'Standalone / no batch':(batches?.find((b:any)=>b.id===r.batchId)?.name||'Uses top level')}</span>}</td><td>{r.type==='Top Level Assembly'||looseSub?<StableDateInput type="date" value={r.shipDate||''} onCommit={(value:any)=>safeChange(r,{shipDate:value})}/>:<span className="muted">{r.shipDate||'Uses top level'}</span>}</td><td><input type="checkbox" checked={!!r.lateAllowed} onChange={e=>safeChange(r,{lateAllowed:e.target.checked})}/></td><td><input type="checkbox" checked={!!r.overrideDependencies} onChange={e=>safeChange(r,{overrideDependencies:e.target.checked})}/></td><td><select value={r.status} onChange={e=>safeChange(r,{status:e.target.value,holdReason:e.target.value==='On Hold'?(r.holdReason||'On hold'):r.holdReason})}><option>Not Started</option><option>In Progress</option><option>Complete</option><option>On Hold</option></select></td><td><BufferedPercentInput className="tiny" max={r.type==='Top Level Assembly'?completionCap(r):100} value={r.type==='Top Level Assembly'?Math.min(r.percent||0,completionCap(r)):(r.percent||0)} onCommit={(value:any)=>safeChange(r,{percent:value})}/>{r.type==='Top Level Assembly'&&hasHeldSubs(r)&&<div className="capNote">capped at {completionCap(r)}%</div>}</td><td>{r.type==='Top Level Assembly'?<input className="tiny" type="number" value={r.maxTopPercentWhenSubHeld||80} onChange={e=>safeChange(r,{maxTopPercentWhenSubHeld:Number(e.target.value)})}/>:<span className="muted">—</span>}</td><td><HoldReasonInput row={r} onCommit={(patch:any)=>safeChange(r,patch)}/></td><td className="small">{r.id}</td><td><button className="btn danger" onClick={()=>onDelete(r.id)}>Delete</button></td></tr>;
 }
 return <div className="tablewrap"><table><thead><tr>{['Part #','#','Description','Type','Qty','Build Hrs Ea','Test','Inspect','Ship','Sequence After','Employees','Batch','Assembly Ship By','Late Allowed','Ignore Sequence','Status','%','Top % If Sub Held','Hold Reason','ID',''].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length===0&&<tr><td colSpan={21} className="muted">No assemblies on this project yet. Add one from the library above.</td></tr>}{groups.map(g=><React.Fragment key={g.id}><tr className="groupHeader"><td colSpan={21}><b>{g.label}</b><span className="muted"> — top level plus {g.subs.length} sub assembly{g.subs.length===1?'':'ies'}</span></td></tr>{renderRow(g.top,false)}{g.subs.map((s:any)=>renderRow(s,true))}</React.Fragment>)}{loose.length>0&&<tr className="groupHeader"><td colSpan={21}><b>Ungrouped Sub Assemblies</b><span className="muted"> — standalone subs added directly to this project</span></td></tr>}{loose.map((r:any)=>renderRow(r,true))}</tbody></table></div>}

function BatchPicker({r,batches,onChange}:any){
 function setBatch(batchId:string){
  const b=batches.find((x:any)=>x.id===batchId);
  if(!batchId){onChange(r,{batchId:''});return;}
  onChange(r,{batchId,shipDate:b?.shipDate||r.shipDate,lateAllowed:!!b?.lateAllowed});
 }
 return <div className="batchPicker"><select value={r.batchId||''} onChange={e=>setBatch(e.target.value)}><option value="">Unbatched / independent</option>{batches.map((b:any)=><option key={b.id} value={b.id}>{b.name} — {b.shipDate||'no date'}</option>)}</select>{r.batchId&&<button className="mini" onClick={()=>setBatch('')}>Unbatch</button>}</div>
}
function LibraryItemRow({r,subs,changeById,del,archive,activeUsage}:any){
 function subPicker(parent:any){return <select multiple value={splitIds(parent.defaultDependsOn)} onChange={e=>changeById(parent.id,'defaultDependsOn',Array.from(e.target.selectedOptions).map((o:any)=>o.value).join(','))}>{subs.map((x:any)=><option key={x.id} value={x.id}>{x.partNumber} — {x.description}</option>)}</select>}
 const usedCount=activeUsage?activeUsage(r.id).length:0;
 return <tr className={r.archived?'archivedRow':''}><td><input value={r.partNumber} onChange={e=>changeById(r.id,'partNumber',e.target.value)}/></td><td><input value={r.description} onChange={e=>changeById(r.id,'description',e.target.value)}/></td><td><select value={r.type} onChange={e=>changeById(r.id,'type',e.target.value)}><option>Top Level Assembly</option><option>Sub Assembly</option></select></td><td><input className="tiny" type="number" value={r.defaultQty||1} onChange={e=>changeById(r.id,'defaultQty',Number(e.target.value))}/></td><td><input className="tiny" type="number" value={r.hoursEach||0} onChange={e=>changeById(r.id,'hoursEach',Number(e.target.value))}/></td><td><input type="checkbox" checked={!!r.testRequired} onChange={e=>changeById(r.id,'testRequired',e.target.checked)}/><input className="tiny" type="number" value={r.testHours||0} onChange={e=>changeById(r.id,'testHours',Number(e.target.value))}/></td><td><input type="checkbox" checked={!!r.inspectionRequired} onChange={e=>changeById(r.id,'inspectionRequired',e.target.checked)}/><input className="tiny" type="number" value={r.inspectionHours||0} onChange={e=>changeById(r.id,'inspectionHours',Number(e.target.value))}/></td><td><input type="checkbox" checked={!!r.shippingRequired} onChange={e=>changeById(r.id,'shippingRequired',e.target.checked)}/><input className="tiny" type="number" value={r.shippingHours||0} onChange={e=>changeById(r.id,'shippingHours',Number(e.target.value))}/></td><td>{r.type==='Top Level Assembly'?subPicker(r):<span className="muted">Assigned from a top level assembly</span>}</td><td>{r.type==='Top Level Assembly'?<input className="tiny" type="number" value={r.maxTopPercentWhenSubHeld||80} onChange={e=>changeById(r.id,'maxTopPercentWhenSubHeld',Number(e.target.value))}/>:<span className="muted">—</span>}</td><td><span className={r.archived?'pill warn':'pill'}>{r.archived?'Archived':'Active'}</span></td><td><input value={r.notes||''} onChange={e=>changeById(r.id,'notes',e.target.value)}/></td><td className="small">{r.id}{usedCount>0&&<div className="muted">Used on {usedCount} active item{usedCount===1?'':'s'}</div>}</td><td><button className="btn" onClick={()=>archive(r.id)}>{r.archived?'Unarchive':'Archive'}</button><button className="btn danger" onClick={()=>del(r.id)}>Delete</button></td></tr>
}




function AssemblyLibrary({data,setData}:any){
 const blank=(type='Sub Assembly')=>({id:uid('tpl'),partNumber:'',description:'',type,defaultQty:1,hoursEach:1,testRequired:false,testHours:0,inspectionRequired:false,inspectionHours:0,shippingRequired:false,shippingHours:0,testReturnDateTime:'',inspectionAssignedTo:'',shippingAssignedTo:'',inspectionManualStartDate:'',shippingManualStartDate:'',inspectionComplete:false,shippingComplete:false,maxTopPercentWhenSubHeld:80,defaultDependsOn:'',notes:'',archived:false});
 const rows=data.assemblyTemplates||[];
 const [showArchived,setShowArchived]=useState(false);
 const [filter,setFilter]=useState('All');
 const [search,setSearch]=useState('');
 const [selectedId,setSelectedId]=useState(rows[0]?.id||'');
 const visibleRows=rows.filter((r:any)=>showArchived||!r.archived).filter((r:any)=>filter==='All'||r.type===filter).filter((r:any)=>matchesAssemblySearch(r,search));
 const selected=rows.find((r:any)=>r.id===selectedId)||visibleRows[0]||rows[0];
 useEffect(()=>{if(selected&&!selectedId)setSelectedId(selected.id)},[selected,selectedId]);
 function changeById(id:string,k:string,v:any){setData((d:any)=>({...d,assemblyTemplates:d.assemblyTemplates.map((r:any)=>r.id===id?{...r,[k]:v}:r)}))}
 function patchItem(id:string,patch:any){setData((d:any)=>({...d,assemblyTemplates:d.assemblyTemplates.map((r:any)=>r.id===id?{...r,...patch}:r)}))}
 function add(type:string){const row=blank(type);setData((d:any)=>({...d,assemblyTemplates:[...d.assemblyTemplates,row]}));setSelectedId(row.id)}
 function duplicate(id:string){const item=rows.find((r:any)=>r.id===id);if(!item)return;const copy={...item,id:uid('tpl'),partNumber:(item.partNumber||'')+' COPY',description:(item.description||'')+' Copy',archived:false,notes:item.notes||''};setData((d:any)=>({...d,assemblyTemplates:[...d.assemblyTemplates,copy]}));setSelectedId(copy.id)}
 function activeUsage(id:string){const activeProjectIds=new Set((data.projects||[]).filter((p:any)=>!['Complete','Cancelled'].includes(p.status)).map((p:any)=>p.id));return (data.projectAssemblies||[]).filter((a:any)=>a.templateId===id&&activeProjectIds.has(a.projectId))}
 function usageProjectList(usages:any[]){const ids=[...new Set(usages.map((u:any)=>u.projectId))];return ids.map((pid:string)=>{const p=(data.projects||[]).find((x:any)=>x.id===pid);return p?.projectId||p?.name||pid}).join(', ')}
 function archive(id:string){const item=rows.find((r:any)=>r.id===id);if(!item)return;const action=item.archived?'unarchive':'archive';if(!confirm(`${action[0].toUpperCase()+action.slice(1)} ${item.partNumber||'this assembly'}?`))return;patchItem(id,{archived:!item.archived,archivedAt:!item.archived?new Date().toISOString():''})}
 function del(id:string){const item=rows.find((r:any)=>r.id===id);if(!item)return;const usages=activeUsage(id);if(usages.length){alert(`Cannot delete this library item because it is used on active project(s): ${usageProjectList(usages)}. Archive it instead if you want to hide it from future use.`);return;}if(!confirm(`Delete ${item.partNumber||'this library item'}? This is only allowed because it is not used on an active project.`))return;setData((d:any)=>({...d,assemblyTemplates:d.assemblyTemplates.filter((r:any)=>r.id!==id).map((r:any)=>({...r,defaultDependsOn:splitIds(r.defaultDependsOn).filter((x:string)=>x!==id).join(',')}))}));if(selectedId===id)setSelectedId('')}
 function whereUsed(id:string){const usages=activeUsage(id);if(!usages.length){alert('This assembly is not used on any active project.');return;}alert('Used on active project(s): '+usageProjectList(usages))}
 function subList(top:any){return splitIds(top.defaultDependsOn).map((id:string,idx:number)=>({id,idx,item:rows.find((r:any)=>r.id===id)})).filter((x:any)=>x.item)}
 const topCount=rows.filter((r:any)=>r.type==='Top Level Assembly'&&!r.archived).length;
 const subCount=rows.filter((r:any)=>r.type==='Sub Assembly'&&!r.archived).length;
 return <div className="libraryWorkspace">
   <div className="card libraryHeader"><div><h2>Assembly Library</h2><p className="muted">Reusable scheduling templates only. Select an assembly on the left, edit it on the right, and build top-level sub assembly trees without leaving the page.</p></div><div className="libraryStats"><span><b>{topCount}</b> Top Level</span><span><b>{subCount}</b> Subs</span><span><b>{rows.filter((r:any)=>r.archived).length}</b> Archived</span></div></div>
   <div className="card libraryListPanel"><div className="libraryTools"><input className="largeInput" placeholder="Search part #, description, notes..." value={search} onChange={e=>setSearch(e.target.value)}/><select className="largeInput" value={filter} onChange={e=>setFilter(e.target.value)}><option>All</option><option>Top Level Assembly</option><option>Sub Assembly</option></select><label className="checkLine"><input type="checkbox" checked={showArchived} onChange={e=>setShowArchived(e.target.checked)}/> Show archived</label></div><div className="actions"><button className="btn primary" onClick={()=>add('Top Level Assembly')}>Add Top Level</button><button className="btn" onClick={()=>add('Sub Assembly')}>Add Sub</button></div><div className="librarySelectableList">{visibleRows.length===0&&<p className="muted">No matching assemblies.</p>}{visibleRows.map((r:any)=>{const used=activeUsage(r.id).length;const subs=r.type==='Top Level Assembly'?splitIds(r.defaultDependsOn).length:0;return <button key={r.id} className={selected?.id===r.id?'librarySelect activeLibrarySelect':'librarySelect'} onClick={()=>setSelectedId(r.id)}><div><b>{r.partNumber||'New Assembly'}</b>{r.archived&&<span className="pill warn">Archived</span>}</div><span>{r.description||'No description'}</span><small>{r.type}{r.type==='Top Level Assembly'?` • ${subs} subs`:''}{used?` • used ${used}`:''}</small></button>})}</div></div>
   <div className="card libraryEditorPanel">{selected?<AssemblyEditor item={selected} rows={rows} data={data} changeById={changeById} patchItem={patchItem} duplicate={duplicate} archive={archive} del={del} whereUsed={whereUsed}/>:<p className="muted">Select or add an assembly to edit.</p>}</div>
 </div>
}
function AssemblyEditor({item,rows,data,changeById,patchItem,duplicate,archive,del,whereUsed}:any){
 const subs=rows.filter((r:any)=>r.type==='Sub Assembly'&&!r.archived);
 const [subToAdd,setSubToAdd]=useState('');
 const [subSearch,setSubSearch]=useState('');
 const linkedIds=splitIds(item.defaultDependsOn);
 useEffect(()=>{if(!subToAdd&&subs[0])setSubToAdd(subs[0].id)},[subToAdd,subs]);
 const filteredSubs=subs.filter((s:any)=>matchesAssemblySearch(s,subSearch));
 const selectedSub=subs.find((s:any)=>s.id===subToAdd);
 const visibleSubs=selectedSub&&!filteredSubs.some((s:any)=>s.id===selectedSub.id)?[selectedSub,...filteredSubs]:filteredSubs;
 function setSubs(ids:string[]){changeById(item.id,'defaultDependsOn',ids.join(','))}
 function addSub(){const id=subToAdd||subs[0]?.id;if(!id)return;setSubs([...linkedIds,id]);setSubToAdd('')}
 function removeSubAt(idx:number){setSubs(linkedIds.filter((_:string,i:number)=>i!==idx))}
 function moveSubAt(idx:number,dir:number){const next=[...linkedIds];const ni=idx+dir;if(idx<0||ni<0||ni>=next.length)return;[next[idx],next[ni]]=[next[ni],next[idx]];setSubs(next)}
 function updateLinkedSub(subId:string,k:string,v:any){changeById(subId,k,v)}
 const req=(label:string,reqKey:string,hoursKey:string)=><div className="libraryReq"><label><input type="checkbox" checked={!!item[reqKey]} onChange={e=>changeById(item.id,reqKey,e.target.checked)}/> {label}</label><input className="largeInput" type="number" min="0" value={item[hoursKey]||0} onChange={e=>changeById(item.id,hoursKey,Number(e.target.value)||0)}/><span className="muted">hrs</span></div>;
 const linked=linkedIds.map((id:string,idx:number)=>({id,idx,item:rows.find((x:any)=>x.id===id)})).filter((x:any)=>x.item);
 const usage=(data.projectAssemblies||[]).filter((a:any)=>a.templateId===item.id);
 return <div className="assemblyEditor"><div className="editorTitle"><div><h2>{item.partNumber||'New Assembly'}</h2><p className="muted">{item.type}{item.archived?' • Archived':''}</p></div><div className="actions"><button className="btn" onClick={()=>duplicate(item.id)}>Duplicate</button><button className="btn" onClick={()=>whereUsed(item.id)}>Where Used</button><button className="btn" onClick={()=>archive(item.id)}>{item.archived?'Unarchive':'Archive'}</button><button className="btn danger" onClick={()=>del(item.id)}>Delete</button></div></div>
   <div className="editorSections"><section><h3>Basic Info</h3><div className="editorGrid"><div className="field"><label>Part #</label><input className="largeInput" value={item.partNumber||''} onChange={e=>changeById(item.id,'partNumber',e.target.value)}/></div><div className="field wide"><label>Description</label><input className="largeInput" value={item.description||''} onChange={e=>changeById(item.id,'description',e.target.value)}/></div><div className="field"><label>Type</label><select className="largeInput" value={item.type} onChange={e=>changeById(item.id,'type',e.target.value)}><option>Top Level Assembly</option><option>Sub Assembly</option></select></div><div className="field"><label>Default Qty</label><input className="largeInput" type="number" min="1" value={item.defaultQty||1} onChange={e=>changeById(item.id,'defaultQty',Number(e.target.value)||1)}/></div><div className="field"><label>Build Hours Each</label><input className="largeInput" type="number" min="0" value={item.hoursEach||0} onChange={e=>changeById(item.id,'hoursEach',Number(e.target.value)||0)}/></div>{item.type==='Top Level Assembly'&&<div className="field"><label>Top % If Sub Held</label><input className="largeInput" type="number" min="0" max="100" value={item.maxTopPercentWhenSubHeld||80} onChange={e=>changeById(item.id,'maxTopPercentWhenSubHeld',Number(e.target.value)||0)}/></div>}<div className="field full"><label>Notes</label><textarea className="largeInput" value={item.notes||''} onChange={e=>changeById(item.id,'notes',e.target.value)}/></div></div></section>
   <section><h3>Schedule Requirements</h3><div className="reqGrid">{req('Test Required','testRequired','testHours')}{req('Inspection Required','inspectionRequired','inspectionHours')}{req('Shipping Required','shippingRequired','shippingHours')}</div></section>
   {item.type==='Top Level Assembly'&&<section><h3>Sub Assembly Tree Builder</h3><p className="muted">Add sub assemblies to this top level. The same sub assembly can be added multiple times when a build needs repeated units.</p><div className="treeBuilderAdd"><input className="largeInput" value={subSearch} placeholder="Search sub part # / description..." onChange={e=>setSubSearch(e.target.value)}/><select className="largeInput" value={subToAdd} onChange={e=>setSubToAdd(e.target.value)}>{visibleSubs.map((s:any)=><option key={s.id} value={s.id}>{s.partNumber||'New Sub'} — {s.description||'No description'}</option>)}</select><button className="btn primary" disabled={!subs.length||!visibleSubs.length} onClick={addSub}>Add Sub Assembly</button></div><div className="treeBuilderList">{linked.length===0&&<p className="muted">No subs assigned to this top level yet.</p>}{linked.map(({item:s,idx}:any)=><div className="treeBuilderRow" key={s.id+'-'+idx}><div className="treeHandle">↳ #{idx+1}</div><div className="treeSubFields"><input className="largeInput" value={s.partNumber||''} onChange={e=>updateLinkedSub(s.id,'partNumber',e.target.value)}/><input className="largeInput" value={s.description||''} onChange={e=>updateLinkedSub(s.id,'description',e.target.value)}/><input className="largeInput smallNum" type="number" value={s.hoursEach||0} onChange={e=>updateLinkedSub(s.id,'hoursEach',Number(e.target.value)||0)}/></div><div className="treeRowActions"><button className="mini" onClick={()=>moveSubAt(idx,-1)}>↑</button><button className="mini" onClick={()=>moveSubAt(idx,1)}>↓</button><button className="mini danger" onClick={()=>removeSubAt(idx)}>Remove</button></div></div>)}</div></section>}
   <section><h3>Usage / Safety</h3><p className="muted">Used on {usage.length} project assembly item{usage.length===1?'':'s'}. Delete is blocked when this item is used on active projects; archive it to hide from future project adds.</p></section>
   </div></div>
}
function ProjectTrainingPicker({projects,employee,onChange}:any){
 const [search,setSearch]=useState('');
 const selectedIds=splitIds(employee?.preferredProjectIds||employee?.trainedProjectIds||'');
 const activeProjects=(projects||[]).filter((project:any)=>!project.archived);
 const query=normalizeSearchQuery(search);
 const filtered=activeProjects.filter((project:any)=>{
  if(!query)return true;
  return query.split(' ').every((token:string)=>projectSearchText(project).includes(token));
 });
 const selectedProjects=activeProjects.filter((project:any)=>selectedIds.includes(project.id));
 const visible=[...selectedProjects,...filtered.filter((project:any)=>!selectedIds.includes(project.id))].slice(0,18);
 function toggleProject(projectId:string,checked:boolean){
  const next=checked?[...new Set([...selectedIds,projectId])]:selectedIds.filter((id:string)=>id!==projectId);
  onChange({preferredProjectIds:next.join(','),trainedProjectIds:next.join(','),preferPreferredProjects:!!employee?.preferPreferredProjects,limitAutoAssignToTrainedProjects:!!employee?.preferPreferredProjects});
 }
 return <div className="trainingPicker"><div className="trainingPickerSummary"><span className="miniStat">Preferred Projects: <b>{selectedProjects.length}</b></span><span className="miniStat">Preferred Project Match: <b>{employee?.preferPreferredProjects?'Boosted':'Open'}</b></span></div><label className="checkLine"><input type="checkbox" checked={!!employee?.preferPreferredProjects} onChange={e=>onChange({preferPreferredProjects:e.target.checked,limitAutoAssignToTrainedProjects:e.target.checked})}/> Prefer these projects during Smart Assign</label><input className="largeInput" value={search} onChange={e=>setSearch(e.target.value)} placeholder="Search preferred projects by ID, name, customer..."/><div className="trainedProjectChips">{selectedProjects.length===0?<span className="muted small">No preferred projects selected.</span>:selectedProjects.map((project:any)=><span key={project.id} className="trainedProjectChip">{project.projectId||project.name}<button type="button" className="mini" onClick={()=>toggleProject(project.id,false)}>×</button></span>)}</div><div className="trainingProjectList">{visible.length===0?<p className="muted small">No matching projects.</p>:visible.map((project:any)=><label key={project.id} className={selectedIds.includes(project.id)?'trainingProjectOption selectedTrainingProjectOption':'trainingProjectOption'}><input type="checkbox" checked={selectedIds.includes(project.id)} onChange={e=>toggleProject(project.id,e.target.checked)}/><div><b>{project.projectId||'New Project'}</b><span>{project.name||'No name'}</span><small>{project.customer||'No customer'}{project.status?` • ${project.status}`:''}</small></div></label>)}</div></div>
}
function Employees({data,setData}:any){
 const blank={id:uid('emp'),name:'',email:'',skills:'',active:true,pto:'',timeOffDates:'',fridayOvertimeDates:'',workDays:'',workHoursByDay:'',canBuild:true,canInspect:true,canShip:true,trainedProjectIds:'',limitAutoAssignToTrainedProjects:false,preferredProjectIds:'',preferPreferredProjects:false};
 const weekdays=[['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri']];
 function updateEmp(id:string,patch:any){setData((d:any)=>({...d,employees:d.employees.map((e:any)=>e.id===id?{...e,...patch}:e)}))}
 function addEmployee(){setData((d:any)=>({...d,employees:[...d.employees,{...blank,id:uid('emp')}]}))}
 function deleteEmployee(id:string){if(!confirm('Delete this employee? Existing assignments will remain by ID until changed.'))return;setData((d:any)=>({...d,employees:d.employees.filter((e:any)=>e.id!==id)}))}
 function daySet(e:any){return new Set(splitIds(e.workDays||''))}
 function hoursMap(e:any){try{return JSON.parse(e.workHoursByDay||'{}')}catch{return {}}}
 function setDay(e:any,day:string,checked:boolean){const days=daySet(e);checked?days.add(day):days.delete(day);updateEmp(e.id,{workDays:[...days].sort().join(',')})}
 function setHours(e:any,day:string,value:any){const map=hoursMap(e);map[day]=Math.max(0,Number(value)||0);updateEmp(e.id,{workHoursByDay:JSON.stringify(map)})}
 return <div className="card span12"><h2>Employees</h2><p className="muted">Set who is active, what kind of work each employee can do, optional recurring weekly availability for part-time employees, and which projects they prefer during Smart Assign. Leave weekly days blank for the normal company schedule.</p><div className="actions"><button className="btn primary" onClick={addEmployee}>Add Employee</button></div><div className="tablewrap employeeSettingsTable"><table><thead><tr><th>Name</th><th>Email</th><th>Skills</th><th>Active</th><th>Can Build</th><th>Can Inspect</th><th>Can Ship</th><th>Preferred Projects</th><th>Weekly Work Days / Hours</th><th></th></tr></thead><tbody>{data.employees.map((e:any)=>{const preferredCount=splitIds(e.preferredProjectIds||e.trainedProjectIds||'').length;return <tr key={e.id}><td><input value={e.name||''} onChange={ev=>updateEmp(e.id,{name:ev.target.value})}/><div className="muted small">Preferred Projects: {preferredCount} • Preferred Project Match: {e.preferPreferredProjects?'Boost this list':'Open to all projects'}</div></td><td><input value={e.email||''} onChange={ev=>updateEmp(e.id,{email:ev.target.value})}/></td><td><input value={e.skills||''} onChange={ev=>updateEmp(e.id,{skills:ev.target.value})}/></td><td><input type="checkbox" checked={!!e.active} onChange={ev=>updateEmp(e.id,{active:ev.target.checked})}/></td><td><input type="checkbox" checked={e.canBuild!==false} onChange={ev=>updateEmp(e.id,{canBuild:ev.target.checked})}/></td><td><input type="checkbox" checked={e.canInspect!==false} onChange={ev=>updateEmp(e.id,{canInspect:ev.target.checked})}/></td><td><input type="checkbox" checked={e.canShip!==false} onChange={ev=>updateEmp(e.id,{canShip:ev.target.checked})}/></td><td><ProjectTrainingPicker projects={data.projects||[]} employee={e} onChange={(patch:any)=>updateEmp(e.id,patch)}/></td><td><div className="partTimeControls"><button type="button" className="mini normalScheduleBtn" onClick={()=>updateEmp(e.id,{workDays:'',workHoursByDay:''})}>Use normal schedule</button><div className="partTimeGrid compactPartTimeGrid">{weekdays.map(([day,label])=>{const selected=daySet(e).has(day);const map=hoursMap(e);return <label key={day} className={selected?'partDay selectedPartDay':'partDay'}><span className="partDayTop"><input type="checkbox" checked={selected} onChange={ev=>setDay(e,day,ev.target.checked)}/><b>{label}</b></span><span className="partHourLine"><input type="number" min="0" step="0.25" disabled={!selected} value={map[day]??dailyHours(data)} onChange={ev=>setHours(e,day,ev.target.value)}/><small>hrs</small></span></label>})}</div></div></td><td><button className="btn danger" onClick={()=>deleteEmployee(e.id)}>Delete</button></td></tr>})}</tbody></table></div></div>
}
function Availability({data,setData}:any){
 const emptyHoliday={id:uid('hol'),date:'',name:'',paid:true,notes:''};
 const [selectedEmployee,setSelectedEmployee]=useState(data.employees[0]?.id||'');
 const [selectedMonth,setSelectedMonth]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`});
 useEffect(()=>{if(!selectedEmployee&&data.employees[0])setSelectedEmployee(data.employees[0].id)},[data.employees,selectedEmployee]);
 function dateTokens(raw:string){return splitIds(raw).filter((x:string)=>/^\d{4}-\d{2}-\d{2}$/.test(x)).sort()}
 function updateEmp(id:string,patch:any){setData((d:any)=>({...d,employees:d.employees.map((e:any)=>e.id===id?{...e,...patch}:e)}))}
 function setEmpDates(id:string,key:string,dates:string[]){const clean=[...new Set(dates)].filter(Boolean).sort().join('\n');updateEmp(id,{[key]:clean,...(key==='timeOffDates'?{pto:clean}:{})})}
 function toggleDate(id:string,key:string,date:string){const emp=data.employees.find((e:any)=>e.id===id);if(!emp)return;const vals=dateTokens(emp[key]||'');const next=vals.includes(date)?vals.filter((x:string)=>x!==date):[...vals,date];setEmpDates(id,key,next)}
 function addHoliday(){setData((d:any)=>({...d,holidays:[...(d.holidays||[]),emptyHoliday]}))}
 function updateHoliday(id:string,patch:any){setData((d:any)=>({...d,holidays:(d.holidays||[]).map((h:any)=>h.id===id?{...h,...patch}:h)}))}
 function deleteHoliday(id:string){setData((d:any)=>({...d,holidays:(d.holidays||[]).filter((h:any)=>h.id!==id)}))}
 function monthDays(month:string){const [y,m]=month.split('-').map(Number);const first=new Date(y,m-1,1);const start=new Date(first);start.setDate(1-(first.getDay()||7)+1);const out:string[]=[];for(let i=0;i<42;i++){const d=new Date(start);d.setDate(start.getDate()+i);out.push(dateOnly(d));}return out}
 const emp=data.employees.find((e:any)=>e.id===selectedEmployee)||data.employees[0];
 const offDates=new Set(dateTokens(emp?.timeOffDates||emp?.pto||''));
 const friDates=new Set(dateTokens(emp?.fridayOvertimeDates||''));
 return <div className="grid"><div className="card span12"><h2>Availability</h2><p className="muted">Use the calendar to toggle employee time off and optional Friday overtime. Time off now blocks capacity, shows on the dashboard, and marks the employee/day on the weekly board.</p></div><div className="card span6"><h2>Company Holidays</h2><button className="btn primary" onClick={addHoliday}>Add Holiday</button><div className="tablewrap"><table><thead><tr><th>Date</th><th>Name</th><th>Paid</th><th>Notes</th><th></th></tr></thead><tbody>{(data.holidays||[]).map((h:any)=><tr key={h.id}><td><input type="date" value={h.date||''} onChange={e=>updateHoliday(h.id,{date:e.target.value})}/></td><td><input value={h.name||''} onChange={e=>updateHoliday(h.id,{name:e.target.value})}/></td><td><input type="checkbox" checked={!!h.paid} onChange={e=>updateHoliday(h.id,{paid:e.target.checked})}/></td><td><input value={h.notes||''} onChange={e=>updateHoliday(h.id,{notes:e.target.value})}/></td><td><button className="btn danger" onClick={()=>deleteHoliday(h.id)}>Delete</button></td></tr>)}</tbody></table></div></div><div className="card span6"><h2>Employee Calendar</h2><div className="form"><div className="field wide"><label>Employee</label><select className="largeInput" value={emp?.id||''} onChange={e=>setSelectedEmployee(e.target.value)}>{data.employees.map((e:any)=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div><div className="field"><label>Month</label><input className="largeInput" type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}/></div></div>{emp&&<><div className="availabilityLegend"><span className="legendOff">Time Off</span><span className="legendOt">Friday OT</span><span className="muted">Click a day to toggle time off. Use the Friday OT button on Friday cells to toggle overtime.</span></div><div className="availabilityCalendar"><div className="calDow">Mon</div><div className="calDow">Tue</div><div className="calDow">Wed</div><div className="calDow">Thu</div><div className="calDow">Fri</div><div className="calDow muted">Sat</div><div className="calDow muted">Sun</div>{monthDays(selectedMonth).map((d:string)=>{const inMonth=d.startsWith(selectedMonth);const day=new Date(d+'T00:00:00').getDay();const isFri=day===5;const off=offDates.has(d);const ot=friDates.has(d);const holiday=(data.holidays||[]).find((h:any)=>h.date===d);return <div key={d} className={'calendarDay '+(!inMonth?'outsideMonth ':'')+(off?'calendarOff ':'')+(ot?'calendarOt ':'')+(holiday?'calendarHoliday ':'')}><button type="button" onClick={()=>toggleDate(emp.id,'timeOffDates',d)}><b>{Number(d.slice(-2))}</b>{holiday&&<small>{holiday.name||'Holiday'}</small>}{off&&<small>Scheduled Out</small>}{ot&&<small>Friday OT</small>}</button>{isFri&&<button type="button" className="mini fridayOtButton" onClick={()=>toggleDate(emp.id,'fridayOvertimeDates',d)}>{ot?'Remove OT':'Friday OT'}</button>}</div>})}</div><div className="selectedDateLists"><div><h3>Selected Time Off</h3>{[...offDates].length?<div className="datePills">{[...offDates].map((d:string)=><button className="mini" key={d} onClick={()=>toggleDate(emp.id,'timeOffDates',d)}>{fmtDate(d)} ×</button>)}</div>:<p className="muted">No time off selected.</p>}</div><div><h3>Friday OT Dates</h3>{[...friDates].length?<div className="datePills">{[...friDates].map((d:string)=><button className="mini" key={d} onClick={()=>toggleDate(emp.id,'fridayOvertimeDates',d)}>{fmtDate(d)} ×</button>)}</div>:<p className="muted">No Friday overtime selected.</p>}</div></div></>}</div></div>} 
function Holds({data,setData}:any){
 function projectName(id:string){const p=data.projects.find((x:any)=>x.id===id);return p?`${p.projectId} — ${p.name}`:id}
 function asmName(id:string){const a=data.projectAssemblies.find((x:any)=>x.id===id);return a?`${a.partNumber} ${a.instanceLabel||''} — ${a.description}`:id}
 function updateHold(id:string,patch:any){setData((d:any)=>({...d,holds:d.holds.map((h:any)=>h.id===id?{...h,...patch}:h)}))}
 function closeHold(h:any){setData((d:any)=>({...d,holds:d.holds.map((x:any)=>x.id===h.id?{...x,status:'Closed'}:x),projectAssemblies:d.projectAssemblies.map((a:any)=>a.id===h.assemblyId?{...a,status:a.status==='On Hold'?'Not Started':a.status,holdReason:''}:a)}))}
 const rows=(data.holds||[]).filter((h:any)=>h.status!=='Closed');
 return <div className="card span12"><h2>Holds</h2><p className="muted">Put an assembly on hold from the Project tab by setting its status to On Hold or entering a hold reason. Open holds appear here automatically.</p><div className="tablewrap"><table><thead><tr>{['Project','Assembly','Reason','Owner','Status','Notes','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{rows.length===0&&<tr><td colSpan={7} className="muted">No open holds.</td></tr>}{rows.map((h:any)=><tr key={h.id}><td>{projectName(h.projectId)}</td><td>{asmName(h.assemblyId)}</td><td><input value={h.reason||''} onChange={e=>updateHold(h.id,{reason:e.target.value})}/></td><td><input value={h.owner||''} onChange={e=>updateHold(h.id,{owner:e.target.value})}/></td><td><select value={h.status||'Open'} onChange={e=>updateHold(h.id,{status:e.target.value})}><option>Open</option><option>Waiting on Parts</option><option>Waiting on Engineering</option><option>Waiting on Customer</option><option>Closed</option></select></td><td><input value={h.notes||''} onChange={e=>updateHold(h.id,{notes:e.target.value})}/></td><td><button className="btn" onClick={()=>closeHold(h)}>Clear Hold</button></td></tr>)}</tbody></table></div></div>
} 
function Crud({title,rows,empty,setRows,fields}:any){return <div className="card span12"><h2>{title}</h2><CrudInner rows={rows} empty={empty} setRows={setRows} fields={fields}/></div>}
function CrudInner({rows,empty,setRows,fields}:any){const [form,setForm]=useState(empty);function add(){setRows([...rows,form]);setForm({...empty,id:uid(empty.id.split('-')[0]||'row')})}function changeRow(i:number,k:string,v:any){const copy=[...rows];copy[i]={...copy[i],[k]:v};setRows(copy)}function input(value:any,onChange:any,f:any){if(f[2]==='checkbox')return <input type="checkbox" checked={!!value} onChange={e=>onChange(e.target.checked)}/>;return <input type={f[2]||'text'} value={value??''} onChange={e=>onChange(e.target.value)}/>}return <><div className="form">{fields.map((f:any)=><div className="field" key={f[0]}><label>{f[1]}</label>{input(form[f[0]],(v:any)=>setForm({...form,[f[0]]:v}),f)}</div>)}<div className="field"><button className="btn primary" onClick={add}>Add Manual Row</button></div></div><div className="tablewrap"><table><thead><tr>{fields.map((f:any)=><th key={f[0]}>{f[1]}</th>)}<th>ID</th><th></th></tr></thead><tbody>{rows.map((r:any,i:number)=><tr key={r.id}>{fields.map((f:any)=><td key={f[0]}>{input(r[f[0]],(v:any)=>changeRow(i,f[0],v),f)}</td>)}<td className="small">{r.id}</td><td><button className="btn danger" onClick={()=>setRows(rows.filter((_:any,idx:number)=>idx!==i))}>Delete</button></td></tr>)}</tbody></table></div></>}

function StableDateInput({value,onCommit,type='date',className=''}:any){
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

function BufferedPercentInput({value,max=100,onCommit,className=''}:any){
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

function HoldReasonInput({row,onCommit,className=''}:any){
  const [value,setValue]=useState(row?.holdReason||'');
  useEffect(()=>{setValue(row?.holdReason||'')},[row?.id,row?.holdReason]);
  function commit(next=value){
    const reason=String(next||'');
    onCommit({holdReason:reason,status:reason?'On Hold':(row?.status==='On Hold'?'Not Started':row?.status)});
  }
  return <input className={className} value={value} onChange={e=>setValue(e.target.value)} onBlur={()=>commit()} onKeyDown={e=>{if(e.key==='Enter'){(e.target as HTMLInputElement).blur()}}}/>
}
function HealthBadge({status}:any){return <span className={`healthBadge tone-${healthTone(status)}`}>{status}</span>}
function TimelineStepBadge({status}:any){return <span className={`timelineStepBadge state-${String(status||'Pending').toLowerCase().replace(/\s+/g,'-')}`}>{status}</span>}
function ProjectTimelinePanel({record,onFocusBoard}:any){
  if(!record)return null;
  return <section className="projectTimelinePanel"><div className="projectTimelineHeader"><div><h3>Project Timeline</h3><p className="muted">Subs to final shipping, based on current schedule data and warning state.</p></div><div className="projectTimelineActions"><HealthBadge status={record.status}/>{record.dueDate&&<span className="timelineDuePill">Due {fmtDate(record.dueDate)}</span>}{onFocusBoard&&<button className="btn" onClick={()=>onFocusBoard(record.projectId,record.dueDate||record.timeline.find((step:any)=>step.date)?.date||'')}>Open Weekly Board</button>}</div></div><div className="projectTimelineFlow">{record.timeline.map((step:any,idx:number)=><React.Fragment key={step.key}><article className={`timelineStepCard state-${String(step.status||'pending').toLowerCase().replace(/\s+/g,'-')}`}><div className="timelineStepTop"><span className="timelineStepLabel">{step.label}</span><TimelineStepBadge status={step.status}/></div>{step.date&&<b>{fmtDate(step.date)}</b>}{!step.date&&<b className="muted">No date yet</b>}{step.employeeName&&<span>{step.employeeName}</span>}{step.note&&<small>{step.note}</small>}{step.warningCount>0&&<span className="timelineWarningTag">{step.warningCount} warning{step.warningCount===1?'':'s'}</span>}</article>{idx<record.timeline.length-1&&<span className="timelineArrow">→</span>}</React.Fragment>)}</div><p className="muted small">{record.reason}</p></section>
}
function ScheduleWarningsPanel({warnings,maxItems=8,title='Schedule Warnings',subtitle='Informational only. Review and adjust the schedule where needed.',getActionLabel,onAction}:any){
  const items=(warnings||[]).slice(0,maxItems);
  const counts={critical:(warnings||[]).filter((w:any)=>w.level==='critical').length,capacity:(warnings||[]).filter((w:any)=>w.level==='capacity').length,info:(warnings||[]).filter((w:any)=>w.level==='info').length};
  function tone(level:string){return level==='critical'?'critical':level==='capacity'?'capacity':'info'}
  return <section className="scheduleWarningsPanel"><div className="scheduleWarningsHeader"><div><h3>{title}</h3><p className="muted">{subtitle}</p></div><div className="scheduleWarningCounts"><span className="warningCount critical">{counts.critical} critical</span><span className="warningCount capacity">{counts.capacity} capacity</span><span className="warningCount info">{counts.info} info</span></div></div><div className="warningList">{items.length===0?<p className="muted">No current schedule warnings.</p>:items.map((warning:any)=>{const actionLabel=getActionLabel?getActionLabel(warning):'';return <article key={warning.id} className={`warningCard ${tone(warning.level)}`}><div className="warningCardTop"><span className={`warningLevel ${tone(warning.level)}`}>{warning.level}</span>{warning.date&&<span className="warningDate">{fmtDate(warning.date)}</span>}</div><b>{warning.projectName}</b><span>{warning.partNumber} — {warning.description}</span><div className="warningMetaRow">{warning.employeeName&&<small>{warning.employeeName}</small>}{warning.phase&&<small>{phaseBadgeLabel(warning.phase)}</small>}</div><small>{warning.reason}</small>{actionLabel&&onAction&&<div className="warningActionRow"><button className="warningActionButton" onClick={()=>onAction(warning)}>{actionLabel}</button></div>}</article>})}</div>{(warnings||[]).length>items.length&&<p className="muted small">Showing {items.length} of {(warnings||[]).length} warnings.</p>}</section>
}
function EmployeePicker({data,value,onChange,row,phase='Build'}:any){const selected=splitIds(value);const visible=data?.employees?.filter((e:any)=>selected.includes(e.id)||(e.active!==false&&canEmployeeForPhase(e,phase)))||[];return <div className="empPick compactEmpPick employeePickerNoScroll"><div className="empPickGrid noScrollEmpGrid">{visible.map((e:any)=>{const eligible=e.active!==false&&canEmployeeForPhase(e,phase);return <label key={e.id} title={e.name} className={selected.includes(e.id)?'selectedEmpChip':''}><input type="checkbox" checked={selected.includes(e.id)} onChange={ev=>{const next=ev.target.checked?[...selected,e.id]:selected.filter((id:string)=>id!==e.id);onChange(next.join(','))}}/> <span>{e.name}</span>{e.active===false&&<small className="capNote">inactive</small>}{e.active!==false&&!eligible&&<small className="capNote">saved only</small>}</label>})}</div><div className="empPickActions"><button type="button" className="mini" onClick={()=>onChange(suggestEmployees(data,row?.id,1,phase).map((e:any)=>e.id).join(','))}>suggest 1</button><button type="button" className="mini" onClick={()=>onChange(suggestEmployees(data,row?.id,2,phase).map((e:any)=>e.id).join(','))}>suggest 2</button><button type="button" className="mini" onClick={()=>onChange('')}>clear</button></div></div>}
function Schedule({data,setData,schedule}:any){function changeAsm(id:string,patch:Partial<ProjectAssembly>){const source=String(id).split('|')[0];setData((d:any)=>({...d,projectAssemblies:d.projectAssemblies.map((a:any)=>a.id===source?{...a,...patch}:a)}))}return <div className="card"><h2>Master Schedule</h2><p className="muted">Project assemblies feed this schedule. Library items do not appear until added to a project.</p><div className="tablewrap"><table><thead><tr>{['Week','Project','Phase','Part #','#','Description','Deps','Employees','Start','Finish / Ship','Hours','Test','Inspection','Shipping','%','Status','Late','Assembly Ship By','Actions'].map(h=><th key={h}>{h}</th>)}</tr></thead><tbody>{schedule.map((r:any)=><tr key={r.id} className={r.isLate?'late':''}><td>{fmtDate(r.week)}</td><td>{r.projectName}</td><td>{r.phase||'Build'}</td><td>{r.partNumber}</td><td>{r.instanceLabel||''}</td><td>{r.description}</td><td>{r.dependencyNames}</td><td>{r.assignedEmployeeNames}</td><td>{fmtDate(r.scheduledStart)}</td><td>{fmtDate(r.scheduledEnd)}</td><td>{r.totalHours} total / {r.hoursPerEmployee.toFixed(1)} ea</td><td>{r.testRequired?`${r.testHours||0} hrs`:''}</td><td>{r.inspectionRequired?`${r.inspectionHours||0} hrs`:''}</td><td>{r.shippingRequired?`${r.shippingHours||0} hrs`:''}</td><td>{r.phase==='Build'?<><input className="tiny" type="number" value={r.percent||0} onChange={e=>changeAsm(r.id,{percent:Number(e.target.value)})}/><div className="muted">Overall {rolledCompletion(data,r)}%</div></>:<label className="checkLine"><input type="checkbox" checked={r.phase==='Inspection'?!!r.inspectionComplete:!!r.shippingComplete} onChange={e=>changeAsm(r.id,r.phase==='Inspection'?{inspectionComplete:e.target.checked}:{shippingComplete:e.target.checked})}/> Done</label>}</td><td><select value={r.status} onChange={e=>changeAsm(r.id,{status:e.target.value})}><option>Not Started</option><option>In Progress</option><option>Complete</option><option>On Hold</option></select></td><td>{r.isLate?'Yes':''}</td><td><StableDateInput type="date" value={r.shipDate||''} onCommit={(value:any)=>changeAsm(r.id,{shipDate:value})}/></td><td><button className="mini" onClick={()=>changeAsm(r.id,r.phase==='Inspection'?{inspectionComplete:true}:r.phase==='Shipping'?{shippingComplete:true}:{percent:100,status:'Complete'})}>Complete</button><button className="mini" onClick={()=>changeAsm(r.id,{shipDate:''})}>Clear</button></td></tr>)}</tbody></table></div></div>}
function WeeklyBoard({data,setData,schedule,warnings,projectHealthById,boardIntent,onOpenProject}:any){
 const splitDateList=(raw:string)=>splitIds(String(raw||''));
 const absenceLabel=(emp:any,date:string)=>{const h=(data.holidays||[]).find((x:any)=>x.date===date);if(h)return `Holiday: ${h.name||'Company Holiday'}`;if(splitDateList(emp.timeOffDates||emp.pto||'').includes(date))return 'Scheduled Out';return '';};
 const [selectedMonth,setSelectedMonth]=useState(()=>{const d=new Date();return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}`});
 const [boardSearch,setBoardSearch]=useState('');
 const [statusFilter,setStatusFilter]=useState('All');
 const [employeeFilter,setEmployeeFilter]=useState('All');
 const [hideComplete,setHideComplete]=useState(false);
	 const [capacitySuggestion,setCapacitySuggestion]=useState('');
	 const [boardDrafts,setBoardDrafts]=useState<any[]>([]);
	 const [boardMode,setBoardMode]=useState<'Current'|'Live'>('Current');
	 const [projectFocusId,setProjectFocusId]=useState('All');
	 const [hideOthers,setHideOthers]=useState(false);
	 const [boardDensity,setBoardDensity]=useState<'comfortable'|'compact'|'ultra'>('comfortable');
	 const [collapseEmptyRows,setCollapseEmptyRows]=useState(false);
	 const [highlightDate,setHighlightDate]=useState('');
	 const [showAutoAssignPreview,setShowAutoAssignPreview]=useState(false);
	 const [smartAssignOptions,setSmartAssignOptions]=useState({assignBlanksOnly:true,improveExistingUnlockedAssignments:true,balanceThisWeek:true,prioritizeShipDates:true,reduceOverloads:true});
	 const [smartAssignSelection,setSmartAssignSelection]=useState<string[]>([]);
	 const [lastAutoAssignRun,setLastAutoAssignRun]=useState<any|null>(null);
	 const [showAutoAssignResults,setShowAutoAssignResults]=useState(false);
	 const [recentAutoAssignedKeys,setRecentAutoAssignedKeys]=useState<string[]>([]);
	 const lastAutoScrollAt=useRef(0);
	 const autoScrollFrame=useRef<any>(null);
	 const autoScrollDelta=useRef(0);
 const activeEmployees=data.employees.filter((e:any)=>e.active);
 const visibleProjects=(data.projects||[]).filter((p:any)=>!p.archived);
 const autoAssignSuggestions=useMemo(()=>previewSmartAssignSuggestions(data,schedule,smartAssignOptions),[data,schedule,smartAssignOptions]);
 const autoAssignSuggestionMap=useMemo(()=>smartAssignSuggestionMapByAssemblyPhase(autoAssignSuggestions),[autoAssignSuggestions]);
 const actionableAutoAssign=autoAssignSuggestions.filter((suggestion:any)=>suggestion.status==='suggested');
 const keptAutoAssign=autoAssignSuggestions.filter((suggestion:any)=>suggestion.status==='kept');
 const lockedAutoAssign=autoAssignSuggestions.filter((suggestion:any)=>suggestion.status==='locked');
 const blockedAutoAssign=autoAssignSuggestions.filter((suggestion:any)=>suggestion.status==='blocked');
 const unassignedSuggestionCount=autoAssignSuggestions.filter((suggestion:any)=>suggestion.changeType==='assign').length;
 const unlockedImprovementCount=autoAssignSuggestions.filter((suggestion:any)=>suggestion.status==='suggested'&&suggestion.changeType==='reassign').length;
 const lockedTileCount=(data.projectAssemblies||[]).filter((assembly:any)=>assembly.locked||assembly.smartAssignProtected).length;
 const overloadCount=new Set((warnings||[]).filter((warning:any)=>warning.code==='over_capacity').map((warning:any)=>`${warning.employeeId||warning.employeeName}|${warning.date}`)).size;
 const autoAssignDiagnostics=useMemo(()=>({
   noQualified:blockedAutoAssign.filter((item:any)=>String(item.diagnostic||'').startsWith('no_qualified_')).length,
   noPreferred:blockedAutoAssign.filter((item:any)=>item.diagnostic==='no_preferred_employee_available').length,
   unavailable:blockedAutoAssign.filter((item:any)=>item.diagnostic==='employee_unavailable').length,
   overCapacity:blockedAutoAssign.filter((item:any)=>item.diagnostic==='over_capacity_smart_assign').length,
 }),[blockedAutoAssign]);
 const actionableSuggestionIds=actionableAutoAssign.map((suggestion:any)=>suggestion.id);
 const selectedSmartAssignCount=smartAssignSelection.filter((id:string)=>actionableAutoAssign.some((suggestion:any)=>suggestion.id===id)).length;
 function smartAssignToneFor(suggestion:any){
   if(suggestion.status==='suggested')return 'info';
   if(suggestion.status==='kept')return 'capacity';
   if(suggestion.status==='locked')return 'capacity';
   return 'critical';
 }
 function smartAssignResultToneFor(suggestion:any){
   if(suggestion.applyStatus==='applied')return 'info';
   if(suggestion.applyStatus==='skipped')return 'capacity';
   return 'critical';
 }
 useEffect(()=>{
   if(!showAutoAssignPreview)return;
   setSmartAssignSelection(actionableAutoAssign.map((suggestion:any)=>suggestion.id));
 },[showAutoAssignPreview,actionableAutoAssign]);
 useEffect(()=>{
   if(!recentAutoAssignedKeys.length)return;
   const timer=setTimeout(()=>setRecentAutoAssignedKeys([]),4200);
   return ()=>clearTimeout(timer);
 },[recentAutoAssignedKeys]);
 useEffect(()=>{if(boardIntent?.token){if(boardIntent.date){setSelectedMonth(String(boardIntent.date).slice(0,7));setHighlightDate(String(boardIntent.date).slice(0,10))}if(boardIntent.projectId)setProjectFocusId(boardIntent.projectId);setHideOthers(false)}},[boardIntent?.token]);
 function splitAssigned(s:string){return (s||'').split(',').map((x:string)=>x.trim()).filter(Boolean)}
 function pad(n:number){return String(n).padStart(2,'0')}
 function dateOnly(d:Date){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
 function mondayOf(d:Date){const x=new Date(d);const day=x.getDay()||7;x.setDate(x.getDate()-day+1);return x}
 function dateFor(week:string,idx:number){const d=new Date(week+'T00:00:00');d.setDate(d.getDate()+idx);return dateOnly(d)}
 function nextDate(date:string){const d=new Date(date+'T00:00:00');d.setDate(d.getDate()+1);return dateOnly(d)}
 function weeksForMonth(month:string){
   const [y,m]=month.split('-').map(Number);
   const first=new Date(y,m-1,1);const last=new Date(y,m,0);
   const now=new Date();const currentMonth=`${now.getFullYear()}-${pad(now.getMonth()+1)}`;
   let start=(month===currentMonth)?mondayOf(now):mondayOf(first);
   const out:string[]=[];let cursor=new Date(start);
   while(cursor<=last || out.length<4){out.push(dateOnly(cursor));cursor.setDate(cursor.getDate()+7);if(out.length>7)break;}
   return out;
 }
	 const weeks=weeksForMonth(selectedMonth);
	 const days=['Mon','Tue','Wed','Thu','Fri'];
	 const boardWarnings=(warnings||[]).filter((warning:any)=>{
	   const q=boardSearch.trim().toLowerCase();
	   const matchesMonth=!warning.date||String(warning.date).startsWith(selectedMonth);
	   const matchesQuery=!q||(`${warning.projectName||''} ${warning.partNumber||''} ${warning.description||''} ${warning.employeeName||''} ${warning.reason||''}`.toLowerCase().includes(q));
	   const matchesFocus=projectFocusId==='All'||warning.projectId===projectFocusId;
	   return matchesMonth&&matchesQuery&&matchesFocus;
	 });
	 function focusMatches(projectId:string){return projectFocusId==='All'||projectId===projectFocusId}
	 function shouldHideProject(projectId:string){return projectFocusId!=='All'&&hideOthers&&!focusMatches(projectId)}
	 function shouldDimProject(projectId:string){return projectFocusId!=='All'&&!focusMatches(projectId)}
	 function jumpToWarning(warning:any){if(warning.date){setSelectedMonth(String(warning.date).slice(0,7));setHighlightDate(String(warning.date).slice(0,10))}if(warning.projectId){setProjectFocusId(warning.projectId);setHideOthers(false)}}
	 function toggleFri(empId:string,date:string){if(boardMode==='Live')return;setData((d:any)=>({...d,employees:d.employees.map((e:any)=>{if(e.id!==empId)return e;const vals=splitIds(e.fridayOvertimeDates||'');const next=vals.includes(date)?vals.filter((x:string)=>x!==date):[...vals,date];return {...e,fridayOvertimeDates:next.join(',')}})}))}
 function isFri(date:string){return new Date(date+'T00:00:00').getDay()===5}
 function parseDragId(id:string){
   const raw=String(id||'');
   if(raw.includes('::chunk::')){
     const [scheduleKey, rest='']=raw.split('::chunk::');
     const [idxPart, hoursPart='']=rest.split('::hours::');
     const segmentIndex=idxPart!==''?Number(idxPart):null;
     const chunkHours=hoursPart!==''?Number(hoursPart):null;
     const sched=schedule.find((x:any)=>x.id===scheduleKey||x.scheduleId===scheduleKey);
     return {sourceId:sched?.sourceAssemblyId||String(scheduleKey).split('|')[0],phase:sched?.phase||String(scheduleKey).split('|')[1]||'Build',sched,segmentIndex,chunkHours};
   }
   const parts=raw.split('|chunk|');
   const base=parts[0];
   const segmentIndex=parts[1]!==undefined?Number(parts[1]):null;
   const sched=schedule.find((x:any)=>x.id===base||x.scheduleId===base);
   return {sourceId:sched?.sourceAssemblyId||base,phase:sched?.phase||'Build',sched,segmentIndex,chunkHours:null};
 }
	 function projectedEnd(id:string,employeeId:string,date:string){
	   const parsed=parseDragId(id); const s=parsed.sched||schedule.find((x:any)=>x.sourceAssemblyId===parsed.sourceId&&x.phase===parsed.phase); if(!s)return date;
	   let remaining=(parsed.segmentIndex!==null&&parsed.chunkHours)?Number(parsed.chunkHours):(Number(s.hoursPerEmployee)||Number(s.totalHours)||0); let cursor=date; let last=date; let guard=0;
	   while(remaining>0&&guard<180){const cap=employeeId?capacityForDate(data,employeeId,cursor):capacityForDate(data,'',cursor); if(cap>0){remaining-=Math.min(remaining,cap); last=cursor;} const d=new Date(cursor+'T00:00:00'); d.setDate(d.getDate()+1); cursor=dateOnly(d); guard++;}
	   return last;
	 }
	 function projectedFinalCompletion(id:string,employeeId:string,date:string){
	   const parsed=parseDragId(id);
	   const asm=data.projectAssemblies.find((a:any)=>a.id===parsed.sourceId);
	   if(!asm)return projectedEnd(id,employeeId,date);
	   const phase=parsed.phase||'Build';
	   let end=projectedEnd(id,employeeId,date);
	   if(phase==='Shipping')return end;
	   if(phase==='Build')end=earliestInspectionDateFor({...asm,id:asm.id,_projectedBuildEnd:end});
	   const inspection=schedule.find((x:any)=>(x.sourceAssemblyId||String(x.id).split('|')[0])===asm.id&&x.phase==='Inspection');
	   if(phase==='Build'&&inspection&&!asm.inspectionComplete){
	     const ids=splitAssigned(inspection.assignedTo);const hpe=Number(inspection.hoursPerEmployee)||Number(inspection.totalHours)||0;
	     end=projectedEnd(inspection.scheduleId||inspection.id,ids[0]||'',dateMax(inspection.scheduledStart,end));
	   }else if(phase==='Inspection'){
	     end=projectedEnd(id,employeeId,date);
	   }
	   const shipping=schedule.find((x:any)=>(x.sourceAssemblyId||String(x.id).split('|')[0])===asm.id&&x.phase==='Shipping');
	   if(shipping&&!asm.shippingComplete){
	     const ids=splitAssigned(shipping.assignedTo);
	     end=projectedEnd(shipping.scheduleId||shipping.id,ids[0]||'',dateMax(shipping.scheduledStart,end));
	   }
	   return end;
	 }
 function addShopWaitDays(startDate:string,hours:number){
   if((Number(hours)||0)<=0)return startDate;
   let remaining=Number(hours)||0;
   let d=new Date(startDate+'T00:00:00');
   d.setDate(d.getDate()+1);
   let guard=0;
   let last=dateOnly(d);
   while(remaining>0&&guard++<240){
     const ds=dateOnly(d);
     // Test is an external gate, but use the same Mon-Thu/holiday shop calendar.
     const isWeekend=[0,5,6].includes(d.getDay());
     const isHoliday=(data.holidays||[]).some((h:any)=>h.date===ds);
     if(!isWeekend&&!isHoliday){remaining-=10;last=ds;}
     d.setDate(d.getDate()+1);
   }
   return last;
 }
 function latestBuildChunkDate(asmId:string){
   const dates=chunks
     .filter((c:any)=>(c.sourceAssemblyId||String(c.id).split('|')[0])===asmId && (c.phase||'Build')==='Build')
     .map((c:any)=>c.chunkDate)
     .filter(Boolean)
     .sort();
   if(dates.length)return dates[dates.length-1];
   const build=schedule.find((x:any)=>(x.sourceAssemblyId||String(x.id).split('|')[0])===asmId&&(x.phase||'Build')==='Build');
   return build?.scheduledEnd||'';
 }
	 function earliestInspectionDateFor(asm:any){
	   const buildFinish=asm._projectedBuildEnd||latestBuildChunkDate(asm.id);
   if(!buildFinish)return '';
   const hasTest=!!asm.testRequired || Number(asm.testHours||0)>0;
   const manual=hasTest&&asm.testReturnDateTime?String(asm.testReturnDateTime).slice(0,10):'';
   const estimateHours=hasTest?Number(asm.testHours||0):0;
   let release=buildFinish;
   if(estimateHours>0){
     const testDone=addShopWaitDays(buildFinish,estimateHours);
     const next=new Date(testDone+'T00:00:00');
     next.setDate(next.getDate()+1);
     let guard=0;
     while(guard++<90){const ds=dateOnly(next);const isWeekend=[0,5,6].includes(next.getDay());const isHoliday=(data.holidays||[]).some((h:any)=>h.date===ds);if(!isWeekend&&!isHoliday){release=ds;break;}next.setDate(next.getDate()+1);}
   }
   if(manual)release=dateMax(release,manual);
   return release;
 }
 function canDrop(id:string,employeeId:string,date:string){
   const parsed=parseDragId(id);
   const asm=data.projectAssemblies.find((a:any)=>a.id===parsed.sourceId);
   if(!asm)return true;
   const top=asm.type==='Top Level Assembly'?asm:data.projectAssemblies.find((a:any)=>a.id===asm.parentAssemblyId)||data.projectAssemblies.find((a:any)=>a.buildGroupId&&a.buildGroupId===asm.buildGroupId&&a.type==='Top Level Assembly');
   if(asm.locked||top?.locked){alert('This assembly is locked. Unlock it before moving scheduled work.');return false;}
   if(employeeId&&capacityForDate(data,employeeId,date)<=0){const emp=data.employees.find((e:any)=>e.id===employeeId);alert(`${emp?.name||'That employee'} is not available on ${fmtDate(date)}. Remove the time off/holiday or choose another employee/date.`);return false;}
   const freeze=(data.settings as any)?.freezeBeforeDate||'';
   if(freeze&&date<=freeze){alert(`This date is in the frozen schedule window through ${fmtDate(freeze)}. Change the freeze date in Settings before moving work here.`);return false;}
   if((parsed.phase||'Build')==='Inspection'){
     const release=earliestInspectionDateFor(asm);
     if(release&&date<release){
       const testH=Number(asm.testHours||0);
       alert(`Inspection cannot start on ${fmtDate(date)}. This assembly is gated by test${testH?` (${testH} hrs)`:''} until ${fmtDate(release)}.`);
       return false;
     }
   }
   if((parsed.phase||'Build')==='Shipping'){
     const release=earliestInspectionDateFor(asm);
     const insp=schedule.find((x:any)=>(x.sourceAssemblyId||String(x.id).split('|')[0])===asm.id&&x.phase==='Inspection');
     const shipRelease=insp?dateMax(release,insp.scheduledEnd):release;
     if(shipRelease&&date<shipRelease){alert(`Shipping cannot start before upstream test/inspection is available on ${fmtDate(shipRelease)}.`);return false;}
   }
   const ship=top?.shipDate||asm.shipDate;
   const late=!!(top?.lateAllowed||asm.lateAllowed);
	   if(ship&&!late){const finish=projectedFinalCompletion(id,employeeId,date);if(finish>ship){alert(`This would make final shipping complete on ${fmtDate(finish)}, past the Ship By date ${fmtDate(ship)}. Check Late Allowed on the top level assembly first.`);return false;}}
   return true
 }
 function findParentTop(asm:any,rows:any[]){if(!asm||asm.type==='Top Level Assembly')return null;return rows.find((a:any)=>a.id===asm.parentAssemblyId)||rows.find((a:any)=>a.buildGroupId&&a.buildGroupId===asm.buildGroupId&&a.projectId===asm.projectId&&a.type==='Top Level Assembly')||null}
 function maybePushParentTop(rows:any[],sourceId:string,newSubFinish:string){
   const sub=rows.find((a:any)=>a.id===sourceId);
   const top=findParentTop(sub,rows);
   if(!top||!newSubFinish)return rows;
   const topSched=schedule.find((x:any)=>(x.sourceAssemblyId||String(x.id).split('|')[0])===top.id&&(x.phase||'Build')==='Build');
   const topStart=topSched?.scheduledStart||top.manualStartDate||top.shipDate||'';
   if(topStart&&newSubFinish>topStart){
     return rows.map((a:any)=>{
       if(a.id===top.id)return {...a,manualStartDate:newSubFinish,manuallyScheduled:true};
       if(a.id===top.id+'|inspection')return a;
       return a;
     });
   }
   return rows;
 }
	 function addBoardDraft(id:string,employeeId:string,date:string){
	   if(boardMode==='Live')return;
   if(!canDrop(id,employeeId,date))return;
   const parsed=parseDragId(id);
   setBoardDrafts((drafts:any[])=>[
     ...drafts.filter((d:any)=>!(d.sourceId===parsed.sourceId&&d.phase===parsed.phase&&Number(d.segmentIndex??-1)===Number(parsed.segmentIndex??-1))),
     {sourceId:parsed.sourceId,phase:parsed.phase,segmentIndex:parsed.segmentIndex,employeeId,date,chunkHours:parsed.chunkHours}
   ]);
 }
	 function drop(id:string,employeeId:string,date:string){addBoardDraft(id,employeeId,date)}
	 function unassignedDrop(id:string,date:string){addBoardDraft(id,'',date)}
	 function itemKey(x:any){return `${x.sourceAssemblyId||String(x.id).split('|')[0]}|${x.phase||'Build'}`}
	 function shopCapacity(empId:string,date:string){return empId?capacityForDate(data,empId,date):capacityForDate(data,'',date)}
	 function nextCapacityDate(date:string,empId:string,minDate=''){
	   let cursor=dateMax(date,minDate||date);let guard=0;
	   while(guard++<365){if(shopCapacity(empId,cursor)>0)return cursor;cursor=nextDate(cursor)}
	   return cursor;
	 }
	 function addWorkToForecast(out:any[],used:Record<string,number>,base:any,empId:string,start:string,hours:number,earliest=''){
	   let remaining=Math.max(0,Number(hours)||0);let cursor=nextCapacityDate(start,empId,earliest);let idx=0;let last=cursor;let moved=false;let guard=0;
	   while(remaining>0.01&&guard++<365){
	     const usedKey=`${empId}|${cursor}`;const cap=Math.max(0,shopCapacity(empId,cursor)-(used[usedKey]||0));
	     if(cap>0){
	       const hrs=Math.min(remaining,cap);
	       const wasMoved=cursor!==base.scheduledStart||!!earliest&&cursor>earliest;
	       out.push({...base,employeeChunkId:empId,chunkDate:cursor,chunkHours:hrs,chunkLabel:'Live',segmentIndex:idx++,isLive:true,forecastMoved:wasMoved||base.scheduledStart!==cursor,isLate:!!(base.shipDate&&cursor>base.shipDate&&!base.lateAllowed)});
	       used[usedKey]=(used[usedKey]||0)+hrs;remaining-=hrs;last=cursor;moved=moved||wasMoved;
	     }
	     if(remaining>0.01)cursor=nextDate(cursor);
	   }
	   return {end:last,moved};
	 }
	 function scheduleWait(start:string,hours:number){
	   let remaining=Math.max(0,Number(hours)||0);let cursor=nextDate(start);let last=start;let guard=0;
	   while(remaining>0.01&&guard++<365){
	     const d=new Date(cursor+'T00:00:00');const ds=dateOnly(d);
	     const weekend=[0,5,6].includes(d.getDay());const holiday=(data.holidays||[]).some((h:any)=>h.date===ds);
	     if(!weekend&&!holiday){remaining-=10;last=ds}
	     cursor=nextDate(cursor);
	   }
	   return last;
	 }
	 function releaseAfterBuild(asm:any,buildEnd:string){
	   const hasTest=!!asm?.testRequired||Number(asm?.testHours||0)>0;
	   if(!hasTest)return buildEnd;
	   const estimated=Number(asm?.testHours||0)>0?scheduleWait(buildEnd,Number(asm.testHours)||0):buildEnd;
	   const manual=asm?.testReturnDateTime?String(asm.testReturnDateTime).slice(0,10):'';
	   let release=manual?dateMax(estimated,manual):estimated;
	   if(Number(asm?.testHours||0)>0&&!manual)release=nextCapacityDate(nextDate(release),'');
	   return release;
	 }
	 function calculateLiveForecast(currentChunks:any[]){
	   const out:any[]=[];const used:Record<string,number>={};const buildEnds:Record<string,string>={};const phaseEnds:Record<string,string>={};const currentByKey:Record<string,any[]>={};
	   for(const c of currentChunks){const key=itemKey(c);if(!currentByKey[key])currentByKey[key]=[];currentByKey[key].push(c)}
	   const assemblies=[...(data.projectAssemblies||[])].sort((a:any,b:any)=>(a.type==='Sub Assembly'?-1:1)-(b.type==='Sub Assembly'?-1:1)||(a.shipDate||'').localeCompare(b.shipDate||''));
	   const buildItemFor=(asm:any)=>schedule.find((s:any)=>(s.sourceAssemblyId||String(s.id).split('|')[0])===asm.id&&(s.phase||'Build')==='Build');
	   const itemFor=(asm:any,phase:string)=>schedule.find((s:any)=>(s.sourceAssemblyId||String(s.id).split('|')[0])===asm.id&&s.phase===phase);
	   const childIdsFor=(top:any)=>(data.projectAssemblies||[]).filter((x:any)=>x.parentAssemblyId===top.id||((x.buildGroupId&&x.buildGroupId===top.buildGroupId)&&x.projectId===top.projectId&&x.type==='Sub Assembly')).map((x:any)=>x.id);
	   for(const asm of assemblies){
	     const build=buildItemFor(asm);if(!build)continue;
	     const held=asm.status==='On Hold'||!!asm.holdReason;
	     const ids=splitAssigned(build.assignedTo);
	     const percent=Math.max(0,Math.min(100,Number(asm.percent||0)));
	     const remainingTotal=(Number(build.totalHours)||0)*(1-percent/100);
	     let earliest=build.scheduledStart;
	     if(asm.type==='Top Level Assembly'){
	       for(const childId of childIdsFor(asm)){if(buildEnds[childId])earliest=dateMax(earliest,buildEnds[childId])}
	     }
	     if(held){
	       const baseChunks=currentByKey[itemKey(build)]||[{...build,employeeChunkId:ids[0]||'',chunkDate:build.scheduledStart,chunkHours:Number(build.hoursPerEmployee)||Number(build.totalHours)||0,segmentIndex:0}];
	       for(const c of baseChunks)out.push({...c,chunkLabel:'Live Hold',isLive:true,forecastBlocked:true,forecastMoved:false,isLate:!!(c.shipDate&&c.chunkDate>c.shipDate&&!c.lateAllowed)});
	       buildEnds[asm.id]=build.scheduledEnd;phaseEnds[asm.id+'|Build']=build.scheduledEnd;continue;
	     }
	     if(remainingTotal<=0.01){buildEnds[asm.id]=build.scheduledEnd;phaseEnds[asm.id+'|Build']=build.scheduledEnd;continue;}
	     let latest=earliest;
	     const assignees=ids.length?ids:[''];
	     for(const empId of assignees){
	       const hpe=remainingTotal/assignees.length;
	       const r=addWorkToForecast(out,used,build,empId,build.scheduledStart,hpe,earliest);
	       latest=dateMax(latest,r.end);
	     }
	     buildEnds[asm.id]=latest;phaseEnds[asm.id+'|Build']=latest;
	   }
	   for(const asm of assemblies){
	     const buildEnd=buildEnds[asm.id]||buildItemFor(asm)?.scheduledEnd||asm.shipDate||'';
	     let release=releaseAfterBuild(asm,buildEnd);
	     const inspection=itemFor(asm,'Inspection');
	     if(inspection&&!asm.inspectionComplete){
	       const ids=splitAssigned(inspection.assignedTo);let latest=release;
	       for(const empId of (ids.length?ids:[''])){const r=addWorkToForecast(out,used,inspection,empId,inspection.scheduledStart,Number(inspection.hoursPerEmployee)||Number(inspection.totalHours)||0,release);latest=dateMax(latest,r.end)}
	       phaseEnds[asm.id+'|Inspection']=latest;release=latest;
	     }else if(inspection){phaseEnds[asm.id+'|Inspection']=inspection.scheduledEnd;release=dateMax(release,inspection.scheduledEnd)}
	     const shipping=itemFor(asm,'Shipping');
	     if(shipping&&!asm.shippingComplete){
	       const ids=splitAssigned(shipping.assignedTo);let latest=release;
	       for(const empId of (ids.length?ids:[''])){const r=addWorkToForecast(out,used,shipping,empId,shipping.scheduledStart,Number(shipping.hoursPerEmployee)||Number(shipping.totalHours)||0,release);latest=dateMax(latest,r.end)}
	       phaseEnds[asm.id+'|Shipping']=latest;
	     }
	   }
	   return out.map((c:any)=>({...c,forecastMoved:c.forecastMoved||((currentByKey[itemKey(c)]||[]).some((x:any)=>x.employeeChunkId===c.employeeChunkId&&x.chunkDate!==c.chunkDate)),isLate:!!(c.shipDate&&c.chunkDate>c.shipDate&&!c.lateAllowed)}));
	 }
	 function buildChunks(){
   const chunks:any[]=[];
   for(const s of schedule){
     const source=data.projectAssemblies.find((a:any)=>a.id===(s.sourceAssemblyId||String(s.id).split('|')[0]));
     const manualSegments=(s.phase==='Build'&&Array.isArray(source?.manualWorkSegments))?source.manualWorkSegments.filter((seg:any)=>(seg.phase||'Build')==='Build'&&Number(seg.hours)>0):[];
     if(manualSegments.length){
       manualSegments.forEach((seg:any,idx:number)=>chunks.push({...s,employeeChunkId:seg.employeeId||'',chunkDate:seg.date,chunkHours:Number(seg.hours)||0,chunkLabel:'Manual',segmentIndex:idx,manualSegmentId:seg.id}));
       continue;
     }
     const ids=splitAssigned(s.assignedTo);
     if(!ids.length){
       let date=s.scheduledStart;let remaining=Number(s.hoursPerEmployee)||Number(s.totalHours)||0;let guard=0;let idx=0;
       while(remaining>0&&guard<120){const cap=capacityForDate(data,'',date);if(cap>0){const hrs=Math.min(remaining,cap);chunks.push({...s,segmentIndex:idx++,employeeChunkId:'',chunkDate:date,chunkHours:hrs,chunkLabel:remaining>hrs?'Partial':'Final'});remaining-=hrs;}date=nextDate(date);guard++;}
     }else{
       for(const empId of ids){let date=s.scheduledStart;let remaining=Number(s.hoursPerEmployee)||0;let guard=0;let idx=0;
        while(remaining>0&&guard<120){const cap=capacityForDate(data,empId,date);if(cap>0){const hrs=Math.min(remaining,cap);chunks.push({...s,employeeChunkId:empId,chunkDate:date,chunkHours:hrs,chunkLabel:remaining>hrs?'Partial':'Final',segmentIndex:idx++});remaining-=hrs;}date=nextDate(date);guard++;}
       }
     }
   }
   return chunks;
 }
 function defaultSegmentsFor(sourceId:string,phase:string){
   return chunks.filter((c:any)=>(c.sourceAssemblyId||String(c.id).split('|')[0])===sourceId&&(c.phase||'Build')===phase)
     .map((c:any,i:number)=>({id:c.manualSegmentId||`seg_${Date.now()}_${i}`,employeeId:c.employeeChunkId||'',date:c.chunkDate,hours:Number(c.chunkHours)||0,phase}));
 }
 function moveChunk(id:string,employeeId:string,date:string){
   const parsed=parseDragId(id);
   if(parsed.phase!=='Build'||parsed.segmentIndex===null){drop(id,employeeId,date);return;}
   if(!canDrop(id,employeeId,date))return;
   const sourceNow=data.projectAssemblies.find((a:any)=>a.id===parsed.sourceId);
   const currentSegments=Array.isArray(sourceNow?.manualWorkSegments)&&sourceNow.manualWorkSegments.length
     ? sourceNow.manualWorkSegments
     : defaultSegmentsFor(parsed.sourceId,parsed.phase);
   const draftAdjusted=currentSegments.map((seg:any,idx:number)=>{
     const d=boardDrafts.find((x:any)=>x.sourceId===parsed.sourceId&&x.phase==='Build'&&Number(x.segmentIndex)===idx);
     return d?{...seg,employeeId:d.employeeId,date:d.date}:seg;
   });
   const duplicateSameEmployeeDay=draftAdjusted.some((seg:any,idx:number)=>
     idx!==parsed.segmentIndex &&
     (seg.phase||'Build')==='Build' &&
     (seg.employeeId||'')===(employeeId||'') &&
     seg.date===date
   );
   if(duplicateSameEmployeeDay){
     alert('This assembly already has a work block on that employee for that day. Put the block on a different employee or a different day.');
     return;
   }
   addBoardDraft(id,employeeId,date);
 }
	 function applyBoardDrafts(){
	   if(boardMode==='Live')return;
   if(!boardDrafts.length)return;
   setData((d:any)=>{
     let rows=d.projectAssemblies;
     for(const draft of boardDrafts){
       rows=rows.map((a:any)=>{
         if(a.id!==draft.sourceId)return a;
         if(draft.phase==='Inspection')return {...a,inspectionAssignedTo:draft.employeeId,inspectionManualStartDate:draft.date};
         if(draft.phase==='Shipping')return {...a,shippingAssignedTo:draft.employeeId,shippingManualStartDate:draft.date};
         const existing=Array.isArray(a.manualWorkSegments)&&a.manualWorkSegments.length?a.manualWorkSegments:defaultSegmentsFor(draft.sourceId,draft.phase);
         const idx=Number.isFinite(Number(draft.segmentIndex))?Number(draft.segmentIndex):0;
         let segs:any[]=existing.map((seg:any)=>({...seg}));
         if(draft.splitMove){
           const original=segs[idx]||{id:`seg_${Date.now()}_${idx}`,employeeId:a.assignedTo||'',date:a.manualStartDate||a.shipDate||'',hours:Number(draft.chunkHours)||0,phase:'Build'};
           const moveHours=Math.max(0,Number(draft.chunkHours)||0);
           const originalHours=Math.max(0,Number(original.hours)||0);
           if(moveHours>=originalHours-0.01){
             segs[idx]={...original,employeeId:draft.employeeId,date:draft.date,hours:moveHours,phase:'Build'};
           }else{
             segs[idx]={...original,hours:originalHours-moveHours,phase:'Build'};
             segs.push({id:`seg_${Date.now()}_${Math.random().toString(36).slice(2,7)}`,employeeId:draft.employeeId,date:draft.date,hours:moveHours,phase:'Build'});
           }
         }else{
           segs=segs.map((seg:any,i:number)=>i===idx?{...seg,employeeId:draft.employeeId,date:draft.date}:seg);
         }
         return {...a,assignedTo:draft.employeeId||a.assignedTo,manualWorkSegments:segs,manuallyScheduled:true};
       });
       if(draft.phase==='Build')rows=maybePushParentTop(rows,draft.sourceId,draft.date);
     }
     return {...d,projectAssemblies:rows};
   });
   setBoardDrafts([]);
 }
 function discardBoardDrafts(){setBoardDrafts([])}
 function applyAutoAssignSuggestions(selectionIds:string[]=smartAssignSelection){
  if(boardMode==='Live')return;
  const chosenIds=Array.from(new Set((selectionIds||[]).filter(Boolean)));
  if(!chosenIds.length)return;
  const result=applySmartAssignSuggestionsToData(data,chosenIds,autoAssignSuggestions,schedule);
  if(result.applied.length) setData(result.data);
  const lockedSkipped=result.skipped.filter((item:any)=>/locked/i.test(String(item.applyReason||''))).length;
  const protectedSkipped=result.skipped.filter((item:any)=>/manual-protected/i.test(String(item.applyReason||''))).length;
  setRecentAutoAssignedKeys(result.appliedKeys);
  setLastAutoAssignRun({
    ...result,
    kept:keptAutoAssign,
    previewLocked:lockedAutoAssign,
    previewBlocked:blockedAutoAssign,
    counts:{
      applied:result.applied.length,
      skipped:result.skipped.length,
      failed:result.failed.length,
      added:result.applied.filter((item:any)=>item.changeType==='assign').length,
      changed:result.applied.filter((item:any)=>item.changeType==='reassign').length,
      unchanged:keptAutoAssign.length,
      lockedSkipped,
      protectedSkipped,
      previewLocked:lockedAutoAssign.length,
      previewBlocked:blockedAutoAssign.length,
      noQualified:blockedAutoAssign.filter((item:any)=>String(item.diagnostic||'').startsWith('no_qualified_')).length,
      noPreferred:blockedAutoAssign.filter((item:any)=>item.diagnostic==='no_preferred_employee_available').length,
      unavailable:blockedAutoAssign.filter((item:any)=>item.diagnostic==='employee_unavailable').length,
      overCapacity:blockedAutoAssign.filter((item:any)=>item.diagnostic==='over_capacity_smart_assign').length,
      overloadsResolved:result.applied.filter((item:any)=>item.overloadResolved).length,
      overloadsRemaining:blockedAutoAssign.filter((item:any)=>item.diagnostic==='over_capacity_smart_assign').length,
    },
  });
  setShowAutoAssignResults(true);
  setShowAutoAssignPreview(false);
  setSmartAssignSelection([]);
 }
	 function clearSegments(sourceId:string){if(boardMode==='Live')return;setData((d:any)=>({...d,projectAssemblies:d.projectAssemblies.map((a:any)=>a.id===sourceId?{...a,manualWorkSegments:[],manuallyScheduled:false}:a)}))}
 function overlayBoardDrafts(list:any[]){
   if(!boardDrafts.length)return list;
   return list.map((c:any)=>{
     const sourceId=c.sourceAssemblyId||String(c.id).split('|')[0];
     const phase=c.phase||'Build';
     const draft=boardDrafts.find((d:any)=>d.sourceId===sourceId&&d.phase===phase&&Number(d.segmentIndex??-1)===Number(c.segmentIndex??-1));
     return draft?{...c,employeeChunkId:draft.employeeId,chunkDate:draft.date,chunkLabel:'Draft'}:c;
   });
 }
	 const currentChunks=overlayBoardDrafts(buildChunks());
	 const rawChunks=boardMode==='Live'?calculateLiveForecast(buildChunks()):currentChunks;
 function cardStatus(s:any){const src=sourceAssembly(s.sourceAssemblyId||String(s.id).split('|')[0])||s;if(src.holdReason||src.status==='On Hold')return 'Blocked';if(s.isLate)return 'Late';if((s.phase||'Build')==='Shipping'&&src.shippingComplete)return 'Shipped';if((s.phase||'Build')==='Build'&&Number(src.percent||0)>=100)return 'Build Complete';if(src.shipDate){const days=(new Date(src.shipDate+'T00:00:00').getTime()-new Date((new Date()).toISOString().slice(0,10)+'T00:00:00').getTime())/86400000;if(days<=5&&Number(src.percent||0)<90)return 'At Risk';}return 'Scheduled'}
 function chunkProjectId(chunk:any){return (sourceAssembly(chunk.sourceAssemblyId||String(chunk.id).split('|')[0])||chunk)?.projectId||chunk?.projectId||''}
 const chunks=rawChunks.filter((s:any)=>{const q=boardSearch.trim().toLowerCase();const src=sourceAssembly(s.sourceAssemblyId||String(s.id).split('|')[0])||s;const hay=`${s.projectName||''} ${src.partNumber||''} ${src.description||''} ${src.instanceLabel||''}`.toLowerCase();const status=cardStatus(s);const pct=phasePercentFor(s.sourceAssemblyId||String(s.id).split('|')[0],s.phase||'Build',s);const completed=status==='Shipped'||status==='Build Complete'||pct>=100;const projectId=chunkProjectId(s);return (!q||hay.includes(q))&&(statusFilter==='All'||status===statusFilter)&&(!hideComplete||!completed)&&!shouldHideProject(projectId);});
 const boardEmployees=employeeFilter==='All'?activeEmployees:activeEmployees.filter((e:any)=>e.id===employeeFilter);
 function cardsFor(empId:string,date:string){return chunks.filter((s:any)=>s.chunkDate===date&&s.employeeChunkId===empId)}
 function unassignedFor(date:string){return chunks.filter((s:any)=>s.chunkDate===date&&!s.employeeChunkId)}
 function testItemsFor(date:string){
   const rows:any[]=[];
   for(const asm of (data.projectAssemblies||[])){
     const hasTest=!!asm.testRequired||Number(asm.testHours||0)>0||!!asm.testReturnDateTime;
     if(!hasTest||asm.inspectionComplete||asm.shippingComplete)continue;
     const buildEnd=latestBuildChunkDate(asm.id)||schedule.find((x:any)=>(x.sourceAssemblyId||String(x.id).split('|')[0])===asm.id&&(x.phase||'Build')==='Build')?.scheduledEnd||'';
     if(!buildEnd)continue;
     const estimated=Number(asm.testHours||0)>0?addShopWaitDays(buildEnd,Number(asm.testHours||0)):buildEnd;
     const manual=asm.testReturnDateTime?String(asm.testReturnDateTime).slice(0,10):'';
     const testEnd=dateMax(estimated,manual||estimated);
     if(date>buildEnd&&date<=testEnd)rows.push(asm);
   }
   return rows.filter((assembly:any)=>!shouldHideProject(assembly.projectId||'')).sort((a:any,b:any)=>(a.shipDate||'').localeCompare(b.shipDate||'')||(a.partNumber||'').localeCompare(b.partNumber||''));
 }
 const labelColumnWidth=boardDensity==='ultra'?138:boardDensity==='compact'?160:190;
 const dayColumnWidth=boardDensity==='ultra'?170:boardDensity==='compact'?190:230;
 function weekDates(week:string){return days.map((_:string,idx:number)=>dateFor(week,idx))}
 function weekHasEmployeeWork(week:string,employeeId:string){return weekDates(week).some((date:string)=>cardsFor(employeeId,date).length>0)}
 function weekHasUnassigned(week:string){return weekDates(week).some((date:string)=>unassignedFor(date).length>0)}
 function weekHasTests(week:string){return weekDates(week).some((date:string)=>testItemsFor(date).length>0)}
 function visibleEmployeesForWeek(week:string){return boardEmployees.filter((emp:any)=>!collapseEmptyRows||employeeFilter!=='All'||weekHasEmployeeWork(week,emp.id))}
	 function autoScrollDuringDrag(e:any){
	   const y=Number(e.clientY||0);
	   if(!y){stopAutoScroll();return;}
	   const edge=72;
	   const maxSpeed=8;
	   const topDistance=y;
	   const bottomDistance=window.innerHeight-y;
	   let delta=0;
   if(topDistance<edge){
     const strength=(edge-topDistance)/edge;
	     delta=-Math.max(2,Math.round(maxSpeed*strength));
	   }else if(bottomDistance<edge){
	     const strength=(edge-bottomDistance)/edge;
	     delta=Math.max(2,Math.round(maxSpeed*strength));
	   }
	   autoScrollDelta.current=delta;
	   if(delta===0){stopAutoScroll();return;}
	   if(autoScrollFrame.current)return;
	   const tick=()=>{
	     if(!autoScrollDelta.current){autoScrollFrame.current=null;return;}
	     const now=Date.now();
	     if(now-lastAutoScrollAt.current>24){
	       const scroller=document.scrollingElement||document.documentElement;
	       scroller.scrollBy({top:autoScrollDelta.current,left:0,behavior:'auto'});
	       lastAutoScrollAt.current=now;
	     }
	     autoScrollFrame.current=requestAnimationFrame(tick);
	   };
	   autoScrollFrame.current=requestAnimationFrame(tick);
	 }
	 function stopAutoScroll(){autoScrollDelta.current=0;if(autoScrollFrame.current){cancelAnimationFrame(autoScrollFrame.current);autoScrollFrame.current=null;}}
	 function boardDragOver(e:any){
	   if(boardMode==='Live')return;
   e.preventDefault();
   if(e.dataTransfer)e.dataTransfer.dropEffect='move';
   autoScrollDuringDrag(e);
 }
	 function updateCompletion(sourceId:string,phase:string,value:any){
	   if(boardMode==='Live')return;
   const pct=Math.max(0,Math.min(100,Number(value)||0));
   setData((d:any)=>({...d,projectAssemblies:d.projectAssemblies.map((a:any)=>{
     if(a.id!==sourceId)return a;
     if(phase==='Inspection')return {...a,inspectionComplete:pct>=100};
     if(phase==='Shipping')return {...a,shippingComplete:pct>=100};
     return {...a,...syncAssemblyPercentStatus(a,{percent:pct})};
   })}))
 }
 function sourceAssembly(sourceId:string){return (data.projectAssemblies||[]).find((a:any)=>a.id===sourceId)}
 function phasePercentFor(sourceId:string,phase:string,fallback:any){
   const a=sourceAssembly(sourceId)||fallback;
   if(phase==='Inspection')return a.inspectionComplete?100:0;
   if(phase==='Shipping')return a.shippingComplete?100:0;
   return Math.max(0,Math.min(100,Number(a.percent||0)));
 }
	 function toggleLock(sourceId:string){if(boardMode==='Live')return;setData((d:any)=>({...d,projectAssemblies:d.projectAssemblies.map((a:any)=>a.id===sourceId?{...a,locked:!a.locked}:a)}))}
 function findOpenCapacity(){
   const openings:any[]=[];
   for(const w of weeks){for(let idx=0;idx<days.length;idx++){const date=dateFor(w,idx);for(const e of activeEmployees){const cap=capacityForDate(data,e.id,date);if(cap<=0)continue;const used=chunks.filter((c:any)=>c.employeeChunkId===e.id&&c.chunkDate===date).reduce((n:number,c:any)=>n+(Number(c.chunkHours)||0),0);const open=cap-used;if(open>0.1)openings.push(`${fmtDate(date)} · ${e.name}: ${open.toFixed(1)} open hrs`);}}}
   setCapacitySuggestion(openings.slice(0,12).join('\n')||'No open capacity found in the visible month.');
 }
 function suggestMoveForSelection(){
   const overloadedCells:any[]=[];
   for(const w of weeks){for(let idx=0;idx<days.length;idx++){const date=dateFor(w,idx);for(const e of activeEmployees){const cap=capacityForDate(data,e.id,date);const used=chunks.filter((c:any)=>c.employeeChunkId===e.id&&c.chunkDate===date).reduce((n:number,c:any)=>n+(Number(c.chunkHours)||0),0);if(used>cap)overloadedCells.push(`${fmtDate(date)} · ${e.name}: ${(used-cap).toFixed(1)} hrs over`);}}}
   setCapacitySuggestion(overloadedCells.length?('Overloaded cells to fix first:\n'+overloadedCells.slice(0,12).join('\n')):'No overloaded cells in this visible month. Use Find open capacity to see open spots.');
 }

 function addDaysToDate(date:string,n:number){const d=new Date(date+'T00:00:00');d.setDate(d.getDate()+n);return dateOnly(d)}
 function dateMax(a:string,b:string){return a>b?a:b}
 function balanceTargetSafe(chunk:any,employeeId:string,date:string,planned:any[]){
   const sourceId=chunk.sourceAssemblyId||String(chunk.id).split('|')[0];
   const asm=data.projectAssemblies.find((a:any)=>a.id===sourceId);
   const top=asm?.type==='Top Level Assembly'?asm:data.projectAssemblies.find((a:any)=>a.id===asm?.parentAssemblyId)||data.projectAssemblies.find((a:any)=>a.buildGroupId&&a.buildGroupId===asm?.buildGroupId&&a.type==='Top Level Assembly');
   if(asm?.locked||top?.locked)return false;
   if(capacityForDate(data,employeeId,date)<=0)return false;
   const freeze=(data.settings as any)?.freezeBeforeDate||'';
   if(freeze&&date<=freeze)return false;
   const ship=top?.shipDate||asm?.shipDate;
   const late=!!(top?.lateAllowed||asm?.lateAllowed);
   if(ship&&!late&&date>ship)return false;
   const sameAlready=chunks.some((c:any)=>(c.sourceAssemblyId||String(c.id).split('|')[0])===sourceId&&c.employeeChunkId===employeeId&&c.chunkDate===date);
   const samePlanned=planned.some((d:any)=>d.sourceId===sourceId&&d.employeeId===employeeId&&d.date===date);
   return !sameAlready&&!samePlanned;
 }
 function openHoursForTarget(employeeId:string,date:string,planned:any[]){
   const cap=capacityForDate(data,employeeId,date);
   if(cap<=0)return 0;
   const used=chunks.filter((c:any)=>c.employeeChunkId===employeeId&&c.chunkDate===date).reduce((n:number,c:any)=>n+(Number(c.chunkHours)||0),0);
   const alreadyDrafted=boardDrafts.filter((d:any)=>d.employeeId===employeeId&&d.date===date).reduce((n:number,d:any)=>n+(Number(d.chunkHours)||0),0);
   const plannedHours=planned.filter((d:any)=>d.employeeId===employeeId&&d.date===date).reduce((n:number,d:any)=>n+(Number(d.chunkHours)||0),0);
   return Math.max(0,cap-used-alreadyDrafted-plannedHours);
 }
 function findOpeningsForChunk(chunk:any,avoidEmployeeId:string,avoidDate:string,needed:number,planned:any[]){
   const out:any[]=[];
   const today=dateOnly(new Date());
   const weekStart=dateOnly(mondayOf(new Date(avoidDate+'T00:00:00')));
   const start=dateMax(today,weekStart);
   const end=addDaysToDate(avoidDate,28);
   let cursor=start; let guard=0;
   while(cursor<=end&&guard<60&&needed>0.01){
     const day=new Date(cursor+'T00:00:00').getDay();
     if(day!==0&&day!==6){
       for(const emp of activeEmployees){
         if(emp.id===avoidEmployeeId&&cursor===avoidDate)continue;
         if(!balanceTargetSafe(chunk,emp.id,cursor,planned))continue;
         const open=openHoursForTarget(emp.id,cursor,planned);
         if(open>0.01){
           const hrs=Math.min(open,needed);
           out.push({employeeId:emp.id,date:cursor,hours:hrs});
           needed-=hrs;
           if(needed<=0.01)break;
         }
       }
     }
     cursor=addDaysToDate(cursor,1); guard++;
   }
   return out;
 }
 function previewBalanceThisWeek(){
   const today=dateOnly(new Date());
   const end=addDaysToDate(today,6);
   const drafts:any[]=[];
   const notes:string[]=[];
   for(const w of weeks){for(let idx=0;idx<days.length;idx++){const date=dateFor(w,idx);if(date<today||date>end)continue;for(const e of activeEmployees){
     const cellChunks=chunks.filter((c:any)=>c.employeeChunkId===e.id&&c.chunkDate===date).sort((a:any,b:any)=>(Number(b.chunkHours)||0)-(Number(a.chunkHours)||0));
     const cap=capacityForDate(data,e.id,date);
     let used=cellChunks.reduce((n:number,c:any)=>n+(Number(c.chunkHours)||0),0);
     if(used<=cap+0.01)continue;
     let excess=used-cap;
     for(const moving of cellChunks){
       if(excess<=0.01)break;
       const sourceId=moving.sourceAssemblyId||String(moving.id).split('|')[0];
       const phase=moving.phase||'Build';
       if(phase!=='Build')continue;
       const availableFromChunk=Number(moving.chunkHours)||0;
       const moveNeed=Math.min(availableFromChunk,excess);
       const openings=findOpeningsForChunk(moving,e.id,date,moveNeed,drafts);
       let moved=0;
       for(const open of openings){
         if(open.hours<=0.01)continue;
         drafts.push({sourceId,phase,segmentIndex:moving.segmentIndex,employeeId:open.employeeId,date:open.date,chunkHours:open.hours,splitMove:true});
         moved+=open.hours;
         excess-=open.hours;
         used-=open.hours;
         if(excess<=0.01)break;
       }
       if(moved>0){
         const empName=data.employees.find((x:any)=>x.id===e.id)?.name||'Employee';
         notes.push(`${empName} ${fmtDate(date)}: moved ${moved.toFixed(1)} hrs from an overloaded ${availableFromChunk.toFixed(1)} hr block`);
       }
     }
   }}}
   if(!drafts.length){setCapacitySuggestion('No safe balance moves found for this week. Check locked work, ship dates, employee time off, or filters.');return;}
   setBoardDrafts((prev:any[])=>[...prev,...drafts]);
   setCapacitySuggestion(`Preview Smart Assign rebalance added ${drafts.length} draft move${drafts.length===1?'':'s'}. It can split oversized blocks when only partial open capacity is available.\n${notes.slice(0,8).join('\n')}\nReview the board, then click Apply Changes or Discard Changes.`);
 }
 function exportNextYearWeeklyPdf(){
   const weeksOut:string[]=[]; let cursor=mondayOf(new Date());
   for(let i=0;i<52;i++){weeksOut.push(dateOnly(cursor));cursor.setDate(cursor.getDate()+7);}
   const esc=(v:any)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
   const employeesForPrint=activeEmployees;
   const taskHtml=(c:any)=>{const src=sourceAssembly(c.sourceAssemblyId||String(c.id).split('|')[0])||c;const proj=(data.projects||[]).find((p:any)=>p.id===(src.projectId||c.projectId));return `<div class="pdfTask phase-${esc(String(c.phase||'Build').toLowerCase())}"><b>${esc(src.description||c.description)}</b><span>${esc(proj?.projectId||c.projectName||'')}</span><small>${esc(String(c.phase||'Build'))} · P/N ${esc(src.partNumber||c.partNumber)} · ${Number(c.chunkHours||0).toFixed(1)} hrs</small></div>`;};
   const boardFor=(week:string)=>{
     const weekEnd=dateFor(week,days.length-1);
     const dayHeaders=days.map((d,idx)=>`<div class="pdfHeader"><b>${d}</b><span>${fmtDate(dateFor(week,idx))}</span></div>`).join('');
     const rows=employeesForPrint.map((emp:any)=>{
       const cells=days.map((d,idx)=>{const date=dateFor(week,idx);const dayCards=chunks.filter((c:any)=>c.chunkDate===date&&c.employeeChunkId===emp.id);return `<div class="pdfCell">${dayCards.map(taskHtml).join('')}</div>`}).join('');
       return `<div class="pdfEmp"><b>${esc(emp.name)}</b><span>${esc(emp.skills||'')}</span></div>${cells}`;
     }).join('');
     const unassigned=days.map((d,idx)=>{const date=dateFor(week,idx);const dayCards=chunks.filter((c:any)=>c.chunkDate===date&&!c.employeeChunkId);return `<div class="pdfCell">${dayCards.map(taskHtml).join('')}</div>`}).join('');
     return `<section class="pdfWeek"><div class="pdfWeekHeader"><h2>Week of ${fmtDate(week)}</h2><span>${fmtDate(week)} - ${fmtDate(weekEnd)}</span></div><div class="pdfGrid"><div class="pdfHeader empHead">Employee</div>${dayHeaders}${rows}<div class="pdfEmp"><b>Unassigned</b><span>Needs assignment</span></div>${unassigned}</div></section>`;
   };
   const html=`<!doctype html><html><head><title>Weekly Board - Next Year</title><style>@page{size:landscape;margin:.22in}*{box-sizing:border-box}body{font-family:Arial,sans-serif;color:#172033;margin:0;font-size:8px}h1{font-size:16px;margin:0 0 10px}.pdfWeek{break-after:page;page-break-after:always;break-inside:avoid;margin-bottom:10px}.pdfWeek:last-child{break-after:auto;page-break-after:auto}.pdfWeekHeader{display:flex;justify-content:space-between;align-items:center;padding:6px 8px;background:#e9eef2;border:1px solid #aeb8c4;border-bottom:0}.pdfWeekHeader span{font-size:9px;color:#526071;font-weight:700}.pdfWeekHeader h2{font-size:13px;margin:0}.pdfGrid{display:grid;grid-template-columns:112px repeat(${days.length},1fr);border-left:1px solid #aeb8c4;border-top:1px solid #aeb8c4}.pdfHeader,.pdfEmp,.pdfCell{border-right:1px solid #aeb8c4;border-bottom:1px solid #aeb8c4;padding:4px;min-height:34px}.pdfHeader{background:#eef2f5;font-weight:800;text-align:center}.pdfHeader span,.pdfEmp span,.pdfTask span,.pdfTask small{display:block;color:#536173;margin-top:1px}.pdfEmp{background:#f7f9fb;font-weight:800}.pdfCell{min-height:92px;background:#fff;vertical-align:top}.pdfTask{border:1px solid #b8c2cc;border-left:4px solid #6f8798;border-radius:5px;margin:2px 0;padding:3px;background:#fff;break-inside:avoid;page-break-inside:avoid}.pdfTask.phase-build{border-left-color:#6f8798}.pdfTask.phase-inspection{border-left-color:#d97706}.pdfTask.phase-shipping{border-left-color:#0891b2}.pdfTask b{display:block;font-size:8.5px;line-height:1.2}</style></head><body><h1>Weekly Board Export - Next 52 Weeks</h1>${weeksOut.map(boardFor).join('')}</body></html>`;
   const win=window.open('','_blank'); if(!win){alert('Popup blocked. Allow popups to export PDF.');return;} win.document.write(html); win.document.close(); setTimeout(()=>win.print(),500);
  }
 function exportWeeklyExcel(){
   const esc=(v:any)=>String(v??'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
   const weekTables=weeks.map((week:string)=>{
     const weekEnd=dateFor(week,days.length-1);
     const rows=[['Date','Employee','Project ID','Task Type','Part Number','Instance','Description','Hours','Percent Complete','Ship By']];
     for(const c of chunks.filter((chunk:any)=>chunk.chunkDate>=week&&chunk.chunkDate<=weekEnd)){
       const src=sourceAssembly(c.sourceAssemblyId||String(c.id).split('|')[0])||c;
       const emp=activeEmployees.find((e:any)=>e.id===c.employeeChunkId)?.name||'Unassigned';
       const project=(data.projects||[]).find((p:any)=>p.id===src.projectId);
       rows.push([fmtDate(c.chunkDate),emp,project?.projectId||c.projectName||'',c.phase||'Build',src.partNumber||'',src.instanceLabel||'',src.description||'',Number(c.chunkHours||0),phasePercentFor(src.id,c.phase||'Build',c),fmtDate(src.shipDate||'')]);
     }
     return `<section class="excelWeek"><h2>Week of ${fmtDate(week)} (${fmtDate(week)} - ${fmtDate(weekEnd)})</h2><table border="1">${rows.map(r=>`<tr>${r.map(v=>`<td>${esc(v)}</td>`).join('')}</tr>`).join('')}</table></section>`;
   }).join('');
   const html=`<html><head><meta charset="UTF-8"><style>@page{size:landscape;margin:.25in}body{font-family:Arial,sans-serif;font-size:10px}table{border-collapse:collapse;width:100%;margin:0 0 12px}td,th{padding:4px;border:1px solid #94a3b8;vertical-align:top}h2{margin:0 0 6px;font-size:14px}.excelWeek{page-break-after:always;break-after:page}.excelWeek:last-child{page-break-after:auto;break-after:auto}@media print{table{page-break-inside:avoid}tr{page-break-inside:avoid;page-break-after:auto}}</style></head><body>${weekTables}</body></html>`;
   const a=document.createElement('a');
   a.href=URL.createObjectURL(new Blob([html],{type:'application/vnd.ms-excel'}));
   a.download=`weekly-board-${selectedMonth}.xls`;
   a.click();
   URL.revokeObjectURL(a.href);
 }
 function printBoard(){document.body.classList.add('printingWeeklyBoard');setTimeout(()=>{window.print();setTimeout(()=>document.body.classList.remove('printingWeeklyBoard'),500)},50)}
function TaskCard({s}:any){
  const dragKey=`${s.scheduleId||s.id}::chunk::${s.segmentIndex??0}::hours::${Number(s.chunkHours)||0}`;
  const src=s.sourceAssemblyId||String(s.id).split('|')[0];
  const phase=s.phase||'Build';
  const phaseLabel=phaseBadgeLabel(phase);
  const phaseTone=phaseToneKey(phase);
  const source=sourceAssembly(src)||s;
  const pct=phasePercentFor(src,phase,s);
  const totalHrs=Number(source.qty||0)*Number(source.hoursEach||0);
  const completeHrs=phase==='Build'?Number(((pct/100)*totalHrs).toFixed(1)):null;
  const phaseChunks=chunks
    .filter((c:any)=>(c.sourceAssemblyId||String(c.id).split('|')[0])===src&&(c.phase||'Build')===phase)
    .sort((a:any,b:any)=>(Number(a.segmentIndex)||0)-(Number(b.segmentIndex)||0)||String(a.chunkDate).localeCompare(String(b.chunkDate))||String(a.employeeChunkId||'').localeCompare(String(b.employeeChunkId||'')));
  let hrsBefore=0;
  for(const c of phaseChunks){
    const same=c.segmentIndex===s.segmentIndex&&c.chunkDate===s.chunkDate&&c.employeeChunkId===s.employeeChunkId&&Number(c.chunkHours)===Number(s.chunkHours);
    if(same)break;
    hrsBefore+=Number(c.chunkHours)||0;
  }
  const tileEnd=hrsBefore+(Number(s.chunkHours)||0);
  const tol=Math.max(0.1,totalHrs*0.01);
  const buildTileDone=phase==='Build'&&completeHrs!==null&&completeHrs+tol>=tileEnd;
  const buildTilePartial=phase==='Build'&&completeHrs!==null&&completeHrs>hrsBefore&&!buildTileDone;
  function startDrag(e:any){if(boardMode==='Live')return;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('asm',dragKey);e.dataTransfer.setData('text/plain',dragKey)}
  const status=cardStatus(s);
  const locked=!!source.locked;
  const tileProject=(data.projects||[]).find((p:any)=>p.id===(source.projectId||s.projectId));
  const dimmed=shouldDimProject(source.projectId||s.projectId||'');
  const suggestion=autoAssignSuggestionMap[`${src}|${phase}`];
  const autoAssigned=recentAutoAssignedKeys.includes(`${src}|${phase}`);
  return <div className={'task phaseCard phase-'+phaseTone+' status'+status.replace(/\s+/g,'')+' '+(locked?'lockedTask ':'')+(buildTileDone?'buildTileDone ':'')+(buildTilePartial?'buildTilePartial ':'')+(s.chunkLabel==='Draft'?'draftTask ':'')+(s.isLive?' liveForecastTask ':'')+(s.forecastMoved?' forecastMovedTask ':'')+(s.forecastBlocked?' forecastBlockedTask ':'')+(dimmed?'taskDimmed ':'')+(projectFocusId!=='All'&&!dimmed?'taskFocused ':'')+(autoAssigned?' autoAssignedTask ':'')+((boardDensity==='compact'||boardDensity==='ultra')?'compactTask ':'')+(boardDensity==='ultra'?'ultraCompactTask ':'')} style={{'--project-accent':projectAccentColor(source.projectId||s.projectId||'')} as any} draggable={!locked&&boardMode!=='Live'} onDragStart={boardMode==='Live'?undefined:startDrag} onDragEnd={stopAutoScroll}>{boardMode!=='Live'&&<div className="dragHandle" draggable={!locked} onDragStart={startDrag} title="Drag this scheduled block">↕ Drag</div>}{boardMode!=='Live'&&<button className="mini lockBtn" title={locked?'Unlock Assignment':'Lock Assignment'} onClick={(e)=>{e.stopPropagation();toggleLock(src)}}>{locked?'Unlock':'Lock'}</button>}<div className="taskBadgeRow"><span className={`phaseBadge phase-${phaseTone}`}>{phaseLabel}</span><span className="statusBadge">{status}</span>{locked&&<span className="forecastBadge">LOCK</span>}{autoAssigned&&<span className="forecastBadge autoBadge">AUTO</span>}{s.isLive&&<span className="forecastBadge">Live</span>}{s.forecastMoved&&<span className="forecastMovedBadge">Moved</span>}{s.isLate&&<span className="lateBadge">late</span>}</div><div className="taskProgress"><div className="taskProgressFill" style={{width:`${Math.max(0,Math.min(100,pct))}%`}}/></div><b className="tileDescription">{(source.instanceLabel||s.instanceLabel)&&<span className="tileAssemblyNo">{source.instanceLabel||s.instanceLabel}</span>}{source.description||s.description}</b>{s.batchId&&<span className="batchBadge">{(data.shipmentBatches||[]).find((b:any)=>b.id===s.batchId)?.name}</span>}<span className="tileMeta">Job ID: {tileProject?.projectId||s.projectName}</span><span className="tileMeta">P/N: {source.partNumber||s.partNumber} {source.instanceLabel||s.instanceLabel||''}</span><span className="chunkHours">{Number(s.chunkHours).toFixed(1)} hrs this day</span>{!s.employeeChunkId&&suggestion?.employeeName&&<span className="suggestedAssignBadge">Suggest: {suggestion.employeeName}</span>}{suggestion?.nonPreferredButNecessary&&<span className="suggestedAssignBadge warn">Non-preferred but needed</span>}{s.chunkLabel==='Manual'&&<span className="splitBadge">manual</span>}{s.chunkLabel==='Partial'&&<span className="splitBadge">split</span>}{s.chunkLabel==='Live Hold'&&<span className="splitBadge">hold</span>}{boardMode!=='Live'&&<div className="completionEdit" draggable={false} onDragStart={e=>e.stopPropagation()} onMouseDown={e=>e.stopPropagation()} onClick={e=>e.stopPropagation()}><label>{phase==='Build'?'Assembly Build %':phase+' %'}</label><input draggable={false} type="number" min="0" max="100" defaultValue={pct} onBlur={e=>updateCompletion(src,phase,e.target.value)} onKeyDown={e=>{if(e.key==='Enter'){(e.target as HTMLInputElement).blur()}}}/>{phase==='Build'&&<small>{completeHrs} / {totalHrs} total hrs complete</small>}<small className="muted">Type a % and press Enter or click away</small></div>}<span className="muted">Overall {rolledCompletion(data,source)}%</span>{s.chunkLabel==='Manual'&&boardMode!=='Live'&&<button className="mini resetSplitBtn" onClick={(e)=>{e.stopPropagation();clearSegments(src)}}>Reset split</button>}</div>
}
 function SmartAssignPreviewPanel(){
  return (
    <div className="autoAssignPreviewPanel">
      <div className="autoAssignPreviewHeader">
        <div>
          <h3>Smart Assign Preview</h3>
          <p className="muted">Preview first, apply second. Locked or manually protected work stays untouched.</p>
        </div>
        <div className="scheduleWarningCounts">
          <span className="warningCount info">{actionableAutoAssign.length} suggested</span>
          <span className="warningCount capacity">{keptAutoAssign.length} unchanged</span>
          <span className="warningCount capacity">{lockedAutoAssign.length} locked</span>
          <span className="warningCount critical">{blockedAutoAssign.length} blocked</span>
        </div>
      </div>

      <div className="smartAssignOptionGrid">
        <label className="smartAssignOption"><input type="checkbox" checked={!!smartAssignOptions.assignBlanksOnly} onChange={e=>setSmartAssignOptions((value:any)=>({...value,assignBlanksOnly:e.target.checked}))}/> <span><b>Assign blanks only</b><small>Fill unassigned work first.</small></span></label>
        <label className="smartAssignOption"><input type="checkbox" checked={!!smartAssignOptions.improveExistingUnlockedAssignments} onChange={e=>setSmartAssignOptions((value:any)=>({...value,improveExistingUnlockedAssignments:e.target.checked}))}/> <span><b>Improve unlocked assignments</b><small>Review reassignment opportunities.</small></span></label>
        <label className="smartAssignOption"><input type="checkbox" checked={!!smartAssignOptions.balanceThisWeek} onChange={e=>setSmartAssignOptions((value:any)=>({...value,balanceThisWeek:e.target.checked}))}/> <span><b>Balance this week</b><small>Focus improvement work on the current week.</small></span></label>
        <label className="smartAssignOption"><input type="checkbox" checked={!!smartAssignOptions.prioritizeShipDates} onChange={e=>setSmartAssignOptions((value:any)=>({...value,prioritizeShipDates:e.target.checked}))}/> <span><b>Prioritize ship dates</b><small>Favor urgent ship dates and late work.</small></span></label>
        <label className="smartAssignOption"><input type="checkbox" checked={!!smartAssignOptions.reduceOverloads} onChange={e=>setSmartAssignOptions((value:any)=>({...value,reduceOverloads:e.target.checked}))}/> <span><b>Reduce overloads</b><small>Prefer safer available capacity.</small></span></label>
      </div>

      <div className="smartAssignSelectionBar">
        <span className="muted">{selectedSmartAssignCount} of {actionableAutoAssign.length} actionable suggestions selected.</span>
        <div className="actions">
          <button className="btn" onClick={()=>setSmartAssignSelection(actionableSuggestionIds)}>Select all</button>
          <button className="btn" onClick={()=>setSmartAssignSelection([])}>Clear selection</button>
        </div>
      </div>

      <div className="autoAssignPreviewList">
        {autoAssignSuggestions.length===0&&<p className="muted">No Smart Assign changes are suggested right now.</p>}
        {autoAssignSuggestions.map((suggestion:any)=>{
          const tone=smartAssignToneFor(suggestion);
          const selectedSuggestion=smartAssignSelection.includes(suggestion.id);
          return (
            <article key={suggestion.id} className={`warningCard ${tone}`}>
              <div className="warningCardTop">
                <span className={`warningLevel ${tone}`}>{phaseBadgeLabel(suggestion.phase)}</span>
                <span className="warningDate">{fmtDate(suggestion.date)}</span>
              </div>
              <b>{suggestion.projectCode}</b>
              <span>{suggestion.partNumber} — {suggestion.description}</span>
              <div className="warningMetaRow">
                {suggestion.currentEmployeeName&&<small>Current: {suggestion.currentEmployeeName}</small>}
                {suggestion.employeeName&&<small>Suggested: {suggestion.employeeName}</small>}
                {suggestion.shipDate&&<small>Ship By {fmtDate(suggestion.shipDate)}</small>}
              </div>
              <div className="smartAssignReasonMeta">
                <small>Status: {suggestion.status}</small>
                {typeof suggestion.score==='number'&&<small>Score {Math.round(suggestion.score)}</small>}
                {suggestion.preferredMatch&&<small>Preferred project match</small>}
                {suggestion.nonPreferredButNecessary&&<small>Non-preferred but necessary</small>}
              </div>
              <small>{suggestion.reason}</small>
              {suggestion.status==='suggested'&&<label className="smartAssignCardSelect"><input type="checkbox" checked={selectedSuggestion} onChange={e=>setSmartAssignSelection((value:string[])=>e.target.checked?[...value,suggestion.id]:value.filter(id=>id!==suggestion.id))}/> Include when applying</label>}
            </article>
          );
        })}
      </div>

      <div className="warningActionRow">
        <button className="btn primary" disabled={!selectedSmartAssignCount||boardMode==='Live'} onClick={()=>applyAutoAssignSuggestions()}>Apply Selected {selectedSmartAssignCount?`(${selectedSmartAssignCount})`:''}</button>
        <button className="btn" disabled={!actionableAutoAssign.length||boardMode==='Live'} onClick={()=>applyAutoAssignSuggestions(actionableSuggestionIds)}>Apply All</button>
        <button className="btn" onClick={()=>setShowAutoAssignPreview(false)}>Cancel</button>
      </div>
    </div>
  );
 }
 function SmartAssignResultsPanel(){
  const items=[...(lastAutoAssignRun.applied||[]),...(lastAutoAssignRun.skipped||[]),...(lastAutoAssignRun.failed||[])];
  return (
    <div className="autoAssignResultsPanel">
      <div className="autoAssignPreviewHeader">
        <div>
          <h3>Last Smart Assign Apply</h3>
          <p className="muted">Accepted suggestions use the same save path as the rest of the board, so the Weekly Board, Projects, Dashboard, and SQLite-backed data stay in sync.</p>
        </div>
        <div className="scheduleWarningCounts">
          <span className="warningCount info">{lastAutoAssignRun.counts.applied} applied</span>
          <span className="warningCount capacity">{lastAutoAssignRun.counts.skipped} skipped</span>
          <span className="warningCount critical">{lastAutoAssignRun.counts.failed} failed</span>
        </div>
      </div>
      <div className="scheduleWarningCounts">
          <span className="warningCount info">{lastAutoAssignRun.counts.added} blanks assigned</span>
          <span className="warningCount capacity">{lastAutoAssignRun.counts.changed} changed</span>
          <span className="warningCount capacity">{lastAutoAssignRun.counts.unchanged} unchanged</span>
          <span className="warningCount capacity">{lastAutoAssignRun.counts.lockedSkipped} locked skips</span>
          <span className="warningCount capacity">{lastAutoAssignRun.counts.protectedSkipped} protected skips</span>
          <span className="warningCount capacity">{lastAutoAssignRun.counts.previewLocked} preview locked</span>
          <span className="warningCount critical">{lastAutoAssignRun.counts.previewBlocked} preview blocked</span>
      </div>
      <div className="scheduleWarningCounts">
        <span className="warningCount info">{lastAutoAssignRun.counts.overloadsResolved} overloads resolved</span>
        <span className="warningCount capacity">{lastAutoAssignRun.counts.overloadsRemaining} overloads remaining</span>
        <span className="warningCount critical">{lastAutoAssignRun.counts.noQualified} no qualified</span>
        <span className="warningCount critical">{lastAutoAssignRun.counts.noPreferred} no preferred</span>
        <span className="warningCount capacity">{lastAutoAssignRun.counts.unavailable} unavailable</span>
        <span className="warningCount capacity">{lastAutoAssignRun.counts.overCapacity} over capacity</span>
      </div>
      <div className="warningActionRow">
        <button className="btn" onClick={()=>setShowAutoAssignResults((value:any)=>!value)}>{showAutoAssignResults?'Hide Results':'Show Results'}</button>
        <button className="btn" onClick={()=>setLastAutoAssignRun(null)}>Clear</button>
      </div>
      {showAutoAssignResults&&<div className="autoAssignPreviewList">{items.length===0?<p className="muted">No suggestions were applied this run.</p>:items.map((suggestion:any)=>{const tone=smartAssignResultToneFor(suggestion);return <article key={`result-${suggestion.id}-${suggestion.applyStatus}`} className={`warningCard ${tone}`}><div className="warningCardTop"><span className={`warningLevel ${tone}`}>{phaseBadgeLabel(suggestion.phase)}</span><span className="warningDate">{fmtDate(suggestion.date)}</span></div><b>{suggestion.projectCode}</b><span>{suggestion.partNumber} — {suggestion.description}</span><div className="warningMetaRow"><small>{suggestion.applyStatus==='applied'?'Applied':suggestion.applyStatus==='skipped'?'Skipped':'Failed'}</small>{suggestion.currentEmployeeName&&<small>Current: {suggestion.currentEmployeeName}</small>}{suggestion.employeeName&&<small>Suggested: {suggestion.employeeName}</small>}{suggestion.shipDate&&<small>Ship By {fmtDate(suggestion.shipDate)}</small>}</div><div className="smartAssignReasonMeta">{typeof suggestion.score==='number'&&<small>Score {Math.round(suggestion.score)}</small>}{suggestion.preferredMatch&&<small>Preferred project match</small>}{suggestion.nonPreferredButNecessary&&<small>Non-preferred but necessary</small>}</div><small>{suggestion.applyReason}</small>{suggestion.reason&&<small className="muted">{suggestion.reason}</small>}</article>})}</div>}
    </div>
  );
 }
 return <div className={`card weeklyBoardCard density-${boardDensity}`}><div className="boardHeader"><div><h2>Monthly Employee Board</h2><p className="muted">{boardMode==='Live'?'Read-only forecast from saved schedule, status, holds, time off, tests, dependencies, and ship rules.':'Drag individual daily chunks. Moves stay in draft mode until you click Apply Changes, so accidental moves can be discarded.'}</p></div><div className="boardTools enhancedBoardTools"><div className="modeToggle"><button className={boardMode==='Current'?'active':''} onClick={()=>setBoardMode('Current')}>Current</button><button className={boardMode==='Live'?'active':''} onClick={()=>{setBoardMode('Live');setBoardDrafts([])}}>Live Forecast</button></div><div className="modeToggle compactToggle"><button className={boardDensity==='comfortable'?'active':''} onClick={()=>setBoardDensity('comfortable')}>Comfortable</button><button className={boardDensity==='compact'?'active':''} onClick={()=>setBoardDensity('compact')}>Compact</button><button className={boardDensity==='ultra'?'active':''} onClick={()=>setBoardDensity('ultra')}>Ultra Compact</button></div><div className="field monthPick"><label>Month</label><input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}/></div><div className="field monthPick"><label>Search</label><input value={boardSearch} onChange={e=>setBoardSearch(e.target.value)} placeholder="Project / P/N"/></div><div className="field monthPick"><label>Employee</label><select value={employeeFilter} onChange={e=>setEmployeeFilter(e.target.value)}><option value="All">All employees</option>{activeEmployees.map((e:any)=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div><div className="field monthPick"><label>Status</label><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>{['All','Scheduled','Build Complete','At Risk','Blocked','Late','Shipped'].map(x=><option key={x}>{x}</option>)}</select></div><label className="checkLine boardCheck"><input type="checkbox" checked={hideComplete} onChange={e=>setHideComplete(e.target.checked)}/> Hide completed</label><label className="checkLine boardCheck"><input type="checkbox" checked={collapseEmptyRows} onChange={e=>setCollapseEmptyRows(e.target.checked)}/> Collapse empty rows</label><button className="btn" onClick={findOpenCapacity}>Find open capacity</button><button className="btn" disabled={boardMode==='Live'} onClick={suggestMoveForSelection}>Show conflicts</button><button className="btn" disabled={boardMode==='Live'} onClick={previewBalanceThisWeek}>Preview Smart Rebalance</button><button className="btn primary autoAssignPrimaryButton" title="Preview Smart Assign suggestions for unassigned work and unlocked assignments. Nothing is saved until you apply the suggestions." disabled={boardMode==='Live'} onClick={()=>setShowAutoAssignPreview(true)}>Smart Assign <span className="buttonBadge">{unassignedSuggestionCount} Unassigned</span><span className="buttonBadge good">{actionableAutoAssign.length} Auto-Assignable</span></button><button className="btn primary" disabled={boardMode==='Live'||!boardDrafts.length} onClick={applyBoardDrafts}>Apply Changes {boardDrafts.length?`(${boardDrafts.length})`:``}</button><button className="btn" disabled={boardMode==='Live'||!boardDrafts.length} onClick={discardBoardDrafts}>Discard Changes</button><button className="btn" onClick={exportWeeklyExcel}>Export Excel</button><button className="btn" onClick={printBoard}>Print</button><button className="btn" onClick={exportNextYearWeeklyPdf}>Export Next Year PDF</button></div></div><div className="autoAssignBoardSummary"><span className="muted">Smart Assign previews safe assignment and rebalance ideas before anything changes.</span><span className="warningCount info">{unassignedSuggestionCount} unassigned</span><span className="warningCount info">{unlockedImprovementCount} unlocked improvements</span><span className="warningCount capacity">{overloadCount} overloads</span><span className="warningCount critical">{lockedTileCount} locked</span></div><div className="projectFocusBar"><div className="field projectFocusField"><label>Project Focus</label><select value={projectFocusId} onChange={e=>setProjectFocusId(e.target.value)}><option value="All">All Projects</option>{visibleProjects.map((project:any)=>{const record=projectHealthById?.[project.id];return <option key={project.id} value={project.id}>{project.projectId||project.name}{record?` • ${record.status}`:''}</option>})}</select></div>{projectFocusId!=='All'&&<div className="projectFocusSummary"><HealthBadge status={projectHealthById?.[projectFocusId]?.status||'At Risk'}/><span>{visibleProjects.find((project:any)=>project.id===projectFocusId)?.name||visibleProjects.find((project:any)=>project.id===projectFocusId)?.projectId}</span></div>}<label className="checkLine boardCheck"><input type="checkbox" checked={hideOthers} onChange={e=>setHideOthers(e.target.checked)}/> Hide other projects</label><button className="btn" disabled={projectFocusId==='All'} onClick={()=>{setProjectFocusId('All');setHideOthers(false);setHighlightDate('')}}>Clear focus</button>{projectFocusId!=='All'&&onOpenProject&&<button className="btn" onClick={()=>onOpenProject(projectFocusId)}>Open project</button>}</div>{boardDrafts.length>0&&<div className="draftNotice weeklyDraftNotice">Draft mode: {boardDrafts.length} weekly board move{boardDrafts.length===1?``:`s`} pending. Dashboard/master schedule will update after Apply Changes.</div>}{capacitySuggestion&&<pre className="capacitySuggestion">{capacitySuggestion}</pre>}{showAutoAssignPreview&&<SmartAssignPreviewPanel/>}{lastAutoAssignRun&&<SmartAssignResultsPanel/>}<div className="weeklyWarningWrap"><ScheduleWarningsPanel warnings={boardWarnings} maxItems={8} subtitle="These warnings are informational only. They do not block drag/drop or change saved schedule data." onAction={jumpToWarning} getActionLabel={(warning:any)=>warning.projectId||warning.date?'Jump to item':''}/></div>{weeks.map((w:string)=>{const weekEmployees=visibleEmployeesForWeek(w);const showUnassignedRow=!collapseEmptyRows||weekHasUnassigned(w);const showTestRow=!collapseEmptyRows||weekHasTests(w);const emptyWeek=weekEmployees.length===0&&!showUnassignedRow&&!showTestRow;return <div key={w} className={`weekBoard strongerWeekBoard density-${boardDensity}`}><h3 className="weekDividerHeader">Week of {fmtDate(w)}</h3>{emptyWeek?<div className="weekBoardEmpty muted">No visible work in this week with the current filters.</div>:<div className="employeeBoard" style={{"--week-days":days.length,gridTemplateColumns:`${labelColumnWidth}px repeat(${days.length}, minmax(${dayColumnWidth}px,1fr))`} as any}><div className="employeeHeader">Employee</div>{days.map((day,idx)=>{const date=dateFor(w,idx);return <div className={`dayHeader ${highlightDate===date?'highlightedBoardDate':''}`} key={day}><b>{day}</b><span>{fmtDate(date)}</span></div>})}{weekEmployees.map((emp:any)=><React.Fragment key={emp.id}><div className="employeeCell"><b>{emp.name}</b><span>{emp.skills}</span></div>{days.map((day,idx)=>{const date=dateFor(w,idx);const cards=cardsFor(emp.id,date);const hours=cards.reduce((n:number,s:any)=>n+(Number(s.chunkHours)||0),0);const cap=capacityForDate(data,emp.id,date);const overloaded=hours>cap;const friday=isFri(date);return <div className={'assignmentCell '+(overloaded?'overloaded ':'')+(cap===0?' unavailable ':'')+(highlightDate===date?'highlightedBoardDate ':'')} key={emp.id+day} onDragOver={boardMode==='Live'?undefined:boardDragOver} onDragLeave={stopAutoScroll} onDrop={e=>{stopAutoScroll();if(boardMode!=='Live')moveChunk(e.dataTransfer.getData('asm'),emp.id,date)}}>{friday&&<button className="mini otToggle" disabled={boardMode==='Live'} onClick={()=>toggleFri(emp.id,date)}>{cap>0?'Friday OT On':'Enable Friday OT'}</button>}{cap===0&&!friday&&<div className="offBadge">{absenceLabel(emp,date)||'Off / Holiday'}</div>}{overloaded&&<div className="overBadge">{hours.toFixed(1)} / {cap.toFixed(1)} hrs</div>}{!overloaded&&hours>0&&<div className="hourBadge">{hours.toFixed(1)} hrs</div>}{cards.map((row:any)=><TaskCard key={(row.employeeChunkId||'u')+row.id+row.chunkDate} s={row}/>)}</div>})}</React.Fragment>)}{showUnassignedRow&&<><div className="employeeCell unassignedLabel"><b>Unassigned</b><span>Unassigned work appears here until employees are selected</span></div>{days.map((day,idx)=>{const date=dateFor(w,idx);const cards=unassignedFor(date);return <div className={`assignmentCell ${highlightDate===date?'highlightedBoardDate':''}`} key={'unassigned'+day} onDragOver={boardMode==='Live'?undefined:boardDragOver} onDragLeave={stopAutoScroll} onDrop={e=>{stopAutoScroll();if(boardMode!=='Live')moveChunk(e.dataTransfer.getData('asm'),'',date)}}>{cards.map((row:any)=><TaskCard key={'u'+row.id+row.chunkDate} s={row}/>)}</div>})}</>}{showTestRow&&<><div className="employeeCell testRowLabel"><b>In Test</b><span>External test gate by day</span></div>{days.map((day,idx)=>{const date=dateFor(w,idx);const tests=testItemsFor(date);return <div className={`assignmentCell testAssignmentCell ${highlightDate===date?'highlightedBoardDate':''}`} key={'test'+day}>{tests.length===0&&<span className="muted small">No test items</span>}{tests.map((a:any)=>{const dimmed=shouldDimProject(a.projectId||'');return <div className={`testMiniCard phase-test ${dimmed?'taskDimmed ':''}${projectFocusId!=='All'&&!dimmed?'taskFocused ':''}`} style={{'--project-accent':projectAccentColor(a.projectId||'')} as any} key={a.id+date}><div className="taskBadgeRow"><span className="phaseBadge phase-test">{phaseBadgeLabel('Test')}</span>{a.shipDate&&<span className="testReturnPill">Ship {fmtDate(a.shipDate)}</span>}</div><b>{a.description||a.partNumber}</b><span>Assembly: {a.partNumber||'—'} {a.instanceLabel||''}</span><small>{a.testReturnDateTime?`Expected return ${fmtDateTime(a.testReturnDateTime)}`:`Test gate ${Number(a.testHours||0).toFixed(1)}h`}</small></div>})}</div>})}</>}</div>}</div>})}</div>
}

function MonthlyCalendar({data,schedule}:any){
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


function GanttTimeline({data,schedule}:any){
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

function Capacity({data}:any){const rows=capacityByEmployee(data);const weekly=weeklyCapacity(data);return <div className="grid"><div className="card span6"><h2>Total Workload</h2><table><thead><tr><th>Employee</th><th>Scheduled Hours</th><th>Items</th><th>Load</th></tr></thead><tbody>{rows.map((r:any)=><tr key={r.id}><td>{r.employee}</td><td>{r.hours}</td><td>{r.items}</td><td><div className="bar"><span style={{width:Math.min(100,r.hours)+'%'}}/></div></td></tr>)}</tbody></table></div><div className="card span6"><h2>Weekly Workload</h2><Table rows={weekly} cols={['week','employee','hours','items']}/></div></div>}
function Settings({data,update}:any){return <div className="card span12"><h2>Settings</h2><div className="form"><div className="field"><label>Allow Friday Overtime</label><input type="checkbox" checked={data.settings.allowFriday} onChange={e=>update('settings',{...data.settings,allowFriday:e.target.checked})}/></div>{['workdayStart','workdayEnd','lunchStart','lunchEnd'].map(k=><div className="field" key={k}><label>{k}</label><input type="time" value={(data.settings as any)[k]} onChange={e=>update('settings',{...data.settings,[k]:e.target.value})}/></div>)}<div className="field"><label>Freeze Schedule Through</label><input type="date" value={(data.settings as any).freezeBeforeDate||''} onChange={e=>update('settings',{...data.settings,freezeBeforeDate:e.target.value})}/><div className="fieldHelp">Work cannot be dragged onto or before this date.</div></div></div></div>}
function Table({rows,cols}:any){return <div className="tablewrap"><table><thead><tr>{cols.map((c:string)=><th key={c}>{c}</th>)}</tr></thead><tbody>{rows.map((r:any,i:number)=><tr key={r.id||i}>{cols.map((c:string)=><td key={c}>{String(r[c]??'')}</td>)}</tr>)}</tbody></table></div>}
