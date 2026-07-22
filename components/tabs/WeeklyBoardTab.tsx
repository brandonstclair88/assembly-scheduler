'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {expandChunks,externalWaitEnd} from '../../lib/chunks';
import {dateOnly,fmtDate,fmtDateTime,splitIds} from '../../lib/format';
import {applyAssemblyPatch} from '../../lib/mutations';
import {download} from '../../lib/persistence';
import {capacityForDate} from '../../lib/scheduler';
import {applySmartAssignSuggestionsToData,previewSmartAssignSuggestions,smartAssignSuggestionMapByAssemblyPhase} from '../../lib/smartAssign';
import {BufferedPercentInput,HealthBadge,ScheduleWarningsPanel,phaseBadgeLabel,phaseToneKey,projectAccentColor,rolledCompletion} from '../shared/common';

export function WeeklyBoard({data,setData,schedule,warnings,projectHealthById,boardIntent,onOpenProject}:any){
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
	 const [focusedAssemblyId,setFocusedAssemblyId]=useState('');
	 const [detailTarget,setDetailTarget]=useState<any>(null);
	 const [showAutoAssignPreview,setShowAutoAssignPreview]=useState(false);
	 const [smartAssignOptions,setSmartAssignOptions]=useState({assignBlanksOnly:true,improveExistingUnlockedAssignments:true,balanceThisWeek:true,prioritizeShipDates:true,reduceOverloads:true});
	 const [smartAssignSelection,setSmartAssignSelection]=useState<string[]>([]);
	 const [lastAutoAssignRun,setLastAutoAssignRun]=useState<any|null>(null);
	 const [showAutoAssignResults,setShowAutoAssignResults]=useState(false);
	 const [recentAutoAssignedKeys,setRecentAutoAssignedKeys]=useState<string[]>([]);
	 const [expandedSuggestionIds,setExpandedSuggestionIds]=useState<string[]>([]);
	 function toggleSuggestionExpanded(id:string){setExpandedSuggestionIds((value:string[])=>value.includes(id)?value.filter(x=>x!==id):[...value,id])}
	 const [showScheduleWarnings,setShowScheduleWarnings]=useState(false);
	 const lastAutoScrollAt=useRef(0);
	 const autoScrollFrame=useRef<any>(null);
	 const autoScrollDelta=useRef(0);
	 const autoAssignResultsRef=useRef<HTMLDivElement>(null);
	 useEffect(()=>{
	   // Applying a Smart Assign suggestion collapses the (often very tall,
	   // many-hundred-px) preview panel and replaces it with this much
	   // shorter results panel higher up the page. A single scrollIntoView
	   // right after the click lands in the wrong place: it fires before
	   // the browser finishes reflowing the now-shorter page, so the very
	   // collapse we're scrolling to react to shifts the target out of
	   // view again a moment later. Re-running scrollIntoView a few times
	   // over the following half-second reliably lands after that reflow
	   // settles, however long it takes.
	   if(!lastAutoAssignRun)return;
	   const delays=[0,50,150,300,600];
	   const timers=delays.map(ms=>setTimeout(()=>{
	     autoAssignResultsRef.current?.scrollIntoView({behavior:'smooth',block:'start'});
	   },ms));
	   return()=>{timers.forEach(clearTimeout)};
	 },[lastAutoAssignRun]);
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
 function addShopWaitDays(startDate:string,hours:number){return externalWaitEnd(data,startDate,hours)}
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
	 function scheduleWait(start:string,hours:number){return externalWaitEnd(data,start,hours)}
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
	 function buildChunks(){return expandChunks(data,schedule,{maxDays:240})}
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
 function assemblyAccentColor(id:string){let h=0;const str=String(id||'');for(let i=0;i<str.length;i++)h=(h*31+str.charCodeAt(i))>>>0;return `hsl(${h%360} 62% 42%)`}
 const chunkMeta=(()=>{
   const byKey:Record<string,any[]>={};
   for(const c of rawChunks){const k=`${c.sourceAssemblyId||String(c.id).split('|')[0]}|${c.phase||'Build'}`;(byKey[k]=byKey[k]||[]).push(c)}
   const meta=new Map<any,any>();
   Object.values(byKey).forEach((list:any[])=>{
     const sorted=[...list].sort((a:any,b:any)=>String(a.chunkDate).localeCompare(String(b.chunkDate))||((Number(a.segmentIndex)||0)-(Number(b.segmentIndex)||0))||String(a.employeeChunkId||'').localeCompare(String(b.employeeChunkId||'')));
     let run=0;
     sorted.forEach((c:any,i:number)=>{meta.set(c,{index:i+1,count:sorted.length,hrsBefore:run,contPrev:false,contNext:false});run+=Number(c.chunkHours)||0});
     const byEmp:Record<string,any[]>={};
     sorted.forEach((c:any)=>{const e=c.employeeChunkId||'';(byEmp[e]=byEmp[e]||[]).push(c)});
     Object.values(byEmp).forEach((empList:any[])=>{
       const near=(a:string,b:string)=>Math.abs(new Date(b+'T00:00:00').getTime()-new Date(a+'T00:00:00').getTime())<=3*86400000;
       empList.forEach((c:any,i:number)=>{
         const mm=meta.get(c);if(!mm)return;
         const prev=empList[i-1],next=empList[i+1];
         mm.contPrev=!!(prev&&near(prev.chunkDate,c.chunkDate));
         mm.contNext=!!(next&&near(c.chunkDate,next.chunkDate));
       });
     });
   });
   return meta;
 })();
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
   setData((d:any)=>applyAssemblyPatch(d,sourceId,phase==='Inspection'?{inspectionComplete:pct>=100}:phase==='Shipping'?{shippingComplete:pct>=100}:{percent:pct}));
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
export function TaskCard({s}:any){
  const dragKey=`${s.scheduleId||s.id}::chunk::${s.segmentIndex??0}::hours::${Number(s.chunkHours)||0}`;
  const src=s.sourceAssemblyId||String(s.id).split('|')[0];
  const phase=s.phase||'Build';
  const phaseLabel=phaseBadgeLabel(phase);
  const phaseTone=phaseToneKey(phase);
  const source=sourceAssembly(src)||s;
  const pct=phasePercentFor(src,phase,s);
  const totalHrs=Number(source.qty||0)*Number(source.hoursEach||0);
  const completeHrs=phase==='Build'?Number(((pct/100)*totalHrs).toFixed(1)):null;
  const m=chunkMeta.get(s)||{index:(Number(s.segmentIndex)||0)+1,count:1,hrsBefore:0,contPrev:false,contNext:false};
  const tileEnd=m.hrsBefore+(Number(s.chunkHours)||0);
  const tol=Math.max(0.1,totalHrs*0.01);
  const buildTileDone=phase==='Build'&&completeHrs!==null&&completeHrs+tol>=tileEnd;
  const buildTilePartial=phase==='Build'&&completeHrs!==null&&completeHrs>m.hrsBefore&&!buildTileDone;
  function startDrag(e:any){if(boardMode==='Live')return;e.dataTransfer.effectAllowed='move';e.dataTransfer.setData('asm',dragKey);e.dataTransfer.setData('text/plain',dragKey)}
  const status=cardStatus(s);
  const locked=!!source.locked;
  const tileProject=(data.projects||[]).find((p:any)=>p.id===(source.projectId||s.projectId));
  const dimmed=shouldDimProject(source.projectId||s.projectId||'');
  const suggestion=autoAssignSuggestionMap[`${src}|${phase}`];
  const autoAssigned=recentAutoAssignedKeys.includes(`${src}|${phase}`);
  const asmFocus=focusedAssemblyId?(focusedAssemblyId===src?'focusedAssembly ':'dimmedByFocus '):'';
  const isCont=!!m.contPrev;
  function tileClick(){if(focusedAssemblyId===src&&detailTarget?.sourceId===src){setFocusedAssemblyId('');setDetailTarget(null)}else{setFocusedAssemblyId(src);setDetailTarget({sourceId:src,phase})}}
  return <div data-asm={src} data-phase={phase} data-date={s.chunkDate} className={'task phaseCard phase-'+phaseTone+' status'+status.replace(/\s+/g,'')+' '+asmFocus+(isCont?'runCont ':'')+(m.contNext?'runNext ':'')+(locked?'lockedTask ':'')+(buildTileDone?'buildTileDone ':'')+(buildTilePartial?'buildTilePartial ':'')+(s.chunkLabel==='Draft'?'draftTask ':'')+(s.isLive?' liveForecastTask ':'')+(s.forecastMoved?' forecastMovedTask ':'')+(s.forecastBlocked?' forecastBlockedTask ':'')+(dimmed?'taskDimmed ':'')+(projectFocusId!=='All'&&!dimmed?'taskFocused ':'')+(autoAssigned?' autoAssignedTask ':'')+((boardDensity==='compact'||boardDensity==='ultra')?'compactTask ':'')+(boardDensity==='ultra'?'ultraCompactTask ':'')} style={{'--project-accent':projectAccentColor(source.projectId||s.projectId||''),'--assembly-accent':assemblyAccentColor(src)} as any} draggable={!locked&&boardMode!=='Live'} onDragStart={boardMode==='Live'?undefined:startDrag} onDragEnd={stopAutoScroll} onClick={tileClick}><span className="asmStripe"/>{isCont?<>
    <div className="taskProgress"><div className="taskProgressFill" style={{width:`${Math.max(0,Math.min(100,pct))}%`}}/></div>
    <b className="contLabel">↳ {(source.instanceLabel||s.instanceLabel||'')} Day {m.index}/{m.count}</b>
    <span className="chunkHours">{Number(s.chunkHours).toFixed(1)} hrs{phase==='Build'&&totalHrs?` · ${m.hrsBefore.toFixed(1)}–${tileEnd.toFixed(1)} of ${totalHrs.toFixed(1)}`:''}</span>
    {s.isLate&&<span className="lateBadge">late</span>}{s.chunkLabel==='Draft'&&<span className="splitBadge">draft</span>}{s.chunkLabel==='Manual'&&<span className="splitBadge">manual</span>}{s.forecastMoved&&<span className="forecastMovedBadge">Moved</span>}
  </>:<>
    <div className="taskBadgeRow"><span className={`phaseBadge phase-${phaseTone}`}>{phaseLabel}</span><span className="statusBadge">{status}</span>{locked&&<span className="forecastBadge">LOCK</span>}{autoAssigned&&<span className="forecastBadge autoBadge">AUTO</span>}{s.isLive&&<span className="forecastBadge">Live</span>}{s.forecastMoved&&<span className="forecastMovedBadge">Moved</span>}{s.isLate&&<span className="lateBadge">late</span>}</div>
    <div className="taskProgress"><div className="taskProgressFill" style={{width:`${Math.max(0,Math.min(100,pct))}%`}}/></div>
    <b className="tileDescription">{(source.instanceLabel||s.instanceLabel)&&<span className="tileAssemblyNo">{source.instanceLabel||s.instanceLabel}</span>}{source.description||s.description}</b>
    {s.batchId&&<span className="batchBadge">{(data.shipmentBatches||[]).find((b:any)=>b.id===s.batchId)?.name}</span>}
    <span className="tileMeta">{tileProject?.projectId||s.projectName} · P/N {source.partNumber||s.partNumber}</span>
    <span className="chunkHours">Day {m.index}/{m.count} · {Number(s.chunkHours).toFixed(1)} hrs{phase==='Build'&&totalHrs?` · ${m.hrsBefore.toFixed(1)}–${tileEnd.toFixed(1)} of ${totalHrs.toFixed(1)}`:''}</span>
    {!s.employeeChunkId&&suggestion?.employeeName&&<span className="suggestedAssignBadge">Suggest: {suggestion.employeeName}</span>}
    {suggestion?.nonPreferredButNecessary&&<span className="suggestedAssignBadge warn">Non-preferred but needed</span>}
    {s.chunkLabel==='Manual'&&<span className="splitBadge">manual</span>}{s.chunkLabel==='Partial'&&<span className="splitBadge">split</span>}{s.chunkLabel==='Live Hold'&&<span className="splitBadge">hold</span>}
  </>}</div>
}
export function FocusFlowOverlay(){
  const [segs,setSegs]=useState<any[]>([]);
  useEffect(()=>{
    if(!focusedAssemblyId){setSegs([]);return;}
    let raf:any=null;
    function compute(){
      const asm=sourceAssembly(focusedAssemblyId);
      if(!asm){setSegs([]);return;}
      const top=asm.type==='Top Level Assembly'?asm:((data.projectAssemblies||[]).find((a:any)=>a.id===asm.parentAssemblyId)||(data.projectAssemblies||[]).find((a:any)=>a.buildGroupId&&asm.buildGroupId&&a.buildGroupId===asm.buildGroupId&&a.type==='Top Level Assembly')||asm);
      const family=new Set<string>([asm.id]);
      if(top){family.add(top.id);(data.projectAssemblies||[]).forEach((a:any)=>{if(a.parentAssemblyId===top.id||(top.buildGroupId&&a.buildGroupId===top.buildGroupId&&a.projectId===top.projectId))family.add(a.id)});}
      const pts:any[]=[];
      family.forEach(id=>{document.querySelectorAll(`[data-asm="${id}"]`).forEach(el=>{const r=(el as HTMLElement).getBoundingClientRect();if(r.width>0&&r.height>0)pts.push({id,phase:(el as HTMLElement).dataset.phase||'Build',date:(el as HTMLElement).dataset.date||'',x:r.left+r.width/2,y:r.top+r.height/2})})});
      const rank:any={Build:0,Test:1,Inspection:2,Shipping:3};
      pts.sort((a:any,b:any)=>String(a.date).localeCompare(String(b.date))||((rank[a.phase]??0)-(rank[b.phase]??0))||(a.id===top?.id?1:0)-(b.id===top?.id?1:0));
      const out:any[]=[];
      for(let i=0;i<pts.length-1;i++)out.push({x1:pts[i].x,y1:pts[i].y,x2:pts[i+1].x,y2:pts[i+1].y});
      setSegs(out);
    }
    compute();
    const onScroll=()=>{if(raf)return;raf=requestAnimationFrame(()=>{raf=null;compute()})};
    window.addEventListener('scroll',onScroll,true);
    window.addEventListener('resize',onScroll);
    const interval=setInterval(compute,700);
    return()=>{window.removeEventListener('scroll',onScroll,true);window.removeEventListener('resize',onScroll);clearInterval(interval);if(raf)cancelAnimationFrame(raf)};
  },[focusedAssemblyId]);
  if(!focusedAssemblyId||!segs.length)return null;
  const color=assemblyAccentColor(focusedAssemblyId);
  return <svg className="flowOverlay" aria-hidden="true">{segs.map((g:any,i:number)=><g key={i}><path d={`M ${g.x1} ${g.y1} C ${(g.x1+g.x2)/2} ${g.y1}, ${(g.x1+g.x2)/2} ${g.y2}, ${g.x2} ${g.y2}`} stroke={color} strokeWidth={2.5} fill="none" opacity={0.9} strokeDasharray="7 5"/><circle cx={g.x2} cy={g.y2} r={3.5} fill={color} opacity={0.9}/></g>)}</svg>
}
export function AssemblyDetailPanel(){
  if(!detailTarget)return null;
  const asm=sourceAssembly(detailTarget.sourceId);
  if(!asm)return null;
  const proj=(data.projects||[]).find((p:any)=>p.id===asm.projectId);
  const items=schedule.filter((x:any)=>(x.sourceAssemblyId||String(x.id).split('|')[0])===asm.id);
  const build=items.find((x:any)=>(x.phase||'Build')==='Build');
  const insp=items.find((x:any)=>x.phase==='Inspection');
  const shipItem=items.find((x:any)=>x.phase==='Shipping');
  const hasManualSegs=Array.isArray(asm.manualWorkSegments)&&asm.manualWorkSegments.length>0;
  const totalHrs=Number(asm.qty||0)*Number(asm.hoursEach||0);
  const buildPct=Math.max(0,Math.min(100,Number(asm.percent||0)));
  return <div className="assemblyDetailPanel" style={{'--assembly-accent':assemblyAccentColor(asm.id)} as any}>
    <div className="assemblyDetailHeader"><div><b><span className="asmDot"/>{asm.description||asm.partNumber}</b><span className="muted small">{asm.partNumber} {asm.instanceLabel||''} · {proj?.projectId||'Project'} · Overall {rolledCompletion(data,asm)}%</span></div><button className="btn" onClick={()=>{setDetailTarget(null);setFocusedAssemblyId('')}}>Close</button></div>
    <div className="assemblyDetailPhases">
      {build&&<div className={'detailPhaseRow'+(build.isLate?' late':'')}><span className="phaseBadge phase-build">BUILD</span><span>{fmtDate(build.scheduledStart)} → {fmtDate(build.scheduledEnd)}</span><span>{Number(build.totalHours||0).toFixed(1)} hrs</span><span>{build.assignedEmployeeNames||'Unassigned'}</span></div>}
      {(asm.testRequired||Number(asm.testHours||0)>0)&&<div className="detailPhaseRow"><span className="phaseBadge phase-test">TEST</span><span>{asm.testReturnDateTime?`Expected return ${fmtDateTime(asm.testReturnDateTime)}`:`${Number(asm.testHours||0).toFixed(1)} hr external gate`}</span></div>}
      {insp&&<div className={'detailPhaseRow'+(insp.isLate?' late':'')}><span className="phaseBadge phase-inspect">INSPECT</span><span>{fmtDate(insp.scheduledStart)} → {fmtDate(insp.scheduledEnd)}</span><span>{Number(insp.totalHours||0).toFixed(1)} hrs</span><span>{insp.assignedEmployeeNames||'Unassigned'}</span></div>}
      {shipItem&&<div className={'detailPhaseRow'+(shipItem.isLate?' late':'')}><span className="phaseBadge phase-ship">SHIP</span><span>{fmtDate(shipItem.scheduledStart)} → {fmtDate(shipItem.scheduledEnd)}</span><span>{Number(shipItem.totalHours||0).toFixed(1)} hrs</span><span>{shipItem.assignedEmployeeNames||'Unassigned'}</span></div>}
      <div className="detailPhaseRow"><span className="phaseBadge">SHIP BY</span><span>{fmtDate(asm.shipDate)||'Not set'}</span>{asm.lateAllowed&&<span className="pill warn">Late allowed</span>}{(asm.status==='On Hold'||asm.holdReason)&&<span className="pill bad">On Hold{asm.holdReason?`: ${asm.holdReason}`:''}</span>}</div>
    </div>
    {boardMode!=='Live'&&<div className="assemblyDetailControls">
      <div className="field"><label>Build % Complete ({(buildPct/100*totalHrs).toFixed(1)} / {totalHrs.toFixed(1)} hrs)</label><BufferedPercentInput className="largeInput" value={buildPct} onCommit={(value:any)=>updateCompletion(asm.id,'Build',value)}/></div>
      {asm.inspectionRequired&&<label className="checkLine"><input type="checkbox" checked={!!asm.inspectionComplete} onChange={e=>updateCompletion(asm.id,'Inspection',e.target.checked?100:0)}/> Inspection complete</label>}
      {asm.shippingRequired&&<label className="checkLine"><input type="checkbox" checked={!!asm.shippingComplete} onChange={e=>updateCompletion(asm.id,'Shipping',e.target.checked?100:0)}/> Shipping complete</label>}
      <div className="actions"><button className="btn" onClick={()=>toggleLock(asm.id)}>{asm.locked?'Unlock Assignment':'Lock Assignment'}</button>{hasManualSegs&&<button className="btn" onClick={()=>clearSegments(asm.id)}>Reset split</button>}{onOpenProject&&<button className="btn" onClick={()=>onOpenProject(asm.projectId)}>Open project</button>}</div>
    </div>}
  </div>
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

      <div className="autoAssignCompactList">
        {autoAssignSuggestions.length===0&&<p className="muted">No Smart Assign changes are suggested right now.</p>}
        {autoAssignSuggestions.map((suggestion:any)=>{
          const tone=smartAssignToneFor(suggestion);
          const selectedSuggestion=smartAssignSelection.includes(suggestion.id);
          const expanded=expandedSuggestionIds.includes(suggestion.id);
          return (
            <div key={suggestion.id} className={`autoAssignRow ${tone}${expanded?' expanded':''}`}>
              <div className="autoAssignRowMain" onClick={()=>toggleSuggestionExpanded(suggestion.id)}>
                {suggestion.status==='suggested'?<input type="checkbox" checked={selectedSuggestion} onClick={e=>e.stopPropagation()} onChange={e=>setSmartAssignSelection((value:string[])=>e.target.checked?[...value,suggestion.id]:value.filter(id=>id!==suggestion.id))}/>:<span className="autoAssignRowSpacer"/>}
                <span className={`warningLevel ${tone}`}>{phaseBadgeLabel(suggestion.phase)}</span>
                <span className="warningDate">{fmtDate(suggestion.date)}</span>
                <b>{suggestion.projectCode}</b>
                <span className="autoAssignRowDesc">{suggestion.partNumber} — {suggestion.description}</span>
                {suggestion.currentEmployeeName&&<small>Current: {suggestion.currentEmployeeName}</small>}
                {suggestion.employeeName&&<small>Suggested: {suggestion.employeeName}</small>}
                {typeof suggestion.score==='number'&&<small>Score {Math.round(suggestion.score)}</small>}
                <span className={`autoAssignRowChevron${expanded?' open':''}`}>▾</span>
              </div>
              {expanded&&<div className="autoAssignRowDetail">
                <div className="smartAssignReasonMeta">
                  <small>Status: {suggestion.status}</small>
                  {suggestion.shipDate&&<small>Ship By {fmtDate(suggestion.shipDate)}</small>}
                  {suggestion.preferredMatch&&<small>Preferred project match</small>}
                  {suggestion.nonPreferredButNecessary&&<small>Non-preferred but necessary</small>}
                </div>
                <small>{suggestion.reason}</small>
              </div>}
            </div>
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
    <div className="autoAssignResultsPanel" ref={autoAssignResultsRef}>
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
      {showAutoAssignResults&&<div className="autoAssignCompactList">{items.length===0?<p className="muted">No suggestions were applied this run.</p>:items.map((suggestion:any)=>{const tone=smartAssignResultToneFor(suggestion);const rowKey=`result-${suggestion.id}-${suggestion.applyStatus}`;const expanded=expandedSuggestionIds.includes(rowKey);return <div key={rowKey} className={`autoAssignRow ${tone}${expanded?' expanded':''}`}><div className="autoAssignRowMain" onClick={()=>toggleSuggestionExpanded(rowKey)}><span className={`warningLevel ${tone}`}>{phaseBadgeLabel(suggestion.phase)}</span><span className="warningDate">{fmtDate(suggestion.date)}</span><b>{suggestion.projectCode}</b><span className="autoAssignRowDesc">{suggestion.partNumber} — {suggestion.description}</span><small>{suggestion.applyStatus==='applied'?'Applied':suggestion.applyStatus==='skipped'?'Skipped':'Failed'}</small>{suggestion.employeeName&&<small>Suggested: {suggestion.employeeName}</small>}<span className={`autoAssignRowChevron${expanded?' open':''}`}>▾</span></div>{expanded&&<div className="autoAssignRowDetail"><div className="smartAssignReasonMeta">{suggestion.currentEmployeeName&&<small>Current: {suggestion.currentEmployeeName}</small>}{suggestion.shipDate&&<small>Ship By {fmtDate(suggestion.shipDate)}</small>}{typeof suggestion.score==='number'&&<small>Score {Math.round(suggestion.score)}</small>}{suggestion.preferredMatch&&<small>Preferred project match</small>}{suggestion.nonPreferredButNecessary&&<small>Non-preferred but necessary</small>}</div><small>{suggestion.applyReason}</small>{suggestion.reason&&<small className="muted">{suggestion.reason}</small>}</div>}</div>})}</div>}
    </div>
  );
 }
 return <div className={`card weeklyBoardCard density-${boardDensity}`}><div className="boardHeader"><div><h2>Weekly Board</h2><p className="muted">{boardMode==='Live'?'Read-only forecast from saved schedule, status, holds, time off, tests, dependencies, and ship rules.':'Drag individual daily chunks. Moves stay in draft mode until you click Apply Changes, so accidental moves can be discarded.'}</p></div><div className="boardTools enhancedBoardTools">
  <div className="boardToolGroup boardToolGroupView">
   <span className="boardToolGroupLabel">View</span>
   <div className="boardToolGroupRow">
    <div className="modeToggle"><button className={boardMode==='Current'?'active':''} onClick={()=>setBoardMode('Current')}>Current</button><button className={boardMode==='Live'?'active':''} onClick={()=>{setBoardMode('Live');setBoardDrafts([])}}>Live Forecast</button></div>
    <div className="modeToggle compactToggle"><button className={boardDensity==='comfortable'?'active':''} onClick={()=>setBoardDensity('comfortable')}>Comfortable</button><button className={boardDensity==='compact'?'active':''} onClick={()=>setBoardDensity('compact')}>Compact</button><button className={boardDensity==='ultra'?'active':''} onClick={()=>setBoardDensity('ultra')}>Ultra Compact</button></div>
    <div className="field monthPick"><label>Month</label><input type="month" value={selectedMonth} onChange={e=>setSelectedMonth(e.target.value)}/></div>
    <div className="field monthPick"><label>Search</label><input value={boardSearch} onChange={e=>setBoardSearch(e.target.value)} placeholder="Project / P/N"/></div>
    <div className="field monthPick"><label>Employee</label><select value={employeeFilter} onChange={e=>setEmployeeFilter(e.target.value)}><option value="All">All employees</option>{activeEmployees.map((e:any)=><option key={e.id} value={e.id}>{e.name}</option>)}</select></div>
    <div className="field monthPick"><label>Status</label><select value={statusFilter} onChange={e=>setStatusFilter(e.target.value)}>{['All','Scheduled','Build Complete','At Risk','Blocked','Late','Shipped'].map(x=><option key={x}>{x}</option>)}</select></div>
    <label className="checkLine boardCheck"><input type="checkbox" checked={hideComplete} onChange={e=>setHideComplete(e.target.checked)}/> Hide completed</label>
    <label className="checkLine boardCheck"><input type="checkbox" checked={collapseEmptyRows} onChange={e=>setCollapseEmptyRows(e.target.checked)}/> Collapse empty rows</label>
   </div>
  </div>
  <div className="boardToolGroup boardToolGroupActions">
   <span className="boardToolGroupLabel">Actions</span>
   <div className="boardToolGroupRow">
    <button className="btn" onClick={findOpenCapacity}>Find open capacity</button>
    <button className="btn" disabled={boardMode==='Live'} onClick={suggestMoveForSelection}>Show conflicts</button>
    <button className="btn" disabled={boardMode==='Live'} onClick={previewBalanceThisWeek}>Preview Smart Rebalance</button>
    <button className="btn primary autoAssignPrimaryButton" title="Preview Smart Assign suggestions for unassigned work and unlocked assignments. Nothing is saved until you apply the suggestions." disabled={boardMode==='Live'} onClick={()=>setShowAutoAssignPreview(true)}>Smart Assign <span className="buttonBadge">{unassignedSuggestionCount} Unassigned</span><span className="buttonBadge good">{actionableAutoAssign.length} Auto-Assignable</span>{unlockedImprovementCount>0&&<span className="buttonBadge">{unlockedImprovementCount} Improvable</span>}{overloadCount>0&&<span className="buttonBadge warn">{overloadCount} Overloaded</span>}{lockedTileCount>0&&<span className="buttonBadge">{lockedTileCount} Locked</span>}</button>
    <button className="btn primary" disabled={boardMode==='Live'||!boardDrafts.length} onClick={applyBoardDrafts}>Apply Changes {boardDrafts.length?`(${boardDrafts.length})`:``}</button>
    <button className="btn" disabled={boardMode==='Live'||!boardDrafts.length} onClick={discardBoardDrafts}>Discard Changes</button>
   </div>
  </div>
  <div className="boardToolGroup boardToolGroupExport">
   <span className="boardToolGroupLabel">Export</span>
   <div className="boardToolGroupRow">
    <button className="btn quiet" onClick={exportWeeklyExcel}>Export Excel</button>
    <button className="btn quiet" onClick={printBoard}>Print</button>
    <button className="btn quiet" onClick={exportNextYearWeeklyPdf}>Export Next Year PDF</button>
   </div>
  </div>
 </div></div><div className="projectFocusBar"><div className="field projectFocusField"><label>Project Focus</label><select value={projectFocusId} onChange={e=>setProjectFocusId(e.target.value)}><option value="All">All Projects</option>{visibleProjects.map((project:any)=>{const record=projectHealthById?.[project.id];return <option key={project.id} value={project.id}>{project.projectId||project.name}{record?` • ${record.status}`:''}</option>})}</select></div>{projectFocusId!=='All'&&<><div className="projectFocusSummary"><HealthBadge status={projectHealthById?.[projectFocusId]?.status||'At Risk'}/><span>{visibleProjects.find((project:any)=>project.id===projectFocusId)?.name||visibleProjects.find((project:any)=>project.id===projectFocusId)?.projectId}</span></div><label className="checkLine boardCheck"><input type="checkbox" checked={hideOthers} onChange={e=>setHideOthers(e.target.checked)}/> Hide other projects</label><button className="btn" onClick={()=>{setProjectFocusId('All');setHideOthers(false);setHighlightDate('')}}>Clear focus</button>{onOpenProject&&<button className="btn" onClick={()=>onOpenProject(projectFocusId)}>Open project</button>}</>}</div>{focusedAssemblyId&&<div className="draftNotice focusNotice">Highlighting one assembly across the board. <button className="mini" onClick={()=>{setFocusedAssemblyId('');setDetailTarget(null)}}>Clear highlight</button></div>}{boardDrafts.length>0&&<div className="draftNotice weeklyDraftNotice">Draft mode: {boardDrafts.length} weekly board move{boardDrafts.length===1?``:`s`} pending. Dashboard/master schedule will update after Apply Changes.</div>}{capacitySuggestion&&<pre className="capacitySuggestion">{capacitySuggestion}</pre>}{showAutoAssignPreview&&<SmartAssignPreviewPanel/>}{lastAutoAssignRun&&<SmartAssignResultsPanel/>}<AssemblyDetailPanel/><FocusFlowOverlay/><div className="weeklyWarningWrap"><button type="button" className="weeklyWarningToggle" onClick={()=>setShowScheduleWarnings((v:boolean)=>!v)}><span>{showScheduleWarnings?'Hide':'Show'} Schedule Warnings</span><span className="scheduleWarningCounts"><span className="warningCount critical">{boardWarnings.filter((w:any)=>w.level==='critical').length} critical</span><span className="warningCount capacity">{boardWarnings.filter((w:any)=>w.level==='capacity').length} capacity</span><span className="warningCount info">{boardWarnings.filter((w:any)=>w.level==='info').length} info</span></span><span className={`weeklyWarningChevron${showScheduleWarnings?' open':''}`}>▾</span></button>{showScheduleWarnings&&<ScheduleWarningsPanel warnings={boardWarnings} maxItems={8} subtitle="These warnings are informational only. They do not block drag/drop or change saved schedule data." onAction={jumpToWarning} getActionLabel={(warning:any)=>warning.projectId||warning.date?'Jump to item':''}/>}</div>{weeks.map((w:string)=>{const weekEmployees=visibleEmployeesForWeek(w);const showUnassignedRow=!collapseEmptyRows||weekHasUnassigned(w);const showTestRow=!collapseEmptyRows||weekHasTests(w);const emptyWeek=weekEmployees.length===0&&!showUnassignedRow&&!showTestRow;return <div key={w} className={`weekBoard strongerWeekBoard density-${boardDensity}`}><h3 className="weekDividerHeader">Week of {fmtDate(w)}</h3>{emptyWeek?<div className="weekBoardEmpty muted">No visible work in this week with the current filters.</div>:<div className="employeeBoard" style={{"--week-days":days.length,gridTemplateColumns:`${labelColumnWidth}px repeat(${days.length}, minmax(${dayColumnWidth}px,1fr))`} as any}><div className="employeeHeader">Employee</div>{days.map((day,idx)=>{const date=dateFor(w,idx);return <div className={`dayHeader ${highlightDate===date?'highlightedBoardDate':''}`} key={day}><b>{day}</b><span>{fmtDate(date)}</span></div>})}{weekEmployees.map((emp:any)=><React.Fragment key={emp.id}><div className="employeeCell"><b>{emp.name}</b><span>{emp.skills}</span></div>{days.map((day,idx)=>{const date=dateFor(w,idx);const cards=cardsFor(emp.id,date);const hours=cards.reduce((n:number,s:any)=>n+(Number(s.chunkHours)||0),0);const cap=capacityForDate(data,emp.id,date);const overloaded=hours>cap;const friday=isFri(date);return <div className={'assignmentCell '+(overloaded?'overloaded ':'')+(cap===0?' unavailable ':'')+(highlightDate===date?'highlightedBoardDate ':'')} key={emp.id+day} onDragOver={boardMode==='Live'?undefined:boardDragOver} onDragLeave={stopAutoScroll} onDrop={e=>{stopAutoScroll();if(boardMode!=='Live')moveChunk(e.dataTransfer.getData('asm'),emp.id,date)}}>{friday&&<button className="mini otToggle" disabled={boardMode==='Live'} onClick={()=>toggleFri(emp.id,date)}>{cap>0?'Friday OT On':'Enable Friday OT'}</button>}{cap===0&&!friday&&<div className="offBadge">{absenceLabel(emp,date)||'Off / Holiday'}</div>}{overloaded&&<div className="overBadge">{hours.toFixed(1)} / {cap.toFixed(1)} hrs</div>}{!overloaded&&hours>0&&<div className="hourBadge">{hours.toFixed(1)} hrs</div>}{cards.map((row:any)=><TaskCard key={(row.employeeChunkId||'u')+row.id+row.chunkDate} s={row}/>)}</div>})}</React.Fragment>)}{showUnassignedRow&&<><div className="employeeCell unassignedLabel"><b>Unassigned</b><span>Unassigned work appears here until employees are selected</span></div>{days.map((day,idx)=>{const date=dateFor(w,idx);const cards=unassignedFor(date);return <div className={`assignmentCell ${highlightDate===date?'highlightedBoardDate':''}`} key={'unassigned'+day} onDragOver={boardMode==='Live'?undefined:boardDragOver} onDragLeave={stopAutoScroll} onDrop={e=>{stopAutoScroll();if(boardMode!=='Live')moveChunk(e.dataTransfer.getData('asm'),'',date)}}>{cards.map((row:any)=><TaskCard key={'u'+row.id+row.chunkDate} s={row}/>)}</div>})}</>}{showTestRow&&<><div className="employeeCell testRowLabel"><b>In Test</b><span>External test gate by day</span></div>{days.map((day,idx)=>{const date=dateFor(w,idx);const tests=testItemsFor(date);return <div className={`assignmentCell testAssignmentCell ${highlightDate===date?'highlightedBoardDate':''}`} key={'test'+day}>{tests.length===0&&<span className="muted small">No test items</span>}{tests.map((a:any)=>{const dimmed=shouldDimProject(a.projectId||'');return <div className={`testMiniCard phase-test ${dimmed?'taskDimmed ':''}${projectFocusId!=='All'&&!dimmed?'taskFocused ':''}${focusedAssemblyId?(focusedAssemblyId===a.id?'focusedAssembly ':'dimmedByFocus '):''}`} style={{'--project-accent':projectAccentColor(a.projectId||''),'--assembly-accent':assemblyAccentColor(a.id)} as any} key={a.id+date} data-asm={a.id} data-phase="Test" data-date={date} onClick={()=>{if(focusedAssemblyId===a.id){setFocusedAssemblyId('');setDetailTarget(null)}else{setFocusedAssemblyId(a.id);setDetailTarget({sourceId:a.id,phase:'Test'})}}}><div className="taskBadgeRow"><span className="phaseBadge phase-test">{phaseBadgeLabel('Test')}</span>{a.shipDate&&<span className="testReturnPill">Ship {fmtDate(a.shipDate)}</span>}</div><b>{a.description||a.partNumber}</b><span>Assembly: {a.partNumber||'—'} {a.instanceLabel||''}</span><small>{a.testReturnDateTime?`Expected return ${fmtDateTime(a.testReturnDateTime)}`:`Test gate ${Number(a.testHours||0).toFixed(1)}h`}</small></div>})}</div>})}</>}</div>}</div>})}</div>
}
