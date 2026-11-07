import { h, render } from "../vendor/preact.mjs";
import { useState, useEffect, useMemo, useRef } from "../vendor/preact-hooks.mjs";
import htm from "../vendor/htm.mjs";
import { state, update } from "./store.js";
import { searchByName, effectivePrice, perUnit, UNIT_LABEL } from "./engine.js";
import { storeLabel, catLabel } from "./data.js";

export const html = htm.bind(h);
export { h, render, useState, useEffect, useMemo, useRef };

export const nis = (x) => (x == null || isNaN(x) ? "—" : `₪${Number(x).toFixed(2)}`);
export const pct = (x) => `${Math.round((x || 0) * 100)}%`;

export function go(path) {
  location.hash = path;
}

export function fmtDate(ms, withYear = false) {
  if (!ms) return "";
  const d = new Date(ms);
  return d.toLocaleDateString("he-IL", withYear ? { day: "numeric", month: "numeric", year: "2-digit" } : { day: "numeric", month: "numeric" });
}

export function daysFromNow(ms) {
  if (!ms) return null;
  return Math.round((ms - Date.now()) / 864e5);
}

export function endLabel(s) {
  if (!s) return "";
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return "";
  return `עד ${+m[3]}/${+m[2]}`;
}

export function Top({ title, back, right }) {
  return html`<header class="top">
    ${back && html`<button class="back" onClick=${() => (history.length > 1 ? history.back() : go(back))} aria-label="חזרה">→</button>`}
    <h1>${title}</h1>
    ${right}
  </header>`;
}

export function Modal({ onClose, children }) {
  useEffect(() => {
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    document.body.style.overflow = "hidden";
    return () => { window.removeEventListener("keydown", k); document.body.style.overflow = ""; };
  }, []);
  return html`<div class="modal-bg" onClick=${(e) => e.target === e.currentTarget && onClose()}>
    <div class="modal"><div class="handle"></div>${children}</div>
  </div>`;
}

export function Empty({ icon, title, children }) {
  return html`<div class="empty"><div class="big">${icon}</div><div class="b">${title}</div><div class="small mt">${children}</div></div>`;
}

export function DataStatus() {
  const s = state;
  if (s.indexError && !(s.index && s.index.stores && s.index.stores.length))
    return html`<div class="banner">עדיין אין נתוני מחירים. השרת מוריד אותם פעם ביום, אז אם זה עתה הותקן, נסה שוב בעוד כחצי שעה.</div>`;
  if (s.dataLoading)
    return html`<div class="card flat small"><div>טוען מחירים מהסניפים שלך…</div><div class="progress"><div style=${{ width: `${Math.round((s.dataProgress || 0) * 100)}%` }}></div></div></div>`;
  if (s.dataError) return html`<div class="banner small">${s.dataError}</div>`;
  return null;
}

/** Search the catalog (loaded stores) by name or barcode. onPick(item) */
export function ProductSearch({ onPick, placeholder = "חפש מוצר או הקלד ברקוד", autoFocus = true, allowFree, onFree }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    if (!state.catalog || q.trim().length < 2) return [];
    const t = q.trim();
    if (/^\d{5,14}$/.test(t)) {
      const it = state.catalog.items.get(t.replace(/^0+/, ""));
      return it ? [{ item: it }] : [];
    }
    return searchByName(t, state.catalog, state.nameIndex, 30);
  }, [q, state.dataVersion]);
  return html`<div>
    <input class="input" placeholder=${placeholder} value=${q} onInput=${(e) => setQ(e.target.value)} autoFocus=${autoFocus} enterKeyHint="search" />
    ${allowFree && q.trim() && html`<button class="btn sec sm mt" onClick=${() => onFree(q.trim())}>+ הוסף "${q.trim()}" כטקסט חופשי</button>`}
    ${!state.catalog && html`<div class="small muted mt">בחר סניפים כדי לחפש במחירון.</div>`}
    <div class="mt">
      ${results.map(({ item }) => html`<div class="li" style="cursor:pointer" onClick=${() => onPick(item)}>
        <div class="grow"><div class="ellipsis">${item.name}</div>
          <div class="tiny muted">${item.manuf || ""} ${catLabel(item.cat) ? "· " + catLabel(item.cat) : ""} · ${item.code}</div></div>
        <div class="small b">${nis(minPrice(item))}</div>
      </div>`)}
      ${q.trim().length >= 2 && state.catalog && !results.length && html`<div class="small muted">לא נמצא בסניפים שלך</div>`}
    </div>
  </div>`;
}

export function minPrice(item) {
  let m = Infinity;
  for (const k of item.at.keys()) {
    const ep = effectivePrice(item, k, state.catalog, state.prefs);
    if (ep && ep.price < m) m = ep.price;
  }
  return m === Infinity ? null : m;
}

/** Prices of one item across the user's stores. */
export function PriceTable({ item }) {
  const rows = [];
  for (const k of item.at.keys()) {
    const meta = state.catalog.stores.get(k);
    const ep = effectivePrice(item, k, state.catalog, state.prefs);
    rows.push({ meta, ep });
  }
  rows.sort((a, b) => a.ep.price - b.ep.price);
  const up = (p) => {
    const u = perUnit(p, item);
    return u ? `${nis(u)} ל${UNIT_LABEL[item.unit]}` : "";
  };
  return html`<table class="price-table">
    ${rows.map(({ meta, ep }, i) => html`<tr>
      <td>${i === 0 ? "🏆 " : ""}${storeLabel(meta)}${ep.offer && html`<div class="tiny" style="color:var(--bad)">${ep.offer.promo.desc}${ep.offer.promo.minQty > 1 ? ` (${ep.offer.promo.minQty} יח')` : ""}${ep.offer.promo.clubs.length ? " · מועדון" : ""}</div>`}</td>
      <td style="text-align:left;white-space:nowrap"><b>${nis(ep.price)}</b>${ep.offer && html`<div class="tiny muted" style="text-decoration:line-through">${nis(ep.regular)}</div>`}<div class="tiny muted">${up(ep.price)}</div></td>
    </tr>`)}
  </table>`;
}

export function Toast() {
  return state.toast ? html`<div class="toast">${state.toast}</div>` : null;
}

export function setPrefs(patch) {
  update({ prefs: { ...state.prefs, ...patch } });
}
