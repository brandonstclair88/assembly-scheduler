import {AppData} from './types';
import {defaultData} from './defaultData';

export const APP_VERSION=91;
const uid=(p:string)=>p+'-'+Math.random().toString(36).slice(2,9);

// Backward-compat: the "Inspection" phase was renamed to "Finalizing". Records
// saved before that rename carry the old inspection* keys. Lift each old key
// onto its finalizing* equivalent when the new key is absent, then drop the old
// key so persisted data converges on the new schema. (Old key names are written
// as literals here on purpose so they are NOT affected by the rename.)
const FINALIZING_LEGACY:[string,string][]=[
  ['finalizingRequired','inspectionRequired'],
  ['finalizingHours','inspectionHours'],
  ['finalizingAssignedTo','inspectionAssignedTo'],
  ['finalizingManualStartDate','inspectionManualStartDate'],
  ['finalizingComplete','inspectionComplete'],
];
function liftFinalizing(o:any){
  if(!o||typeof o!=='object')return o;
  const r:any={...o};
  for(const [nk,ok] of FINALIZING_LEGACY){
    if(r[nk]===undefined&&r[ok]!==undefined)r[nk]=r[ok];
    if(ok in r)delete r[ok];
  }
  return r;
}

export function migrate(raw:any):AppData{
  const d={...defaultData,...raw};
  if(!d.assemblyTemplates)d.assemblyTemplates=[];
  if(!d.holidays)d.holidays=[];
  if(!d.shipmentBatches)d.shipmentBatches=[];
  if(typeof d.testFridayDates!=='string')d.testFridayDates='';
  if(!d.projectAssemblies)d.projectAssemblies=d.assemblies||defaultData.projectAssemblies;
  if(!d.assemblyTemplates.length&&d.projectAssemblies?.length){
    const seen=new Set();
    d.assemblyTemplates=d.projectAssemblies.filter((a:any)=>{if(seen.has(a.partNumber))return false;seen.add(a.partNumber);return true}).map((a:any)=>({id:uid('tpl'),partNumber:a.partNumber,description:a.description,type:a.type,defaultQty:a.qty||1,hoursEach:a.hoursEach||1,testRequired:a.testRequired||false,testHours:a.testHours||0,finalizingRequired:a.finalizingRequired||false,finalizingHours:a.finalizingHours||0,shippingRequired:a.shippingRequired||false,shippingHours:a.shippingHours||0,defaultDependsOn:a.dependsOn||'',notes:'Created from older project assembly.'}))
  }
  delete d.assemblies;
  d.assemblyTemplates=(d.assemblyTemplates||[]).map((t:any)=>({testRequired:false,testHours:0,finalizingRequired:false,finalizingHours:0,shippingRequired:false,shippingHours:0,testReturnDateTime:'',finalizingAssignedTo:'',shippingAssignedTo:'',finalizingManualStartDate:'',shippingManualStartDate:'',finalizingComplete:false,shippingComplete:false,maxTopPercentWhenSubHeld:80,defaultDependsOn:'',archived:false,...liftFinalizing(t),type:t.type==='Tool Level Assembly'?'Top Level Assembly':t.type}));
  // Canonical fields win; legacy pairs (pto, trainedProjectIds, limitAutoAssignToTrainedProjects)
  // are kept mirrored so old readers/backups keep working.
  d.employees=(d.employees||[]).map((e:any)=>{const timeOff=e.timeOffDates||e.pto||'';const preferred=e.preferredProjectIds||e.trainedProjectIds||'';const prefer=typeof e.preferPreferredProjects==='boolean'?e.preferPreferredProjects:!!e.limitAutoAssignToTrainedProjects;const canFin=e.canFinalize!==undefined?e.canFinalize:e.canInspect;const eRest:any={...e};delete eRest.canInspect;return {fridayOvertimeDates:'',workDays:'',workHoursByDay:'',...eRest,canBuild:e.canBuild!==false,canFinalize:canFin!==false,canShip:e.canShip!==false,timeOffDates:timeOff,pto:timeOff,preferredProjectIds:preferred,trainedProjectIds:preferred,preferPreferredProjects:prefer,limitAutoAssignToTrainedProjects:prefer};});
  d.projects=(d.projects||[]).map((p:any)=>({projectType:p.projectType||'New Build',sequencingEnabled:p.sequencingEnabled!==false,...p}));
  d.projectAssemblies=(d.projectAssemblies||[]).map((a:any)=>({testRequired:false,testHours:0,finalizingRequired:false,finalizingHours:0,shippingRequired:false,shippingHours:0,testReturnDateTime:'',finalizingAssignedTo:'',shippingAssignedTo:'',finalizingManualStartDate:'',shippingManualStartDate:'',finalizingComplete:false,shippingComplete:false,maxTopPercentWhenSubHeld:80,instanceNumber:a.instanceNumber||1,instanceLabel:a.instanceLabel||'#1',shipDate:a.shipDate||a.manualStart||'',lateAllowed:!!a.lateAllowed,manuallyScheduled:!!a.manuallyScheduled,manualStartDate:a.manualStartDate||'',buildGroupId:a.buildGroupId||'',buildGroupLabel:a.buildGroupLabel||'',parentAssemblyId:a.parentAssemblyId||'',locked:!!a.locked,smartAssignProtected:!!a.smartAssignProtected,...liftFinalizing(a),type:a.type==='Tool Level Assembly'?'Top Level Assembly':a.type,manualStart:undefined}));
  return {...d,version:APP_VERSION,settings:{...defaultData.settings,...d.settings}};
}
