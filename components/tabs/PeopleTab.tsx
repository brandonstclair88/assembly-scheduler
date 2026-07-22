'use client';
import React,{useEffect,useMemo,useRef,useState} from 'react';
import {dateOnly,fmtDate,normalizeSearchQuery,projectSearchText,splitIds} from '../../lib/format';
import {dailyHours} from '../../lib/scheduler';
import {uid} from '../shared/common';

export function People({data,setData}:any){
 const [view,setView]=useState('Roster');
 return <div className="subTabPage">
  <div className="subTabBar">{['Roster','Availability'].map((v:string)=><button key={v} type="button" className={view===v?'active':''} onClick={()=>setView(v)}>{v}</button>)}</div>
  {view==='Roster'&&<Employees data={data} setData={setData}/>}
  {view==='Availability'&&<Availability data={data} setData={setData}/>}
 </div>
}

export function ProjectTrainingPicker({projects,employee,onChange}:any){
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

export function Employees({data,setData}:any){
 const blank={id:uid('emp'),name:'',email:'',skills:'',active:true,pto:'',timeOffDates:'',fridayOvertimeDates:'',workDays:'',workHoursByDay:'',canBuild:true,canInspect:true,canShip:true,trainedProjectIds:'',limitAutoAssignToTrainedProjects:false,preferredProjectIds:'',preferPreferredProjects:false};
 const weekdays=[['1','Mon'],['2','Tue'],['3','Wed'],['4','Thu'],['5','Fri']];
 const [selectedId,setSelectedId]=useState(data.employees[0]?.id||'');
 const emp=data.employees.find((e:any)=>e.id===selectedId)||data.employees[0];
 useEffect(()=>{if(emp&&emp.id!==selectedId)setSelectedId(emp.id)},[emp?.id,selectedId]);
 function updateEmp(id:string,patch:any){setData((d:any)=>({...d,employees:d.employees.map((e:any)=>e.id===id?{...e,...patch}:e)}))}
 function addEmployee(){const row={...blank,id:uid('emp')};setData((d:any)=>({...d,employees:[...d.employees,row]}));setSelectedId(row.id)}
 function deleteEmployee(id:string){if(!confirm('Delete this employee? Existing assignments will remain by ID until changed.'))return;setData((d:any)=>({...d,employees:d.employees.filter((e:any)=>e.id!==id)}));setSelectedId(data.employees.find((e:any)=>e.id!==id)?.id||'')}
 function daySet(e:any){return new Set(splitIds(e.workDays||''))}
 function hoursMap(e:any){try{return JSON.parse(e.workHoursByDay||'{}')}catch{return {}}}
 function setDay(e:any,day:string,checked:boolean){const days=daySet(e);checked?days.add(day):days.delete(day);updateEmp(e.id,{workDays:[...days].sort().join(',')})}
 function setHours(e:any,day:string,value:any){const map=hoursMap(e);map[day]=Math.max(0,Number(value)||0);updateEmp(e.id,{workHoursByDay:JSON.stringify(map)})}
 return <div className="peopleWorkspace">
  <div className="card peopleListPanel">
   <h2>People</h2>
   <p className="muted">Pick a person to edit their profile, roles, preferred projects, and weekly schedule.</p>
   <div className="actions"><button className="btn primary" onClick={addEmployee}>Add Employee</button></div>
   <div className="librarySelectableList">
    {data.employees.length===0&&<p className="muted">No employees yet.</p>}
    {data.employees.map((e:any)=>{
     const roles=[e.canBuild!==false?'Build':'',e.canInspect!==false?'Inspect':'',e.canShip!==false?'Ship':''].filter(Boolean).join(' · ');
     const preferredCount=splitIds(e.preferredProjectIds||e.trainedProjectIds||'').length;
     return <button key={e.id} className={emp?.id===e.id?'librarySelect activeLibrarySelect':'librarySelect'} onClick={()=>setSelectedId(e.id)}>
      <div><b>{e.name||'New Employee'}</b>{e.active===false&&<span className="pill warn">Inactive</span>}</div>
      <span>{e.skills||'No skills listed'}</span>
      <small>{roles||'No roles'}{preferredCount?` • ${preferredCount} preferred project${preferredCount===1?'':'s'}`:''}</small>
     </button>})}
   </div>
  </div>
  <div className="card peopleDetailPanel">{emp?<>
   <div className="editorTitle"><div><h2>{emp.name||'New Employee'}</h2><p className="muted">{emp.email||'No email'}{emp.active===false?' • Inactive':''}</p></div><div className="actions"><button className="btn danger" onClick={()=>deleteEmployee(emp.id)}>Delete Employee</button></div></div>
   <div className="editorSections">
    <section><h3>Profile</h3><div className="editorGrid">
     <div className="field"><label>Name</label><input className="largeInput" value={emp.name||''} onChange={ev=>updateEmp(emp.id,{name:ev.target.value})}/></div>
     <div className="field"><label>Email</label><input className="largeInput" value={emp.email||''} onChange={ev=>updateEmp(emp.id,{email:ev.target.value})}/></div>
     <div className="field wide"><label>Skills</label><input className="largeInput" value={emp.skills||''} onChange={ev=>updateEmp(emp.id,{skills:ev.target.value})}/></div>
     <div className="field"><label>Status</label><label className="checkLine"><input type="checkbox" checked={!!emp.active} onChange={ev=>updateEmp(emp.id,{active:ev.target.checked})}/> Active</label></div>
    </div></section>
    <section><h3>Roles</h3><p className="muted">What kind of scheduled work this person can be assigned.</p><div className="actions">
     <label className="checkLine"><input type="checkbox" checked={emp.canBuild!==false} onChange={ev=>updateEmp(emp.id,{canBuild:ev.target.checked})}/> Can Build</label>
     <label className="checkLine"><input type="checkbox" checked={emp.canInspect!==false} onChange={ev=>updateEmp(emp.id,{canInspect:ev.target.checked})}/> Can Inspect</label>
     <label className="checkLine"><input type="checkbox" checked={emp.canShip!==false} onChange={ev=>updateEmp(emp.id,{canShip:ev.target.checked})}/> Can Ship</label>
    </div></section>
    <section><h3>Preferred Projects</h3><p className="muted">Smart Assign favors these projects for this person.</p><ProjectTrainingPicker projects={data.projects||[]} employee={emp} onChange={(patch:any)=>updateEmp(emp.id,patch)}/></section>
    <section><h3>Weekly Schedule</h3><p className="muted">Leave days unchecked for the normal company schedule (Mon–Thu, plus Friday OT when enabled).</p><div className="partTimeControls">
     <button type="button" className="mini normalScheduleBtn" onClick={()=>updateEmp(emp.id,{workDays:'',workHoursByDay:''})}>Use normal schedule</button>
     <div className="partTimeGrid compactPartTimeGrid">{weekdays.map(([day,label])=>{const selected=daySet(emp).has(day);const map=hoursMap(emp);return <label key={day} className={selected?'partDay selectedPartDay':'partDay'}><span className="partDayTop"><input type="checkbox" checked={selected} onChange={ev=>setDay(emp,day,ev.target.checked)}/><b>{label}</b></span><span className="partHourLine"><input type="number" min="0" step="0.25" disabled={!selected} value={map[day]??dailyHours(data)} onChange={ev=>setHours(emp,day,ev.target.value)}/><small>hrs</small></span></label>})}</div>
    </div></section>
    <section><h3>Time Off & Friday Overtime</h3><p className="muted">Specific days off and Friday OT dates are managed on the Availability tab, where you can click days on a calendar.</p></section>
   </div>
  </>:<p className="muted">Add an employee to get started.</p>}</div>
 </div>
}

export function Availability({data,setData}:any){
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
