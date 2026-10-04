import test from "node:test";
import assert from "node:assert/strict";
import { IDBFactory } from "fake-indexeddb";
import fs from "node:fs";
import {
  historySave,
  historyList,
  historyDelete,
  type Snapshot,
} from "../src/data";
const sample = JSON.parse(
  fs.readFileSync(
    new URL("../../samples/test-result.json", import.meta.url),
    "utf8",
  ),
) as Snapshot;
test("browser history keeps the newest ten and deletes only the selected entry", async () => {
  globalThis.indexedDB = new IDBFactory();
  for (let i = 0; i < 12; i++)
    await historySave({
      ...sample,
      id: String(i),
      created: new Date(2026, 0, i + 1).toISOString(),
    });
  const rows = await historyList();
  assert.equal(rows.length, 10);
  assert.equal(rows[0].id, "11");
  assert.ok(!rows.some((r) => r.id === "0"));
  await historyDelete("11");
  assert.equal((await historyList()).length, 9);
});
test("oversized history becomes an explicitly labelled summary and reports fallback", async () => {
  globalThis.indexedDB = new IDBFactory();
  const s = structuredClone(sample);
  s.id = "large";
  s.result.quality.issues = [
    {
      code: "large",
      product_id: "0007",
      row: null,
      blocking: false,
      message: "x".repeat(26 * 1024 * 1024),
    },
  ];
  // Oversized issue details should not turn a summary into another oversized payload.
  const saved = await historySave(s);
  assert.equal(saved, true);
  const stored = (await historyList())[0];
  assert.equal(stored.summaryOnly, true);
  assert.equal(stored.result.products[0].forecast?.length, 0);
  assert.equal(
    stored.result.products[0].forecast_total,
    s.result.products[0].forecast_total,
  );
});

test("unavailable browser storage rejects clearly without claiming a save", async () => {
  globalThis.indexedDB = {
    open() {
      const r: any = {};
      queueMicrotask(() => r.onerror());
      return r;
    },
  } as unknown as IDBFactory;
  await assert.rejects(historySave(sample), /Browser storage unavailable/);
  globalThis.indexedDB = new IDBFactory();
});
