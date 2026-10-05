import {type Job,type Snapshot,friendlyDate} from './data';
export type HistoryEntry={id:string;created:number;title:string;files:string[];fileCount:number|null;snapshot?:Snapshot;job?:Job};
export function pastAnalyses(saved:Snapshot[],jobs:Job[],hidden:string[]=[]):HistoryEntry[]{
 const hiddenIds=new Set(hidden);
 const reviewIds=new Set(jobs.map(j=>j.review_id).filter(Boolean));
 const entries=new Map<string,HistoryEntry>();
 for(const s of saved) entries.set(s.id,{id:s.id,created:Date.parse(s.created),title:s.name,files:s.sourceFiles||[],fileCount:null,snapshot:s});
 for(const j of jobs){
  if(j.kind==='normalize'&&reviewIds.has(j.id))continue;
  const previous=entries.get(j.id);
  entries.set(j.id,{...previous,id:j.id,created:previous?.created??j.created*1000,title:previous?.title||j.source_name||'Sales analysis',files:previous?.files.length?previous.files:j.source_files||[],fileCount:null,job:j});
 }
 // Hide only processing steps explicitly linked to a forecast, never by filename or digest.
 for(const id of reviewIds) if(id)entries.delete(id);
 return [...entries.values()].filter(e=>!hiddenIds.has(e.id)).map(e=>{
  const combined=/^Combined sales(?: \((\d+) files?\))?(?:\.csv)?$/i.exec(e.title);
  e.fileCount=e.files.length|| (combined?.[1]?Number(combined[1]):combined?null:1);
  if(e.snapshot?.result.quality.config.synthetic)e.title='Sample store sales';
  else if(combined&&e.snapshot){const q=e.snapshot.result.quality;e.title=`Sales · ${friendlyDate(q.coverage_start)} – ${friendlyDate(q.coverage_end)}`;}
  else if(combined)e.title='Combined sales';
  else e.title=e.title.replace(/\.csv$/i,'');
  return e;
 }).sort((a,b)=>b.created-a.created);
}
