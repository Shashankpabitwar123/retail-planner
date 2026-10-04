import {useEffect, useLayoutEffect, useRef, useState} from "react";
import {createPortal} from "react-dom";
import {api, post, type Upload} from "./data";
import GuidedImport, {type Guidance} from "./GuidedImport";
import {Button, Notice} from "./UI";
type Reply = Guidance & {file_index?: number; file_name?: string; row_count?: number; id?: string; upload_id?: string; file_count?: number};
export default function BatchUpload({files, maxBytes, onCancel, onReady, onQuestionChange, onFilesChange, embedded = false}: {onFilesChange: (files: File[]) => void; onQuestionChange: (open: boolean) => void; embedded?: boolean; files: File[]; maxBytes: number; onCancel: () => void; onReady: (id: string, uploadId: string, count: number) => void}) {
  const active = useRef(true);
  useEffect(() => {active.current=true; return () => {active.current=false;};}, []);
  const [items, setItems] = useState(files);
  useEffect(() => {onFilesChange(items);}, [items, onFilesChange]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [reply, setReply] = useState<Reply | null>(null);
  useEffect(() => {
    if (reply && !reply.ready) document.getElementById("batch-question-root")?.scrollIntoView({block:"start"});
  }, [reply?.question?.id, reply?.blocked]);
  useLayoutEffect(() => {
    onQuestionChange(Boolean(reply && !reply.ready));
  }, [reply, onQuestionChange]);
  useEffect(() => () => onQuestionChange(false), [onQuestionChange]);
  const [answers, setAnswers] = useState<Record<string,string>>({});
  const uploaded = useRef(new Map<File, Upload>());
  const addInput = useRef<HTMLInputElement>(null);
  const replaceInput = useRef<HTMLInputElement>(null);
  const [replaceIndex, setReplaceIndex] = useState<number | null>(null);
  async function analyze(nextAnswers = answers) {
    setBusy(true); setError("");
    let current = "";
    try {
      if (!items.length || items.length > 12) throw Error("Choose between 1 and 12 CSV files.");
      if (items.reduce((sum,f) => sum+f.size,0) > maxBytes) throw Error(`These files exceed ${maxBytes/1024/1024} MB together. Remove a file or export fewer products.`);
      const ids: string[] = [];
      for (const f of items) {
        if (!active.current) return;
        current = f.name;
        if (!uploaded.current.has(f)) uploaded.current.set(f, await api<Upload>("/uploads?name="+encodeURIComponent(f.name), {method:"POST", body:f}));
        ids.push(uploaded.current.get(f)!.id);
      }
      current = "";
      const result = await post<Reply>("/batches/prepare", {upload_ids:ids, answers:nextAnswers});
      if (!active.current) return;
      setReply(result);
      if (result.ready && result.id && result.upload_id) {
        for (const [file, upload] of uploaded.current) {
          if (!upload.duplicate) await api(`/uploads/${upload.id}`, {method:"DELETE"}).catch(() => {});
          uploaded.current.delete(file);
        }
        if (active.current) onReady(result.id,result.upload_id,result.file_count || items.length);
      }
    } catch (e) {setError((current ? current+": " : "")+(e as Error).message);}
    finally {setBusy(false);}
  }
  function cleanup(file: File) {
    const upload = uploaded.current.get(file);
    if (upload && !upload.duplicate) api(`/uploads/${upload.id}`, {method:"DELETE"}).catch(() => {});
    uploaded.current.delete(file);
  }
  function change(next: File[]) {items.filter(f => !next.includes(f)).forEach(cleanup); setItems(next); setAnswers({}); setReply(null); setError("");}
  function addFiles(files: File[]) {
    if (busy || !files.length) return;
    if (files.some(f => !f.name.toLowerCase().endsWith(".csv"))) { setError("Please choose CSV files only."); return; }
    const next = [...items, ...files];
    if (next.length > 12) { setError(`You can add ${Math.max(0, 12-items.length)} more files. The limit is 12.`); return; }
    if (next.reduce((sum, f) => sum + f.size, 0) > maxBytes) { setError(`These files would exceed ${maxBytes/1024/1024} MB together. Choose fewer files or smaller exports.`); return; }
    change(next);
  }
  return <section className={embedded ? "batch-upload batch-inline" : "panel batch-upload"} onDragOver={e => e.preventDefault()} onDrop={e => {e.preventDefault(); e.stopPropagation(); addFiles(Array.from(e.dataTransfer.files));}}>
    <header className="batch-heading">
      <h2>Your sales files</h2>
      <p className="muted" aria-live="polite">{items.length} {items.length === 1 ? "file" : "files"} selected</p>
    </header>
    <input ref={addInput} type="file" multiple accept=".csv,text/csv" hidden onChange={e => {addFiles(Array.from(e.target.files || [])); e.target.value="";}} />
    <ul className="batch-files">{items.map((f,i) => <li key={i}><span>{f.name}</span><button type="button" className="text-link" disabled={busy} onClick={() => {setReplaceIndex(i); replaceInput.current?.click();}}>Replace</button><button type="button" className="text-link" disabled={busy} onClick={() => change(items.filter((_,j)=>i!==j))}>Remove</button></li>)}</ul>
    <input ref={replaceInput} type="file" accept=".csv,text/csv" hidden onChange={e => {const f=e.target.files?.[0]; if(f && replaceIndex !== null) change(items.map((v,i)=>i===replaceIndex?f:v)); e.target.value="";}} />
    <div className="batch-add">
      <Button variant="secondary" disabled={busy || items.length >= 12} onClick={() => addInput.current?.click()}>Add more files</Button>
      <p className="muted">Add sales from the same store, or drop files here.</p>
    </div>
    {error && <Notice tone="warning">{error}</Notice>}
    {reply && !reply.ready && document.getElementById("batch-question-root") && createPortal(
      <section className="batch-question-page">
        <Button variant="text" disabled={busy} onClick={() => {setReply(null); setError("");}}>← Back to files</Button>
        <p className="muted">{reply.file_name}</p>
        {error && <Notice tone="warning">{error}</Notice>}
        <GuidedImport upload={{row_count:reply.row_count || 0} as Upload} guidance={reply} busy={busy}
          onAnswer={(key,value)=>{const next={...answers,[key]:value};setAnswers(next);analyze(next);}}
          onReset={()=>{setReply(null);setAnswers({});setError("");}}
          onDetails={()=>{setReply(null);setAnswers({});setError("");}} />
      </section>, document.getElementById("batch-question-root")!
    )}
    <div className="batch-submit">
    {(!reply || error) && <Button disabled={busy || !items.length} onClick={()=>analyze()}>{busy ? "Reading your files…" : "Analyze sales"}</Button>}
    <Button variant="text" disabled={busy} onClick={() => {items.forEach(cleanup); onCancel();}}>{embedded ? "Clear files" : "Cancel"}</Button>
    </div>
    <p className="batch-limits">Up to 12 CSV files · {maxBytes/1024/1024} MB total</p>
  </section>;
}
