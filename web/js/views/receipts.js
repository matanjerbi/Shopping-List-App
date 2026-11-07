import { html, useState, useMemo, Top, Empty, Modal, ProductSearch, DataStatus, nis, go, fmtDate } from "../ui.js";
import { state, uid, toast } from "../store.js";
import { storeLabel } from "../data.js";
import { saveReceipt, deleteReceipt } from "../actions.js";
import { parseReceiptText, matchReceiptLines, checkReceipt, round2 } from "../engine.js";
import { ocrReceipt } from "../ocr.js";

export function ReceiptsView() {
  const rs = state.receipts;
  return html`<div>
    <${Top} title="קבלות" right=${html`<button class="iconbtn" onClick=${() => go("/receipt/new")} aria-label="קבלה חדשה">＋</button>`} />
    <main>
      <button class="btn block" onClick=${() => go("/receipt/new")}>📷 סריקת קבלה חדשה</button>
      ${!rs.length ? html`<${Empty} icon="🧾" title="עוד לא נסרקו קבלות">כל קבלה מלמדת את האפליקציה מה אתה קונה ובאיזה קצב, ובודקת שלא חויבת ביותר מדי בקופה.</${Empty}>`
      : html`<div class="card">${rs.map((r) => html`<div class="li" style="cursor:pointer" onClick=${() => go(`/receipt/${r.id}`)}>
          ${r.thumb ? html`<img src=${r.thumb} style="width:44px;height:44px;object-fit:cover;border-radius:10px" />` : html`<div class="thumb">🧾</div>`}
          <div class="grow"><div>${r.storeName || r.chain || "קבלה"}</div><div class="tiny muted">${fmtDate(r.date, true)} · ${r.lines.filter((l) => !l.skip).length} פריטים${r.issues && r.issues.length ? html` · <span style="color:var(--bad)">${r.issues.length} חיובים חשודים</span>` : ""}</div></div>
          <div class="b">${nis(r.total)}</div></div>`)}</div>`}
      <button class="btn ghost mt" onClick=${() => go("/report")}>📊 דוח הוצאות</button>
    </main>
  </div>`;
}

export function NewReceiptView() {
  const [stage, setStage] = useState("pick"); // pick | ocr | review
  const [prog, setProg] = useState({ stage: "", p: 0 });
  const [rec, setRec] = useState(null);
  const [paste, setPaste] = useState(false);
  const [text, setText] = useState("");

  const analyze = (rawText, thumb = "") => {
    const parsed = parseReceiptText(rawText);
    const lines = state.catalog ? matchReceiptLines(parsed.lines, state.catalog, state.nameIndex) : parsed.lines.map((l) => ({ ...l, item: null }));
    // guess the store: same chain among my stores
    let storeKey = "";
    if (state.catalog) {
      const metas = [...state.catalog.stores.values()];
      const byChain = parsed.chain ? metas.filter((m) => (m.chainName || "").includes(parsed.chain) || parsed.chain.includes(m.chainName || "@@")) : [];
      // pick the store where most matched barcodes exist
      const cands = byChain.length ? byChain : metas;
      let best = null;
      for (const m of cands) {
        const n = lines.filter((l) => l.item && l.item.at.has(m.k)).length;
        if (!best || n > best.n) best = { m, n };
      }
      if (best && (byChain.length || best.n >= 3)) storeKey = best.m.k;
    }
    const sumLines = round2(lines.reduce((a, l) => a + (l.total || 0), 0));
    setRec({ id: uid(), date: parsed.date || Date.now(), chain: parsed.chain, storeKey, total: parsed.total || sumLines, lines, thumb, text: rawText.slice(0, 20000) });
    setStage("review");
  };

  const onFiles = async (files) => {
    if (!files || !files.length) return;
    setStage("ocr");
    try {
      const { text: t, thumb } = await ocrReceipt([...files], setProg);
      analyze(t, thumb);
    } catch (e) {
      toast("הזיהוי נכשל: " + (e.message || e), 5000);
      setStage("pick");
    }
  };

  if (stage === "review" && rec) return html`<${ReviewReceipt} rec=${rec} setRec=${setRec} />`;

  return html`<div>
    <${Top} title="סריקת קבלה" back="/receipts" />
    <main>
      <${DataStatus} />
      ${stage === "ocr" ? html`<div class="card center"><div class="b">${prog.stage || "מעבד…"}</div>
          <div class="progress"><div style=${{ width: `${Math.round((prog.p || 0) * 100)}%` }}></div></div>
          <div class="tiny muted">בפעם הראשונה נטען מנוע הזיהוי (כ-5MB), אחר כך זה מהיר יותר.</div></div>`
      : html`
        <div class="card">
          <div class="b">טיפים לצילום טוב</div>
          <div class="small muted">הנח את הקבלה ישרה על משטח כהה, באור טוב, והכנס למסגרת רק את הקבלה. קבלה ארוכה אפשר לצלם בכמה חלקים.</div>
          <label class="btn block mt" style="cursor:pointer">📷 צלם קבלה<input type="file" accept="image/*" capture="environment" multiple style="display:none" onChange=${(e) => onFiles(e.target.files)} /></label>
          <label class="btn sec block mt" style="cursor:pointer">🖼️ בחר תמונות מהגלריה<input type="file" accept="image/*" multiple style="display:none" onChange=${(e) => onFiles(e.target.files)} /></label>
          <button class="btn ghost block mt" onClick=${() => setPaste(!paste)}>📋 הדבק טקסט של קבלה דיגיטלית</button>
          ${paste && html`<textarea class="input mt" rows="8" placeholder="הדבק כאן את הטקסט מהקבלה הדיגיטלית (SMS / מייל)" value=${text} onInput=${(e) => setText(e.target.value)}></textarea>
            <button class="btn block mt" disabled=${!text.trim()} onClick=${() => analyze(text)}>נתח</button>`}
        </div>`}
    </main>
  </div>`;
}

function ReviewReceipt({ rec, setRec }) {
  const [edit, setEdit] = useState(null);
  const metas = state.catalog ? [...state.catalog.stores.values()] : [];
  const issues = useMemo(() => (state.catalog ? checkReceipt(rec.lines.filter((l) => !l.skip), rec.storeKey, state.catalog, state.prefs, new Date(rec.date)) : []), [rec]);
  const matched = rec.lines.filter((l) => l.item && !l.skip).length;
  const setLine = (i, patch) => setRec({ ...rec, lines: rec.lines.map((l, j) => (j === i ? { ...l, ...patch } : l)) });
  const save = () => {
    const meta = state.catalog && state.catalog.stores.get(rec.storeKey);
    const r = {
      ...rec,
      storeName: meta ? storeLabel(meta) : rec.chain || "",
      issues: issues.map((x) => ({ name: x.line.item.name, paid: x.paid, expected: x.expected, diff: x.diff, promo: x.promo })),
      lines: rec.lines.map((l) => ({ code: l.item ? l.item.code : l.code || "", name: l.item ? l.item.name : l.name, cat: l.item ? l.item.cat : "", qty: l.qty || 1, total: l.total || 0, skip: !!l.skip, item: l.item ? { code: l.item.code, name: l.item.name, cat: l.item.cat, unit: l.item.unit, qty: l.item.qty } : null })),
    };
    saveReceipt(r);
    toast(`הקבלה נשמרה · ${matched} מוצרים נלמדו`);
    go(`/receipt/${r.id}`);
  };
  return html`<div>
    <${Top} title="בדיקת הקבלה" right=${html`<button class="btn sm" onClick=${save}>שמור</button>`} />
    <main>
      <div class="small muted">זוהו ${rec.lines.length} שורות, ${matched} מהן הותאמו למוצרים. לחץ על שורה כדי לתקן.</div>
      <div class="card">
        <label class="field"><span>סניף</span>
          <select class="input" value=${rec.storeKey} onChange=${(e) => setRec({ ...rec, storeKey: e.target.value })}>
            <option value="">${rec.chain ? `${rec.chain} (סניף אחר)` : "לא ידוע"}</option>
            ${metas.map((m) => html`<option value=${m.k}>${storeLabel(m)}</option>`)}
          </select></label>
        <div class="row">
          <label class="field grow"><span>תאריך</span><input class="input" type="date" value=${new Date(rec.date - new Date(rec.date).getTimezoneOffset() * 6e4).toISOString().slice(0, 10)} onChange=${(e) => setRec({ ...rec, date: new Date(e.target.value + "T12:00").getTime() })} /></label>
          <label class="field grow"><span>סה"כ</span><input class="input" type="number" step="0.01" value=${rec.total} onChange=${(e) => setRec({ ...rec, total: parseFloat(e.target.value) || 0 })} /></label>
        </div>
      </div>
      ${issues.length > 0 && html`<div class="banner bad"><b>⚠️ ייתכן שחויבת ביותר מדי:</b>
        ${issues.map((x) => html`<div class="small">${x.line.item.name}: שולם ${nis(x.paid)} ליח', המחיר היה ${nis(x.expected)}${x.promo ? ` (מבצע: ${x.promo})` : ""}</div>`)}
        <div class="tiny mt">ההשוואה מתבססת על המחירים העדכניים של הסניף, אז כדאי לוודא מול הקבלה.</div></div>`}
      <div class="card">
        ${rec.lines.map((l, i) => html`<div class=${`li ${l.skip ? "done" : ""}`} style="cursor:pointer" onClick=${() => setEdit(i)}>
          <div class="thumb" style="font-size:14px">${l.skip ? "✕" : l.item ? (l.how === "barcode" ? "✓" : "≈") : "?"}</div>
          <div class="grow"><div class="t small ellipsis">${l.item ? l.item.name : l.name || "(ללא שם)"}</div>
            <div class="tiny muted ellipsis">${l.item ? `מהקבלה: ${l.name || l.code}` : "לא הותאם — לחץ לבחירת מוצר"}</div></div>
          <div class="small" style="text-align:left">${l.qty > 1 ? html`<div class="tiny muted">${l.qty} ×</div>` : ""}${nis(l.total)}</div>
        </div>`)}
        <button class="btn sm ghost mt" onClick=${() => { setRec({ ...rec, lines: [...rec.lines, { name: "", code: "", qty: 1, total: 0, item: null }] }); setEdit(rec.lines.length); }}>+ הוסף שורה</button>
      </div>
      <button class="btn block" onClick=${save}>שמור קבלה</button>
    </main>
    ${edit !== null && rec.lines[edit] && html`<${Modal} onClose=${() => setEdit(null)}>
      <div class="small muted">מהקבלה: ${rec.lines[edit].raw || rec.lines[edit].name || "—"}</div>
      <div class="row mt">
        <label class="field grow"><span>כמות</span><input class="input" type="number" step="0.001" value=${rec.lines[edit].qty} onChange=${(e) => setLine(edit, { qty: parseFloat(e.target.value) || 1 })} /></label>
        <label class="field grow"><span>סה"כ לשורה</span><input class="input" type="number" step="0.01" value=${rec.lines[edit].total} onChange=${(e) => setLine(edit, { total: parseFloat(e.target.value) || 0 })} /></label>
      </div>
      <div class="btns mb">
        <button class="btn sm sec" onClick=${() => { setLine(edit, { skip: !rec.lines[edit].skip }); setEdit(null); }}>${rec.lines[edit].skip ? "החזר שורה" : "התעלם משורה"}</button>
        ${rec.lines[edit].item && html`<button class="btn sm ghost" onClick=${() => setLine(edit, { item: null })}>בטל התאמה</button>`}
      </div>
      <div class="b small">${rec.lines[edit].item ? `מותאם ל: ${rec.lines[edit].item.name}` : "בחר את המוצר:"}</div>
      <${ProductSearch} autoFocus=${false} placeholder="חיפוש מוצר להתאמה" onPick=${(it) => { setLine(edit, { item: it, how: "manual", skip: false }); setEdit(null); }} />
    </${Modal}>`}
  </div>`;
}

export function ReceiptView({ id }) {
  const r = state.receipts.find((x) => x.id === id);
  if (!r) return html`<div><${Top} title="קבלה" back="/receipts" /><main><${Empty} icon="❓" title="הקבלה לא נמצאה" /></main></div>`;
  return html`<div>
    <${Top} title=${r.storeName || r.chain || "קבלה"} back="/receipts" />
    <main>
      <div class="stats"><div class="stat"><div class="v">${nis(r.total)}</div><div class="l">${fmtDate(r.date, true)}</div></div>
        <div class="stat"><div class="v">${r.lines.filter((l) => !l.skip).length}</div><div class="l">פריטים</div></div></div>
      ${r.issues && r.issues.length > 0 && html`<div class="banner bad"><b>⚠️ חיובים חשודים (${nis(r.issues.reduce((a, x) => a + x.diff, 0))})</b>
        ${r.issues.map((x) => html`<div class="small">${x.name}: שולם ${nis(x.paid)}, המחיר היה ${nis(x.expected)}${x.promo ? ` (${x.promo})` : ""}</div>`)}
        <div class="tiny mt">אפשר לפנות לשירות הלקוחות בסניף עם הקבלה.</div></div>`}
      <div class="card">${r.lines.filter((l) => !l.skip).map((l) => html`<div class="li small" style=${l.code ? "cursor:pointer" : ""} onClick=${() => l.code && go(`/item/${l.code}`)}>
        <div class="grow">${l.name}</div><div>${l.qty > 1 ? `${l.qty} × ` : ""}${nis(l.total)}</div></div>`)}</div>
      ${r.thumb && html`<img src=${r.thumb} style="width:120px;border-radius:10px" />`}
      <div class="btns mt"><button class="btn danger sm" onClick=${() => { if (confirm("למחוק את הקבלה?")) { deleteReceipt(r.id); go("/receipts"); } }}>מחק קבלה</button></div>
    </main>
  </div>`;
}
