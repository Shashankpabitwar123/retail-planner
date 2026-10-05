import test from 'node:test';
import assert from 'node:assert/strict';
import {pastAnalyses} from '../src/historyEntries';
import {type Job,type Snapshot} from '../src/data';
const saved=(id:string)=>({id,name:'Combined sales (3 files).csv',created:'2026-10-04T20:00:00Z',result:{products:[],forecast_start:'2026-10-01',forecast_end:'2026-10-28',quality:{coverage_start:'2026-07-01',coverage_end:'2026-09-30',config:{}}}} as Snapshot);
const job=(id:string,kind='forecast',review_id?:string)=>({id,kind,review_id,created:1791144000,source_name:'Combined sales (3 files).csv',source_files:['july.csv','august.csv','september.csv']} as Job);
test('history joins exact forecast IDs and hides only their linked reviews',()=>{
 const entries=pastAnalyses([saved('f1'),saved('f2')],[job('f1','forecast','r1'),job('f2','forecast','r2'),job('r1','normalize'),job('r2','normalize'),job('r3','normalize')]);
 assert.equal(entries.length,3);
 assert.ok(entries.find(e=>e.id==='f1')?.snapshot);
 assert.ok(entries.find(e=>e.id==='f1')?.job);
 assert.deepEqual(entries.find(e=>e.id==='f1')?.files,['july.csv','august.csv','september.csv']);
 assert.match(entries.find(e=>e.id==='f1')!.title,/1 Jul 2026/);
 assert.ok(entries.find(e=>e.id==='r3'),'Unrelated review remains accessible');
});
test('removed analyses do not reappear as live jobs or processing steps',()=>{
 assert.deepEqual(pastAnalyses([], [job('f1','forecast','r1'),job('r1','normalize')],['f1']),[]);
});
test('older saved analyses remain readable when live jobs expire',()=>{
 const e=pastAnalyses([saved('f1')],[])[0];
 assert.equal(e.fileCount,3);assert.equal(e.job,undefined);assert.equal(e.files.length,0);
 const single={...saved('one'),name:'september.csv'};
 assert.equal(pastAnalyses([single],[])[0].title,'september');
});
