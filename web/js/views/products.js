import { html, useState, Top, Empty, DataStatus, ProductSearch, nis, pct, go, daysFromNow, endLabel } from "../ui.js";
import { DealCard } from "./deals.js";
import { state } from "../store.js";
import { catLabel, productKey, storeShort } from "../data.js";
import { addProduct, patchProduct, removeProduct, addToList, itemToListEntry } from "../actions.js";
import { predictRunOut, SUBSTITUTABLE, UNIT_LABEL, median, effectivePrice, perUnit } from "../engine.js";

export function ProductsView() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("runout");
  const list = Object.entries(state.products).filter(([, p]) => !p.hidden && (!q || p.name.includes(q)));
  const rows = list.map(([key, p]) => ({ key, p, pr: predictRunOut(p.purchases || []), deals: (state.deals || []).filter((d) => d.type !== "fake" && (d.product.code ? d.product.code === p.code : d.product.name === p.name) && !state.dismissed[d.key]).length }));
  rows.sort((a, b) => sort === "name" ? a.p.name.localeCompare(b.p.name, "he")
    : sort === "deals" ? b.deals - a.deals
    : (a.pr.next || 9e15) - (b.pr.next || 9e15));
  return html`<div>
    <${Top} title="המוצרים שלי" right=${html`<button class="iconbtn" onClick=${() => go("/receipts")} aria-label="קבלות" title="קבלות">🧾</button><button class="iconbtn" onClick=${() => go("/receipt/new")} aria-label="צלם קבלה" title="צלם קבלה">📷</button><button class="iconbtn" onClick=${() => go("/products/add")} aria-label="הוספה">＋</button>`} />
    <main>
      <${DataStatus} />
      ${!list.length && !q ? html`<${Empty} icon="🛒" title="עוד אין מוצרים">
          המוצרים נלמדים אוטומטית מהקבלות שאתה סורק. אפשר גם להוסיף ידנית.
          <div class="btns mt" style="justify-content:center"><button class="btn" onClick=${() => go("/receipt/new")}>📷 סריקת קבלה</button>
          <button class="btn sec" onClick=${() => go("/products/add")}>+ הוספה ידנית</button></div></${Empty}>`
      : html`
        <input class="input" placeholder="סינון…" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <div class="chips mt">${[["runout", "לפי מתי נגמר"], ["deals", "לפי מבצעים"], ["name", "א-ב"]].map(([k, l]) => html`<button class=${`chip ${sort === k ? "on" : ""}`} onClick=${() => setSort(k)}>${l}</button>`)}</div>
        <div class="card">
          ${rows.map(({ key, p, pr, deals }) => {
            const days = daysFromNow(pr.next);
            return html`<div class="li" style="cursor:pointer" onClick=${() => go(`/product/${encodeURIComponent(key)}`)}>
              <div class="thumb">${deals ? "🔥" : "📦"}</div>
              <div class="grow"><div class="ellipsis">${p.name}</div>
                <div class="tiny muted">${catLabel(p.cat) || "ללא קטגוריה"}${(p.purchases || []).length ? ` · נקנה ${(p.purchases || []).length} פעמים` : ""}
                  ${pr.next ? html` · <span style=${days <= 3 ? "color:var(--warn);font-weight:600" : ""}>${days <= 0 ? "כנראה נגמר" : `נגמר בעוד ~${days} ימים`}</span>` : ""}</div></div>
              ${deals > 0 && html`<span class="tag bad">${deals} מבצעים</span>`}
            </div>`;
          })}
        </div>`}
    </main>
  </div>`;
}

export function AddProductView() {
  return html`<div>
    <${Top} title="הוספת מוצר" back="/products" />
    <main>
      <div class="small muted mb">חפש מוצר בסניפים שלך, או סרוק ברקוד.</div>
      <button class="btn sec block mb" onClick=${() => go("/scan")}>▦ סריקת ברקוד</button>
      <${ProductSearch} onPick=${(it) => { addProduct(it); go(`/item/${it.code}`); }} />
    </main>
  </div>`;
}

/** One compact screen for any product: what it costs now, where, vs. usual — settings tucked away. */
function ProductSheet({ item, p, pkey }) {
  const [open, setOpen] = useState(false);
  const rows = [];
  if (item) {
    for (const k of item.at.keys()) {
      const meta = state.catalog.stores.get(k);
      const ep = effectivePrice(item, k, state.catalog, state.prefs);
      if (meta && ep) rows.push({ meta, ep });
    }
    rows.sort((a, b) => a.ep.price - b.ep.price);
  }
  const best = rows[0];
  const worst = rows[rows.length - 1];
  const meds = [], mins = [], maxs = [];
  if (item) for (const r of rows) {
    const st = state.stats && state.stats[r.meta.chainId] && state.stats[r.meta.chainId][item.code];
    if (st) { meds.push(st[0]); mins.push(st[1]); maxs.push(st[2]); }
  }
  const usual = meds.length ? median(meds) : rows.length ? median(rows.map((r) => r.ep.regular)) : 0;
  const lo = Math.min(...mins, ...rows.map((r) => r.ep.price));
  const hi = Math.max(...maxs, ...rows.map((r) => r.ep.regular));
  const pr = p ? predictRunOut(p.purchases || []) : null;
  const paid = p ? (p.purchases || []).map((x) => x.price).filter(Boolean) : [];
  const days = pr && pr.next ? daysFromNow(pr.next) : null;
  const saving = best && usual ? 1 - best.ep.price / usual : 0;
  const deals = p ? (state.deals || []).filter((d) => d.type !== "fake" && d.type !== "cheaper" && !state.dismissed[d.key]
    && (d.product.code ? d.product.code === p.code : d.product.name === p.name)
    && !(d.item.code === p.code && best && d.store.k === best.meta.k)) : [];
  const effCat = (p && p.catManual && p.cat) || (item && item.cat) || (p && p.cat) || "";
  const allow = p ? p.allowAlt ?? SUBSTITUTABLE.has(effCat) : false;
  const cats = Object.entries(state.categories || {}).sort((a, b) => a[1].localeCompare(b[1], "he"));
  const size = item && item.qty && item.unit ? `${+item.qty.toFixed(3)} ${UNIT_LABEL[item.unit]}` : "";
  const unitP = (price) => { const u = item && perUnit(price, item); return u ? `${nis(u)}/${UNIT_LABEL[item.unit]}` : ""; };
  const pos = (v) => (hi > lo ? ((v - lo) / (hi - lo)) * 100 : 50);

  return html`<div>
    <div class="tiny muted" style="margin-top:-4px">${[size, catLabel(effCat), item && item.manuf].filter(Boolean).join(" · ")}</div>

    ${best ? html`<div class="card">
      <div class="row top-align">
        <div class="grow">
          <div class="tiny muted">הכי זול עכשיו</div>
          <div style="font-size:30px;font-weight:800;line-height:1.15">${nis(best.ep.price)}</div>
          <div class="small">${storeShort(best.meta)}</div>
        </div>
        ${saving >= 0.05 ? html`<div class="pct-chip">−${pct(saving)}<small>מהרגיל</small></div>`
          : best.ep.offer ? html`<div class="pct-chip gray">מבצע<small>לא חריג</small></div>` : null}
      </div>
      ${best.ep.offer && html`<div class="tiny mt" style="color:var(--bad)">${best.ep.offer.promo.desc} ${endLabel(best.ep.offer.promo.end)}</div>`}
      <div class="kv mt">
        <div><b>${nis(usual)}</b><span>מחיר רגיל</span></div>
        ${paid.length ? html`<div><b>${nis(median(paid))}</b><span>שילמת בד"כ</span></div>`
          : rows.length > 1 ? html`<div><b>${nis(worst.ep.price - best.ep.price)}</b><span>פער בין סניפים</span></div>` : null}
        ${p ? html`<div><b>${days === null ? "—" : days <= 0 ? "עכשיו" : `${days} ימים`}</b><span>מתי נגמר</span></div>` : null}
      </div>
      ${hi > lo && html`<div class="range mt">
        <div class="range-bar"><div class="range-dot" style=${{ insetInlineStart: `calc(${pos(best.ep.price)}% - 6px)` }}></div></div>
        <div class="row tiny muted"><span>${nis(lo)}</span><span class="grow center">טווח מחירים 90 יום</span><span>${nis(hi)}</span></div>
      </div>`}
    </div>`
    : html`<div class="banner small">${p && !p.code ? html`נשמר מקבלה בלי ברקוד, אז אין לו מחירים. <a href=${`#/relink/${encodeURIComponent(pkey)}`}>שייך למוצר</a>` : "לא נמכר כרגע בסניפים שבחרת."}</div>`}

    ${rows.length > 1 && html`<div class="card tight">
      ${rows.map(({ meta, ep }, i) => html`<div class="prow">
        <div class=${`grow ellipsis ${i === 0 ? "b" : ""}`}>${storeShort(meta)}${ep.offer ? html` <span class="tiny" style="color:var(--bad)">· ${ep.offer.promo.minQty > 1 ? `${ep.offer.promo.minQty} ב-${nis(ep.offer.eff * ep.offer.promo.minQty)}` : "מבצע"}${ep.offer.promo.clubs.length ? " (מועדון)" : ""}</span>` : ""}</div>
        <div class="tiny muted" style="min-width:70px;text-align:left">${unitP(ep.price)}</div>
        <div class=${i === 0 ? "b good" : ""} style="min-width:62px;text-align:left">${nis(ep.price)}</div>
      </div>`)}
    </div>`}

    ${deals.length > 0 && html`<h3>מבצעים וחלופות</h3>${deals.slice(0, 4).map((d) => html`<${DealCard} key=${d.key} d=${d} />`)}`}

    ${p && html`<div class="card tight">
      <div class="prow" style="cursor:pointer" onClick=${() => setOpen(!open)}><div class="grow">⚙️ הגדרות התראה</div><span class="muted">${open ? "▲" : "▼"}</span></div>
      ${open && html`<div>
        <label class="check"><input type="checkbox" checked=${allow} onChange=${(e) => patchProduct(pkey, { allowAlt: e.target.checked })} /><div class="grow">גם מותגים אחרים</div></label>
        <div class="row mt">
          <select class="input grow" value=${effCat} onChange=${(e) => patchProduct(pkey, { cat: e.target.value, catManual: !!e.target.value })}>
            <option value="">קטגוריה: ללא</option>${cats.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
          </select>
          <input class="input" style="width:118px" type="number" inputmode="decimal" step="0.1" placeholder="מחיר יעד ₪" value=${p.target || ""} onChange=${(e) => patchProduct(pkey, { target: parseFloat(e.target.value) || 0 })} />
        </div>
        <button class="btn sm ghost mt" style="color:var(--bad)" onClick=${() => { if (confirm("להסיר מהמוצרים שלך?")) { removeProduct(pkey); go("/products"); } }}>הסר מהמוצרים שלי</button>
      </div>`}
    </div>`}
  </div>`;
}

export function ProductView({ id }) {
  const key = decodeURIComponent(id);
  const p = state.products[key];
  if (!p) return html`<div><${Top} title="מוצר" back="/products" /><main><${Empty} icon="❓" title="המוצר לא נמצא" /></main></div>`;
  const item = state.catalog && p.code ? state.catalog.items.get(p.code) : null;
  return html`<div>
    <${Top} title=${p.name} back="/products" right=${html`<button class="iconbtn" title="לרשימה" onClick=${() => addToList({ text: p.name, code: p.code, cat: p.cat })}>📝</button>`} />
    <main><${DataStatus} /><${ProductSheet} item=${item} p=${p} pkey=${key} /></main>
  </div>`;
}

/** Any catalog item (from search / scan / deal) */
export function ItemView({ code }) {
  const item = state.catalog && state.catalog.items.get(code);
  if (!item) return html`<div><${Top} title="מוצר" back="/deals" /><main><${DataStatus} />
    ${!state.dataLoading && html`<${Empty} icon="❓" title="לא נמכר בסניפים שבחרת">ברקוד ${code}</${Empty}>`}</main></div>`;
  const key = productKey(item);
  const p = state.products[key] && !state.products[key].hidden ? state.products[key] : null;
  return html`<div>
    <${Top} title=${item.name} back="/deals" right=${html`<button class="iconbtn" title="לרשימה" onClick=${() => addToList(itemToListEntry(item))}>📝</button>`} />
    <main>
      ${!p && html`<button class="btn block mb" onClick=${() => addProduct(item)}>＋ הוסף למוצרים שלי (התראות על מבצעים)</button>`}
      <${ProductSheet} item=${item} p=${p} pkey=${key} />
    </main>
  </div>`;
}

/** Link a receipt product without barcode to a catalog item */
export function RelinkView({ id }) {
  const key = decodeURIComponent(id);
  const p = state.products[key];
  if (!p) return html`<div><${Top} title="שיוך" back="/products" /></div>`;
  return html`<div>
    <${Top} title="שיוך למוצר מהמחירון" back="/products" />
    <main>
      <div class="small muted mb">מהקבלה: "${p.name}"</div>
      <${ProductSearch} onPick=${(it) => {
        const products = { ...state.products };
        delete products[key];
        const nk = it.code;
        products[nk] = { ...(products[nk] || {}), code: it.code, name: it.name, cat: it.cat, unit: it.unit, qty: it.qty, purchases: [...((products[nk] && products[nk].purchases) || []), ...(p.purchases || [])].sort((a, b) => a.date - b.date), addedAt: p.addedAt, hidden: false };
        import("../store.js").then(({ update }) => { update({ products }); import("../actions.js").then((a) => a.afterProductsChange()); go(`/product/${nk}`); });
      }} />
    </main>
  </div>`;
}
