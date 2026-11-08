// Loading price data published by the pipeline (./data/...), with an IndexedDB cache.
import { idb, state, setTemp } from "./store.js";
import { buildCatalog, makeNameIndex, findDeals, predictRunOut, median } from "./engine.js";

export const DATA = "./data";

let config = null;
export async function getConfig() {
  if (config) return config;
  try {
    const r = await fetch("config.json", { cache: "no-store" });
    config = r.ok ? await r.json() : {};
  } catch {
    config = {};
  }
  return config;
}

async function fetchJson(url) {
  const r = await fetch(url, { cache: "no-cache" });
  if (!r.ok) throw new Error(`${r.status} ${url}`);
  return r.json();
}

/** stores.json index; cached so the app works offline */
export async function loadIndex(force = false) {
  try {
    const idx = await fetchJson(`${DATA}/stores.json`);
    await idb.set("cache", "index", idx);
    setTemp({ index: idx, indexError: "" });
    return idx;
  } catch (e) {
    const cached = await idb.get("cache", "index");
    if (cached) {
      setTemp({ index: cached, indexError: "" });
      return cached;
    }
    setTemp({ index: { stores: [], cities: [] }, indexError: String(e.message || e) });
    return null;
  }
}

export async function loadCategories() {
  try {
    const c = await fetchJson(`${DATA}/categories.json`);
    await idb.set("cache", "categories", c);
    setTemp({ categories: c });
  } catch {
    setTemp({ categories: (await idb.get("cache", "categories")) || {} });
  }
}

async function loadStore(meta) {
  const ck = `s:${meta.k}`;
  const cached = await idb.get("cache", ck);
  if (cached && cached.u === meta.u && cached.data) return cached.data;
  try {
    const data = await fetchJson(`${DATA}/s/${meta.k}.json`);
    await idb.set("cache", ck, { u: meta.u, data });
    return data;
  } catch (e) {
    if (cached) return cached.data;
    throw e;
  }
}

async function loadStats(chainId, u) {
  const ck = `st:${chainId}`;
  const cached = await idb.get("cache", ck);
  if (cached && cached.u === u) return cached.data;
  try {
    const data = await fetchJson(`${DATA}/stats/${chainId}.json`);
    await idb.set("cache", ck, { u, data });
    return data;
  } catch {
    return cached ? cached.data : {};
  }
}

let loading = null;
/** Load data for the user's stores and build the in-memory catalog. */
export async function loadCatalog() {
  if (loading) return loading;
  loading = (async () => {
    setTemp({ dataLoading: true, dataError: "" });
    try {
      const idx = state.index || (await loadIndex());
      const metas = (idx && idx.stores ? idx.stores : []).filter((s) => state.myStores.includes(s.k));
      const loaded = [];
      const errors = [];
      let done = 0;
      await Promise.all(metas.map(async (m) => {
        try {
          loaded.push({ meta: m, data: await loadStore(m) });
        } catch (e) {
          errors.push(`${m.chainName} ${m.name}`);
        }
        done++;
        setTemp({ dataProgress: done / Math.max(1, metas.length) });
      }));
      const chains = [...new Set(metas.map((m) => m.chainId))];
      const stats = {};
      await Promise.all(chains.map(async (c) => { stats[c] = await loadStats(c, idx.u); }));
      const catalog = buildCatalog(loaded);
      const nameIndex = makeNameIndex(catalog);
      setTemp({ catalog, nameIndex, stats, dataLoading: false, dataError: errors.length ? `לא נטענו: ${errors.join(", ")}` : "", dataVersion: (state.dataVersion || 0) + 1 });
      recomputeDeals();
    } catch (e) {
      setTemp({ dataLoading: false, dataError: String(e.message || e) });
    } finally {
      loading = null;
    }
  })();
  return loading;
}

export function productKey(p) {
  return p.code || `n:${p.name}`;
}

/** Convert stored products into the engine's product format. */
export function engineProducts(products = state.products) {
  return Object.values(products).filter((p) => !p.hidden).map((p) => {
    const pr = predictRunOut(p.purchases || []);
    const paid = (p.purchases || []).map((x) => x.price).filter((x) => x > 0);
    return {
      code: p.code || "", name: p.name, cat: p.cat || "", catManual: !!p.catManual, unit: p.unit || "", qty: p.qty || 0,
      allowAlt: p.allowAlt, target: p.target || 0, runOut: pr.next || 0, refPrice: median(paid) || 0,
    };
  });
}

export function recomputeDeals() {
  if (!state.catalog) return;
  const deals = findDeals({ products: engineProducts(), catalog: state.catalog, stats: state.stats || {}, prefs: state.prefs });
  setTemp({ deals });
}

export function storeLabel(meta) {
  if (!meta) return "";
  return `${meta.chainName || ""} ${meta.name || ""}`.trim();
}

const CHAIN_SHORT = [["רמי לוי", "רמי לוי"], ["שופרסל", "שופרסל"], ["אושר עד", "אושר עד"], ["טיב טעם", "טיב טעם"], ["יוחננוף", "יוחננוף"], ["ויקטורי", "ויקטורי"], ["יינות ביתן", "יינות ביתן"], ["קרפור", "קרפור"], ["חצי חינם", "חצי חינם"], ["יילו", "יילו"], ["פרשמרקט", "פרשמרקט"], ["פרש מרקט", "פרשמרקט"], ["קשת", "קשת טעמים"], ["דור אלון", "AM:PM"]];

/** Short store name: "רמי לוי · רמת גן איילון" instead of "רמי לוי שיווק השקמה רמי לוי רמת גן איילון" */
export function storeShort(meta) {
  if (!meta) return "";
  const full = `${meta.chainName || ""} ${meta.name || ""}`;
  let chain = (meta.chainName || "").replace(/שיווק השקמה|בע"מ|בע״מ|\(.*?\)/g, "").trim();
  for (const [needle, short] of CHAIN_SHORT) if (full.includes(needle)) { chain = short; break; }
  let branch = (meta.name || "").split(chain).join(" ").replace(/שיווק השקמה|בע"מ/g, " ").replace(/\s+/g, " ").trim();
  if (!branch) branch = meta.city || "";
  return `${chain} · ${branch}`.replace(/ · $/, "");
}

export function catLabel(cat) {
  return (state.categories && state.categories[cat]) || "";
}
