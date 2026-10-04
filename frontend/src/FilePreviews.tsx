import {useEffect, useRef, useState} from 'react';
import Papa from 'papaparse';

type Preview = {rows: string[][]; error?: string};
export function parsePreview(text: string): Preview {
  const result = Papa.parse<string[]>(text, {preview:6, skipEmptyLines:'greedy'});
  if (!result.data.length) return {rows:[],error:'This file is empty.'};
  if (result.errors.some(e=>e.code === 'MissingQuotes')) return {rows:[],error:'We couldn’t preview this file. Check its CSV format.'};
  return {rows:result.data.map(row=>row.slice(0,50).map(cell=>cell.slice(0,200)))};
}
function PreviewTable({rows, expanded=false}: {rows:string[][]; expanded?:boolean}) {
  const visible = rows.slice(0, expanded ? 6 : 4);
  const columns = expanded ? 50 : 4;
  return <div className="preview-table-scroll" tabIndex={0} aria-label="File contents"><table>
    <thead><tr>{visible[0]?.slice(0,columns).map((cell,i)=><th key={i}>{cell || '(empty heading)'}</th>)}</tr></thead>
    <tbody>{visible.slice(1).map((row,i)=><tr key={i}>{row.slice(0,columns).map((cell,j)=><td key={j}>{cell || '—'}</td>)}</tr>)}</tbody>
  </table></div>;
}
function PreviewCard({file}: {file:File}) {
  const [preview,setPreview]=useState<Preview | null>(null);
  const [expanded,setExpanded]=useState(false);
  const dialog=useRef<HTMLDialogElement>(null);
  const trigger=useRef<HTMLButtonElement>(null);
  useEffect(()=>{
    let active=true;
    const reader=new FileReader();
    reader.onload=()=>{if(active) setPreview(parsePreview(String(reader.result || '')));};
    reader.onerror=()=>{if(active) setPreview({rows:[],error:'This file couldn’t be read. Try choosing it again.'});};
    // Only the start of the file is needed; original values never leave this browser.
    reader.readAsText(file.slice(0,256*1024));
    return ()=>{active=false;if(reader.readyState===1)reader.abort();};
  },[file]);
  useEffect(()=>{if(expanded) dialog.current?.showModal();else dialog.current?.close();},[expanded]);
  function close(){setExpanded(false);trigger.current?.focus();}
  return <article className="file-preview-card">
    <h3 title={file.name}>{file.name}</h3>
    {!preview ? <p role="status">Reading preview…</p> : preview.error ? <p>{preview.error}</p> : <>
      <PreviewTable rows={preview.rows}/>
      <button ref={trigger} type="button" className="text-link" onClick={()=>setExpanded(true)}>Expand preview<span className="sr-only"> of {file.name}</span></button>
    </>}
    {expanded && preview && <dialog ref={dialog} className="file-preview-dialog" onCancel={e=>{e.preventDefault();close();}}>
      <header><h2>{file.name}</h2><button type="button" className="icon-button" aria-label="Close preview" onClick={close}>×</button></header>
      <p>First {Math.max(0,preview.rows.length-1)} rows · Original file values · Up to 50 columns</p>
      <PreviewTable rows={preview.rows} expanded/>
      <p className="muted">A preview only. The full file is checked when you select Analyze sales.</p>
    </dialog>}
  </article>;
}
export default function FilePreviews({files}: {files:File[]}) {
  // File objects, rather than names, identify replacements with the same filename.
  const ids=useRef(new WeakMap<File,number>());
  const next=useRef(0);
  return <section className="file-previews" aria-label="Your file previews">
    <h2>Your file previews</h2><p className="muted">A quick look at your original files. First 3 rows and 4 columns shown.</p>
    <div className={'file-preview-grid '+(files.length===1?'single':'')}>
      {files.map(file=>{if(!ids.current.has(file)) ids.current.set(file,++next.current);return <PreviewCard key={ids.current.get(file)} file={file}/>;})}
    </div>
  </section>;
}
