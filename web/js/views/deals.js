import { html, useState, useMemo, Top, Empty, DataStatus, nis, pct, go, endLabel } from "../ui.js";
import { state, update } from "../store.js";
import { storeLabel } from "../data.js";
import { addToList, logSaving, dismissDeal, itemToListEntry } from "../actions.js";
import { weeklySummary, UNIT_LABEL } from "../engine.js";

const FILTERS = [
  ["all", "הכל"], ["same", "המוצרים שלי"], ["alt", "חלופות במבצע"], ["stock", "כדאי למלאי"], ["urgent", "נגמר בקרוב"], ["target", "מחיר יעד"], ["cheaper", "חלופות זולות קבועות"],
];

export function DealCard({ d, compact }) {
  const isAlt = d.type === "alt" || d.type === "cheaper";
  const cls = d.type === "target" ? "target" : isAlt ? "alt" : "";
  const isNew = !state.seenDeals[d.key];
  const unitTxt = d.unitPrice && d.unit ? `${nis(d.unitPrice)} ל${UNIT_LABEL[d.unit] || ""}` : "";
  return html`<div class="card deal">
    <div class="row top-align">
      <div class=${`pct ${cls}`}>${d.type === "target" ? "🎯" : `-${pct(d.savingsPct)}`}<small>${d.type === "target" ? "יעד" : isAlt ? "חלופה" : "מבצע"}</small></div>
      <div class="grow">
        ${isAlt && html`<div class="instead">במקום ${d.product.name}</div>`}
        <div class="b" style="cursor:pointer" onClick=${() => go(`/item/${d.item.code}`)}>${d.item.name}</div>
        <div class="small muted">${storeLabel(d.store)}</div>
        <div class="mt"><span class="price">${nis(d.price)}</span>${d.regular > d.price + 0.01 && html`<span class="was">${nis(d.regular)}</span>`}
          ${d.minQty > 1 && html`<span class="small muted"> ליח' בקניית ${d.minQty}</span>`}</div>
        ${unitTxt && html`<div class="tiny muted">${unitTxt}${d.refUnitPrice && isAlt ? ` · אצלך בד"כ ${nis(d.refUnitPrice)}` : ""}</div>`}
        ${d.offer && html`<div class="small mt">${d.offer.promo.desc} <span class="muted">${endLabel(d.offer.promo.end)}</span></div>`}
        <div>
          ${isNew && html`<span class="tag bad">חדש</span>`}
          ${d.type === "cheaper" && html`<span class="tag gray">זול יותר באופן קבוע</span>`}
          ${d.stockUp && html`<span class="tag good">כדאי לקנות מלאי</span>`}
          ${d.urgent && html`<span class="tag warn">נגמר לך בקרוב</span>`}
          ${d.flags.club && html`<span class="tag">מועדון</span>`}
          ${d.flags.minPurchase > 0 && html`<span class="tag warn">בקנייה מעל ${nis(d.flags.minPurchase)}</span>`}
          ${d.saveAmount >= 1 && html`<span class="tag good">חוסך ${nis(d.saveAmount)}</span>`}
        </div>
      </div>
    </div>
    ${!compact && html`<div class="btns mt">
      <button class="btn sm sec" onClick=${() => addToList({ ...itemToListEntry(d.item), qty: d.minQty || 1, note: `${storeLabel(d.store)} ${nis(d.price)}` })}>+ לרשימה</button>
      <button class="btn sm sec" onClick=${() => logSaving(d)}>✓ ניצלתי</button>
      <button class="btn sm ghost" onClick=${() => dismissDeal(d.key)}>הסתר</button>
    </div>`}
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
      ${!s.myStores.length ? html`<${Empty} icon="🏪" title="בוא נתחיל: איפה אתה קונה?">
          <div>בחר את הסניפים באזור שלך, ואני אחפש בהם מבצעים.</div>
          <button class="btn mt" onClick=${() => go("/stores")}>בחירת סניפים</button>
        </${Empty}>`
      : !nProducts ? html`<${Empty} icon="🧾" title="עכשיו נלמד מה אתה קונה">
          <div>צלם קבלה מהסופר, או הוסף מוצרים ידנית. ככה אדע אילו מבצעים רלוונטיים לך.</div>
          <div class="btns mt" style="justify-content:center">
            <button class="btn" onClick=${() => go("/receipt/new")}>📷 סריקת קבלה</button>
            <button class="btn sec" onClick=${() => go("/products/add")}>+ הוספת מוצר</button>
          </div>
        </${Empty}>`
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
