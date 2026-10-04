import test from 'node:test';
import assert from 'node:assert/strict';
import React,{act} from 'react';
import {createRoot} from 'react-dom/client';
import {JSDOM} from 'jsdom';
import FilePreviews,{parsePreview} from '../src/FilePreviews';

test('preview reads quoted fields, multiline cells, alternate separators and leading zero IDs',()=>{
  assert.deepEqual(parsePreview('sku,name,qty\n0007,"Rice, large",3\n0008,"Line one\nline two",4').rows,[['sku','name','qty'],['0007','Rice, large','3'],['0008','Line one\nline two','4']]);
  assert.deepEqual(parsePreview('\uFEFFsku;qty\n0007;4').rows,[['sku','qty'],['0007','4']]);
  assert.equal(parsePreview('').error,'This file is empty.');
  assert.equal(parsePreview('a,b\n1,"unclosed').rows.length,0);
});

test('preview limits rows and treats formula-like values as plain text',()=>{
  const r=parsePreview('sku,qty\n'+Array.from({length:100},(_,i)=>`=SUM(A1),${i}`).join('\n'));
  assert.equal(r.rows.length,6);
  assert.equal(r.rows[1][0],'=SUM(A1)');
});

test('preview cards update for addition, same-name replacement, removal and expansion',async()=>{
  const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});const w=dom.window;
  Object.assign(globalThis,{window:w,document:w.document,FileReader:w.FileReader,HTMLElement:w.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
  w.HTMLDialogElement.prototype.showModal=function(){this.setAttribute('open','');};
  w.HTMLDialogElement.prototype.close=function(){this.removeAttribute('open');};
  const root=createRoot(w.document.getElementById('root')!);
  const a=new w.File(['sku,qty\nApples,2'],'sales.csv');
  const b=new w.File(['sku,qty\nBananas,3'],'more.csv');
  const replacement=new w.File(['sku,qty\nOranges,9'],'sales.csv');
  async function render(files:File[]){await act(async()=>root.render(React.createElement(FilePreviews,{files})));await act(async()=>{await new Promise(r=>setTimeout(r,25));});}
  try{
    await render([a] as unknown as File[]);assert.match(w.document.body.textContent!,/Apples/);
    await render([a,b] as unknown as File[]);assert.equal(w.document.querySelectorAll('.file-preview-card').length,2);assert.match(w.document.body.textContent!,/Bananas/);
    await render([replacement,b] as unknown as File[]);assert.match(w.document.body.textContent!,/Oranges/);assert.doesNotMatch(w.document.body.textContent!,/Apples/);
    await act(async()=>{(w.document.querySelector('.file-preview-card button') as HTMLButtonElement).click();});
    assert.ok(w.document.querySelector('dialog[open]'));
    await act(async()=>{(w.document.querySelector('[aria-label="Close preview"]') as HTMLButtonElement).click();});
    assert.equal(w.document.querySelector('dialog'),null);
    await render([replacement] as unknown as File[]);assert.equal(w.document.querySelectorAll('.file-preview-card').length,1);assert.doesNotMatch(w.document.body.textContent!,/Bananas/);
  }finally{await act(async()=>root.unmount());dom.window.close();}
});
