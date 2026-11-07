// Backend (Cloudflare Worker) calls: shared lists, push profile.
import { getConfig, engineProducts } from "./data.js";
import { state, update, uid } from "./store.js";

async function base() {
  const c = await getConfig();
  if (!c.apiUrl) throw new Error("השרת עדיין לא הוגדר (חסרים secrets של Cloudflare בריפו)");
  return c.apiUrl.replace(/\/$/, "");
}

async function call(path, opts = {}) {
  const r = await fetch((await base()) + path, {
    ...opts,
    headers: { "Content-Type": "application/json", ...(opts.headers || {}) },
    body: opts.body ? JSON.stringify(opts.body) : undefined,
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || `שגיאה ${r.status}`);
  return j;
}

export const lists = {
  create: (name, items = []) => call("/api/lists", { method: "POST", body: { name, items, by: state.prefs.name } }),
  get: (id) => call(`/api/lists/${id}`),
  rename: (id, name) => call(`/api/lists/${id}`, { method: "PATCH", body: { name } }),
  remove: (id) => call(`/api/lists/${id}`, { method: "DELETE" }),
  add: (id, item) => call(`/api/lists/${id}/items`, { method: "POST", body: { ...item, by: state.prefs.name } }),
  patch: (id, iid, p) => call(`/api/lists/${id}/items/${iid}`, { method: "PATCH", body: p }),
  del: (id, iid) => call(`/api/lists/${id}/items/${iid}`, { method: "DELETE" }),
  clearDone: (id) => call(`/api/lists/${id}/done`, { method: "DELETE" }),
};

export function shareUrl(id) {
  const u = new URL(location.href);
  u.hash = `#/l/${id}`;
  return u.toString();
}

export async function shareLink(title, url) {
  if (navigator.share) {
    try {
      await navigator.share({ title, text: title, url });
      return "shared";
    } catch (e) {
      if (e && e.name === "AbortError") return "cancel";
    }
  }
  await navigator.clipboard.writeText(url);
  return "copied";
}

// ------------------------------------------------------------ push

function b64ToBytes(b64) {
  const pad = "=".repeat((4 - (b64.length % 4)) % 4);
  const s = atob((b64 + pad).replace(/-/g, "+").replace(/_/g, "/"));
  return Uint8Array.from(s, (c) => c.charCodeAt(0));
}

export function pushSupported() {
  return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
}

export function isStandalone() {
  return window.matchMedia("(display-mode: standalone)").matches || navigator.standalone === true;
}

function profileId() {
  let id = state.prefs.profileId;
  if (!id) {
    id = uid(32);
    update({ prefs: { ...state.prefs, profileId: id } });
  }
  return id;
}

function profileData() {
  return {
    v: 1,
    stores: state.myStores,
    products: engineProducts(),
    prefs: { threshold: state.prefs.threshold, noClub: state.prefs.noClub, excludeWords: state.prefs.excludeWords, weekly: state.prefs.weekly },
    dismissed: Object.keys(state.dismissed || {}).slice(-300),
  };
}

export async function enablePush() {
  if (!pushSupported()) throw new Error("הדפדפן לא תומך בהתראות. באייפון: הוסף את האפליקציה למסך הבית ופתח אותה משם.");
  const cfg = await getConfig();
  if (!cfg.vapidPublicKey) throw new Error("שרת ההתראות עדיין לא הוגדר");
  const perm = await Notification.requestPermission();
  if (perm !== "granted") throw new Error("לא אושרו התראות");
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToBytes(cfg.vapidPublicKey) });
  await call(`/api/profiles/${profileId()}`, { method: "PUT", body: { data: profileData(), sub: sub.toJSON() } });
  update({ prefs: { ...state.prefs, notify: true } });
}

export async function disablePush() {
  try {
    const reg = await navigator.serviceWorker.ready;
    const sub = await reg.pushManager.getSubscription();
    if (sub) await sub.unsubscribe();
  } catch {}
  try {
    await call(`/api/profiles/${profileId()}`, { method: "DELETE" });
  } catch {}
  update({ prefs: { ...state.prefs, notify: false } });
}

let syncTimer = null;
/** Keep the server-side profile (used for push alerts) in sync, debounced. */
export function scheduleProfileSync() {
  if (!state.prefs.notify) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => {
    try {
      await call(`/api/profiles/${profileId()}`, { method: "PUT", body: { data: profileData() } });
    } catch (e) {
      console.warn("profile sync", e);
    }
  }, 2500);
}
