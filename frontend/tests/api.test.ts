import test from "node:test";
import assert from "node:assert/strict";
import { api } from "../src/data";
test("expired analysis carries HTTP status for stopping retry loops", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () =>
      new Response(JSON.stringify({ detail: "Expired analysis" }), {
        status: 404,
      });
    await assert.rejects(
      api("/jobs/expired"),
      (e: any) => e.status === 404 && e.message === "Expired analysis",
    );
  } finally {
    globalThis.fetch = original;
  }
});
test("hosting wake-up HTML becomes a readable retry message", async () => {
  const original = globalThis.fetch;
  try {
    globalThis.fetch = async () => new Response("<html>Starting</html>");
    await assert.rejects(api("/session"), /Server is waking up/);
  } finally {
    globalThis.fetch = original;
  }
});
