'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import AIAgent from './AIAgent';
import {STORAGE_KEY,defaultData} from '../lib/defaultData';
import {APP_VERSION,migrate} from '../lib/migrate';
import {backupName,createBackupSnapshot,download,loadFromDatabase,maybeAutoBackup,saveLocal,saveRemote,validateBackup} from '../lib/persistence';
import {calculateProjectHealth,summarizeProjectHealth} from '../lib/projectHealth';
import {calculateScheduleWarnings} from '../lib/scheduleWarnings';
import {buildSchedule,scheduleHealth} from '../lib/scheduler';
import {TodayPriority} from '../lib/todayPriorities';
import {AppData} from '../lib/types';
import {GlobalSearchPanel,warningActionTarget,confirmDialog,toast,NotificationHost} from './shared/common';
import {Dashboard} from './tabs/DashboardTab';
import {WeeklyBoard} from './tabs/WeeklyBoardTab';
import {Projects} from './tabs/ProjectsTab';
import {AssemblyLibrary} from './tabs/LibraryTab';
import {People} from './tabs/PeopleTab';
import {Plan} from './tabs/PlanTab';
import {Admin} from './tabs/AdminTab';

export default function App(){
 const [data,setData]=useState<AppData>(defaultData);
 const [tab,setTab]=useState('Dashboard');
 const [showAIAgent,setShowAIAgent]=useState(false);
 const [loaded,setLoaded]=useState(false);
 const [globalSearch,setGlobalSearch]=useState('');
 const [darkMode,setDarkMode]=useState(false);
 const [saveError,setSaveError]=useState('');
 const [saveState,setSaveState]=useState<'idle'|'saving'|'saved'|'error'>('idle');
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
   saveLocal(versionedData);
   setSaveState('saving');
   const timer=setTimeout(()=>{
    saveRemote(versionedData).then(()=>{setSaveError('');setSaveState('saved');maybeAutoBackup(versionedData)}).catch(err=>{
     console.error('Scheduler database save failed:',err);
     setSaveState('error');
     setSaveError(err?.message||'Database save failed. Browser cache was updated, but the shared database may be out of date.');
    });
   },1200);
   return()=>clearTimeout(timer);
  }
 },[data,loaded]);
 useEffect(()=>{
  function onBeforeUnload(e:BeforeUnloadEvent){if(saveState==='saving'){e.preventDefault();e.returnValue='';}}
  window.addEventListener('beforeunload',onBeforeUnload);
  return()=>window.removeEventListener('beforeunload',onBeforeUnload);
 },[saveState]);

 const schedule=useMemo(()=>buildSchedule(data),[data]);
 const health=useMemo(()=>scheduleHealth(data),[data]);
 const warnings=useMemo(()=>calculateScheduleWarnings(data,schedule),[data,schedule]);
 const projectHealth=useMemo(()=>calculateProjectHealth(data,schedule,warnings),[data,schedule,warnings]);
 const projectHealthById=useMemo(()=>Object.fromEntries(projectHealth.map(record=>[record.projectId,record])),[projectHealth]);
 const activeProjectHealth=useMemo(()=>projectHealth.filter((record:any)=>data.projects.some((project:any)=>project.id===record.projectId&&project.status==='Active'&&!project.archived)),[projectHealth,data.projects]);
 const projectHealthSummary=useMemo(()=>summarizeProjectHealth(activeProjectHealth),[activeProjectHealth]);

 function update<K extends keyof AppData>(key:K,value:AppData[K]){setData(d=>({...d,[key]:value}))}
 async function reset(){if(await confirmDialog('Reset all local data back to sample data?')){localStorage.removeItem(STORAGE_KEY);setData(defaultData);toast('Data reset to sample data.','info')}}
 function importFile(e:any){const f=e.target.files?.[0];if(!f)return;const r=new FileReader();r.onload=async()=>{try{const parsed=JSON.parse(String(r.result));const problems=validateBackup(parsed);if(problems.length&&!await confirmDialog('Backup warning:\n'+problems.join('\n')+'\n\nTry importing anyway?'))return;setData(migrate(parsed));createBackupSnapshot(migrate(parsed),'imported');toast('Import complete.','good')}catch{toast('Could not import that file.','bad')}};r.readAsText(f)}
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
 const mainTabs=[{tab:'Dashboard',label:'Today'},{tab:'Weekly Board',label:'Board'},{tab:'Plan',label:'Plan'},{tab:'Projects',label:'Projects'},{tab:'Assembly Library',label:'Library'},{tab:'People',label:'People'},{tab:'Admin',label:'Admin'}];
 return <main className="shell"><div className="top"><div className="topLeft"><div className="brand" style={{display:'flex',alignItems:'center',gap:14}}><img src="/logo.png" alt="RPM/PSI" style={{height:46,width:'auto'}} onError={e=>{(e.target as HTMLImageElement).style.display='none'}}/><h1>Production Scheduler</h1></div><nav className="mainTabBar">{mainTabs.map((item:any)=><button key={item.tab} type="button" className={tab===item.tab?"active":""} onClick={()=>setTab(item.tab)}>{item.label}</button>)}</nav></div><div className="topRight"><div className="topSearch"><input className="globalSearchInput" value={globalSearch} onChange={e=>setGlobalSearch(e.target.value)} placeholder="Search project ID, P/N, assembly, employee..."/></div><div className="topButtons"><span className={"saveIndicator "+saveState}>{saveState==='saving'?'Saving…':saveState==='error'?'Save failed':saveState==='saved'?'Saved':''}</span><button className="btn" onClick={()=>setShowMobileAccess(true)}>Open Mobile Viewer</button><button className="btn" onClick={()=>setShowAIAgent(v=>!v)} style={showAIAgent?{background:'#2563eb',color:'#fff'}:{}}>{showAIAgent?'Close AI Agent':'🤖 AI Agent'}</button><button className="btn" onClick={()=>setDarkMode(v=>!v)}>{darkMode?'Light Mode':'Dark Mode'}</button></div></div></div>{saveError&&<div className="backupWarning"><b>Database save warning:</b> {saveError} <button className="mini" onClick={()=>window.location.reload()}>Reload now</button></div>}{showMobileAccess&&<MobileAccessPanel onClose={()=>setShowMobileAccess(false)}/>} {globalSearch.trim()&&<GlobalSearchPanel data={data} query={globalSearch} setTab={setTab} clear={()=>setGlobalSearch('')} onOpenProject={(id:string)=>openProjectPanel(id)}/>}{tab==='Dashboard'&&<Dashboard data={data} schedule={schedule} health={health} warnings={warnings} projectHealth={activeProjectHealth} projectHealthSummary={projectHealthSummary} onProjectFilter={openProjectsFilter} onWarningAction={handleDashboardWarningAction} onPriorityAction={handlePriorityAction}/>} {tab==='Projects'&&<Projects data={data} setData={setData} schedule={schedule} warnings={warnings} projectHealth={projectHealth} projectHealthById={projectHealthById} panelIntent={projectPanelIntent} onFocusBoard={focusWeeklyBoard}/>} {tab==='Assembly Library'&&<AssemblyLibrary data={data} setData={setData}/>} {tab==='Weekly Board'&&<WeeklyBoard data={data} setData={setData} schedule={schedule} warnings={warnings} projectHealthById={projectHealthById} boardIntent={weeklyBoardIntent} onOpenProject={openProjectPanel}/>} {tab==='People'&&<People data={data} setData={setData}/>} {tab==='Plan'&&<Plan data={data} setData={setData} schedule={schedule} warnings={warnings} projectHealth={projectHealth} setTab={setTab}/>} {tab==='Admin'&&<Admin data={data} setData={setData} update={update} onExport={()=>download(backupName('manual'),JSON.stringify({...data,version:APP_VERSION},null,2))} onImport={importFile} onReset={reset}/>}{showAIAgent&&<AIAgent data={data} schedule={schedule} onClose={()=>setShowAIAgent(false)}/>}<NotificationHost/></main>
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
