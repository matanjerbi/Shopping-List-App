import { html, useState, Top, Empty, DataStatus, ProductSearch, PriceTable, nis, go, fmtDate, daysFromNow, minPrice } from "../ui.js";
import { state } from "../store.js";
import { catLabel, productKey, storeLabel } from "../data.js";
import { addProduct, patchProduct, removeProduct, addToList, itemToListEntry } from "../actions.js";
import { predictRunOut, SUBSTITUTABLE, UNIT_LABEL, median } from "../engine.js";

export function ProductsView() {
  const [q, setQ] = useState("");
  const [sort, setSort] = useState("runout");
  const list = Object.entries(state.products).filter(([, p]) => !p.hidden && (!q || p.name.includes(q)));
  const rows = list.map(([key, p]) => ({ key, p, pr: predictRunOut(p.purchases || []), deals: (state.deals || []).filter((d) => d.type !== "fake" && (d.product.code ? d.product.code === p.code : d.product.name === p.name) && !state.dismissed[d.key]).length }));
  rows.sort((a, b) => sort === "name" ? a.p.name.localeCompare(b.p.name, "he")
    : sort === "deals" ? b.deals - a.deals
    : (a.pr.next || 9e15) - (b.pr.next || 9e15));
  return html`<div>
    <${Top} title="המוצרים שלי" right=${html`<button class="iconbtn" onClick=${() => go("/products/add")} aria-label="הוספה">＋</button>`} />
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
                <div class="tiny muted">${catLabel(p.cat) || "ללא קטגוריה"} · נקנה ${(p.purchases || []).length} פעמים
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

/** Product I buy: settings, history, prices */
export function ProductView({ id }) {
  const key = decodeURIComponent(id);
  const p = state.products[key];
  if (!p) return html`<div><${Top} title="מוצר" back="/products" /><main><${Empty} icon="❓" title="המוצר לא נמצא" /></main></div>`;
  const item = state.catalog && p.code ? state.catalog.items.get(p.code) : null;
  const pr = predictRunOut(p.purchases || []);
  const paid = (p.purchases || []).map((x) => x.price).filter(Boolean);
  const allow = p.allowAlt ?? SUBSTITUTABLE.has(p.cat);
  const myDeals = (state.deals || []).filter((d) => (d.product.code ? d.product.code === p.code : d.product.name === p.name) && !state.dismissed[d.key]);
  const cats = Object.entries(state.categories || {}).sort((a, b) => a[1].localeCompare(b[1], "he"));
  return html`<div>
    <${Top} title=${p.name} back="/products" />
    <main>
      <div class="stats">
        <div class="stat"><div class="v">${(p.purchases || []).length}</div><div class="l">קניות</div></div>
        <div class="stat"><div class="v">${pr.avgDays ? `${pr.avgDays} ימ'` : "—"}</div><div class="l">קונה כל</div></div>
        <div class="stat"><div class="v">${pr.next ? fmtDate(pr.next) : "—"}</div><div class="l">צפוי להיגמר</div></div>
      </div>
      ${myDeals.filter((d) => d.type !== "fake").length > 0 && html`<div class="banner info">🔥 יש ${myDeals.filter((d) => d.type !== "fake").length} מבצעים רלוונטיים. <a href="#/deals">לצפייה</a></div>`}

      <div class="card">
        <h3 style="margin-top:0">התאמות</h3>
        <label class="check"><input type="checkbox" checked=${allow} onChange=${(e) => patchProduct(key, { allowAlt: e.target.checked })} />
          <div class="grow">הצג גם חלופות ממותגים אחרים<div class="tiny muted">מוצרים אחרים מאותה קטגוריה, שמשמשים לאותה מטרה</div></div></label>
        <label class="field"><span>קטגוריה (קובעת מה נחשב חלופה)</span>
          <select class="input" value=${p.cat || ""} onChange=${(e) => patchProduct(key, { cat: e.target.value })}>
            <option value="">— ללא —</option>
            ${cats.map(([k, l]) => html`<option value=${k}>${l}</option>`)}
          </select></label>
        <label class="field"><span>מחיר יעד: התרע כשהמחיר יורד מתחת ל- (₪ ליחידה)</span>
          <input class="input" type="number" inputmode="decimal" step="0.1" value=${p.target || ""} placeholder=${paid.length ? `שילמת בד"כ ${median(paid).toFixed(2)}` : ""}
            onChange=${(e) => patchProduct(key, { target: parseFloat(e.target.value) || 0 })} /></label>
        <div class="btns">
          <button class="btn sm sec" onClick=${() => addToList({ text: p.name, code: p.code, cat: p.cat })}>+ לרשימת קניות</button>
          <button class="btn sm danger" onClick=${() => { if (confirm("להסיר את המוצר מהרשימה שלך?")) { removeProduct(key); go("/products"); } }}>הסר</button>
        </div>
      </div>

      ${item ? html`<h2>מחירים בסניפים שלך</h2><div class="card"><${PriceTable} item=${item} /></div>
        <${HistoryInfo} item=${item} />`
      : p.code ? html`<div class="banner small">המוצר לא נמצא כרגע בסניפים שבחרת.</div>`
      : html`<div class="banner small">המוצר נשמר מהקבלה בלי ברקוד, ולכן אי אפשר להשוות את מחירו. <a href="#" onClick=${(e) => { e.preventDefault(); go(`/relink/${encodeURIComponent(key)}`); }}>שייך למוצר מהמחירון</a></div>`}

      ${(p.purchases || []).length > 0 && html`<h2>היסטוריית קניות</h2><div class="card">
        ${[...p.purchases].reverse().map((x) => html`<div class="li small"><div class="grow">${fmtDate(x.date, true)} ${x.storeKey && state.catalog && state.catalog.stores.get(x.storeKey) ? "· " + storeLabel(state.catalog.stores.get(x.storeKey)) : ""}</div><div>${x.qty > 1 ? `${x.qty} × ` : ""}${nis(x.price)}</div></div>`)}
      </div>`}
    </main>
  </div>`;
}

export function HistoryInfo({ item }) {
  const rows = [];
  const chains = new Set();
  for (const k of item.at.keys()) {
    const m = state.catalog.stores.get(k);
    if (!m || chains.has(m.chainId)) continue;
    chains.add(m.chainId);
    const st = state.stats && state.stats[m.chainId] && state.stats[m.chainId][item.code];
    if (st) rows.push({ m, st });
  }
  if (!rows.length) return null;
  return html`<h2>היסטוריית מחיר (90 יום)</h2><div class="card">
    ${rows.map(({ m, st }) => html`<div class="li small"><div class="grow b">${m.chainName}</div>
      <div class="tiny">חציון ${nis(st[0])} · מינימום ${nis(st[1])} · מקסימום ${nis(st[2])}${st[4] ? html`<br/>השתנה לפני ${st[3]} ימים (היה ${nis(st[4])})` : ""}</div></div>`)}
  </div>`;
}

/** Any catalog item (from search / scan / deal) */
export function ItemView({ code }) {
  const item = state.catalog && state.catalog.items.get(code);
  if (!item) return html`<div><${Top} title="מוצר" back="/deals" /><main><${DataStatus} />
    ${!state.dataLoading && html`<${Empty} icon="❓" title="המוצר לא נמצא בסניפים שבחרת">ברקוד ${code}</${Empty}>`}</main></div>`;
  const key = productKey(item);
  const mine = state.products[key] && !state.products[key].hidden;
  const up = item.qty && item.unit ? ` · ${item.qty} ${UNIT_LABEL[item.unit]}` : "";
  return html`<div>
    <${Top} title=${item.name} back="/deals" />
    <main>
      <div class="small muted">${item.manuf || ""}${up} · ${catLabel(item.cat) || "ללא קטגוריה"} · ${item.code}</div>
      <div class="btns mt">
        ${mine ? html`<button class="btn sm sec" onClick=${() => go(`/product/${encodeURIComponent(key)}`)}>⚙️ ההגדרות שלי למוצר</button>`
          : html`<button class="btn sm" onClick=${() => addProduct(item)}>+ למוצרים שלי (קבל התראות)</button>`}
        <button class="btn sm sec" onClick=${() => addToList(itemToListEntry(item))}>+ לרשימת קניות</button>
      </div>
      <h2>מחירים בסניפים שלך</h2>
      <div class="card"><${PriceTable} item=${item} /></div>
      <${HistoryInfo} item=${item} />
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
