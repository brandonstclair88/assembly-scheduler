import {AppData,ProjectAssembly,ScheduledItem} from './types';
import {buildSchedule,capacityForDate} from './scheduler';
import {previewSmartAssignSuggestions} from './smartAssign';

export type ScheduleWarningLevel='critical'|'capacity'|'info';
export type ScheduleWarningCode='sub_after_parent'|'non_working_day'|'over_capacity'|'missing_build_assignment'|'missing_finalizing_assignment'|'missing_shipping_assignment'|'no_preferred_employee_available'|'no_qualified_builder_available'|'no_qualified_finalizer_available'|'no_qualified_shipper_available'|'employee_unavailable'|'over_capacity_smart_assign'|'smart_assign_available'|'assigned_to_non_preferred_employee';
export type ScheduleWarning={
  id:string;
  level:ScheduleWarningLevel;
  code:ScheduleWarningCode;
  projectId?:string;
  projectName:string;
  assemblyId?:string;
  partNumber:string;
  description:string;
  date:string;
  employeeId?:string;
  employeeName?:string;
  reason:string;
  phase?:'Build'|'Finalizing'|'Shipping';
};

const MS_DAY=86400000;

function splitIds(value:string){
  return (value||'').split(/[\n,;\s]+/).map(x=>x.trim()).filter(Boolean);
}

function parseDate(value:string){
  const base=(value||'').slice(0,10);
  const date=base?new Date(base+'T00:00:00'):new Date();
  return isNaN(+date)?new Date():date;
}

function dateOnly(date:Date){
  return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
}

function nextDate(value:string){
  return dateOnly(new Date(+parseDate(value)+MS_DAY));
}

function taskHours(assembly:any){
  return Math.max(0,Number(assembly?.qty||1)*Number(assembly?.hoursEach||0));
}

function isStandaloneSub(assembly:any){
  return assembly?.type==='Sub Assembly' && !assembly?.parentAssemblyId && !assembly?.buildGroupId;
}

function employeeWorkDaySet(employee:any){
  return new Set(splitIds(employee?.workDays||''));
}

function hasCustomWeeklySchedule(employee:any){
  return employeeWorkDaySet(employee).size>0;
}

function projectLabel(project:any){
  if(!project)return 'Project';
  if(project.projectId && project.name)return `${project.projectId} — ${project.name}`;
  return project.projectId || project.name || 'Project';
}

function effectiveAssignmentIds(assembly:any,phase:'Build'|'Finalizing'|'Shipping'){
  const raw=phase==='Finalizing'
    ? (assembly?.finalizingAssignedTo||assembly?.assignedTo)
    : phase==='Shipping'
      ? (assembly?.shippingAssignedTo||assembly?.assignedTo)
      : assembly?.assignedTo;
  return splitIds(raw||'');
}

function buildItemMap(schedule:ScheduledItem[]){
  const byKey:Record<string,ScheduledItem>={};
  for(const item of schedule){
    const sourceId=item.sourceAssemblyId||String(item.id).split('|')[0];
    const phase=(item.phase||'Build') as 'Build'|'Finalizing'|'Shipping';
    byKey[`${sourceId}|${phase}`]=item;
  }
  return byKey;
}

type ScheduleChunk=ScheduledItem&{employeeChunkId:string;chunkDate:string;chunkHours:number;segmentIndex?:number};

function expandScheduleChunks(data:AppData,schedule:ScheduledItem[]){
  const assemblies=Object.fromEntries((data.projectAssemblies||[]).map(a=>[a.id,a]));
  const chunks:ScheduleChunk[]=[];
  for(const item of schedule){
    const sourceId=item.sourceAssemblyId||String(item.id).split('|')[0];
    const source:any=assemblies[sourceId];
    const manualSegments=(item.phase==='Build'&&Array.isArray(source?.manualWorkSegments))
      ? source.manualWorkSegments.filter((segment:any)=>(segment.phase||'Build')==='Build'&&Number(segment.hours)>0)
      : [];
    if(manualSegments.length){
      manualSegments.forEach((segment:any,index:number)=>{
        chunks.push({...item,employeeChunkId:segment.employeeId||'',chunkDate:segment.date,chunkHours:Number(segment.hours)||0,segmentIndex:index});
      });
      continue;
    }
    const assignees=splitIds(item.assignedTo||'');
    if(!assignees.length){
      let date=item.scheduledStart;
      let remaining=Number(item.hoursPerEmployee)||Number(item.totalHours)||0;
      let guard=0;
      while(remaining>0&&guard<120){
        const cap=capacityForDate(data,'',date);
        if(cap>0){
          const hours=Math.min(remaining,cap);
          chunks.push({...item,employeeChunkId:'',chunkDate:date,chunkHours:hours});
          remaining-=hours;
        }
        date=nextDate(date);
        guard++;
      }
      continue;
    }
    for(const employeeId of assignees){
      let date=item.scheduledStart;
      let remaining=Number(item.hoursPerEmployee)||0;
      let guard=0;
      while(remaining>0&&guard<120){
        const cap=capacityForDate(data,employeeId,date);
        if(cap>0){
          const hours=Math.min(remaining,cap);
          chunks.push({...item,employeeChunkId:employeeId,chunkDate:date,chunkHours:hours});
          remaining-=hours;
        }
        date=nextDate(date);
        guard++;
      }
    }
  }
  return chunks;
}

export function calculateScheduleWarnings(data:AppData,scheduleInput?:ScheduledItem[]){
  const schedule=scheduleInput||buildSchedule(data);
  const projects=Object.fromEntries((data.projects||[]).map(project=>[project.id,project]));
  const employees=Object.fromEntries((data.employees||[]).map(employee=>[employee.id,employee]));
  const assemblies=(data.projectAssemblies||data.assemblies||[]) as ProjectAssembly[];
  const assembliesById=Object.fromEntries(assemblies.map(assembly=>[assembly.id,assembly]));
  const scheduleByKey=buildItemMap(schedule);
  const warnings:ScheduleWarning[]=[];
  const seen=new Set<string>();

  function pushWarning(warning:ScheduleWarning){
    if(seen.has(warning.id))return;
    seen.add(warning.id);
    warnings.push(warning);
  }

  function warningBase(assembly:any){
    const project=projects[assembly?.projectId];
    return {
      projectId:assembly?.projectId||'',
      projectName:projectLabel(project),
      assemblyId:assembly?.id||'',
      partNumber:assembly?.partNumber||'—',
      description:assembly?.description||assembly?.partNumber||'Assembly',
    };
  }

  for(const assembly of assemblies){
    const base=warningBase(assembly);
    const buildItem=scheduleByKey[`${assembly.id}|Build`];
    const finalizingItem=scheduleByKey[`${assembly.id}|Finalizing`];
    const shippingItem=scheduleByKey[`${assembly.id}|Shipping`];
    const buildDone=assembly.status==='Complete'||Number(assembly.percent||0)>=100;
    const shippingNeedsAssignment=!!assembly.shippingRequired || (!!assembly.shipDate && (assembly.type==='Top Level Assembly' || isStandaloneSub(assembly)));

    if(taskHours(assembly)>0 && !buildDone && effectiveAssignmentIds(assembly,'Build').length===0){
      pushWarning({
        id:`missing-build-${assembly.id}`,
        level:'info',
        code:'missing_build_assignment',
        ...base,
        date:buildItem?.scheduledStart||assembly.manualStartDate||assembly.shipDate||'',
        reason:'Build work has no assigned employee.',
        phase:'Build',
      });
    }

    if(assembly.finalizingRequired && !assembly.finalizingComplete && effectiveAssignmentIds(assembly,'Finalizing').length===0){
      pushWarning({
        id:`missing-finalizing-${assembly.id}`,
        level:'critical',
        code:'missing_finalizing_assignment',
        ...base,
        date:finalizingItem?.scheduledStart||buildItem?.scheduledEnd||assembly.shipDate||'',
        reason:'Finalizing is required but no finalizing employee is assigned.',
        phase:'Finalizing',
      });
    }

    if(shippingNeedsAssignment && !assembly.shippingComplete && effectiveAssignmentIds(assembly,'Shipping').length===0){
      pushWarning({
        id:`missing-shipping-${assembly.id}`,
        level:'critical',
        code:'missing_shipping_assignment',
        ...base,
        date:shippingItem?.scheduledStart||assembly.shipDate||'',
        reason:'Shipping is expected but no shipping employee is assigned.',
        phase:'Shipping',
      });
    }

    if(assembly.type==='Sub Assembly'){
      const parent=assembly.parentAssemblyId
        ? assembliesById[assembly.parentAssemblyId]
        : assemblies.find(candidate=>candidate.type==='Top Level Assembly'&&candidate.projectId===assembly.projectId&&candidate.buildGroupId&&candidate.buildGroupId===assembly.buildGroupId);
      const parentBuild=parent?scheduleByKey[`${parent.id}|Build`]:undefined;
      if(parentBuild && buildItem && buildItem.scheduledEnd>parentBuild.scheduledStart){
        pushWarning({
          id:`sub-after-parent-${assembly.id}-${parent.id}`,
          level:'critical',
          code:'sub_after_parent',
          ...base,
          date:buildItem.scheduledEnd,
          reason:`Sub assembly finishes after parent build starts (${parent.partNumber} ${parent.instanceLabel||''}).`,
          phase:'Build',
        });
      }
    }
  }

  const chunks=expandScheduleChunks(data,schedule);
  const totals:Record<string,{employeeId:string;employeeName:string;date:string;hours:number;chunks:ScheduleChunk[]}>={};
  for(const chunk of chunks){
    if(!chunk.employeeChunkId)continue;
    const employee:any=employees[chunk.employeeChunkId];
    if(!employee)continue;
    const key=`${employee.id}|${chunk.chunkDate}`;
    if(!totals[key])totals[key]={employeeId:employee.id,employeeName:employee.name||employee.id,date:chunk.chunkDate,hours:0,chunks:[]};
    totals[key].hours+=Number(chunk.chunkHours)||0;
    totals[key].chunks.push(chunk);

    if(hasCustomWeeklySchedule(employee)){
      const weekday=String(parseDate(chunk.chunkDate).getDay());
      if(!employeeWorkDaySet(employee).has(weekday)){
        const source=assembliesById[chunk.sourceAssemblyId||String(chunk.id).split('|')[0]];
        const base=warningBase(source||chunk);
        pushWarning({
          id:`non-working-${employee.id}-${chunk.chunkDate}-${chunk.sourceAssemblyId||chunk.id}-${chunk.phase||'Build'}`,
          level:'capacity',
          code:'non_working_day',
          ...base,
          date:chunk.chunkDate,
          employeeId:employee.id,
          employeeName:employee.name||employee.id,
          reason:'Assigned on a non-working day from the employee weekly schedule.',
          phase:(chunk.phase||'Build') as 'Build'|'Finalizing'|'Shipping',
        });
      }
    }
  }

  for(const cell of Object.values(totals)){
    const cap=capacityForDate(data,cell.employeeId,cell.date);
    if(cell.hours<=cap)continue;
    const first=cell.chunks.slice().sort((a,b)=>(Number(b.chunkHours)||0)-(Number(a.chunkHours)||0))[0];
    const source=assembliesById[first?.sourceAssemblyId||String(first?.id||'').split('|')[0]];
    const base=warningBase(source||first);
    pushWarning({
      id:`over-capacity-${cell.employeeId}-${cell.date}`,
      level:'capacity',
      code:'over_capacity',
      ...base,
      date:cell.date,
      employeeId:cell.employeeId,
      employeeName:cell.employeeName,
      reason:`${cell.hours.toFixed(1)} scheduled hours exceeds ${cap.toFixed(1)} available hours for the day.`,
      phase:(first?.phase||'Build') as 'Build'|'Finalizing'|'Shipping',
    });
  }

  for(const suggestion of previewSmartAssignSuggestions(data,schedule)){
    const assembly=assembliesById[suggestion.assemblyId];
    const base=warningBase(assembly||suggestion);
    const codeMap:Record<string,ScheduleWarningCode>={
      smart_assign_available:'smart_assign_available',
      no_preferred_employee_available:'no_preferred_employee_available',
      no_qualified_builder_available:'no_qualified_builder_available',
      no_qualified_finalizer_available:'no_qualified_finalizer_available',
      no_qualified_shipper_available:'no_qualified_shipper_available',
      employee_unavailable:'employee_unavailable',
      over_capacity_smart_assign:'over_capacity_smart_assign',
      assigned_to_non_preferred_employee:'assigned_to_non_preferred_employee',
    };
    pushWarning({
      id:`smart-assign-${suggestion.id}`,
      level:suggestion.diagnostic==='assigned_to_non_preferred_employee'
        ? 'info'
        : suggestion.status==='suggested'
          ? 'info'
          : 'critical',
      code:codeMap[suggestion.diagnostic]||'smart_assign_available',
      ...base,
      projectId:suggestion.projectId||base.projectId,
      projectName:suggestion.projectName||base.projectName,
      partNumber:suggestion.partNumber||base.partNumber,
      description:suggestion.description||base.description,
      date:suggestion.date||assembly?.shipDate||'',
      employeeId:suggestion.employeeId,
      employeeName:suggestion.employeeName,
      phase:suggestion.phase,
      reason:suggestion.diagnostic==='assigned_to_non_preferred_employee'
        ? `${suggestion.reason} A non-preferred employee may still be the right fit when the ship date is urgent.`
        : suggestion.status==='suggested'
          ? `${suggestion.reason} Smart Assign can preview this change safely.`
          : suggestion.reason,
    });
  }

  return warnings.sort((a,b)=>a.date.localeCompare(b.date)||a.level.localeCompare(b.level)||a.projectName.localeCompare(b.projectName)||a.partNumber.localeCompare(b.partNumber));
}
