import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {JSDOM} from 'jsdom';
import {Forecast} from '../src/Results';
import {type Result} from '../src/data';

test('chart points use the same product daily values as the table, for flat and changing forecasts',()=>{
 const result=JSON.parse(fs.readFileSync(new URL('../../samples/test-result.json',import.meta.url),'utf8')).result as Result;
 for(const amounts of [[14,14,14,14,14],[102.4,0,46.4,63.6,106.9]]){
  const p={...result.products[0],forecast:amounts.map((units,i)=>({date:`2026-07-${16+i}`,units})),forecast_total:amounts.reduce((a,b)=>a+b,0)};
  const dom=new JSDOM(renderToStaticMarkup(React.createElement(Forecast,{product:p,onRestock:()=>{},onAddData:()=>{}})));
  const rows=[...dom.window.document.querySelectorAll('.daily-preview tbody tr')];
  const circles=[...dom.window.document.querySelectorAll('svg circle')].slice(-amounts.length);
  amounts.forEach((value,i)=>{assert.equal(rows[i].lastElementChild!.textContent,String(value));assert.match(circles[i].getAttribute('aria-label')!,new RegExp(`: ${value} estimated units`));});
  const ys=new Set(circles.map(c=>c.getAttribute('cy')));
  assert.equal(ys.size,amounts[0]===14?1:5);
  assert.equal(dom.window.document.body.textContent!.includes('same daily amount'),amounts[0]===14);
  dom.window.close();
 }
});
