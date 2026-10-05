import {Button} from './UI';
import {friendlyDate} from './data';
import {type HistoryEntry} from './historyEntries';
export default function PastAnalyses({entries,onOpen,onRemove,onDownload,onDeleteUpload}:{entries:HistoryEntry[];onOpen:(e:HistoryEntry)=>void;onRemove:(e:HistoryEntry)=>void;onDownload:(e:HistoryEntry)=>void;onDeleteUpload:(e:HistoryEntry)=>void}){
 return <><p className="muted">Your last 10 analyses are saved in this browser.</p>
 {!entries.length&&<p>No past analyses yet. Upload sales to get started.</p>}
 {entries.map(e=><section className="history-item past-analysis" key={e.id}>
  <strong>{e.title}</strong>
  <p>{e.fileCount!==null?`${e.fileCount} file${e.fileCount===1?'':'s'}`:'Sales files'}{e.snapshot?` · ${e.snapshot.result.products.length} products`:''}</p>
  <p>Created {new Date(e.created).toLocaleString('en-GB',{day:'numeric',month:'short',year:'numeric',hour:'numeric',minute:'2-digit',hour12:true})}</p>
  {e.snapshot&&<p className="history-forecast">Forecast: {friendlyDate(e.snapshot.result.forecast_start)} – {friendlyDate(e.snapshot.result.forecast_end)}</p>}
  <div className="inline-actions"><Button variant="secondary" onClick={()=>onOpen(e)}>{e.snapshot||e.job?.kind==='forecast'&&e.job.state==='completed'?'Open results':'Continue analysis'}</Button>
  <details className="history-options"><summary aria-label={`Options for ${e.title}`}>•••</summary><div className="history-menu">
   <details><summary>View file names</summary>{e.files.length?<ul>{e.files.map((f,i)=><li key={i}>{f}</li>)}</ul>:<p>{!/^Combined sales/i.test(e.snapshot?.name||e.job?.source_name||'')?(e.snapshot?.name||e.job?.source_name||'File name unavailable'):'Original file names were not saved with this older analysis.'}</p>}{e.job&&<Button variant="text" onClick={()=>onDeleteUpload(e)}>Delete uploaded data</Button>}</details>
   {e.snapshot&&<Button variant="text" onClick={()=>onDownload(e)}>Download backup</Button>}
   <Button variant="text" onClick={()=>onRemove(e)}>Remove from history</Button>
  </div></details></div>
 </section>)}</>;
}
