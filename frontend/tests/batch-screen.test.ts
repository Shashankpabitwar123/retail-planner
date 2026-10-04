import test from 'node:test';
import assert from 'node:assert/strict';
import {JSDOM} from 'jsdom';
import 'fake-indexeddb/auto';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import App from '../src/App';

test('actual app hides landing page during questions and preserves files on return', async () => {
  const dom = new JSDOM('<div id="root"></div>', {url:'http://localhost/'});
  const w = dom.window;
  Object.assign(globalThis, {window:w, document:w.document, HTMLElement:w.HTMLElement, FileReader:w.FileReader, localStorage:w.localStorage, IS_REACT_ACT_ENVIRONMENT:true});
  w.scrollTo = () => {};
  w.HTMLElement.prototype.scrollIntoView = () => {};
  let preparations=0;
  const originalFetch=globalThis.fetch;
  globalThis.fetch=async (input, init) => {
    const url=String(input);
    if(url.endsWith('/session')) return Response.json({max_upload_bytes:2097152,max_rows:50000,max_products:100,ai_available:false});
    if(url.includes('/uploads?')) return Response.json({id:'file-1',duplicate:false,row_count:2});
    if(url.endsWith('/batches/prepare')) {preparations++; if (JSON.parse(String(init?.body)).answers.complete_all) return Response.json({ready:false,config:{},question:{id:'same_store',title:'Are these from one store?',detail:'Confirm the store.',options:[{value:'yes',label:'Same store',hint:''}]}}); return Response.json({ready:false,config:{},file_name:'sales.csv',row_count:2,question:{id:'complete_all',title:'Are these complete daily sales?',detail:'Confirm the dates.',options:[{value:'yes',label:'Yes, complete',hint:''}]}});}
    if(url.includes('/uploads/')) return Response.json({deleted:true});
    throw Error('Unexpected request '+url);
  };
  const root=createRoot(w.document.getElementById('root')!);
  const click=async (text:string) => {const button=[...w.document.querySelectorAll('button')].find(b=>b.textContent?.trim()===text);assert.ok(button,text);await act(async()=>{button.click();});};
  try {
    await act(async()=>{root.render(React.createElement(App));});
    const input=w.document.querySelector('input[type=file][multiple]')!;
    const file=new w.File(['date,sku,units_sold\n2025-01-01,A,2'], 'sales.csv',{type:'text/csv'});
    await act(async()=>{Object.defineProperty(input,'files',{value:[file],configurable:true});input.dispatchEvent(new w.Event('change',{bubbles:true}));});
    await click('Analyze sales');
    const portal=w.document.getElementById('batch-question-root')!;
    assert.match(portal.textContent!,/Are these complete daily sales/);
    const landing=[...w.document.querySelectorAll('h1')].find(h=>h.textContent==='Estimate future sales and plan your stock.')!;
    assert.ok(landing.closest('[hidden]'), 'Landing content must be hidden without CSS selectors');
    assert.equal(portal.closest('[hidden]'),null, 'Question must remain visible');
    await click('Yes, complete');
    assert.equal(preparations,2,'Selecting advances automatically');
    assert.equal(portal.querySelectorAll('button').length,2,'Only answer and Back are shown');
    assert.match(portal.textContent!,/Are these from one store/);
    await click('← Back');
    assert.match(portal.textContent!,/Are these complete daily sales/);
    assert.doesNotMatch(portal.textContent!, /Review my answers|File details|Continue/);
    await click('← Back');
    assert.equal(portal.textContent,'');
    assert.equal(landing.closest('[hidden]'),null);
    assert.match(w.document.querySelector('.batch-files')!.textContent!,/sales.csv/);
    await click('Analyze sales');
    assert.ok(landing.closest('[hidden]'));
    assert.equal(preparations,3);
    await click('← Back');
    await click('Clear files');
    assert.equal(portal.textContent,'');
    assert.equal(w.document.querySelector('.batch-files'),null);
  } finally {await act(async()=>root.unmount());globalThis.fetch=originalFetch;dom.window.close();}
});
