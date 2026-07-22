// Client-side persistence: local cache, debounced remote saves with conflict
// tokens, downloads, and backup snapshot helpers.
import {STORAGE_KEY,defaultData} from './defaultData';
import {migrate} from './migrate';
import {AppData} from './types';

export let remoteSaveQueue:Promise<void>=Promise.resolve();

export function load():AppData{try{const raw=localStorage.getItem(STORAGE_KEY);if(raw)return migrate(JSON.parse(raw));}catch{}return defaultData}

let remoteUpdatedAt='';

export async function loadFromDatabase():Promise<AppData>{
  try{
    const res=await fetch('/api/data',{cache:'no-store'});
    const json=await res.json();
    if(json?.ok&&json?.data){remoteUpdatedAt=String(json.updatedAt||'');return migrate(json.data);}
  }catch{}
  return load();
}

export function saveLocal(d:AppData){
  try{localStorage.setItem(STORAGE_KEY,JSON.stringify(d));}catch{}
}

export function saveRemote(d:AppData){
  remoteSaveQueue=remoteSaveQueue.catch(()=>undefined).then(async()=>{
    const res=await fetch('/api/data',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({data:d,baseUpdatedAt:remoteUpdatedAt})});
    const json=await res.json().catch(()=>null);
    if(!res.ok){
      throw new Error(json?.error||'Failed to save scheduler database.');
    }
    if(json?.updatedAt)remoteUpdatedAt=String(json.updatedAt);
  });
  return remoteSaveQueue;
}

export function download(name:string,text:string){const a=document.createElement('a');a.href=URL.createObjectURL(new Blob([text],{type:'application/json'}));a.download=name;a.click();URL.revokeObjectURL(a.href)}

export function backupName(reason:string){const stamp=new Date().toISOString().replace(/[:.]/g,'-');return `scheduler-${reason}-${stamp}.json`}

export function validateBackup(raw:any){
  const problems:string[]=[];
  if(!raw||typeof raw!=='object')problems.push('File is not a valid scheduler backup.');
  if(!Array.isArray(raw.employees))problems.push('Missing employees list.');
  if(!Array.isArray(raw.projects))problems.push('Missing projects list.');
  if(!Array.isArray(raw.assemblyTemplates))problems.push('Missing assembly library list.');
  if(!Array.isArray(raw.projectAssemblies)&&!Array.isArray(raw.assemblies))problems.push('Missing project assemblies list.');
  return problems;
}
// Snapshots now live in the database (app_backups table) so they survive browser
// cache clears and are visible from any machine. Fire-and-forget.

export function createBackupSnapshot(_data:AppData,reason='manual'){
  try{fetch('/api/backups',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({reason})}).catch(()=>undefined)}catch{}
}

export const AUTO_BACKUP_STAMP_KEY='assembly-scheduler-last-auto-backup';

export function maybeAutoBackup(data:AppData){
  try{
    const last=Number(localStorage.getItem(AUTO_BACKUP_STAMP_KEY)||0);
    if(Date.now()-last>1000*60*30){localStorage.setItem(AUTO_BACKUP_STAMP_KEY,String(Date.now()));createBackupSnapshot(data,'auto');}
  }catch{}
}
