import { html, useState, useMemo, Top, Empty, DataStatus, nis, pct, go, endLabel } from "../ui.js";
import { state, update } from "../store.js";
import { storeLabel, storeShort } from "../data.js";
import { addToList, dismissDeal, itemToListEntry } from "../actions.js";
import { weeklySummary, UNIT_LABEL } from "../engine.js";

const FILTERS = [
  ["all", "הכל"], ["same", "בדיוק מה שאני קונה"], ["alt", "מותגים אחרים"], ["stock", "למלאי"], ["cheaper", "זול תמיד"],
];

export function DealCard({ d }) {
  const isAlt = d.type === "alt" || d.type === "cheaper";
  const cls = d.type === "target" ? "target" : isAlt ? "alt" : "";
  const isNew = !state.seenDeals[d.key];
  const unitTxt = isAlt && d.unitPrice && d.unit ? `${nis(d.unitPrice)}/${UNIT_LABEL[d.unit]} במקום ${nis(d.refUnitPrice)}` : "";
  const note = d.type === "target" ? "הגיע למחיר היעד" : d.urgent ? "נגמר לך בקרוב" : d.stockUp ? "כדאי לקנות מלאי" : d.flags.club ? "למועדון" : d.flags.minPurchase > 0 ? `בקנייה מעל ${nis(d.flags.minPurchase)}` : "";
  return html`<div class="card deal compact">
    <div class="row top-align">
      <div class=${`pct ${cls}`}>${d.type === "target" ? "🎯" : `−${pct(d.savingsPct)}`}</div>
      <div class="grow" style="min-width:0;cursor:pointer" onClick=${() => go(`/item/${d.item.code}`)}>
        ${isAlt && html`<div class="instead ellipsis">במקום ${d.product.name}</div>`}
        <div class="b ellipsis2">${isNew ? html`<span class="newdot"></span>` : ""}${d.item.name}</div>
        <div class="tiny muted ellipsis">${storeShort(d.store)}${d.offer && endLabel(d.offer.promo.end) ? ` · ${endLabel(d.offer.promo.end)}` : ""}</div>
        ${unitTxt && html`<div class="tiny muted">${unitTxt}</div>`}
        ${note && html`<div class="tiny" style="color:var(--warn)">${note}</div>`}
      </div>
      <div style="text-align:left;flex:none">
        <div class="price">${nis(d.price)}</div>
        ${d.regular > d.price + 0.01 && html`<div class="was">${nis(d.regular)}</div>`}
        ${d.minQty > 1 && html`<div class="tiny muted">ליח' בקניית ${d.minQty}</div>`}
        <div class="deal-actions">
          <button class="iconbtn sm ghosty" title="הסתר" onClick=${() => dismissDeal(d.key)}>✕</button>
          <button class="iconbtn sm" title="לרשימה" onClick=${() => addToList({ ...itemToListEntry(d.item), qty: d.minQty || 1, note: `${storeShort(d.store)} ${nis(d.price)}` })}>＋</button>
        </div>
      </div>
    </div>
  </div>`;
}

function Onboarding({ stores, products }) {
  const Step = ({ n, done, title, children }) => html`<div class="card">
    <div class="row"><div class=${`step ${done ? "done" : ""}`}>${done ? "✓" : n}</div><div class="grow b">${title}</div></div>
    ${!done && html`<div class="mt">${children}</div>`}
  </div>`;
  return html`<div>
    <div class="small muted mb">שני צעדים, ואחריהם יופיעו כאן רק מבצעים שבאמת משתלמים על מה שאתה קונה.</div>
    <${Step} n="1" done=${stores > 0} title=${stores ? `נבחרו ${stores} סניפים` : "איפה אתה קונה?"}>
      <button class="btn" onClick=${() => go("/stores")}>בחירת סניפים</button>
    </${Step}>
    <${Step} n="2" done=${products > 0} title="מה אתה קונה?">
      <div class="btns"><button class="btn" disabled=${!stores} onClick=${() => go("/receipt/new")}>📷 צלם קבלה</button>
      <button class="btn sec" disabled=${!stores} onClick=${() => go("/products/add")}>＋ הוסף מוצר</button></div>
      <div class="tiny muted mt">כל קבלה מוסיפה את המוצרים שבה אוטומטית.</div>
    </${Step}>
  </div>`;
}

export function DealsView() {
  const [filter, setFilter] = useState("all");
  const s = state;
  const deals = (s.deals || []).filter((d) => !s.dismissed[d.key]);
  const real = deals.filter((d) => d.type !== "fake");
  const fakes = deals.filter((d) => d.type === "fake");
  const shown = useMemo(() => real.filter((d) => {
    if (filter === "cheaper") return d.type === "cheaper";
    if (d.type === "cheaper") return false; // permanent alternatives aren't deals — own tab only
    if (filter === "all") return true;
    if (filter === "same") return d.type === "same";
    if (filter === "alt") return d.type === "alt";
    if (filter === "stock") return d.stockUp;
    if (filter === "urgent") return d.urgent;
    if (filter === "target") return d.type === "target";
    return true;
  }), [deals, filter]);
  const sum = weeklySummary(real);
  const nProducts = Object.values(s.products).filter((p) => !p.hidden).length;

  // mark as seen after render
  setTimeout(() => {
    const unseen = real.filter((d) => !s.seenDeals[d.key]);
    if (unseen.length && document.visibilityState === "visible") {
      const seen = { ...s.seenDeals };
      const now = Date.now();
      unseen.forEach((d) => (seen[d.key] = now));
      // drop entries older than 60 days
      for (const [k, t] of Object.entries(seen)) if (now - t > 60 * 864e5) delete seen[k];
      s.seenDeals = seen; // update silently; persisted on next save
      update({ seenDeals: seen });
    }
  }, 4000);

  return html`<div>
    <${Top} title="מבצעים חריגים" right=${html`<button class="iconbtn" onClick=${() => go("/scan")} aria-label="סריקת ברקוד">▦</button>`} />
    <main>
      <${DataStatus} />
      ${!s.myStores.length || !nProducts ? html`<${Onboarding} stores=${s.myStores.length} products=${nProducts} />`
      : html`
        <div class="stats">
          <div class="stat"><div class="v">${sum.count}</div><div class="l">מבצעים רלוונטיים</div></div>
          <div class="stat"><div class="v">${nis(sum.potential)}</div><div class="l">חיסכון אפשרי</div></div>
        </div>
        <div class="chips">${FILTERS.map(([k, l]) => html`<button class=${`chip ${filter === k ? "on" : ""}`} onClick=${() => setFilter(k)}>${l}</button>`)}</div>
        ${shown.map((d) => html`<${DealCard} key=${d.key} d=${d} />`)}
        ${!shown.length && !s.dataLoading && html`<${Empty} icon="🔍" title="אין כרגע מבצעים חריגים">
          המבצעים שמופיעים כאן זולים לפחות ב-${s.prefs.threshold}% מהמחיר הרגיל. אפשר לשנות את הסף בהגדרות.</${Empty}>`}
        ${fakes.length > 0 && html`<details class="card flat mt">
          <summary>⚠️ מבצעים מטעים (${fakes.length})</summary>
          <div class="small muted mb">מבצעים על מוצרים שלך שבעצם לא משתלמים: המחיר הרגיל הועלה לפני המבצע, או שבסניף אחר זה זול יותר גם בלי מבצע.</div>
          ${fakes.slice(0, 30).map((d) => html`<div class="li"><div class="grow">
            <div class="small b">${d.item.name}</div>
            <div class="tiny muted">${storeLabel(d.store)} · ${d.offer ? d.offer.promo.desc : ""}</div>
            <div class="tiny" style="color:var(--warn)">
              ${d.flags.raised ? `המחיר הרגיל עלה לאחרונה ל-${nis(d.regular)} (בד"כ ${nis(d.flags.median)}). ` : ""}
              ${d.flags.cheaperElsewhere ? "בסניף אחר זה זול יותר גם בלי מבצע." : ""}
            </div></div><div class="small b">${nis(d.price)}</div></div>`)}
        </details>`}
      `}
    </main>
  </div>`;
}
