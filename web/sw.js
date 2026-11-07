// Service worker: offline app shell + push notifications.
const VERSION = "__BUILD__";
const SHELL = `shell-${VERSION}`;
const ASSETS = [
  "./", "index.html", "css/app.css", "manifest.webmanifest",
  "js/app.js", "js/ui.js", "js/store.js", "js/data.js", "js/api.js", "js/engine.js", "js/actions.js", "js/ocr.js", "js/scan.js",
  "js/views/deals.js", "js/views/list.js", "js/views/products.js", "js/views/receipts.js", "js/views/scan.js", "js/views/shared.js", "js/views/more.js",
  "vendor/preact.mjs", "vendor/preact-hooks.mjs", "vendor/htm.mjs",
  "icons/icon-192.png", "icons/apple-touch-icon.png", "icons/favicon.png",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(SHELL).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k.startsWith("shell-") && k !== SHELL).map((k) => caches.delete(k)))).then(() => self.clients.claim())
  );
});

self.addEventListener("fetch", (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== "GET" || url.origin !== location.origin) return;
  // price data and config: network (the app caches data in IndexedDB itself)
  if (url.pathname.includes("/data/") || url.pathname.endsWith("config.json")) return;
  // heavy OCR / scanner libraries: cache on first use
  if (url.pathname.includes("/vendor/")) {
    e.respondWith(caches.open("vendor-v1").then(async (c) => {
      const hit = await c.match(e.request);
      if (hit) return hit;
      const r = await fetch(e.request);
      if (r.ok) c.put(e.request, r.clone());
      return r;
    }));
    return;
  }
  // app shell: stale-while-revalidate
  e.respondWith(caches.open(SHELL).then(async (c) => {
    const hit = await c.match(e.request, { ignoreSearch: true });
    const net = fetch(e.request).then((r) => { if (r.ok) c.put(e.request, r.clone()); return r; }).catch(() => hit);
    return hit || net;
  }));
});

self.addEventListener("push", (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { title: "סל חכם", body: e.data ? e.data.text() : "" }; }
  e.waitUntil(self.registration.showNotification(d.title || "סל חכם", {
    body: d.body || "",
    icon: "icons/icon-192.png",
    badge: "icons/favicon.png",
    tag: d.tag || "deals",
    renotify: true,
    dir: "rtl",
    lang: "he",
    data: { url: d.url || "#/deals" },
  }));
});

self.addEventListener("notificationclick", (e) => {
  e.notification.close();
  const target = new URL((e.notification.data && e.notification.data.url) || "#/deals", self.registration.scope).href;
  e.waitUntil((async () => {
    const all = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    for (const c of all) {
      if (c.url.startsWith(self.registration.scope)) {
        c.postMessage({ type: "navigate", url: target });
        return c.focus();
      }
    }
    return self.clients.openWindow(target);
  })());
});
