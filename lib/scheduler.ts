import {AppData,ScheduledItem,Assembly} from './types';
const MS_DAY=86400000;
function pad(n:number){return String(n).padStart(2,'0')}
function dateOnly(d:Date){return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function mondayOf(d:Date){const x=new Date(d);const day=x.getDay()||7;x.setDate(x.getDate()-day+1);return dateOnly(x)}
function parseDate(s:string){const base=(s||'').slice(0,10);const d=base?new Date(base+'T00:00:00'):new Date(); if(isNaN(+d))return new Date(); return d}
function minutes(t:string){const [h,m]=t.split(':').map(Number);return h*60+m}
export function dailyHours(data:AppData){return ((minutes(data.settings.workdayEnd)-minutes(data.settings.workdayStart))-(minutes(data.settings.lunchEnd)-minutes(data.settings.lunchStart)))/60}
function splitIds(s:string){return (s||'').split(/[\n,;\s]+/).map(x=>x.trim()).filter(Boolean)}
function dateList(s:string){return new Set(splitIds(s))}
function isCompanyHoliday(data:AppData,date:string){return !!(data.holidays||[]).some(h=>h.date===date)}
function employeeUnavailable(data:AppData,empId:string,date:string){const e=data.employees.find(x=>x.id===empId);return !!e && dateList((e as any).timeOffDates||e.pto||'').has(date)}
function employeeFridayOt(data:AppData,empId:string,date:string){const e=data.employees.find(x=>x.id===empId);return !!e && dateList((e as any).fridayOvertimeDates||'').has(date)}
// The external test gate uses the shop calendar (Mon–Thu), and only counts a
// Friday when that specific date has been enabled shop-wide as a test overtime day.
function testWorksFriday(data:AppData,date:string){return dateList((data as any).testFridayDates||'').has(date)}
function isTestWorkday(data:AppData,d:Date){const ds=dateOnly(d);if(isCompanyHoliday(data,ds))return false;const day=d.getDay();if(day>=1&&day<=4)return true;if(day===5)return testWorksFriday(data,ds);return false}
function nextTestWorkday(d:Date,data:AppData){const x=new Date(d);let g=0;while(!isTestWorkday(data,x)&&g++<1000)x.setDate(x.getDate()+1);return x}
function prevTestWorkday(d:Date,data:AppData){const x=new Date(d);let g=0;while(!isTestWorkday(data,x)&&g++<1000)x.setDate(x.getDate()-1);return x}
function employeeWorkDaySet(e:any){return dateList(e?.workDays||'')}
function employeeHoursMap(e:any){try{return JSON.parse(e?.workHoursByDay||'{}')}catch{return {}}}
function hasCustomWeeklySchedule(e:any){return employeeWorkDaySet(e).size>0}
function employeeCan(e:any,phase:'Build'|'Finalizing'|'Shipping'){if(!e||e.active===false)return false;if(phase==='Finalizing')return e.canFinalize!==false;if(phase==='Shipping')return e.canShip!==false;return e.canBuild!==false}
function isWorkdayFor(data:AppData,d:Date,empIds:string[]=[]){const ds=dateOnly(d);if(isCompanyHoliday(data,ds))return false;const day=d.getDay();if(!empIds.length)return day>=1&&day<=4;if(day<1||day>5)return false;return empIds.some(id=>capacityForDate(data,id,ds)>0)}
function nextWorkdayFor(d:Date,data:AppData,empIds:string[]=[]){const x=new Date(d);let guard=0;while(!isWorkdayFor(data,x,empIds)&&guard++<1000)x.setDate(x.getDate()+1);return x}
function prevWorkdayFor(d:Date,data:AppData,empIds:string[]=[]){const x=new Date(d);let guard=0;while(!isWorkdayFor(data,x,empIds)&&guard++<1000)x.setDate(x.getDate()-1);return x}
export function capacityForDate(data:AppData,empId:string,date:string){
  const d=parseDate(date);const day=d.getDay();
  if(isCompanyHoliday(data,date))return 0;
  if(!empId)return day>=1&&day<=4?dailyHours(data):0;
  const emp:any=data.employees.find(x=>x.id===empId);
  if(!emp||emp.active===false||employeeUnavailable(data,empId,date))return 0;
  if(hasCustomWeeklySchedule(emp)){
    const days=employeeWorkDaySet(emp);
    if(days.has(String(day))){
      const hours=employeeHoursMap(emp)[String(day)];
      return Number(hours)>0?Number(hours):dailyHours(data);
    }
    // Friday overtime still applies even when the employee has a custom weekly
    // schedule that normally excludes Friday.
    if(day===5&&employeeFridayOt(data,empId,date))return dailyHours(data);
    return 0;
  }
  if(day>=1&&day<=4)return dailyHours(data);
  if(day===5&&employeeFridayOt(data,empId,date))return dailyHours(data);
  return 0;
}
function addWorkHours(start:string,hours:number,data:AppData,empIds:string[]=[]){let d=nextWorkdayFor(parseDate(start),data,empIds);let remaining=hours;while(remaining>dailyHours(data)){remaining-=dailyHours(data);d=new Date(+d+MS_DAY);d=nextWorkdayFor(d,data,empIds)}return dateOnly(d)}
function addExternalWaitHours(afterFinish:string,hours:number,data:AppData){
  if((Number(hours)||0)<=0)return afterFinish;
  let d=new Date(+parseDate(afterFinish)+MS_DAY);
  d=nextTestWorkday(d,data);
  let remaining=Number(hours)||0;
  while(remaining>dailyHours(data)){
    remaining-=dailyHours(data);
    d=new Date(+d+MS_DAY);
    d=nextTestWorkday(d,data);
  }
  return dateOnly(d);
}
function subtractWorkHours(finish:string,hours:number,data:AppData,empIds:string[]=[]){let d=prevWorkdayFor(parseDate(finish),data,empIds);let remaining=hours;while(remaining>dailyHours(data)){remaining-=dailyHours(data);d=new Date(+d-MS_DAY);d=prevWorkdayFor(d,data,empIds)}return dateOnly(d)}
function previousWorkdayBefore(date:string,data:AppData,empIds:string[]=[]){const d=new Date(+parseDate(date)-MS_DAY);return dateOnly(prevWorkdayFor(d,data,empIds))}
function subtractTestWaitHours(finish:string,hours:number,data:AppData){let d=prevTestWorkday(parseDate(finish),data);let remaining=hours;while(remaining>dailyHours(data)){remaining-=dailyHours(data);d=new Date(+d-MS_DAY);d=prevTestWorkday(d,data)}return dateOnly(d)}
function previousTestWorkdayBefore(date:string,data:AppData){const d=new Date(+parseDate(date)-MS_DAY);return dateOnly(prevTestWorkday(d,data))}
function latestBuildBeforeExternalGate(downstreamStart:string,hours:number,data:AppData){
  if((Number(hours)||0)<=0)return downstreamStart;
  const gateStart=previousTestWorkdayBefore(subtractTestWaitHours(downstreamStart,hours,data),data);
  return previousTestWorkdayBefore(gateStart,data);
}
// Test is an external wait/gate. Estimate it using the same shop work calendar,
// but do not assign it to an employee or consume employee capacity.
function hasTestGate(a:Assembly){return !!a.testRequired || (Number((a as any).testHours)||0)>0}
function testGateEnd(buildFinish:string,a:Assembly,data:AppData){
  const estimatedHours=hasTestGate(a)?(Number(a.testHours)||0):0;
  const estimatedReturn=estimatedHours>0?addExternalWaitHours(buildFinish,estimatedHours,data):buildFinish;
  const manualReturn=(hasTestGate(a) && (a as any).testReturnDateTime)?dateOnly(parseDate((a as any).testReturnDateTime)):'';
  return manualReturn?maxDate(estimatedReturn,manualReturn):estimatedReturn;
}
function firstInternalWorkDateAfterTest(buildFinish:string,a:Assembly,data:AppData){
  const gate=testGateEnd(buildFinish,a,data);
  const hasManual=!!(hasTestGate(a) && (a as any).testReturnDateTime);
  const estimatedHours=hasTestGate(a)?(Number(a.testHours)||0):0;
  // When only an estimated test duration is supplied, treat the returned gate date
  // as consumed by test. Finalizing/shipping should start on the next available
  // shop day, not immediately after the last build tile. If the planner enters
  // an explicit expected return date/time, that manual return date is the release date.
  if(estimatedHours>0 && !hasManual){
    const next=new Date(+parseDate(gate)+MS_DAY);
    return dateOnly(nextWorkdayFor(next,data,[]));
  }
  return gate;
}
function latestBuildFinishBeforeTestDownstream(downstreamStart:string,a:Assembly,data:AppData){
  const estimatedHours=hasTestGate(a)?(Number(a.testHours)||0):0;
  const manualReturn=(hasTestGate(a) && (a as any).testReturnDateTime)?dateOnly(parseDate((a as any).testReturnDateTime)):'';
  let latest=downstreamStart;
  if(estimatedHours>0) latest=latestBuildBeforeExternalGate(latest,estimatedHours,data);
  // If a manual expected return is supplied, build must also be done early enough
  // to make that return realistic. Finalizing/shipping are still held until that date.
  if(manualReturn){
    const latestForManual=estimatedHours>0?latestBuildBeforeExternalGate(manualReturn,estimatedHours,data):manualReturn;
    latest=minDate(latest,latestForManual);
  }
  return latest;
}
function maxDate(a:string,b:string){if(!a)return b;if(!b)return a;return a>b?a:b}
function minDate(a:string,b:string){if(!a)return b;if(!b)return a;return a<b?a:b}

export function buildSchedule(data:AppData):ScheduledItem[]{
  const projects=Object.fromEntries(data.projects.map(p=>[p.id,p]));
  const employees=Object.fromEntries(data.employees.map(e=>[e.id,e]));
  const assemblies=(data.projectAssemblies||data.assemblies||[]);
  const byId=Object.fromEntries(assemblies.map(a=>[a.id,a]));
  const scheduled:Record<string,ScheduledItem>={};
  const employeeLatest:Record<string,string>={};
  data.employees.filter(e=>e.active).forEach(e=>employeeLatest[e.id]='9999-12-31');
  const sorted=[...assemblies].sort((a,b)=>((projects[a.projectId]?.priority||99)-(projects[b.projectId]?.priority||99)) || (a.type==='Top Level Assembly'?-1:1));

  function assigneesFor(a:Assembly,phase:'Build'|'Finalizing'|'Shipping'){
    const raw=phase==='Finalizing'?(a.finalizingAssignedTo||a.assignedTo):phase==='Shipping'?(a.shippingAssignedTo||a.assignedTo):a.assignedTo;
    let ids=splitIds(raw||'').filter(id=>employeeCan(employees[id],phase));
    // Leave unassigned or unqualified work unassigned. The weekly board will place it in the Unassigned row
    // on the calculated dates so the planner can assign employees intentionally.
    return ids;
  }
  function makeItem(a:Assembly,phase:'Build'|'Finalizing'|'Shipping',start:string,finish:string,totalHours:number,hoursPerEmployee:number,assignees:string[],deps:string[],isLate:boolean):ScheduledItem{
    const proj=projects[a.projectId];
    const phasePrefix=phase==='Build'?'BUILD':phase==='Finalizing'?'FINALIZE':'SHIP';
    return {...a,id:`${a.id}|${phase.toLowerCase()}`,scheduleId:`${a.id}|${phase.toLowerCase()}`,sourceAssemblyId:a.id,phase,assignedTo:assignees.join(','),projectName:proj?.name||proj?.projectId||'Unknown Project',employeeName:assignees.map(id=>employees[id]?.name||id).join(', ')||'Unassigned',assignedEmployeeNames:assignees.map(id=>employees[id]?.name||id).join(', ')||'Unassigned',description:`${phasePrefix}: ${a.description}`,scheduledStart:start,scheduledEnd:finish,totalHours,hoursPerEmployee,week:mondayOf(parseDate(start)),dependencyNames:deps.join(', '),isLate,lateAllowed:!!a.lateAllowed} as ScheduledItem;
  }
  function phasePlan(a:Assembly,phase:'Finalizing'|'Shipping',deadline:string){
    const hours=phase==='Finalizing'?(Number(a.finalizingHours)||0):(Number(a.shippingHours)||0);
    if(hours<=0)return {start:deadline,end:deadline,hours,hpe:0,ids:[] as string[]};
    const ids=assigneesFor(a,phase); const count=Math.max(1,ids.length); const hpe=hours/count;
    const end=dateOnly(prevWorkdayFor(parseDate(deadline),data,ids));
    const start=subtractWorkHours(end,hpe,data,ids);
    return {start,end,hours,hpe,ids};
  }
  function addPhase(a:Assembly,phase:'Finalizing'|'Shipping',targetStart:string,targetEnd:string,afterDate:string,shipDate:string){
    const hours=phase==='Finalizing'?(Number(a.finalizingHours)||0):(Number(a.shippingHours)||0);
    if(hours<=0)return {start:afterDate,end:afterDate,item:null as any,late:false};
    const ids=assigneesFor(a,phase); const count=Math.max(1,ids.length); const hpe=hours/count;
    const manual=phase==='Finalizing'?a.finalizingManualStartDate:a.shippingManualStartDate;
    const earliest=dateOnly(nextWorkdayFor(parseDate(afterDate),data,ids));
    let start=a.lateAllowed?maxDate(targetStart,earliest):targetStart;
    if(manual)start=maxDate(start,dateOnly(nextWorkdayFor(parseDate(manual),data,ids)));
    const end=addWorkHours(start,hpe,data,ids);
    const late=!!(shipDate&&(end>shipDate||targetEnd>shipDate||(!a.lateAllowed&&earliest>targetStart)));
    const item=makeItem(a,phase,start,end,hours,hpe,ids,[phase==='Finalizing'?'Build/Test complete':'Finalizing complete'],late);
    return {start,end,item,late};
  }
  function scheduleOne(a:Assembly,requestedFinish?:string,seen=new Set<string>()):ScheduledItem{
    if(scheduled[a.id])return scheduled[a.id];
    if(seen.has(a.id))throw new Error('Dependency loop around '+a.partNumber);
    seen.add(a.id);
    const proj=projects[a.projectId];
    let assignees=assigneesFor(a,'Build');
    const buildHours=(Number(a.qty)||0)*(Number(a.hoursEach)||0);
    const buildHPE=buildHours/Math.max(1,assignees.length);
    const onHold=a.status==='On Hold'||!!a.holdReason;
    const isManual=!!a.manuallyScheduled && !!a.manualStartDate;
    const inspHours=a.finalizingRequired?(Number(a.finalizingHours)||0):0;
    const shipHours=a.shippingRequired?(Number(a.shippingHours)||0):0;
    const shipDate=(a as any).shipDate || proj?.dueDate || dateOnly(new Date());
    const shipTarget=a.shippingRequired?phasePlan(a,'Shipping',shipDate):{start:shipDate,end:shipDate,hours:0,hpe:0,ids:[] as string[]};
    const finalizingDeadline=a.shippingRequired?previousWorkdayBefore(shipTarget.start,data,shipTarget.ids):shipDate;
    const finalizingTarget=a.finalizingRequired?phasePlan(a,'Finalizing',finalizingDeadline):{start:finalizingDeadline,end:finalizingDeadline,hours:0,hpe:0,ids:[] as string[]};
    const downstreamStart=a.finalizingRequired?finalizingTarget.start:finalizingDeadline;
    const targetBuildFinish=latestBuildFinishBeforeTestDownstream(downstreamStart,a,data);
    let start:string; let finish:string;
    const manualSegments=Array.isArray((a as any).manualWorkSegments)?(a as any).manualWorkSegments.filter((seg:any)=>(seg.phase||'Build')==='Build'&&Number(seg.hours)>0):[];
    if(manualSegments.length){
      const dates=manualSegments.map((seg:any)=>seg.date).filter(Boolean).sort();
      start=dates[0]||dateOnly(nextWorkdayFor(parseDate(a.manualStartDate||''),data,assignees));
      finish=dates[dates.length-1]||start;
    }
    else if(isManual){start=dateOnly(nextWorkdayFor(parseDate(a.manualStartDate||''),data,assignees));finish=addWorkHours(start,buildHPE,data,assignees)}
    else{
      let latestBuildFinish=targetBuildFinish;
      if(requestedFinish) latestBuildFinish=minDate(latestBuildFinish,requestedFinish);
      for(const empId of assignees){if(employeeLatest[empId]&&employeeLatest[empId]<latestBuildFinish)latestBuildFinish=employeeLatest[empId];}
      finish=latestBuildFinish; start=onHold?finish:subtractWorkHours(finish,buildHPE,data,assignees);
    }
    const depNames:string[]=[];
    // Top-level assemblies always depend on their project-specific sub assemblies.
    // This is separate from optional sequencing, so turning sequencing off or replacing
    // the sequence dropdown does not accidentally disconnect the top level from its subs.
    const childDepIds=a.type==='Top Level Assembly'
      ? assemblies.filter(x=>x.parentAssemblyId===a.id || (!!a.buildGroupId && x.type==='Sub Assembly' && x.buildGroupId===a.buildGroupId && x.projectId===a.projectId)).map(x=>x.id)
      : [];
    const explicitDepIds=!a.overrideDependencies?splitIds(a.dependsOn):[];
    const dependencyIds=Array.from(new Set([...childDepIds,...explicitDepIds].filter(id=>id && id!==a.id)));
    for(const depId of dependencyIds){
      const dep=byId[depId]||assemblies.find(x=>x.partNumber===depId);
      if(dep){
        const depItem=scheduleOne(dep,start,new Set(seen));
        depNames.push(dep.partNumber+(dep.instanceLabel?' '+dep.instanceLabel:''));
        if(depItem.scheduledEnd>start){start=depItem.scheduledEnd;finish=addWorkHours(start,buildHPE,data,assignees)}
      }
    }
    if(!onHold){for(const empId of assignees){employeeLatest[empId]=start;}}
    let gate=testGateEnd(finish,a,data);
    let readyForInternal=firstInternalWorkDateAfterTest(finish,a,data);
    let finalCompletion=finish;
    const buildItem=makeItem(a,'Build',start,finish,buildHours,buildHPE,assignees,depNames,false);
    scheduled[a.id]=buildItem;
    let missedWindow=!!(readyForInternal&&finalizingTarget.start&&readyForInternal>finalizingTarget.start);
    if(a.finalizingRequired){const p=addPhase(a,'Finalizing',finalizingTarget.start,finalizingTarget.end,readyForInternal,shipDate); if(p.item)scheduled[a.id+'|finalizing']=p.item; gate=p.end||gate; finalCompletion=p.end||finalCompletion; missedWindow=missedWindow||p.late;}
    missedWindow=missedWindow||!!(gate&&shipTarget.start&&gate>shipTarget.start);
    if(a.shippingRequired){const p=addPhase(a,'Shipping',shipTarget.start,shipTarget.end,gate,shipDate); if(p.item)scheduled[a.id+'|shipping']=p.item; gate=p.end||gate; finalCompletion=p.end||finalCompletion; missedWindow=missedWindow||p.late;}
    if(!a.finalizingRequired&&!a.shippingRequired)finalCompletion=testGateEnd(finish,a,data);
    const isLate=!!(shipDate&&(finalCompletion>shipDate||missedWindow));
    if(isLate){
      scheduled[a.id]={...scheduled[a.id],isLate:true};
      if(scheduled[a.id+'|finalizing'])scheduled[a.id+'|finalizing']={...scheduled[a.id+'|finalizing'],isLate:true};
      if(scheduled[a.id+'|shipping'])scheduled[a.id+'|shipping']={...scheduled[a.id+'|shipping'],isLate:true};
    }
    return buildItem;
  }
  for(const a of sorted)scheduleOne(a);
  return Object.values(scheduled).sort((a,b)=>a.scheduledStart.localeCompare(b.scheduledStart)||a.employeeName.localeCompare(b.employeeName)||String(a.phase).localeCompare(String(b.phase)));
}
export function capacityByEmployee(data:AppData){const s=buildSchedule(data);return data.employees.map(e=>{const items=s.filter(x=>splitIds(x.assignedTo).includes(e.id));const hours=Number(items.reduce((n,x)=>n+x.hoursPerEmployee,0).toFixed(1));return {employee:e.name,id:e.id,hours,items:items.length};}).sort((a,b)=>b.hours-a.hours);}
export function weeklyCapacity(data:AppData){const s=buildSchedule(data);const rows:Record<string,any>={};for(const item of s){for(const id of splitIds(item.assignedTo)){const emp=data.employees.find(e=>e.id===id);const key=item.week+'|'+id;if(!rows[key])rows[key]={week:item.week,employee:emp?.name||id,hours:0,items:0};rows[key].hours+=item.hoursPerEmployee;rows[key].items++;}}
return Object.values(rows).map((r:any)=>({...r,hours:Number(r.hours.toFixed(1))})).sort((a:any,b:any)=>a.week.localeCompare(b.week)||a.employee.localeCompare(b.employee));}
export function suggestEmployees(data:AppData,ignoreAssemblyId?:string,count=1,phase:'Build'|'Finalizing'|'Shipping'='Build'){
  const loads:Record<string,number>={};
  data.employees.filter(e=>e.active&&employeeCan(e as any,phase)).forEach(e=>loads[e.id]=0);
  for(const a of (data.projectAssemblies||data.assemblies||[])){
    if(a.id===ignoreAssemblyId)continue;
    const raw=phase==='Finalizing'?(a.finalizingAssignedTo||a.assignedTo):phase==='Shipping'?(a.shippingAssignedTo||a.assignedTo):a.assignedTo;
    for(const id of splitIds(raw||'')){if(loads[id]!==undefined)loads[id]+=(((Number(a.qty)||0)*(Number(a.hoursEach)||0)))/Math.max(1,splitIds(raw||'').length)}
  }
  return data.employees.filter(e=>e.active&&employeeCan(e as any,phase)).sort((a,b)=>(loads[a.id]||0)-(loads[b.id]||0)).slice(0,count)
}
export function scheduleHealth(data:AppData){const s=buildSchedule(data);return {late:s.filter(x=>x.isLate).length,complete:(data.projectAssemblies||data.assemblies||[]).filter(a=>Number(a.percent)>=100||a.status==='Complete').length,total:(data.projectAssemblies||data.assemblies||[]).length,onHold:(data.projectAssemblies||data.assemblies||[]).filter(a=>a.status==='On Hold'||a.holdReason).length};}
