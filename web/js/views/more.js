import { html, useState, useMemo, Top, Empty, nis, go, setPrefs, fmtDate } from "../ui.js";
import { state, update, toast, exportBackup, importBackup } from "../store.js";
import { loadIndex, loadCatalog, storeLabel, catLabel, getConfig } from "../data.js";
import { enablePush, disablePush, pushSupported, isStandalone, scheduleProfileSync } from "../api.js";
import { weeklySummary } from "../engine.js";

export function MoreView() {
  const items = [
    ["/stores", "🏪", "הסניפים שלי", `${state.myStores.length} סניפים נבחרו`],
    ["/shared", "👥", "רשימות משותפות", "רשימה אחת לכל הבית, עם קישור"],
    ["/report", "📊", "דוח הוצאות וחיסכון", ""],
    ["/scan", "▦", "סריקת ברקוד בחנות", "בדוק מחיר מול הסניפים האחרים"],
    ["/settings", "⚙️", "הגדרות והתראות", ""],
    ["/help", "❔", "איך זה עובד", ""],
  ];
  return html`<div>
    <${Top} title="עוד" />
    <main><div class="card">${items.map(([href, i, t, s]) => html`<div class="li" style="cursor:pointer" onClick=${() => go(href)}>
      <div class="thumb">${i}</div><div class="grow"><div>${t}</div>${s && html`<div class="tiny muted">${s}</div>`}</div><span class="muted">‹</span></div>`)}</div></main>
  </div>`;
}

export function StoresView() {
  const [q, setQ] = useState("");
  const [city, setCity] = useState("");
  const idx = state.index;
  const all = (idx && idx.stores) || [];
  const cities = [...new Set(all.map((s) => s.city).filter((c) => c && !/^\d+$/.test(c)))].sort((a, b) => a.localeCompare(b, "he"));
  const sel = new Set(state.myStores);
  const shown = all.filter((s) => (!city || s.city === city) && (!q || `${s.chainName} ${s.name} ${s.address} ${s.city}`.includes(q)));
  const byChain = useMemo(() => {
    const m = new Map();
    for (const s of shown) {
      const k = s.chainName || s.chain;
      if (!m.has(k)) m.set(k, []);
      m.get(k).push(s);
    }
    return [...m.entries()].sort((a, b) => a[0].localeCompare(b[0], "he"));
  }, [shown.length, q, city]);
  const toggle = (k) => {
    const next = sel.has(k) ? state.myStores.filter((x) => x !== k) : [...state.myStores, k];
    update({ myStores: next });
  };
  const done = () => {
    loadCatalog();
    scheduleProfileSync();
    go("/deals");
  };
  return html`<div>
    <${Top} title="הסניפים שלי" back="/more" right=${html`<button class="btn sm" onClick=${done}>סיום</button>`} />
    <main>
      ${!all.length ? html`<${Empty} icon="⏳" title="רשימת הסניפים עדיין לא מוכנה">${state.indexError ? "השרת מוריד את נתוני הרשתות. נסה שוב בעוד כחצי שעה." : "טוען…"}
          <div><button class="btn sec mt" onClick=${() => loadIndex(true)}>נסה שוב</button></div></${Empty}>`
      : html`
        <div class="small muted">בחר את הסניפים שאתה קונה בהם. מומלץ 3–8 סניפים, כי כל סניף נוסף מאט קצת את הטעינה.</div>
        ${idx.cities && html`<div class="tiny muted mt">ערים במאגר: ${idx.cities.join(", ")}</div>`}
        <input class="input mt" placeholder="חיפוש רשת / סניף / רחוב" value=${q} onInput=${(e) => setQ(e.target.value)} />
        <div class="chips mt"><button class=${`chip ${!city ? "on" : ""}`} onClick=${() => setCity("")}>כל הערים</button>
          ${cities.map((c) => html`<button class=${`chip ${city === c ? "on" : ""}`} onClick=${() => setCity(c)}>${c}</button>`)}</div>
        ${state.myStores.length > 0 && html`<div class="banner info small">נבחרו ${state.myStores.length} סניפים</div>`}
        ${byChain.map(([chain, stores]) => html`<div class="card"><div class="b">${chain} <span class="tiny muted">(${stores.length})</span></div>
          ${stores.map((s) => html`<label class="check"><input type="checkbox" checked=${sel.has(s.k)} onChange=${() => toggle(s.k)} />
            <div class="grow"><div class="small">${s.name}</div><div class="tiny muted">${[s.address, /^\d+$/.test(s.city || "") ? "" : s.city].filter(Boolean).join(", ")} · ${s.items} מוצרים${s.stale ? " · נתונים ישנים" : ""}</div></div></label>`)}
        </div>`)}
        <button class="btn block" onClick=${done}>סיום (${state.myStores.length})</button>
        <div class="tiny muted mt">חסרה עיר? אפשר להוסיף ערים בקובץ pipeline/config.json בריפו.</div>`}
    </main>
  </div>`;
}

export function SettingsView() {
  const p = state.prefs;
  const [busy, setBusy] = useState(false);
  const [words, setWords] = useState((p.excludeWords || []).join(", "));
  const chains = useMemo(() => {
    const m = new Map();
    for (const s of (state.index && state.index.stores) || []) if (state.myStores.includes(s.k)) m.set(s.chainId, s.chainName);
    return [...m.entries()];
  }, [state.myStores, state.index]);
  const pref = (patch) => { setPrefs(patch); import("../data.js").then((d) => d.recomputeDeals()); scheduleProfileSync(); };
  const togglePush = async () => {
    setBusy(true);
    try {
      if (p.notify) { await disablePush(); toast("ההתראות כובו"); }
      else { await enablePush(); toast("ההתראות הופעלו 🔔"); }
    } catch (e) {
      toast(e.message, 6000);
    } finally {
      setBusy(false);
    }
  };
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  return html`<div>
    <${Top} title="הגדרות" back="/more" />
    <main>
      <h2>התראות</h2>
      <div class="card">
        ${ios && !isStandalone() && html`<div class="banner small">באייפון, התראות עובדות רק כשהאפליקציה מותקנת: לחץ על כפתור השיתוף ⬆️ ובחר "הוסף למסך הבית", ואז פתח אותה משם.</div>`}
        <label class="check"><input type="checkbox" checked=${p.notify} disabled=${busy} onChange=${togglePush} />
          <div class="grow">התראות על מבצעים חריגים<div class="tiny muted">כל בוקר, אחרי עדכון המחירים, על מבצעים חדשים בלבד</div></div></label>
        <label class="check"><input type="checkbox" checked=${p.weekly} onChange=${(e) => pref({ weekly: e.target.checked })} />
          <div class="grow">סיכום שבועי<div class="tiny muted">ביום ראשון בבוקר: כל המבצעים הרלוונטיים לשבוע</div></div></label>
        ${!pushSupported() && html`<div class="tiny muted">הדפדפן הזה לא תומך בהתראות.</div>`}
      </div>

      <h2>מה נחשב מבצע חריג</h2>
      <div class="card">
        <label class="field"><span>הנחה מינימלית: <b>${p.threshold}%</b></span>
          <input type="range" min="10" max="50" step="5" value=${p.threshold} style="width:100%" onInput=${(e) => pref({ threshold: +e.target.value })} /></label>
        <div class="tiny muted">המחיר מושווה למחיר הרגיל ב-90 הימים האחרונים, כך שהעלאות מחיר לפני מבצע לא נחשבות הנחה.</div>
      </div>

      ${chains.length > 0 && html`<h2>מועדוני לקוחות</h2>
      <div class="card">
        <div class="tiny muted mb">סמן את המועדונים שאתה חבר בהם, כדי לקבל גם מבצעים של מועדון.</div>
        ${chains.map(([id, name]) => html`<label class="check"><input type="checkbox" checked=${!(p.noClub || {})[id]} onChange=${(e) => pref({ noClub: { ...(p.noClub || {}), [id]: !e.target.checked } })} /><div class="grow">${name}</div></label>`)}
      </div>`}

      <h2>העדפות תזונה ומוצרים</h2>
      <div class="card">
        <label class="field"><span>אל תציע חלופות שהשם שלהן מכיל (מופרד בפסיקים)</span>
          <input class="input" placeholder="למשל: חזיר, ללא כשרות, בשרי" value=${words} onInput=${(e) => setWords(e.target.value)}
            onBlur=${() => pref({ excludeWords: words.split(",").map((x) => x.trim()).filter(Boolean) })} /></label>
        <div class="tiny muted">אפשר גם לנעול מוצר ספציפי על מותג מסוים, מתוך מסך המוצר.</div>
      </div>

      <h2>פרטים</h2>
      <div class="card">
        <label class="field"><span>השם שלך (ברשימות משותפות)</span>
          <input class="input" value=${p.name} onChange=${(e) => setPrefs({ name: e.target.value.trim() })} /></label>
      </div>

      <h2>נתונים</h2>
      <div class="card small">
        <div>עדכון מחירים אחרון: ${(state.index && state.index.u) || "—"}</div>
        <div class="btns mt">
          <button class="btn sm sec" onClick=${async () => { await loadIndex(true); await loadCatalog(); toast("עודכן"); }}>רענן עכשיו</button>
          <button class="btn sm sec" onClick=${() => { const b = new Blob([exportBackup()], { type: "application/json" }); const a = document.createElement("a"); a.href = URL.createObjectURL(b); a.download = `smart-basket-backup-${new Date().toISOString().slice(0, 10)}.json`; a.click(); }}>גיבוי לקובץ</button>
          <label class="btn sm sec" style="cursor:pointer">שחזור מגיבוי<input type="file" accept="application/json" style="display:none" onChange=${async (e) => { try { importBackup(await e.target.files[0].text()); toast("שוחזר"); loadCatalog(); } catch (er) { toast(er.message); } }} /></label>
        </div>
        <${ChainStatus} />
      </div>
    </main>
  </div>`;
}

function ChainStatus() {
  const [st, setSt] = useState(null);
  return html`<div class="mt">
    ${!st ? html`<button class="btn sm ghost" onClick=${async () => { try { setSt(await (await fetch("./data/status.json", { cache: "no-cache" })).json()); } catch { setSt({ chains: [] }); } }}>מצב הרשתות במאגר</button>`
    : html`<div class="tiny">${(st.chains || []).map((c) => html`<div>${c.ok ? "✅" : "⚠️"} ${c.chain}: ${c.stores} סניפים${c.error ? ` — ${c.error.slice(0, 80)}` : ""}</div>`)}</div>`}
  </div>`;
}

export function ReportView() {
  const rs = state.receipts;
  const byMonth = new Map();
  const byCat = new Map();
  for (const r of rs) {
    const d = new Date(r.date);
    const k = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
    byMonth.set(k, (byMonth.get(k) || 0) + (r.total || 0));
    for (const l of r.lines) {
      if (l.skip) continue;
      const c = catLabel(l.cat) || "אחר";
      byCat.set(c, (byCat.get(c) || 0) + (l.total || 0));
    }
  }
  const months = [...byMonth.entries()].sort((a, b) => b[0].localeCompare(a[0])).slice(0, 12);
  const cats = [...byCat.entries()].sort((a, b) => b[1] - a[1]).slice(0, 15);
  const maxM = Math.max(1, ...months.map((m) => m[1]));
  const maxC = Math.max(1, ...cats.map((m) => m[1]));
  const saved = state.taken.reduce((a, t) => a + (t.saved || 0), 0);
  const savedMonth = state.taken.filter((t) => Date.now() - t.date < 30 * 864e5).reduce((a, t) => a + (t.saved || 0), 0);
  const issues = rs.flatMap((r) => r.issues || []);
  const pot = weeklySummary((state.deals || []).filter((d) => !state.dismissed[d.key]));
  return html`<div>
    <${Top} title="דוח הוצאות וחיסכון" back="/more" />
    <main>
      <div class="stats">
        <div class="stat"><div class="v" style="color:var(--good)">${nis(saved)}</div><div class="l">חסכת עם האפליקציה</div></div>
        <div class="stat"><div class="v">${nis(savedMonth)}</div><div class="l">ב-30 הימים האחרונים</div></div>
      </div>
      <div class="stats">
        <div class="stat"><div class="v">${nis(pot.potential)}</div><div class="l">אפשר לחסוך עכשיו</div></div>
        <div class="stat"><div class="v" style=${issues.length ? "color:var(--bad)" : ""}>${nis(issues.reduce((a, x) => a + (x.diff || 0), 0))}</div><div class="l">חיובי יתר בקופה</div></div>
      </div>
      ${!rs.length ? html`<${Empty} icon="📊" title="אין עדיין נתונים">סרוק קבלות כדי לראות לאן הולך הכסף.</${Empty}>`
      : html`
        <h2>הוצאות לפי חודש</h2>
        <div class="card">${months.map(([m, v]) => html`<div class="mb"><div class="row small"><div class="grow">${m.slice(5)}/${m.slice(2, 4)}</div><b>${nis(v)}</b></div><div class="bar"><div style=${{ width: `${(v / maxM) * 100}%` }}></div></div></div>`)}</div>
        <h2>לפי קטגוריה</h2>
        <div class="card">${cats.map(([c, v]) => html`<div class="mb"><div class="row small"><div class="grow">${c}</div><b>${nis(v)}</b></div><div class="bar"><div style=${{ width: `${(v / maxC) * 100}%` }}></div></div></div>`)}</div>`}
      ${state.taken.length > 0 && html`<h2>מבצעים שניצלת</h2><div class="card">${state.taken.slice(0, 30).map((t) => html`<div class="li small"><div class="grow">${t.name}<div class="tiny muted">${fmtDate(t.date, true)}</div></div><div style="color:var(--good)">${nis(t.saved)}</div></div>`)}</div>`}
    </main>
  </div>`;
}

export function HelpView() {
  return html`<div>
    <${Top} title="איך זה עובד" back="/more" />
    <main><div class="card small">
      <p><b>מאיפה המחירים?</b> לפי חוק שקיפות המחירים, כל רשתות המזון מפרסמות קבצי מחירים ומבצעים. השרת מוריד אותם כל בוקר לסניפים באזור שלך.</p>
      <p><b>מה זה "מבצע חריג"?</b> מחיר נמוך לפחות ב-${state.prefs.threshold}% מהמחיר הרגיל של המוצר ב-90 הימים האחרונים. אם הרשת העלתה מחיר לפני המבצע, או שהמוצר זול יותר בסניף אחר גם בלי מבצע, המבצע מסומן כמטעה.</p>
      <p><b>חלופות:</b> לכל מוצר שאתה קונה יש קטגוריה (למשל "מרכך כביסה"). כשיש מבצע על מוצר אחר באותה קטגוריה, שזול יותר לליטר, לק"ג או ליחידה, תקבל עליו התראה. אפשר לכבות את זה לכל מוצר בנפרד.</p>
      <p><b>מתי נגמר?</b> מכמה קבלות האפליקציה לומדת כל כמה זמן אתה קונה כל מוצר, ומזהירה לפני שהוא נגמר. ככה מבצע קופץ בזמן.</p>
      <p><b>בדיקת קופה:</b> כל קבלה נבדקת מול מחיר המדף והמבצעים בסניף, כדי לזהות חיובי יתר.</p>
      <p><b>פרטיות:</b> הקבלות והמוצרים נשמרים רק במכשיר שלך. כשמפעילים התראות, נשלחת לשרת רק רשימת המוצרים והסניפים, כדי לחשב התראות.</p>
    </div></main>
  </div>`;
}
