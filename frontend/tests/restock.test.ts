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
 const makePlan=(id:string)=>({suggested_order_units:10,pre_arrival_unmet_units:0,arrival_date:'2026-07-21',planning_date:'2026-07-16',buffer_units:2,protection_units:8,stock_before_new_order_on_arrival:0,assumptions:{product_id:id,stock:0,lead_days:5,review_days:7,buffer_days:2},notice:''} as Plan);
 w.HTMLDialogElement.prototype.showModal=function(){this.open=true;};
 w.HTMLDialogElement.prototype.close=function(){this.open=false;this.dispatchEvent(new w.Event('close'));};
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
  assert.match(rows.find(r=>r.textContent?.includes('Product 0'))!.textContent!,/10 units/);
  assert.match(rows.find(r=>r.textContent?.includes('Product 1'))!.textContent!,/Needs review/);
  assert.match(rows.find(r=>r.textContent?.includes('Product 2'))!.textContent!,/Add stock count/);
  assert.match(w.document.body.textContent!,/1 products calculated/);
  const printed=w.document.querySelector('.restock-print')!;
  assert.match(printed.textContent!,/Order breakdown/);
  assert.match(printed.textContent!,/Test unavailable/,'Print retains failed products instead of omitting them');
  assert.match(printed.textContent!,/7 days|7/);
  const printButton=[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Print restock list')!;
  assert.equal(printButton.disabled,false);
  const details=w.document.querySelector('button[aria-label="Details for Product 0"]') as HTMLButtonElement;
  await act(async()=>details.click());
  assert.equal((w.document.querySelector('dialog') as HTMLDialogElement).open,true);
  assert.match(w.document.querySelector('dialog')!.textContent!,/Why this amount/);
  assert.doesNotMatch(w.document.querySelector('.restock-table')!.textContent!,/Why this amount/,'Details never expand a table row');
  const add=[...w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='Add incoming delivery') as HTMLButtonElement;
  await act(async()=>add.click());
  assert.equal(printButton.disabled,true,'Unsaved input changes must block stale printing');
  assert.match(printed.textContent!,/Update the restock list before printing/);
  assert.equal(printed.querySelector('table'),null,'Stale plans must not appear in browser print either');
  const close=[...w.document.querySelectorAll('dialog button')].find(b=>b.textContent==='Close') as HTMLButtonElement;
  await act(async()=>close.click());
  assert.equal(w.document.querySelector('dialog'),null);

 }finally{await act(async()=>root.unmount());globalThis.fetch=old;dom.window.close();}
});

test('blocked forecasts can be exported as a review list without invented orders',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),w=dom.window;
 Object.assign(globalThis,{window:w,document:w.document,HTMLElement:w.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const result=JSON.parse(fs.readFileSync(new URL('../../samples/test-result.json',import.meta.url),'utf8')).result as Result;
 result.products=result.products.map(p=>({...p,inventory_eligible:false,forecast_warning:'Failed past test'}));
 const old=globalThis.fetch;globalThis.fetch=async()=>{throw Error('Ineligible products must not request an order');};
 const root=createRoot(w.document.getElementById('root')!);
 try{
 await act(async()=>root.render(React.createElement(StoreRestock,{result,jobId:'job',saved:{},onSave:async()=>{},onAddData:()=>{}})));
 await act(async()=>{(w.document.querySelector('input[type=checkbox]') as HTMLInputElement).click();});
 await act(async()=>{[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Calculate restock list')!.click();});
 assert.equal([...w.document.querySelectorAll('button')].find(b=>b.textContent==='Download spreadsheet')!.disabled,false);
 assert.match(w.document.querySelector('.restock-print')!.textContent!,/Needs review/);
 assert.match(w.document.querySelector('.restock-print')!.textContent!,/Failed past test/);
 assert.equal(w.document.querySelector('.restock-amount'),null);
 }finally{await act(async()=>root.unmount());globalThis.fetch=old;dom.window.close();}
});

test('restoring a plan keeps its duration and changing shared delivery clears saved overrides',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),w=dom.window;
 Object.assign(globalThis,{window:w,document:w.document,HTMLElement:w.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const result=JSON.parse(fs.readFileSync(new URL('../../samples/test-result.json',import.meta.url),'utf8')).result as Result;
 result.products=[{...result.products[0],product_id:'P0',inventory_eligible:true}];
 const plan={suggested_order_units:10,pre_arrival_unmet_units:0,arrival_date:'2026-07-21',planning_date:result.forecast_start,buffer_units:2,assumptions:{stock:200,lead_days:5,review_days:20,buffer_days:2}} as Plan;
 const old=globalThis.fetch;let body:Record<string,unknown>={};globalThis.fetch=async(_i,init)=>{body=JSON.parse(String(init?.body));return Response.json(plan);};
 const root=createRoot(w.document.getElementById('root')!);
 try{
 await act(async()=>root.render(React.createElement(StoreRestock,{result,jobId:'job',saved:{P0:plan},onSave:async()=>{},onAddData:()=>{}})));
 const fields=w.document.querySelectorAll('.inventory-grid input');
 assert.equal((fields[2] as HTMLInputElement).value,'20');
 // React's native input event handling requires the DOM to exist before module import;
 // use the mounted handler here to exercise the same state transition directly.
 const input=fields[1] as HTMLInputElement;
 const propKey=Object.keys(input).find(k=>k.startsWith('__reactProps'))!;
 await act(async()=>{(input as unknown as Record<string,{onChange:(e:unknown)=>void}>)[propKey].onChange({target:{value:'2'}});});
 await act(async()=>{(w.document.querySelector('input[type=checkbox]') as HTMLInputElement).click();});
 await act(async()=>{[...w.document.querySelectorAll('button')].find(b=>b.textContent==='Update restock list')!.click();});
 assert.equal(body.lead_days,2);assert.equal(body.review_days,20);assert.equal(body.buffer_days,2);
 }finally{await act(async()=>root.unmount());globalThis.fetch=old;dom.window.close();}
});

test('Enter calculates only the edited product, preserves other plans and keeps row order',async()=>{
 const dom=new JSDOM('<div id="root"></div>',{url:'http://localhost/'}),w=dom.window;
 Object.assign(globalThis,{window:w,document:w.document,HTMLElement:w.HTMLElement,IS_REACT_ACT_ENVIRONMENT:true});
 const result=JSON.parse(fs.readFileSync(new URL('../../samples/test-result.json',import.meta.url),'utf8')).result as Result;
 result.products=result.products.slice(0,3).map((p,i)=>({...p,product_id:`P${i}`,name:`Product ${i}`,inventory_eligible:i!==2}));
 const plan=(id:string,n:number)=>({product_id:id,suggested_order_units:n,pre_arrival_unmet_units:0,arrival_date:'2026-07-21',planning_date:result.forecast_start,buffer_units:2,assumptions:{stock:20,lead_days:5,review_days:7,buffer_days:2}} as Plan);
 const old=globalThis.fetch;const calls:Record<string,unknown>[]=[];let fail=false;
 globalThis.fetch=async(_i,init)=>{const body=JSON.parse(String(init?.body));calls.push(body);return fail?Response.json({detail:'Try again'},{status:422}):Response.json(plan(body.product_id,999));};
 const root=createRoot(w.document.getElementById('root')!);
 const props=(input:HTMLInputElement)=>(input as any)[Object.keys(input).find(k=>k.startsWith('__reactProps'))!];
 try{
 await act(async()=>root.render(React.createElement(StoreRestock,{result,jobId:'job',saved:{P0:plan('P0',10),P1:plan('P1',20)},onSave:async()=>{},onAddData:()=>{}})));
 const input=w.document.querySelector('input[aria-label="Stock for Product 1"]') as HTMLInputElement;
 const focusCalls:FocusOptions[]=[];input.focus=options=>{focusCalls.push(options||{});};
 await act(async()=>props(input).onChange({target:{value:'123'}}));
 await act(async()=>props(input).onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){},currentTarget:input}));
 await act(async()=>{await new Promise(resolve=>setTimeout(resolve,5));});
 assert.equal(focusCalls.at(-1)?.preventScroll,true);
 assert.equal(calls.length,1);assert.equal(calls[0].product_id,'P1');assert.equal(calls[0].stock,123);
 const rows=[...w.document.querySelectorAll('.restock-table tbody tr')];
 assert.match(rows[0].textContent!,/Product 0.*10 units/);assert.match(rows[1].textContent!,/Product 1.*999 units/);
 assert.equal((w.document.querySelector('input[type=checkbox]') as HTMLInputElement).checked,false,'Single-row action does not confirm the entire list');
 fail=true;
 await act(async()=>props(input).onChange({target:{value:'124'}}));
 await act(async()=>props(input).onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){},currentTarget:input}));
 assert.doesNotMatch(rows[1].textContent!,/999 units/,'Failed updates must not show stale order quantities');
 const blocked=w.document.querySelector('input[aria-label="Stock for Product 2"]') as HTMLInputElement;blocked.focus=()=>{};
 await act(async()=>props(blocked).onKeyDown({key:'Enter',nativeEvent:{isComposing:false},preventDefault(){},currentTarget:blocked}));
 assert.equal(calls.length,2,'Enter cannot bypass forecast eligibility');
 }finally{await act(async()=>root.unmount());globalThis.fetch=old;dom.window.close();}
});
