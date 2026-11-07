// Sends push notifications about new unusual deals to every subscribed profile.
// Runs in GitHub Actions right after the data pipeline. Uses the same deals engine as the app.
//
// env: API_URL, CLOUDFLARE_API_TOKEN, DATA_DIR (pipeline output), SITE_URL
import fs from "node:fs";
import path from "node:path";
import webpush from "web-push";
import { deriveKeys } from "./keys.mjs";
import { buildCatalog, findDeals, weeklySummary } from "../web/js/engine.js";

const API = (process.env.API_URL || "").replace(/\/$/, "");
const DATA = process.env.DATA_DIR || "out";
const SITE = (process.env.SITE_URL || "").replace(/\/$/, "/");
const keys = deriveKeys(process.env.CLOUDFLARE_API_TOKEN || "");
if (!API || !keys) {
  console.log("notify: API_URL or Cloudflare token missing — skipping push");
  process.exit(0);
}
webpush.setVapidDetails("mailto:noreply@example.com", keys.vapidPublic, keys.vapidPrivate);

const auth = { Authorization: `Bearer ${keys.pipelineToken}` };
const readJson = (p, d) => { try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch { return d; } };

const statePath = path.join(DATA, "state", "sent.json");
const sent = readJson(statePath, {});
const index = readJson(path.join(DATA, "stores.json"), { stores: [] });
const metaByKey = new Map(index.stores.map((s) => [s.k, s]));
const storeCache = new Map();
const statsCache = new Map();
const loadStore = (k) => {
  if (!storeCache.has(k)) storeCache.set(k, readJson(path.join(DATA, "s", `${k}.json`), null));
  return storeCache.get(k);
};
const loadStats = (c) => {
  if (!statsCache.has(c)) statsCache.set(c, readJson(path.join(DATA, "stats", `${c}.json`), {}));
  return statsCache.get(c);
};

const nowIL = new Date(Date.now() + 2 * 3600e3);
const isSundayMorning = nowIL.getUTCDay() === 0 && nowIL.getUTCHours() < 12;
const fmt = (x) => `₪${Number(x).toFixed(2)}`;

function short(d) {
  const s = Math.round(d.savingsPct * 100);
  const where = d.store.chainName || "";
  if (d.type === "target") return `🎯 ${d.item.name} ${fmt(d.price)} (${where})`;
  if (d.type === "same") return `${d.item.name} ${fmt(d.price)}${d.minQty > 1 ? ` ב-${d.minQty}+` : ""} (−${s}%, ${where})`;
  return `${d.item.name} במקום ${d.product.name} (−${s}%, ${where})`;
}

async function main() {
  const r = await fetch(`${API}/api/admin/profiles`, { headers: auth });
  if (!r.ok) {
    console.log("notify: cannot list profiles", r.status, await r.text());
    return;
  }
  const { profiles } = await r.json();
  console.log(`notify: ${profiles.length} subscribed profiles`);
  let sentCount = 0;
  for (const p of profiles) {
    try {
      const data = p.data || {};
      const stores = (data.stores || []).map((k) => ({ meta: metaByKey.get(k), data: loadStore(k) })).filter((s) => s.meta && s.data);
      if (!stores.length) continue;
      const catalog = buildCatalog(stores);
      const stats = {};
      for (const s of stores) stats[s.meta.chainId] = loadStats(s.meta.chainId);
      const dismissed = new Set(data.dismissed || []);
      const deals = findDeals({ products: data.products || [], catalog, stats, prefs: data.prefs || {} })
        .filter((d) => d.type !== "fake" && d.type !== "cheaper" && !dismissed.has(d.key));
      const mine = sent[p.id] || {};
      const fresh = deals.filter((d) => !mine[d.key]);
      const messages = [];
      if (fresh.length === 1) {
        const d = fresh[0];
        messages.push({ title: d.type === "target" ? "🎯 הגיע למחיר היעד" : `🔥 מבצע חריג: −${Math.round(d.savingsPct * 100)}%`, body: short(d), tag: "deals", url: "#/deals" });
      } else if (fresh.length > 1) {
        const save = fresh.reduce((a, d) => a + d.saveAmount, 0);
        messages.push({ title: `🔥 ${fresh.length} מבצעים חריגים חדשים${save >= 5 ? ` · עד ${fmt(save)} חיסכון` : ""}`, body: fresh.slice(0, 3).map(short).join("\n"), tag: "deals", url: "#/deals" });
      }
      if (isSundayMorning && (data.prefs || {}).weekly !== false && (!mine.__weekly || Date.now() - mine.__weekly > 5 * 864e5) && deals.length) {
        const w = weeklySummary(deals);
        messages.push({ title: "🗓️ הסיכום השבועי שלך", body: `${w.count} מבצעים על דברים שאתה קונה · חיסכון אפשרי ${fmt(w.potential)}\n${w.top.map(short).join("\n")}`, tag: "weekly", url: "#/deals" });
        mine.__weekly = Date.now();
      }
      for (const m of messages) {
        try {
          await webpush.sendNotification(p.sub, JSON.stringify({ ...m, url: SITE ? SITE + m.url : m.url }), { TTL: 12 * 3600, urgency: "normal" });
          sentCount++;
        } catch (e) {
          console.log(`push failed for ${p.id.slice(0, 6)}: ${e.statusCode}`);
          if (e.statusCode === 404 || e.statusCode === 410) {
            await fetch(`${API}/api/admin/unsubscribe`, { method: "POST", headers: { ...auth, "Content-Type": "application/json" }, body: JSON.stringify({ id: p.id }) });
          }
        }
      }
      const now = Date.now();
      for (const d of fresh) mine[d.key] = now;
      for (const [k, t] of Object.entries(mine)) if (k !== "__weekly" && now - t > 21 * 864e5) delete mine[k];
      sent[p.id] = mine;
    } catch (e) {
      console.log("profile error", e);
    }
  }
  fs.mkdirSync(path.dirname(statePath), { recursive: true });
  fs.writeFileSync(statePath, JSON.stringify(sent));
  console.log(`notify: sent ${sentCount} notifications`);
}

main().catch((e) => { console.log("notify failed", e); });
