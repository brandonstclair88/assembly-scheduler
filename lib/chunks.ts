import {AppData,ScheduledItem} from './types';
import {capacityForDate,dailyHours} from './scheduler';

// Single source of truth for expanding scheduled items (one row per assembly-phase)
// into per-employee, per-day work chunks. Previously this algorithm was duplicated
// with slight differences in WeeklyBoard, Dashboard, Planner, and MobileViewer.

export function sourceIdOf(item:any){return item?.sourceAssemblyId||String(item?.id||'').split('|')[0]}

function pad(n:number){return String(n).padStart(2,'0')}
function nextDate(s:string){const d=new Date(s+'T00:00:00');d.setDate(d.getDate()+1);return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}`}
function splitIds(s:string){return (s||'').split(/[\n,;\s]+/).map(x=>x.trim()).filter(Boolean)}

export type ExpandOptions={startDate?:string;endDate?:string;maxDays?:number};

export function expandChunks(data:AppData,schedule:ScheduledItem[],opts:ExpandOptions={}):any[]{
  const {startDate='',endDate='',maxDays=240}=opts;
  const chunks:any[]=[];
  const inRange=(d:string)=>(!startDate||d>=startDate)&&(!endDate||d<=endDate);
  for(const s of schedule as any[]){
    const source=(data.projectAssemblies||[]).find((a:any)=>a.id===sourceIdOf(s));
    const manualSegments=((s.phase||'Build')==='Build'&&Array.isArray((source as any)?.manualWorkSegments))
      ?(source as any).manualWorkSegments.filter((seg:any)=>(seg.phase||'Build')==='Build'&&Number(seg.hours)>0)
      :[];
    if(manualSegments.length){
      manualSegments.forEach((seg:any,idx:number)=>{
        if(inRange(seg.date))chunks.push({...s,employeeChunkId:seg.employeeId||'',chunkDate:seg.date,chunkHours:Number(seg.hours)||0,chunkLabel:'Manual',segmentIndex:idx,manualSegmentId:seg.id});
      });
      continue;
    }
    const ids=splitIds(s.assignedTo);
    for(const empId of (ids.length?ids:[''])){
      let date=s.scheduledStart;
      let remaining=Number(s.hoursPerEmployee)||Number(s.totalHours)||0;
      let guard=0;let idx=0;
      while(remaining>0&&guard<maxDays){
        const cap=capacityForDate(data,empId,date);
        if(cap>0){
          const hrs=Math.min(remaining,cap);
          if(inRange(date))chunks.push({...s,employeeChunkId:empId,chunkDate:date,chunkHours:hrs,chunkLabel:remaining>hrs?'Partial':'Final',segmentIndex:idx++});
          remaining-=hrs;
        }
        date=nextDate(date);guard++;
      }
    }
  }
  return chunks;
}

export function sortChunksByDate(chunks:any[]){
  return chunks.sort((a:any,b:any)=>String(a.chunkDate).localeCompare(String(b.chunkDate))||String(a.projectName||'').localeCompare(String(b.projectName||'')));
}

// External wait (e.g. test gate): walks shop-open days (Mon-Thu + holidays excluded)
// consuming one settings-defined workday of hours per day. Shared by the Weekly
// Board's test-gate math so the walk can't drift from the scheduler's calendar.
export function externalWaitEnd(data:AppData,start:string,hours:number){
  let remaining=Math.max(0,Number(hours)||0);
  if(remaining<=0)return start;
  let cursor=nextDate(start);let last=start;let guard=0;
  while(remaining>0.01&&guard++<365){
    const d=new Date(cursor+'T00:00:00');
    const weekend=[0,5,6].includes(d.getDay());
    const holiday=(data.holidays||[]).some((h:any)=>h.date===cursor);
    if(!weekend&&!holiday){remaining-=dailyHours(data);last=cursor;}
    cursor=nextDate(cursor);
  }
  return last;
}
