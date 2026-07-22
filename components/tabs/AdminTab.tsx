'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {APP_VERSION,migrate} from '../../lib/migrate';
import {backupName,createBackupSnapshot,download,load,loadFromDatabase,validateBackup} from '../../lib/persistence';

export function Admin({data,setData,update,onExport,onImport,onReset}:any){
 const [view,setView]=useState('Settings');
 return <div className="subTabPage">
  <div className="subTabBar">{['Settings','Backups'].map((v:string)=><button key={v} type="button" className={view===v?'active':''} onClick={()=>setView(v)}>{v==='Backups'?'Reports / Backup':v}</button>)}</div>
  {view==='Settings'&&<Settings data={data} update={update} onExport={onExport} onImport={onImport} onReset={onReset}/>}
  {view==='Backups'&&<BackupCenter data={data} setData={setData}/>}
 </div>
}

export function Settings({data,update,onExport,onImport,onReset}:any){return <div className="grid"><div className="card span12"><h2>Settings</h2><div className="form"><div className="field"><label>Allow Friday Overtime</label><input type="checkbox" checked={data.settings.allowFriday} onChange={e=>update('settings',{...data.settings,allowFriday:e.target.checked})}/></div>{['workdayStart','workdayEnd','lunchStart','lunchEnd'].map(k=><div className="field" key={k}><label>{k}</label><input type="time" value={(data.settings as any)[k]} onChange={e=>update('settings',{...data.settings,[k]:e.target.value})}/></div>)}<div className="field"><label>Freeze Schedule Through</label><input type="date" value={(data.settings as any).freezeBeforeDate||''} onChange={e=>update('settings',{...data.settings,freezeBeforeDate:e.target.value})}/><div className="fieldHelp">Work cannot be dragged onto or before this date.</div></div></div></div><div className="card span12"><h2>Data Management</h2><p className="muted">Export a JSON copy of everything currently in the database, or import a backup file. For restoring from local backup history, use the Reports / Backup page.</p><div className="actions"><button className="btn" onClick={onExport}>Export Backup</button><label className="btn">Import Backup<input type="file" accept="application/json" onChange={onImport} style={{display:'none'}}/></label></div></div><div className="card span12 dangerZoneCard"><h2>Danger Zone</h2><p className="muted">Resets all data in this app back to the built-in sample data. This cannot be undone from here.</p><div className="actions"><button className="btn danger" onClick={onReset}>Reset to Sample Data</button></div></div></div>}

export function BackupCenter({data,setData}:any){
 const [backups,setBackups]=useState<any[]>([]);
 const [busy,setBusy]=useState('');
 const [loadError,setLoadError]=useState('');
 const [importProblems,setImportProblems]=useState<string[]>([]);
 async function refresh(){
  try{const res=await fetch('/api/backups',{cache:'no-store'});const json=await res.json();if(json?.ok){setBackups(json.backups||[]);setLoadError('')}else setLoadError(json?.error||'Could not load backups.')}catch{setLoadError('Could not load backups.')}
 }
 useEffect(()=>{refresh()},[]);
 async function createNow(){setBusy('create');try{await fetch('/api/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason:'manual'})});await refresh()}finally{setBusy('')}}
 async function restore(b:any){
  if(!confirm('Restore this backup? Current data will be replaced. A safety backup of the current data is created first.'))return;
  setBusy('restore-'+b.id);
  try{
   const res=await fetch('/api/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({restoreId:b.id})});
   const json=await res.json();
   if(json?.ok){const fresh=await loadFromDatabase();setData(fresh);await refresh();alert('Backup restored.')}
   else alert(json?.error||'Restore failed.');
  }finally{setBusy('')}
 }
 async function remove(id:number){if(!confirm('Delete this backup from the database?'))return;await fetch(`/api/backups?id=${id}`,{method:'DELETE'});refresh()}
 async function downloadOne(b:any){const res=await fetch(`/api/backups?id=${b.id}`,{cache:'no-store'});const json=await res.json();if(json?.ok)download(backupName(b.reason||'backup'),JSON.stringify(json.data,null,2));else alert('Could not download that backup.')}
 function importAppData(e:any){
  const f=e.target.files?.[0];if(!f)return;
  const r=new FileReader();
  r.onload=()=>{try{const parsed=JSON.parse(String(r.result));const problems=validateBackup(parsed);setImportProblems(problems);if(problems.length&&!confirm('Backup warning:\n'+problems.join('\n')+'\n\nTry importing this as app data anyway?'))return;createBackupSnapshot(data,'before-import');setData(migrate(parsed));createBackupSnapshot(migrate(parsed),'imported');setTimeout(refresh,1200);alert('App data imported.')}catch{setImportProblems(['Could not read that file as JSON.']);alert('Could not import that backup file.')}};
  r.readAsText(f);
 }
 const latest=backups[0];
 return <div className="grid"><div className="card span12"><h2>Backups & Restore</h2><p className="muted">Backups are stored in the scheduler database, so they survive browser cache clears and are visible from any computer. Download a file copy for offline safekeeping.</p><div className="actions"><button className="btn primary" disabled={busy==='create'} onClick={createNow}>{busy==='create'?'Creating…':'Create Backup Now'}</button><button className="btn" onClick={()=>download(backupName('manual'),JSON.stringify({...data,version:APP_VERSION},null,2))}>Download Current Data</button><label className="btn">Import App Data<input type="file" accept="application/json" onChange={importAppData} style={{display:'none'}}/></label><button className="btn" onClick={refresh}>Refresh List</button></div>{latest&&<p className="small muted">Latest backup: {new Date(latest.createdAt).toLocaleString()} ({latest.reason})</p>}{loadError&&<div className="backupWarning"><b>Backup warning:</b> {loadError}</div>}{importProblems.length>0&&<div className="backupWarning"><b>Import validation warnings:</b><ul>{importProblems.map((p:string)=><li key={p}>{p}</li>)}</ul></div>}</div><div className="card span12"><h2>Backup History</h2><div className="tablewrap"><table><thead><tr><th>Created</th><th>Type</th><th>Counts</th><th>Actions</th></tr></thead><tbody>{backups.length===0&&<tr><td colSpan={4}><p className="muted">No backups yet. The app also creates automatic snapshots about every 30 minutes while you work.</p></td></tr>}{backups.map((b:any)=><tr key={b.id}><td>{new Date(b.createdAt).toLocaleString()}</td><td><span className={b.reason==='auto'?'pill good':'pill warn'}>{b.reason}</span></td><td className="small">Employees {b.counts?.employees||0}<br/>Projects {b.counts?.projects||0}<br/>Library {b.counts?.library||0}<br/>Project Assemblies {b.counts?.projectAssemblies||0}</td><td><div className="actions"><button className="btn" disabled={busy==='restore-'+b.id} onClick={()=>restore(b)}>{busy==='restore-'+b.id?'Restoring…':'Restore'}</button><button className="btn" onClick={()=>downloadOne(b)}>Download</button><button className="btn danger" onClick={()=>remove(b.id)}>Delete</button></div></td></tr>)}</tbody></table></div></div><div className="card span12"><h2>Version Safety Notes</h2><ul className="muted"><li>Automatic snapshots are taken about every 30 minutes while you are working.</li><li>Restore creates a safety backup first, so you can undo a bad restore.</li><li>Imported files are checked for the core scheduler lists before loading.</li><li>The most recent 40 snapshots are kept; older ones are trimmed automatically.</li></ul></div></div>
}
