import test from "node:test";
import assert from "node:assert/strict";
import { restore, backup, csv, forecastCSV, type Snapshot } from "../src/data";
import fs from "node:fs";
const sample = JSON.parse(
  fs.readFileSync(
    new URL("../../samples/test-result.json", import.meta.url),
    "utf8",
  ),
) as Snapshot;
test("portable backup restores actual results and inventory, without live access", () => {
  const saved = restore(backup(sample));
  assert.deepEqual(
    saved.result.products[0].forecast,
    sample.result.products[0].forecast,
  );
  assert.notEqual(saved.id, sample.id);
  assert.equal(saved.result.products[0].inventory_eligible, false);
});
test("backup rejects invalid dates, malformed issues and inconsistent totals", () => {
  for (const mutate of [
    (s: any) => (s.result.forecast_start = "invalid"),
    (s: any) => (s.result.quality.issues = [{ message: { nested: true } }]),
    (s: any) => (s.result.products[0].forecast_total = 1234),
    (s: any) => (s.result.products[0].status = {}),
  ]) {
    const s = structuredClone(sample);
    mutate(s);
    assert.throws(() => restore(backup(s)));
  }
});
test("backup discards unknown secret-like fields", () => {
  const s: any = structuredClone(sample);
  s.result.access_token = "example";
  s.result.quality.config.api_key = "example";
  const result = backup(restore(backup(s)));
  assert.ok(!result.includes("access_token"));
  assert.ok(!result.includes("api_key"));
});
test("CSV neutralizes spreadsheet formulas and preserves leading-zero IDs", () => {
  const text = csv([["0007", "=SUM(A1)", " +cmd", "@x", 'normal,quote"']]);
  assert.ok(text.includes('"0007"'));
  assert.ok(text.includes("'=SUM"));
  assert.ok(text.includes("' +cmd"));
  assert.ok(text.includes('quote""'));
});
test("forecast export has 28 days per eligible product", () => {
  const text = forecastCSV(sample.result);
  assert.equal(text.split("\r\n").length, 85);
  assert.ok(text.includes("0007"));
});
test("revision 2 rejects altered payload with unchanged checksum; legacy remains readable", () => {
  const doc = JSON.parse(backup(sample));
  doc.snapshot.name = "altered";
  assert.throws(() => restore(JSON.stringify(doc)));
  delete doc.checksum;
  doc.revision = 1;
  assert.equal(restore(JSON.stringify(doc)).name, "altered");
});
test("new forecast methods survive a portable round trip", () => {
  for (const method of ["mean_56", "exponential_level"]) {
    const s = structuredClone(sample);
    s.result.products[0].method = method;
    assert.equal(restore(backup(s)).result.products[0].method, method);
  }
});
test('inventory backup rejects invalid dates and foreign products; strips nested extra fields', () => {
  const doc = JSON.parse(fs.readFileSync(new URL('../../examples/with-inventory.retailplan.json', import.meta.url),'utf8'));
  const s = doc.snapshot;
  s.plans['0007'].assumptions.incoming = [{id:'PO1',date:'2026-07-20',units:12,status:'open',api_key:'discard-me'}];
  const restored = restore(backup(s));
  assert.equal(restored.plans['0007'].suggested_order_units,132);
  assert.ok(!JSON.stringify(restored).includes('discard-me'));
  for (const mutate of [
    (v:any)=>v.plans['0007'].planning_date='invalid',
    (v:any)=>v.plans['0007'].assumptions.stock=-1,
    (v:any)=>v.plans['0007'].assumptions.incoming[0].date='2026-02-30',
    (v:any)=>v.plans['foreign']=v.plans['0007'],
  ]) {const v=structuredClone(s);mutate(v);assert.throws(()=>restore(backup(v)));}
});
