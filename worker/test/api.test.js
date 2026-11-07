import { test } from "node:test";
import assert from "node:assert";
import { Miniflare } from "miniflare";
import fs from "node:fs";

test("lists + profiles API", async () => {
  const mf = new Miniflare({
    modules: true,
    scriptPath: "src/index.js",
    compatibilityDate: "2026-07-01",
    d1Databases: ["DB"],
    bindings: { PIPELINE_TOKEN: "t0k" },
  });
  const db = await mf.getD1Database("DB");
  for (const stmt of fs.readFileSync("migrations/0001_init.sql", "utf8").split(";").map(s => s.trim()).filter(Boolean)) {
    await db.prepare(stmt).run();
  }
  const f = (p, o = {}) => mf.dispatchFetch("http://x" + p, { ...o, headers: { "Content-Type": "application/json", ...(o.headers || {}) } });
  let r = await f("/api/lists", { method: "POST", body: JSON.stringify({ name: "בית", items: [{ text: "חלב" }] }) });
  assert.equal(r.status, 201);
  let j = await r.json();
  const id = j.list.id;
  assert.equal(j.items.length, 1);
  r = await f(`/api/lists/${id}/items`, { method: "POST", body: JSON.stringify({ text: "לחם", qty: 2, by: "מתן" }) });
  j = await r.json();
  assert.equal(j.items.length, 2);
  const lechem = j.items.find(i => i.text === "לחם");
  r = await f(`/api/lists/${id}/items/${lechem.id}`, { method: "PATCH", body: JSON.stringify({ done: true }) });
  j = await r.json();
  assert.ok(j.items.find(i => i.id === lechem.id).done);
  r = await f(`/api/lists/${id}/done`, { method: "DELETE" });
  j = await r.json();
  assert.equal(j.items.length, 1);
  r = await f(`/api/lists/${id}/items/${j.items[0].id}`, { method: "DELETE" });
  j = await r.json();
  assert.equal(j.items.length, 0);
  const pid = "p".repeat(24);
  r = await f(`/api/profiles/${pid}`, { method: "PUT", body: JSON.stringify({ data: { stores: ["a"] }, sub: { endpoint: "https://e" } }) });
  assert.equal(r.status, 200);
  r = await f(`/api/admin/profiles`);
  assert.equal(r.status, 401);
  r = await f(`/api/admin/profiles`, { headers: { Authorization: "Bearer t0k" } });
  j = await r.json();
  assert.equal(j.profiles[0].sub.endpoint, "https://e");
  r = await f(`/api/lists/nonexistent123`);
  assert.equal(r.status, 404);
  await mf.dispose();
  setTimeout(() => process.exit(0), 100);
});
