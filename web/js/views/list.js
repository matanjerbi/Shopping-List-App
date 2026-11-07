import { html, useState, useMemo, Top, Empty, Modal, ProductSearch, nis, go, fmtDate } from "../ui.js";
import { state, update, toast } from "../store.js";
import { storeLabel } from "../data.js";
import { addToList, runningOut, itemToListEntry } from "../actions.js";
import { compareBasket, effectivePrice } from "../engine.js";
import { lists, shareUrl, shareLink } from "../api.js";

function bestHint(entry) {
  if (!state.catalog || !entry.code) return null;
  const it = state.catalog.items.get(entry.code);
  if (!it) return null;
  let best = null;
  for (const k of it.at.keys()) {
    const ep = effectivePrice(it, k, state.catalog, state.prefs);
    if (!best || ep.price < best.ep.price) best = { k, ep };
  }
  return best ? { store: state.catalog.stores.get(best.k), price: best.ep.price, promo: !!best.ep.offer } : null;
}

export function ListView() {
  const [adding, setAdding] = useState(false);
  const list = state.list;
  const open = list.filter((x) => !x.done);
  const done = list.filter((x) => x.done);
  const suggestions = runningOut(4);
  const set = (id, patch) => update({ list: list.map((x) => (x.id === id ? { ...x, ...patch } : x)) });
  const del = (id) => update({ list: list.filter((x) => x.id !== id) });

  const toShared = async () => {
    try {
      const r = await lists.create("רשימת קניות", open.map((x) => ({ text: x.text, qty: x.qty, code: x.code, cat: x.cat, note: x.note })));
      update({ shared: [{ id: r.list.id, name: r.list.name }, ...state.shared] });
      const how = await shareLink("רשימת קניות משותפת", shareUrl(r.list.id));
      if (how === "copied") toast("הקישור הועתק — שלח אותו למי שתרצה");
      go(`/l/${r.list.id}`);
    } catch (e) {
      toast(e.message, 4000);
    }
  };

  return html`<div>
    <${Top} title="רשימת קניות" right=${html`<button class="iconbtn" onClick=${() => setAdding(true)} aria-label="הוספה">＋</button>`} />
    <main>
      ${suggestions.length > 0 && html`<div class="card flat">
        <div class="b small">⏳ כנראה נגמר לך בקרוב</div>
        ${suggestions.slice(0, 6).map(({ p, next }) => html`<div class="li small"><div class="grow">${p.name}<div class="tiny muted">${next < Date.now() ? "כנראה כבר נגמר" : `עד ${fmtDate(next)}`}</div></div>
          <button class="btn sm sec" onClick=${() => addToList({ text: p.name, code: p.code, cat: p.cat })}>+ הוסף</button></div>`)}
        ${suggestions.length > 1 && html`<button class="btn sm ghost" onClick=${() => suggestions.forEach(({ p }) => addToList({ text: p.name, code: p.code, cat: p.cat }))}>הוסף הכל</button>`}
      </div>`}

      ${!list.length ? html`<${Empty} icon="📝" title="הרשימה ריקה">הוסף פריטים עם ＋ או מתוך מסך המבצעים.</${Empty}>`
      : html`<div class="card">
          ${open.map((x) => {
            const hint = bestHint(x);
            return html`<div class="li" key=${x.id}>
              <button class="box" onClick=${() => set(x.id, { done: true })}></button>
              <div class="grow"><div class="t">${x.text}</div>
                ${hint && html`<div class="tiny muted">הכי זול: ${storeLabel(hint.store)} ${nis(hint.price)}${hint.promo ? " (מבצע)" : ""}</div>`}
                ${x.note && html`<div class="tiny muted">${x.note}</div>`}</div>
              <div class="qty"><button onClick=${() => (x.qty > 1 ? set(x.id, { qty: x.qty - 1 }) : del(x.id))}>−</button><span>${x.qty}</span><button onClick=${() => set(x.id, { qty: x.qty + 1 })}>+</button></div>
            </div>`;
          })}
          ${done.length > 0 && html`<div class="tiny muted mt">נקנו</div>`}
          ${done.map((x) => html`<div class="li done" key=${x.id}>
            <button class="box on" onClick=${() => set(x.id, { done: false })}>✓</button>
            <div class="grow t">${x.text}</div>
            <button class="btn sm ghost" onClick=${() => del(x.id)}>✕</button></div>`)}
        </div>
        <div class="btns">
          <button class="btn" onClick=${() => go("/compare")} disabled=${!open.length}>⚖️ איפה הכי זול?</button>
          <button class="btn sec" onClick=${toShared} disabled=${!open.length}>🔗 שתף כרשימה משותפת</button>
          ${done.length > 0 && html`<button class="btn ghost" onClick=${() => update({ list: open })}>נקה שנקנו</button>`}
        </div>`}
      <button class="btn ghost mt" onClick=${() => go("/shared")}>👥 הרשימות המשותפות שלי</button>
    </main>
    ${adding && html`<${Modal} onClose=${() => setAdding(false)}>
      <h3 style="margin-top:0">הוספה לרשימה</h3>
      <${ProductSearch} allowFree onFree=${(t) => { addToList({ text: t }); setAdding(false); }} onPick=${(it) => { addToList(itemToListEntry(it)); setAdding(false); }} />
    </${Modal}>`}
  </div>`;
}

export function CompareView() {
  const open = state.list.filter((x) => !x.done);
  const res = useMemo(() => (state.catalog ? compareBasket(open.map((x) => ({ text: x.text, code: x.code, cat: x.cat, qty: x.qty })), state.catalog, state.prefs) : null), [state.dataVersion, state.list]);
  const [show, setShow] = useState(null);
  if (!res) return html`<div><${Top} title="השוואת סל" back="/list" /><main><${Empty} icon="⏳" title="טוען מחירים…" /></main></div>`;
  const single = res.bestSingle;
  const pair = res.bestPair;
  const pairSaves = pair && single && pair.missing <= single.missing ? single.total - pair.total : 0;
  return html`<div>
    <${Top} title="איפה הכי זול?" back="/list" />
    <main>
      <div class="small muted">${open.length} פריטים · מחירי מבצע נלקחים בחשבון כשהכמות מספיקה</div>
      ${pair && pairSaves >= 10 && html`<div class="card" style="border:2px solid var(--brand-2)">
        <div class="b">💡 פיצול בין שני סניפים חוסך ${nis(pairSaves)}</div>
        <div class="small muted">${pair.stores.map(storeLabel).join(" + ")} · סה"כ ${nis(pair.total)}</div>
        <details class="mt"><summary class="small">מה לקנות איפה</summary>
          ${pair.stores.map((st) => html`<div class="mt"><div class="small b">${storeLabel(st)}</div>
            ${pair.split.filter((s) => s && s.store.k === st.k).map((s) => html`<div class="li small"><div class="grow">${s.line.text}${s.alt ? html`<div class="tiny muted">חלופה: ${s.item.name}</div>` : ""}</div><div>${nis(s.price * (s.line.qty || 1))}</div></div>`)}
          </div>`)}
        </details>
      </div>`}
      ${res.stores.map((r, i) => html`<div class="card" key=${r.store.k} onClick=${() => setShow(show === r.store.k ? null : r.store.k)} style="cursor:pointer">
        <div class="row"><div class="grow"><div class="b">${i === 0 ? "🏆 " : ""}${storeLabel(r.store)}</div>
          <div class="tiny muted">${r.missing ? `${r.missing} פריטים חסרים` : "כל הפריטים זמינים"}</div></div>
          <div class="b" style="font-size:19px">${nis(r.total)}</div></div>
        ${show === r.store.k && html`<div class="mt">${r.lines.map((l) => html`<div class="li small"><div class="grow">${l.line.text}
          ${l.item && l.alt ? html`<div class="tiny muted">חלופה: ${l.item.name}</div>` : ""}${l.offer ? html`<div class="tiny" style="color:var(--bad)">${l.offer.promo.desc}</div>` : ""}</div>
          <div>${l.item ? nis(l.price * (l.line.qty || 1)) : html`<span class="muted">אין</span>`}</div></div>`)}</div>`}
      </div>`)}
      <div class="tiny muted">פריטים בטקסט חופשי בלי מוצר מהמחירון לא נכללים בהשוואה.</div>
    </main>
  </div>`;
}
