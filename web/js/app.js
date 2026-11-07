import { html, render, useEffect, useState, Toast } from "./ui.js";
import { state, loadState, useApp, onChange } from "./store.js";
import { loadIndex, loadCategories, loadCatalog, recomputeDeals } from "./data.js";
import { scheduleProfileSync } from "./api.js";
import { DealsView } from "./views/deals.js";
import { ListView, CompareView } from "./views/list.js";
import { ProductsView, AddProductView, ProductView, ItemView, RelinkView } from "./views/products.js";
import { ReceiptsView, NewReceiptView, ReceiptView } from "./views/receipts.js";
import { ScanView } from "./views/scan.js";
import { SharedListsView, SharedListView } from "./views/shared.js";
import { MoreView, StoresView, SettingsView, ReportView, HelpView } from "./views/more.js";

const ROUTES = [
  [/^\/deals$/, DealsView, "deals"],
  [/^\/list$/, ListView, "list"],
  [/^\/compare$/, CompareView, "list"],
  [/^\/products$/, ProductsView, "products"],
  [/^\/products\/add$/, AddProductView, "products"],
  [/^\/product\/(.+)$/, ProductView, "products", "id"],
  [/^\/relink\/(.+)$/, RelinkView, "products", "id"],
  [/^\/item\/(.+)$/, ItemView, "deals", "code"],
  [/^\/receipts$/, ReceiptsView, "receipts"],
  [/^\/receipt\/new$/, NewReceiptView, "receipts"],
  [/^\/receipt\/(.+)$/, ReceiptView, "receipts", "id"],
  [/^\/scan$/, ScanView, "deals"],
  [/^\/shared$/, SharedListsView, "list"],
  [/^\/l\/([A-Za-z0-9_-]+)$/, SharedListView, "list", "id"],
  [/^\/more$/, MoreView, "more"],
  [/^\/stores$/, StoresView, "more"],
  [/^\/settings$/, SettingsView, "more"],
  [/^\/report$/, ReportView, "more"],
  [/^\/help$/, HelpView, "more"],
];

function useHash() {
  const [h, setH] = useState(location.hash.slice(1) || "/deals");
  useEffect(() => {
    const f = () => { setH(location.hash.slice(1) || "/deals"); window.scrollTo(0, 0); };
    window.addEventListener("hashchange", f);
    return () => window.removeEventListener("hashchange", f);
  }, []);
  return h;
}

function Nav({ tab }) {
  const n = (state.deals || []).filter((d) => d.type !== "fake" && !state.dismissed[d.key] && !state.seenDeals[d.key]).length;
  const listN = state.list.filter((x) => !x.done).length;
  const items = [
    ["deals", "/deals", "🔥", "מבצעים", n],
    ["list", "/list", "📝", "רשימה", listN],
    ["products", "/products", "🛒", "המוצרים שלי", 0],
    ["receipts", "/receipts", "🧾", "קבלות", 0],
    ["more", "/more", "☰", "עוד", 0],
  ];
  return html`<nav class="nav">${items.map(([k, href, i, l, badge]) => html`<a href=${"#" + href} class=${tab === k ? "on" : ""}>
    <span class="i">${i}</span>${l}${badge ? html`<span class="dot">${badge > 99 ? "99+" : badge}</span>` : ""}</a>`)}</nav>`;
}

function App() {
  useApp();
  const path = useHash();
  if (!state.ready) return html`<div class="boot">טוען…</div>`;
  let View = DealsView, tab = "deals", props = {};
  for (const [re, V, t, param] of ROUTES) {
    const m = path.match(re);
    if (m) { View = V; tab = t; if (param) props[param] = m[1]; break; }
  }
  // first run: choose stores
  if (!state.myStores.length && tab !== "more" && !path.startsWith("/l/") && state.index && state.index.stores && state.index.stores.length && path === "/deals") {
    View = DealsView;
  }
  return html`<div>
    <${View} ...${props} key=${path} />
    <${Nav} tab=${tab} />
    <${Toast} />
  </div>`;
}

async function boot() {
  render(html`<${App} />`, document.getElementById("app"));
  await loadState();
  await Promise.all([loadIndex(), loadCategories()]);
  if (state.myStores.length) loadCatalog();
  onChange("myStores", () => scheduleProfileSync());
  onChange("dismissed", () => recomputeDeals());
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw", e));
    navigator.serviceWorker.addEventListener("message", (e) => {
      if (e.data && e.data.type === "navigate" && e.data.url) location.hash = e.data.url.split("#")[1] || "/deals";
    });
  }
  // refresh data when returning to the app after a while
  let last = Date.now();
  document.addEventListener("visibilitychange", async () => {
    if (document.visibilityState === "visible" && Date.now() - last > 3 * 3600e3) {
      last = Date.now();
      const before = state.index && state.index.u;
      await loadIndex();
      if (state.index && state.index.u !== before && state.myStores.length) loadCatalog();
    }
  });
  // keep server profile fresh once per day (purchase predictions change over time)
  if (state.prefs.notify) scheduleProfileSync();
}

boot();
