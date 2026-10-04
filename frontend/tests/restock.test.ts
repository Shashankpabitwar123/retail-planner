import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {JSDOM} from 'jsdom';
import React, {act} from 'react';
import {createRoot} from 'react-dom/client';
import StoreRestock from '../src/StoreRestock';
import {type Result,type Plan} from '../src/data';
test('store-wide calculation keeps missing stock blank and isolates product failures',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'});const w=dom.window;
 Object.assign(globalThis,{window:w,document:w.document,HTMLElement:w.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const result=JSON.parse(fs.readFileSync(new URL('../../samples/test-result.json',import.meta.url),'utf8')).result as Result;
 result.quality.config.synthetic=false;
 result.products=[0,1,2].map(i=>({...result.products[0],product_id:`P${i}`,name:`Product ${i}`,inventory_eligible:true}));
 const makePlan=(id:string)=>({suggested_order_units:10,pre_arrival_unmet_units:0,arrival_date:'2026-07-21',planning_date:'2026-07-16',assumptions:{product_id:id,stock:0,lead_days:5},notice:''} as Plan);
 const old=globalThis.fetch;const calls:string[]=[];
 globalThis.fetch=async(_input,init)=>{const body=JSON.parse(String(init?.body));calls.push(body.product_id);return body.product_id==='P1'?Response.json({detail:'Test unavailable'},{status:422}):Response.json(makePlan(body.product_id));};
 const root=createRoot(w.document.getElementById('root')!);
 try{
  await act(async()=>root.render(React.createElement(StoreRestock,{result,jobId:'job',saved:{P0:makePlan('P0'),P1:makePlan('P1')},onSave:async()=>{},onAddData:()=>{}})));
  await act(async()=>{(w.document.querySelector('input[type=checkbox]') as HTMLInputElement).click();});
  const calculate=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Update restock list')!;
  await act(async()=>calculate.click());
  assert.deepEqual(calls,['P0','P1'],'Blank stock must not become zero or be sent');
  const rows=[...w.document.querySelectorAll('tbody tr')];
  assert.match(rows.find(r=>r.textContent?.includes('Product 0'))!.textContent!,/Order more/);
  assert.match(rows.find(r=>r.textContent?.includes('Product 1'))!.textContent!,/Test unavailable/);
  assert.match(rows.find(r=>r.textContent?.includes('Product 2'))!.textContent!,/Add stock count/);
  assert.match(w.document.body.textContent!,/1 products calculated/);
 }finally{await act(async()=>root.unmount());globalThis.fetch=old;dom.window.close();}
});
