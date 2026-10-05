import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import BatchUpload from '../src/BatchUpload';
import {fileSize,uploadProblem} from '../src/uploadSize';
const MB=1024*1024;
test('upload budget handles exact limits and does not overstate remaining space',()=>{
 const f=(size:number,name='sales.csv')=>({size,name} as File);
 assert.equal(uploadProblem([f(6*MB),f(4*MB)],10*MB),null);
 assert.match(uploadProblem([f(10*MB+1)],10*MB)!,/over/);
 assert.match(uploadProblem(Array.from({length:13},()=>f(1)),10*MB)!,/12/);
 assert.match(uploadProblem([f(1,'sales.txt')],10*MB)!,/CSV/);
 assert.equal(fileSize(10*MB-1,true),'9.99 MB');
});
test('upload box updates size after removal and rejects oversized replacement',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),w=dom.window;
 Object.assign(globalThis,{window:w,document:w.document,HTMLElement:w.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const root=createRoot(w.document.getElementById('root')!);
 const file=(name:string,size:number)=>new w.File([new Uint8Array(size)],name) as unknown as File;
 const a=file('july.csv',MB),b=file('august.csv',2*MB);
 try{
  await act(async()=>root.render(React.createElement(BatchUpload,{files:[a,b],maxBytes:10*MB,onCancel:()=>{},onReady:()=>{},onFilesChange:()=>{},onQuestionChange:()=>{}})));
  assert.match(w.document.body.textContent!,/2 of 12 files · 3 MB used · 7 MB left/);
  assert.equal(w.document.querySelector('.file-size')!.textContent,'1 MB');
  await act(async()=>{([...w.document.querySelectorAll('button')].find(b=>b.textContent==='Replace')!).click();});
  const replace=w.document.querySelectorAll('input[type=file]')[1];
  await act(async()=>{Object.defineProperty(replace,'files',{value:[file('too-big.csv',9*MB)],configurable:true});replace.dispatchEvent(new w.Event('change',{bubbles:true}));});
  assert.match(w.document.querySelector('.batch-files')!.textContent!,/july.csv/);
  assert.doesNotMatch(w.document.querySelector('.batch-files')!.textContent!,/too-big/);
  assert.match(w.document.body.textContent!,/over the 10 MB/);
  await act(async()=>{([...w.document.querySelectorAll('button')].find(b=>b.textContent==='Remove')!).click();});
  assert.match(w.document.body.textContent!,/1 of 12 files · 2 MB used · 8 MB left/);
 }finally{await act(async()=>root.unmount());dom.window.close();}
});
