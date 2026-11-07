// App state persisted in IndexedDB, plus a tiny subscribe/notify mechanism.
import { useEffect, useState } from "../vendor/preact-hooks.mjs";

const DB_NAME = "smart-basket";
let dbp = null;

function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const r = indexedDB.open(DB_NAME, 1);
      r.onupgradeneeded = () => {
        r.result.createObjectStore("kv");
        r.result.createObjectStore("cache");
      };
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    });
  }
  return dbp;
}

async function tx(storeName, mode, fn) {
  const d = await db();
  return new Promise((resolve, reject) => {
    const t = d.transaction(storeName, mode);
    const s = t.objectStore(storeName);
    let out;
    Promise.resolve(fn(s)).then((v) => (out = v));
    t.oncomplete = () => resolve(out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  });
}

const req = (r) => new Promise((res, rej) => { r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); });

export const idb = {
  get: (store, key) => tx(store, "readonly", (s) => req(s.get(key))),
  set: (store, key, val) => tx(store, "readwrite", (s) => { s.put(val, key); }),
  del: (store, key) => tx(store, "readwrite", (s) => { s.delete(key); }),
  keys: (store) => tx(store, "readonly", (s) => req(s.getAllKeys())),
};

export const DEFAULT_PREFS = {
  name: "",
  threshold: 20,
  noClub: {},
  excludeWords: [],
  notify: false,
  weekly: true,
  profileId: "",
};

// Persisted keys and their defaults
const DEFAULTS = {
  prefs: DEFAULT_PREFS,
  myStores: [],
  products: {},      // key -> product
  receipts: [],      // newest first
  list: [],          // my private shopping list
  shared: [],        // [{id, name}]
  taken: [],         // savings log [{date, name, saved, key}]
  dismissed: {},     // dealKey -> ts
  seenDeals: {},     // dealKey -> ts (for "new" badges)
};

export const state = { ready: false, ...structuredClone(DEFAULTS) };
const subs = new Set();
const listeners = new Map(); // key -> [fn]

export async function loadState() {
  for (const k of Object.keys(DEFAULTS)) {
    try {
      const v = await idb.get("kv", k);
      if (v !== undefined) state[k] = k === "prefs" ? { ...DEFAULT_PREFS, ...v } : v;
    } catch (e) {
      console.warn("load", k, e);
    }
  }
  state.ready = true;
  emit();
}

function emit() {
  subs.forEach((f) => f());
}

export function onChange(key, fn) {
  if (!listeners.has(key)) listeners.set(key, []);
  listeners.get(key).push(fn);
}

/** Update one or more persisted keys (shallow). */
export function update(patch) {
  for (const [k, v] of Object.entries(patch)) {
    state[k] = v;
    if (k in DEFAULTS) idb.set("kv", k, v).catch((e) => console.warn("save", k, e));
    (listeners.get(k) || []).forEach((f) => f(v));
  }
  emit();
}

/** Set transient (non-persisted) values. */
export function setTemp(patch) {
  Object.assign(state, patch);
  emit();
}

export function useApp() {
  const [, force] = useState(0);
  useEffect(() => {
    const f = () => force((x) => x + 1);
    subs.add(f);
    return () => subs.delete(f);
  }, []);
  return state;
}

export function uid(n = 12) {
  const a = "abcdefghijkmnopqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  return Array.from(crypto.getRandomValues(new Uint8Array(n)), (b) => a[b % a.length]).join("");
}

let toastTimer = null;
export function toast(msg, ms = 2600) {
  setTemp({ toast: msg });
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => setTemp({ toast: "" }), ms);
}

export function exportBackup() {
  const out = {};
  for (const k of Object.keys(DEFAULTS)) out[k] = state[k];
  return JSON.stringify({ app: "smart-basket", v: 1, at: Date.now(), data: out });
}

export function importBackup(text) {
  const j = JSON.parse(text);
  if (!j || j.app !== "smart-basket" || !j.data) throw new Error("קובץ גיבוי לא תקין");
  const patch = {};
  for (const k of Object.keys(DEFAULTS)) if (k in j.data) patch[k] = j.data[k];
  update(patch);
}
