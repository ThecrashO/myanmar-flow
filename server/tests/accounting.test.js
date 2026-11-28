import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { registerHooks } from "node:module";
import test from "node:test";

import { convertV4MiniflareOptions, Miniflare } from "miniflare";

registerHooks({
  load(url, context, next) {
    if (!url.endsWith(".html")) return next(url, context);
    return { format: "module", source: "export default ''", shortCircuit: true };
  },
});
const { complete } = await import("../src/shop.js");
const { default: worker, reserve } = await import("../src/index.js");
const now = new Date().toISOString();

async function database(t) {
  const mf = new Miniflare(convertV4MiniflareOptions({
    modules: true, script: "export default { fetch: () => new Response() }",
    d1Databases: { DB: "crash-flow-test" },
  }));
  t.after(() => mf.dispose());
  const DB = await mf.getD1Database("DB");
  const sql = readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  await DB.batch(sql.replace(/--[^\n]*/g, "").split(";").map((s) => s.trim()).filter(Boolean)
    .map((statement) => DB.prepare(statement)));
  return DB;
}

test("one balance cannot fund overlapping reservations", async (t) => {
  const DB = await database(t);
  await DB.prepare("INSERT INTO codes (code, balance_ms, created_at) VALUES (?, ?, ?)")
    .bind("MF-ABCD-EFGH", 7500, now).run();
  const results = await Promise.all([reserve({ DB }, "MF-ABCD-EFGH", 5000), reserve({ DB }, "MF-ABCD-EFGH", 5000)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await DB.prepare("SELECT balance_ms FROM codes").first("balance_ms"), 2500);
});

test("payment claim, fulfillment and ledger roll back and retry together", async (t) => {
  const DB = await database(t);
  const order = { id: "order-1", minutes: 30 };
  await DB.prepare("INSERT INTO orders (id, minutes, amount, status, created_at) VALUES (?, ?, ?, 'review', ?)")
    .bind(order.id, order.minutes, 3000, now).run();
  await DB.prepare("INSERT INTO payments (at, amount, raw) VALUES (?, 3000, 'confirmed')").bind(now).run();
  await DB.prepare("CREATE TRIGGER reject_ledger BEFORE INSERT ON ledger BEGIN SELECT RAISE(ABORT, 'test rollback'); END").run();
  await assert.rejects(complete({ DB }, order, 1), /test rollback/);
  assert.equal(await DB.prepare("SELECT status FROM orders").first("status"), "review");
  assert.equal(await DB.prepare("SELECT order_id FROM payments").first("order_id"), null);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM codes").first("n"), 0);
  await DB.prepare("DROP TRIGGER reject_ledger").run();

  const results = await Promise.all([complete({ DB }, order, 1), complete({ DB }, order, 1)]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal(await DB.prepare("SELECT order_id FROM payments").first("order_id"), order.id);
  assert.equal(await DB.prepare("SELECT balance_ms FROM codes").first("balance_ms"), 1_800_000);
  assert.equal(await DB.prepare("SELECT COUNT(*) AS n FROM ledger").first("n"), 1);
});

test("proxy forwards a bounded text request and refunds a failed upstream call", async (t) => {
  const DB = await database(t);
  const code = "MF-ABCD-EFGH";
  await DB.prepare("INSERT INTO codes (code, balance_ms, created_at) VALUES (?, ?, ?)").bind(code, 5000, now).run();
  const originalFetch = globalThis.fetch;
  t.after(() => { globalThis.fetch = originalFetch; });
  let forwarded;
  globalThis.fetch = (url, options) => {
    if (!String(url).startsWith("https://generativelanguage.googleapis.com/")) return originalFetch(url, options);
    forwarded = JSON.parse(options.body);
    return Promise.resolve(new Response(null, { status: 503 }));
  };
  const response = await worker.fetch(new Request("http://local/v1beta/models/gemini-3.5-flash-lite:generateContent", {
    method: "POST", headers: { authorization: `Bearer ${code}` },
    body: JSON.stringify({
      contents: [{ role: "user", parts: [{ text: "clean this sentence" }] }],
      generationConfig: { temperature: 0.5, maxOutputTokens: 256 },
      metadata: { requestLabel: "test" },
    }),
  }), { DB, GEMINI_API_KEY: "test" }, {});
  assert.equal(response.status, 503);
  assert.deepEqual(forwarded.contents, [{ parts: [{ text: "clean this sentence" }] }]);
  assert.equal(forwarded.generationConfig.candidateCount, 1);
  assert.equal(forwarded.generationConfig.temperature, undefined);
  assert.equal(forwarded.metadata, undefined);
  assert.equal(await DB.prepare("SELECT balance_ms FROM codes").first("balance_ms"), 5000);
});
