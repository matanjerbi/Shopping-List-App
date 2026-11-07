import { html, useState, useEffect, useRef, Top, Empty, Modal, ProductSearch, go } from "../ui.js";
import { state, update, toast } from "../store.js";
import { lists, shareUrl, shareLink } from "../api.js";
import { setPrefs } from "../ui.js";

export function SharedListsView() {
  const [name, setName] = useState("");
  const create = async () => {
    try {
      const r = await lists.create(name.trim() || "רשימה משותפת");
      update({ shared: [{ id: r.list.id, name: r.list.name }, ...state.shared] });
      go(`/l/${r.list.id}`);
    } catch (e) {
      toast(e.message, 4000);
    }
  };
  return html`<div>
    <${Top} title="רשימות משותפות" back="/list" />
    <main>
      <div class="small muted">כל מי שמקבל את הקישור יכול להוסיף, לסמן ולמחוק פריטים. השינויים מתעדכנים אצל כולם בזמן אמת. אפשר לפתוח את הקישור גם מהדפדפן, בלי להתקין.</div>
      <div class="card">
        <div class="row"><input class="input grow" placeholder="שם הרשימה (למשל: הדירה)" value=${name} onInput=${(e) => setName(e.target.value)} />
        <button class="btn" onClick=${create}>צור</button></div>
      </div>
      ${state.shared.length ? html`<div class="card">${state.shared.map((l) => html`<div class="li" style="cursor:pointer" onClick=${() => go(`/l/${l.id}`)}>
          <div class="thumb">👥</div><div class="grow">${l.name}</div><span class="muted">‹</span></div>`)}</div>`
        : html`<${Empty} icon="👥" title="אין עדיין רשימות משותפות" />`}
    </main>
  </div>`;
}

export function SharedListView({ id }) {
  const [data, setData] = useState(null);
  const [err, setErr] = useState("");
  const [text, setText] = useState("");
  const [picking, setPicking] = useState(false);
  const [askName, setAskName] = useState(!state.prefs.name);
  const busy = useRef(false);

  const load = async () => {
    if (busy.current) return;
    try {
      const d = await lists.get(id);
      setData(d);
      setErr("");
      // remember the list locally (joined via link)
      const known = state.shared.find((x) => x.id === id);
      if (!known || known.name !== d.list.name) update({ shared: [{ id, name: d.list.name }, ...state.shared.filter((x) => x.id !== id)] });
    } catch (e) {
      setErr(e.message);
    }
  };
  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    const v = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", v);
    return () => { clearInterval(t); document.removeEventListener("visibilitychange", v); };
  }, [id]);

  const act = async (fn) => {
    busy.current = true;
    try {
      setData(await fn());
    } catch (e) {
      toast(e.message, 3500);
    } finally {
      busy.current = false;
    }
  };
  const add = (item) => act(() => lists.add(id, item));
  const optimistic = (iid, patch) => setData((d) => ({ ...d, items: d.items.map((x) => (x.id === iid ? { ...x, ...patch } : x)) }));

  if (err && !data) return html`<div><${Top} title="רשימה משותפת" back="/shared" /><main><${Empty} icon="⚠️" title="לא הצלחתי לפתוח את הרשימה">${err}</${Empty}>
    ${state.shared.find((x) => x.id === id) && html`<button class="btn danger" onClick=${() => { update({ shared: state.shared.filter((x) => x.id !== id) }); go("/shared"); }}>הסר מהרשימות שלי</button>`}</main></div>`;
  if (!data) return html`<div><${Top} title="רשימה משותפת" back="/shared" /><main><div class="boot">טוען…</div></main></div>`;

  const open = data.items.filter((x) => !x.done);
  const done = data.items.filter((x) => x.done);
  const share = async () => {
    const how = await shareLink(`רשימת קניות: ${data.list.name}`, shareUrl(id));
    if (how === "copied") toast("הקישור הועתק");
  };
  return html`<div>
    <${Top} title=${data.list.name} back="/shared" right=${html`<button class="iconbtn" onClick=${share} aria-label="שיתוף">🔗</button>`} />
    <main>
      <form class="row" onSubmit=${(e) => { e.preventDefault(); if (text.trim()) { add({ text: text.trim() }); setText(""); } }}>
        <input class="input grow" placeholder="הוסף פריט…" value=${text} onInput=${(e) => setText(e.target.value)} enterKeyHint="done" />
        <button class="btn" type="submit">הוסף</button>
        <button class="iconbtn" type="button" onClick=${() => setPicking(true)} title="מהמחירון">🔍</button>
      </form>
      <div class="card">
        ${!data.items.length && html`<div class="muted small center">הרשימה ריקה</div>`}
        ${open.map((x) => html`<div class="li" key=${x.id}>
          <button class="box" onClick=${() => { optimistic(x.id, { done: true }); act(() => lists.patch(id, x.id, { done: true })); }}></button>
          <div class="grow"><div class="t">${x.text}</div>${(x.by || x.note) && html`<div class="tiny muted">${x.note}${x.note && x.by ? " · " : ""}${x.by ? `הוסיף/ה: ${x.by}` : ""}</div>`}</div>
          <div class="qty"><button onClick=${() => x.qty > 1 ? (optimistic(x.id, { qty: x.qty - 1 }), act(() => lists.patch(id, x.id, { qty: x.qty - 1 }))) : act(() => lists.del(id, x.id))}>−</button><span>${x.qty}</span>
            <button onClick=${() => { optimistic(x.id, { qty: x.qty + 1 }); act(() => lists.patch(id, x.id, { qty: x.qty + 1 })); }}>+</button></div>
        </div>`)}
        ${done.length > 0 && html`<div class="tiny muted mt">נקנו</div>`}
        ${done.map((x) => html`<div class="li done" key=${x.id}>
          <button class="box on" onClick=${() => { optimistic(x.id, { done: false }); act(() => lists.patch(id, x.id, { done: false })); }}>✓</button>
          <div class="grow t">${x.text}</div>
          <button class="btn sm ghost" onClick=${() => act(() => lists.del(id, x.id))}>✕</button></div>`)}
      </div>
      <div class="btns">
        <button class="btn sec" onClick=${share}>🔗 שלח קישור</button>
        ${done.length > 0 && html`<button class="btn ghost" onClick=${() => act(() => lists.clearDone(id))}>נקה שנקנו</button>`}
        <button class="btn ghost" onClick=${() => { const n = prompt("שם חדש לרשימה", data.list.name); if (n) act(() => lists.rename(id, n)); }}>שנה שם</button>
        <button class="btn ghost" onClick=${() => { if (confirm("להסיר את הרשימה מהמכשיר שלך? (היא תישאר אצל אחרים)")) { update({ shared: state.shared.filter((x) => x.id !== id) }); go("/shared"); } }}>הסר ממני</button>
      </div>
      <div class="tiny muted mt">מתעדכן אוטומטית כל כמה שניות.</div>
    </main>
    ${picking && html`<${Modal} onClose=${() => setPicking(false)}>
      <${ProductSearch} allowFree onFree=${(t) => { add({ text: t }); setPicking(false); }} onPick=${(it) => { add({ text: it.name, code: it.code, cat: it.cat }); setPicking(false); }} />
    </${Modal}>`}
    ${askName && html`<${Modal} onClose=${() => setAskName(false)}>
      <h3 style="margin-top:0">איך לקרוא לך ברשימה?</h3>
      <div class="small muted mb">השם יופיע ליד פריטים שתוסיף, כדי שכולם יידעו מי הוסיף מה.</div>
      <form onSubmit=${(e) => { e.preventDefault(); const v = e.target.elements.n.value.trim(); if (v) setPrefs({ name: v }); setAskName(false); }}>
        <input class="input" name="n" placeholder="השם שלך" autoFocus />
        <button class="btn block mt" type="submit">שמור</button>
      </form>
    </${Modal}>`}
  </div>`;
}
