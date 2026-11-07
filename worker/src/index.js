// Shopping app backend: shared shopping lists + push-notification profiles.
// Storage: Cloudflare D1 (binding DB). Secret PIPELINE_TOKEN guards admin routes.

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET,POST,PUT,PATCH,DELETE,OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type,Authorization",
  "Access-Control-Max-Age": "86400",
};

const json = (data, status = 200) =>
  new Response(JSON.stringify(data), { status, headers: { "Content-Type": "application/json; charset=utf-8", ...CORS } });
const err = (msg, status = 400) => json({ error: msg }, status);

const ID_RE = /^[A-Za-z0-9_-]{8,64}$/;

function newId(len = 22) {
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(len));
  let s = "";
  for (const b of bytes) s += alphabet[b % alphabet.length];
  return s;
}

async function body(req) {
  try {
    const t = await req.text();
    if (t.length > 200_000) return null;
    return t ? JSON.parse(t) : {};
  } catch {
    return null;
  }
}

const str = (v, max = 300) => (typeof v === "string" ? v.slice(0, max) : "");
const num = (v, d = 0) => (typeof v === "number" && isFinite(v) ? v : d);

function rowToItem(r) {
  return { id: r.id, text: r.text, qty: r.qty, note: r.note, code: r.code, cat: r.cat, done: !!r.done, by: r.by, pos: r.pos, created: r.created, updated: r.updated };
}

async function getList(env, id) {
  const list = await env.DB.prepare("SELECT * FROM lists WHERE id = ?").bind(id).first();
  if (!list) return null;
  const { results } = await env.DB.prepare("SELECT * FROM list_items WHERE list_id = ? ORDER BY done, pos, created").bind(id).all();
  return { list: { id: list.id, name: list.name, created: list.created, updated: list.updated }, items: results.map(rowToItem) };
}

async function touch(env, id) {
  await env.DB.prepare("UPDATE lists SET updated = ? WHERE id = ?").bind(Date.now(), id).run();
}

async function handleLists(req, env, parts) {
  const m = req.method;
  // POST /api/lists
  if (parts.length === 0) {
    if (m !== "POST") return err("method", 405);
    const b = await body(req);
    if (!b) return err("bad json");
    const id = newId();
    const now = Date.now();
    await env.DB.prepare("INSERT INTO lists (id, name, created, updated) VALUES (?, ?, ?, ?)").bind(id, str(b.name, 80) || "רשימת קניות", now, now).run();
    const items = Array.isArray(b.items) ? b.items.slice(0, 300) : [];
    for (const [i, it] of items.entries()) {
      await env.DB.prepare("INSERT INTO list_items (id, list_id, text, qty, note, code, cat, done, by, pos, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
        .bind(newId(16), id, str(it.text, 200) || "פריט", num(it.qty, 1), str(it.note, 200), str(it.code, 20), str(it.cat, 40), it.done ? 1 : 0, str(b.by, 40), i, now, now).run();
    }
    return json(await getList(env, id), 201);
  }
  const id = parts[0];
  if (!ID_RE.test(id)) return err("bad id", 404);
  const exists = await env.DB.prepare("SELECT id FROM lists WHERE id = ?").bind(id).first();
  if (!exists) return err("not found", 404);

  if (parts.length === 1) {
    if (m === "GET") return json(await getList(env, id));
    if (m === "PATCH") {
      const b = await body(req);
      if (!b) return err("bad json");
      if (b.name) await env.DB.prepare("UPDATE lists SET name = ?, updated = ? WHERE id = ?").bind(str(b.name, 80), Date.now(), id).run();
      return json(await getList(env, id));
    }
    if (m === "DELETE") {
      await env.DB.prepare("DELETE FROM list_items WHERE list_id = ?").bind(id).run();
      await env.DB.prepare("DELETE FROM lists WHERE id = ?").bind(id).run();
      return json({ ok: true });
    }
    return err("method", 405);
  }
  if (parts[1] === "done" && m === "DELETE") {
    await env.DB.prepare("DELETE FROM list_items WHERE list_id = ? AND done = 1").bind(id).run();
    await touch(env, id);
    return json(await getList(env, id));
  }
  if (parts[1] !== "items") return err("not found", 404);

  if (parts.length === 2 && m === "POST") {
    const b = await body(req);
    if (!b || !str(b.text)) return err("text required");
    const count = await env.DB.prepare("SELECT COUNT(*) AS c FROM list_items WHERE list_id = ?").bind(id).first();
    if (count.c >= 500) return err("list full");
    const now = Date.now();
    const iid = newId(16);
    await env.DB.prepare("INSERT INTO list_items (id, list_id, text, qty, note, code, cat, done, by, pos, created, updated) VALUES (?,?,?,?,?,?,?,?,?,?,?,?)")
      .bind(iid, id, str(b.text, 200), num(b.qty, 1), str(b.note, 200), str(b.code, 20), str(b.cat, 40), b.done ? 1 : 0, str(b.by, 40), num(b.pos, now), now, now).run();
    await touch(env, id);
    return json(await getList(env, id), 201);
  }
  const iid = parts[2];
  if (!iid || !ID_RE.test(iid)) return err("bad item", 404);
  if (m === "PATCH") {
    const b = await body(req);
    if (!b) return err("bad json");
    const cur = await env.DB.prepare("SELECT * FROM list_items WHERE id = ? AND list_id = ?").bind(iid, id).first();
    if (!cur) return err("not found", 404);
    const n = {
      text: "text" in b ? str(b.text, 200) || cur.text : cur.text,
      qty: "qty" in b ? num(b.qty, cur.qty) : cur.qty,
      note: "note" in b ? str(b.note, 200) : cur.note,
      code: "code" in b ? str(b.code, 20) : cur.code,
      cat: "cat" in b ? str(b.cat, 40) : cur.cat,
      done: "done" in b ? (b.done ? 1 : 0) : cur.done,
      pos: "pos" in b ? num(b.pos, cur.pos) : cur.pos,
    };
    await env.DB.prepare("UPDATE list_items SET text=?, qty=?, note=?, code=?, cat=?, done=?, pos=?, updated=? WHERE id=? AND list_id=?")
      .bind(n.text, n.qty, n.note, n.code, n.cat, n.done, n.pos, Date.now(), iid, id).run();
    await touch(env, id);
    return json(await getList(env, id));
  }
  if (m === "DELETE") {
    await env.DB.prepare("DELETE FROM list_items WHERE id = ? AND list_id = ?").bind(iid, id).run();
    await touch(env, id);
    return json(await getList(env, id));
  }
  return err("method", 405);
}

async function handleProfiles(req, env, parts) {
  const id = parts[0];
  if (!id || !/^[A-Za-z0-9_-]{20,64}$/.test(id)) return err("bad id", 404);
  if (req.method === "PUT") {
    const b = await body(req);
    if (!b || typeof b.data !== "object") return err("bad json");
    const data = JSON.stringify(b.data);
    if (data.length > 150_000) return err("too big", 413);
    const sub = b.sub ? JSON.stringify(b.sub) : "";
    await env.DB.prepare("INSERT INTO profiles (id, data, sub, updated) VALUES (?, ?, ?, ?) ON CONFLICT(id) DO UPDATE SET data = excluded.data, sub = CASE WHEN excluded.sub = '' THEN profiles.sub ELSE excluded.sub END, updated = excluded.updated")
      .bind(id, data, sub, Date.now()).run();
    return json({ ok: true });
  }
  if (req.method === "DELETE") {
    await env.DB.prepare("DELETE FROM profiles WHERE id = ?").bind(id).run();
    return json({ ok: true });
  }
  if (req.method === "GET") {
    const r = await env.DB.prepare("SELECT data, updated FROM profiles WHERE id = ?").bind(id).first();
    if (!r) return err("not found", 404);
    return json({ data: JSON.parse(r.data), updated: r.updated });
  }
  return err("method", 405);
}

async function handleAdmin(req, env, parts) {
  const auth = req.headers.get("Authorization") || "";
  if (!env.PIPELINE_TOKEN || auth !== `Bearer ${env.PIPELINE_TOKEN}`) return err("unauthorized", 401);
  if (parts[0] === "profiles" && req.method === "GET") {
    const { results } = await env.DB.prepare("SELECT id, data, sub, updated FROM profiles WHERE sub != ''").all();
    return json({ profiles: results.map((r) => ({ id: r.id, data: JSON.parse(r.data), sub: JSON.parse(r.sub), updated: r.updated })) });
  }
  if (parts[0] === "unsubscribe" && req.method === "POST") {
    const b = await body(req);
    if (b && b.id) await env.DB.prepare("UPDATE profiles SET sub = '' WHERE id = ?").bind(String(b.id)).run();
    return json({ ok: true });
  }
  return err("not found", 404);
}

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });
    const url = new URL(req.url);
    const parts = url.pathname.split("/").filter(Boolean);
    try {
      if (parts[0] !== "api") return json({ ok: true, service: "shopping-api" });
      if (parts[1] === "health") return json({ ok: true });
      if (parts[1] === "lists") return await handleLists(req, env, parts.slice(2));
      if (parts[1] === "profiles") return await handleProfiles(req, env, parts.slice(2));
      if (parts[1] === "admin") return await handleAdmin(req, env, parts.slice(2));
      return err("not found", 404);
    } catch (e) {
      return err(String(e && e.message || e), 500);
    }
  },
};
