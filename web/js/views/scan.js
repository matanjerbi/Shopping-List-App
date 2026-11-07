import { html, useState, useEffect, useRef, Top, PriceTable, DataStatus, go } from "../ui.js";
import { state } from "../store.js";
import { productKey } from "../data.js";
import { addProduct, addToList, itemToListEntry } from "../actions.js";
import { startScanner } from "../scan.js";

export function ScanView() {
  const video = useRef(null);
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [manual, setManual] = useState("");
  useEffect(() => {
    let stop = () => {};
    startScanner(video.current, (c) => setCode(c.replace(/^0+/, "")), (e) => setErr(e.message)).then((s) => (stop = s));
    return () => stop();
  }, []);
  const item = code && state.catalog ? state.catalog.items.get(code) : null;
  const mine = item && state.products[productKey(item)] && !state.products[productKey(item)].hidden;
  return html`<div>
    <${Top} title="סריקת מוצר" back="/deals" />
    <main>
      <${DataStatus} />
      ${err ? html`<div class="banner bad">${err}</div>` : html`<div class="video-wrap"><video ref=${video} muted playsinline></video><div class="aim"></div></div>`}
      <form class="row mt" onSubmit=${(e) => { e.preventDefault(); if (manual.trim()) setCode(manual.trim().replace(/^0+/, "")); }}>
        <input class="input grow" inputmode="numeric" placeholder="או הקלד ברקוד" value=${manual} onInput=${(e) => setManual(e.target.value)} />
        <button class="btn sec" type="submit">חפש</button>
      </form>
      ${code && !item && html`<div class="card"><div class="b">ברקוד ${code}</div><div class="small muted">המוצר לא נמכר בסניפים שבחרת (או שאין לו נתונים).</div></div>`}
      ${item && html`<div class="card">
        <div class="b">${item.name}</div><div class="tiny muted">${item.manuf} · ${item.code}</div>
        <div class="btns mt">
          ${mine ? html`<span class="tag good">במוצרים שלך</span>` : html`<button class="btn sm" onClick=${() => addProduct(item)}>+ למוצרים שלי</button>`}
          <button class="btn sm sec" onClick=${() => addToList(itemToListEntry(item))}>+ לרשימה</button>
          <button class="btn sm ghost" onClick=${() => go(`/item/${item.code}`)}>פרטים</button>
        </div>
        <div class="mt"><${PriceTable} item=${item} /></div>
      </div>`}
    </main>
  </div>`;
}
