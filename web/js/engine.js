// Pure logic shared by the web app and the server-side notifier (no DOM here).
//
// Store data format (from the pipeline, s/<key>.json):
//   items:  [code, name, manufacturer, price, unit('kg'|'l'|'u'|'m'|''), qty, category, weighted]
//   promos: [description, start, end, minQty, clubs[], minPurchase, nItems]
//   ip:     { code: [[promoIndex, effectiveUnitPrice], ...] }
// Stats format (stats/<chainId>.json): code -> [median, min, max, daysSinceChange, previous, nDays]

export const SUBSTITUTABLE = new Set([
  "softener", "laundry_gel", "laundry_powder", "stain", "dish_liquid", "dishwasher", "bleach", "floor_cleaner",
  "surface_cleaner", "sponges", "trash_bags", "toilet_paper", "paper_towels", "tissues", "wet_wipes", "diapers",
  "aluminum_foil", "disposable", "shampoo", "conditioner", "body_wash", "deodorant", "toothpaste", "toothbrush",
  "mouthwash", "shaving", "pads", "cotton", "milk", "plant_milk", "choco_milk", "cottage", "white_cheese",
  "yellow_cheese", "salty_cheese", "cream", "butter", "margarine", "eggs", "water", "cola", "flour", "sugar",
  "salt", "oil", "vinegar", "rice", "pasta", "tuna", "tomato_paste", "oats", "tahini", "cat_food", "dog_food",
  "cat_litter", "coffee", "coffee_instant", "coffee_capsules", "coffee_beans", "tea", "bread", "crackers", "yogurt", "baking", "legumes",
]);

export const STOCKABLE = new Set([
  "softener", "laundry_gel", "laundry_powder", "stain", "dish_liquid", "dishwasher", "bleach", "floor_cleaner",
  "surface_cleaner", "sponges", "trash_bags", "toilet_paper", "paper_towels", "tissues", "wet_wipes", "diapers",
  "aluminum_foil", "disposable", "shampoo", "conditioner", "body_wash", "deodorant", "toothpaste", "toothbrush",
  "mouthwash", "shaving", "pads", "cotton", "body_lotion", "water", "cola", "soft_drinks", "juice", "flour",
  "sugar", "salt", "oil", "vinegar", "rice", "pasta", "legumes", "tuna", "tomato_paste", "canned_veg", "spices",
  "coffee", "coffee_instant", "coffee_capsules", "coffee_beans", "tea", "oats", "cereal", "baking", "cat_food", "dog_food", "cat_litter", "beer", "wine", "spirits",
  "snack_bars", "crackers", "sauces", "tahini",
]);

export const UNIT_LABEL = { kg: "ק\"ג", l: "ליטר", u: "יח'", m: "מטר" };

export const round2 = (x) => Math.round(x * 100) / 100;

export function median(arr) {
  const a = arr.filter((x) => x > 0).sort((x, y) => x - y);
  if (!a.length) return 0;
  const m = a.length >> 1;
  return a.length % 2 ? a[m] : (a[m - 1] + a[m]) / 2;
}

/** Parse "2026-11-20 23:59" style dates from promo files. */
export function parseDate(s) {
  if (!s) return null;
  const m = String(s).match(/(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):(\d{2}))?/);
  if (m) return new Date(+m[1], +m[2] - 1, +m[3], +(m[4] || 23), +(m[5] || 59));
  const m2 = String(s).match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m2) return new Date(+m2[3], +m2[2] - 1, +m2[1], 23, 59);
  return null;
}

// ------------------------------------------------------------------ catalog

/**
 * Build a catalog from store data.
 * stores: [{ meta: {k, chainId, chainName, name, city}, data: <store json> }]
 * returns { items: Map(code -> item), stores: Map(key -> meta) }
 * item: { code, name, manuf, cat, unit, qty, w, at: Map(storeKey -> {price, offers:[{eff, promo}]}) }
 */
export function buildCatalog(stores) {
  const items = new Map();
  const storeMap = new Map();
  for (const { meta, data } of stores) {
    if (!data || !data.items) continue;
    storeMap.set(meta.k, meta);
    const promos = data.promos || [];
    const ip = data.ip || {};
    for (const row of data.items) {
      const [code, name, manuf, price, unit, qty, cat, w] = row;
      let it = items.get(code);
      if (!it) {
        it = { code, name, manuf, cat: cat || "", unit: unit || "", qty: qty || 0, w: !!w, at: new Map() };
        items.set(code, it);
      } else if (!it.unit && unit) {
        it.unit = unit;
        it.qty = qty;
      }
      const offers = (ip[code] || []).map(([idx, eff]) => {
        const p = promos[idx] || [];
        return { eff, promo: { desc: p[0] || "", start: p[1] || "", end: p[2] || "", minQty: p[3] || 1, clubs: p[4] || [], minPurchase: p[5] || 0, nItems: p[6] || 0 } };
      });
      it.at.set(meta.k, { price, offers });
    }
  }
  return { items, stores: storeMap };
}

export function perUnit(price, item) {
  if (!item || !item.qty || item.qty <= 0 || !item.unit) return null;
  return price / item.qty;
}

export function unitLabel(item) {
  return item && item.unit ? `₪ ל${UNIT_LABEL[item.unit] || item.unit}` : "";
}

/** Offers the user can actually use at a store (respects club membership / validity). */
export function eligibleOffers(entry, chainId, prefs = {}, now = new Date()) {
  if (!entry) return [];
  const noClub = (prefs.noClub || {})[chainId];
  return entry.offers.filter((o) => {
    const end = parseDate(o.promo.end);
    if (end && end < now) return false;
    const start = parseDate(o.promo.start);
    if (start && start > new Date(now.getTime() + 36e5 * 24)) return false;
    if (noClub && o.promo.clubs.length) return false;
    return true;
  });
}

export function bestOffer(entry, chainId, prefs, now) {
  const offs = eligibleOffers(entry, chainId, prefs, now);
  if (!offs.length) return null;
  return offs.reduce((a, b) => (b.eff < a.eff ? b : a));
}

/** Effective price for one unit of an item at a store (promo if any). */
export function effectivePrice(item, storeKey, catalog, prefs, now) {
  const entry = item.at.get(storeKey);
  if (!entry) return null;
  const meta = catalog.stores.get(storeKey);
  const off = bestOffer(entry, meta && meta.chainId, prefs, now);
  return off && off.eff < entry.price ? { price: off.eff, regular: entry.price, offer: off } : { price: entry.price, regular: entry.price, offer: null };
}

/** Typical regular price of a product (per item), using chain history if we have it. */
export function regularPrice(item, catalog, stats = {}) {
  const vals = [];
  for (const [k, e] of item.at) {
    const meta = catalog.stores.get(k);
    const st = meta && stats[meta.chainId] && stats[meta.chainId][item.code];
    vals.push(st && st[5] >= 5 ? Math.max(st[0], 0) || e.price : e.price);
  }
  return median(vals);
}

function chainRegular(item, storeKey, catalog, stats) {
  const e = item.at.get(storeKey);
  const meta = catalog.stores.get(storeKey);
  const st = meta && stats[meta.chainId] && stats[meta.chainId][item.code];
  if (st && st[5] >= 5 && st[0] > 0) {
    const raised = e.price > st[0] * 1.08 && st[3] <= 30 && st[5] >= 7;
    return { ref: raised ? st[0] : Math.max(e.price, st[0] * 0.98), raised, median: st[0], min: st[1], prev: st[4], since: st[3] };
  }
  return { ref: e.price, raised: false, median: 0, min: 0, prev: 0, since: 0 };
}

function blocked(name, prefs) {
  const words = (prefs && prefs.excludeWords) || [];
  return words.some((w) => w && name.includes(w));
}

// ------------------------------------------------------------------ deals

/**
 * products: [{ code, name, cat, unit, qty, allowAlt, target, runOut (ms timestamp|0), refPrice }]
 * prefs: { threshold (percent), noClub: {chainId: true}, excludeWords: [] }
 * returns deals sorted by score, each:
 * { key, type: 'same'|'alt'|'target'|'cheaper', product, item, store, price, regular, ref, savingsPct, saveAmount,
 *   unitPrice, refUnitPrice, offer, flags:{raised, club, minPurchase, cheaperElsewhere}, stockUp, urgent, score }
 */
export function findDeals({ products, catalog, stats = {}, prefs = {}, now = new Date(), maxAltPerProduct = 3 }) {
  const threshold = (prefs.threshold ?? 20) / 100;
  const deals = [];
  const byCat = new Map();
  for (const it of catalog.items.values()) {
    if (!it.cat) continue;
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push(it);
  }
  const soon = now.getTime() + 7 * 864e5;

  for (const p of products) {
    const own = catalog.items.get(p.code);
    // a category the user picked wins; otherwise trust the (re)computed catalog category
    const cat = (p.catManual && p.cat) || (own && own.cat) || p.cat || "";
    const unit = (own && own.unit) || p.unit || "";
    const qty = (own && own.qty) || p.qty || 0;
    const urgent = !!(p.runOut && p.runOut <= soon);
    let refItemPrice = own ? regularPrice(own, catalog, stats) : 0;
    if (!refItemPrice && p.refPrice) refItemPrice = p.refPrice;
    const refUnit = refItemPrice && qty ? refItemPrice / qty : 0;
    const seen = new Set();

    // 1) the same product on promo
    if (own) {
      let crossMinRegular = Infinity;
      for (const [, e] of own.at) crossMinRegular = Math.min(crossMinRegular, e.price);
      for (const [k, e] of own.at) {
        const meta = catalog.stores.get(k);
        const off = bestOffer(e, meta.chainId, prefs, now);
        const target = p.target && p.target > 0 ? p.target : 0;
        const price = off ? Math.min(off.eff, e.price) : e.price;
        if (target && price <= target) {
          deals.push(mkDeal("target", p, own, meta, price, e.price, refItemPrice || e.price, off, {}, urgent, qty, unit));
          seen.add(k + "|" + own.code);
          continue;
        }
        if (!off) continue;
        const cr = chainRegular(own, k, catalog, stats);
        const ref = Math.max(cr.ref, 0.01);
        const flags = { raised: cr.raised, club: off.promo.clubs.length > 0, minPurchase: off.promo.minPurchase, cheaperElsewhere: false, median: cr.median, prev: cr.prev };
        // a "promo" that is still more expensive than the regular price elsewhere isn't a deal
        if (crossMinRegular <= off.eff + 0.01 && crossMinRegular < e.price) flags.cheaperElsewhere = true;
        const sav = 1 - off.eff / ref;
        if (sav >= threshold && !flags.cheaperElsewhere) {
          deals.push(mkDeal("same", p, own, meta, off.eff, e.price, ref, off, flags, urgent, qty, unit));
          seen.add(k + "|" + own.code);
        } else if (flags.raised || flags.cheaperElsewhere) {
          // recorded as a warning (fake deal) for the UI, never alerted on
          deals.push({ ...mkDeal("fake", p, own, meta, off.eff, e.price, ref, off, flags, urgent, qty, unit), score: -1 });
        }
      }
    }

    // 2) a different product that serves the same purpose
    const allowAlt = p.allowAlt ?? SUBSTITUTABLE.has(cat);
    if (allowAlt && cat && unit && qty > 0 && refUnit > 0) {
      const alts = [];
      for (const c of byCat.get(cat) || []) {
        if (c.code === p.code || c.unit !== unit || !c.qty) continue;
        if (c.qty < qty / 3 || c.qty > qty * 3) continue;
        if (blocked(c.name, prefs)) continue;
        for (const [k, e] of c.at) {
          if (seen.has(k + "|" + c.code)) continue;
          const meta = catalog.stores.get(k);
          const off = bestOffer(e, meta.chainId, prefs, now);
          const price = off ? Math.min(off.eff, e.price) : e.price;
          const unitP = price / c.qty;
          const sav = 1 - unitP / refUnit;
          const isPromo = !!off && off.eff < e.price;
          // promo alternatives need the normal threshold; a permanently cheaper alternative needs more
          const need = isPromo ? threshold : threshold + 0.1;
          if (sav < need) continue;
          // a "same purpose" product that is 65%+ cheaper per unit is almost always a different
          // kind of product that landed in the same category — don't suggest it
          if (sav > 0.65) continue;
          const flags = { club: !!(off && off.promo.clubs.length), minPurchase: off ? off.promo.minPurchase : 0 };
          alts.push(mkDeal(isPromo ? "alt" : "cheaper", p, c, meta, price, e.price, refUnit * c.qty, isPromo ? off : null, flags, urgent, qty, unit));
        }
      }
      alts.sort((a, b) => b.score - a.score);
      const used = new Set();
      for (const d of alts) {
        if (used.has(d.item.code)) continue;
        used.add(d.item.code);
        deals.push(d);
        if (used.size >= maxAltPerProduct) break;
      }
    }
  }
  // one card per (store, item): keep the best
  const best = new Map();
  for (const d of deals) {
    const k = d.key;
    if (!best.has(k) || best.get(k).score < d.score) best.set(k, d);
  }
  return [...best.values()].sort((a, b) => b.score - a.score);
}

function mkDeal(type, product, item, meta, price, regular, ref, offer, flags, urgent, myQty, unit) {
  const savingsPct = ref > 0 ? Math.max(0, 1 - price / ref) : 0;
  const minQty = offer ? offer.promo.minQty || 1 : 1;
  const saveAmount = Math.max(0, (ref - price) * minQty);
  const stockUp = STOCKABLE.has(item.cat) && savingsPct >= 0.3 && !!offer;
  const unitPrice = item.qty ? price / item.qty : null;
  const refUnitPrice = item.qty ? ref / item.qty : null;
  let score = savingsPct * 100 + Math.min(saveAmount, 25);
  if (type === "target") score += 40;
  if (type === "same") score += 5;
  if (urgent) score += 15;
  if (type === "cheaper") score -= 10;
  return {
    key: `${meta.k}|${item.code}|${offer ? offer.promo.desc + "|" + offer.eff : price}`,
    type, product, item, store: meta, price: round2(price), regular: round2(regular), ref: round2(ref),
    savingsPct, saveAmount: round2(saveAmount), unitPrice, refUnitPrice, offer, minQty,
    flags: flags || {}, stockUp, urgent, score, unit,
  };
}

export function dealText(d) {
  const s = Math.round(d.savingsPct * 100);
  const where = `${d.store.chainName || ""} ${d.store.name || ""}`.trim();
  const q = d.minQty > 1 ? ` (בקניית ${d.minQty})` : "";
  if (d.type === "target") return `${d.item.name} ב-₪${d.price.toFixed(2)} ב${where} — הגיע למחיר היעד שלך`;
  if (d.type === "same") return `${d.item.name} ב-₪${d.price.toFixed(2)}${q} במקום ~₪${d.ref.toFixed(2)} (${s}%-) ב${where}`;
  return `במקום ${d.product.name}: ${d.item.name} ב-₪${d.price.toFixed(2)}${q}, זול ב-${s}% לפי ${UNIT_LABEL[d.unit] || "יחידה"} (${where})`;
}

// ------------------------------------------------------------------ predictions

/** purchases: [{date (ms), qty}] -> {avgDays, next (ms), confidence} */
export function predictRunOut(purchases, now = Date.now()) {
  const ds = [...new Set((purchases || []).map((p) => new Date(p.date).setHours(0, 0, 0, 0)))].sort((a, b) => a - b);
  if (ds.length < 2) return { avgDays: 0, next: 0, confidence: 0 };
  const gaps = [];
  for (let i = 1; i < ds.length; i++) gaps.push((ds[i] - ds[i - 1]) / 864e5);
  const recent = gaps.slice(-5);
  const avg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const last = ds[ds.length - 1];
  // more units bought last time -> lasts proportionally longer
  const lastQty = (purchases.filter((p) => new Date(p.date).setHours(0, 0, 0, 0) === last).reduce((a, p) => a + (p.qty || 1), 0)) || 1;
  const typicalQty = median(purchases.map((p) => p.qty || 1)) || 1;
  const factor = Math.min(3, Math.max(0.5, lastQty / typicalQty));
  return { avgDays: Math.round(avg), next: last + avg * factor * 864e5, confidence: Math.min(1, gaps.length / 4) };
}

// ------------------------------------------------------------------ basket comparison

/**
 * list: [{ text, code, cat, qty, allowAlt }]
 * returns { stores: [{store, total, missing, lines:[{line, item, price, offer, alt}]}], bestSingle, bestPair }
 */
export function compareBasket(list, catalog, prefs = {}, now = new Date()) {
  const storeKeys = [...catalog.stores.keys()];
  const results = storeKeys.map((k) => ({ store: catalog.stores.get(k), total: 0, missing: 0, lines: [] }));
  const byCat = new Map();
  for (const it of catalog.items.values()) {
    if (!it.cat) continue;
    if (!byCat.has(it.cat)) byCat.set(it.cat, []);
    byCat.get(it.cat).push(it);
  }
  for (const line of list) {
    const qty = line.qty || 1;
    const own = line.code ? catalog.items.get(line.code) : null;
    const cat = line.cat || (own && own.cat) || "";
    const allowAlt = line.allowAlt ?? SUBSTITUTABLE.has(cat);
    results.forEach((r) => {
      const k = r.store.k;
      let best = null;
      if (own && own.at.has(k)) {
        const ep = effectivePrice(own, k, catalog, prefs, now);
        const usePromo = ep.offer && qty >= (ep.offer.promo.minQty || 1);
        best = { item: own, price: usePromo ? ep.price : ep.regular, offer: usePromo ? ep.offer : null, alt: false };
      } else if (cat && (allowAlt || !own)) {
        const targetQty = own ? own.qty : 0;
        for (const c of byCat.get(cat) || []) {
          if (!c.at.has(k)) continue;
          if (own && (c.unit !== own.unit || !c.qty || c.qty < targetQty / 2 || c.qty > targetQty * 2)) continue;
          const ep = effectivePrice(c, k, catalog, prefs, now);
          const usePromo = ep.offer && qty >= (ep.offer.promo.minQty || 1);
          let price = usePromo ? ep.price : ep.regular;
          // normalise to the size the user wants
          if (own && c.qty && targetQty) price = price * (targetQty / c.qty);
          if (!best || price < best.price) best = { item: c, price, offer: usePromo ? ep.offer : null, alt: true };
        }
      }
      if (best) {
        r.total += best.price * qty;
        r.lines.push({ line, ...best, price: round2(best.price) });
      } else {
        r.missing += 1;
        r.lines.push({ line, item: null, price: 0 });
      }
    });
  }
  results.forEach((r) => (r.total = round2(r.total)));
  results.sort((a, b) => a.missing - b.missing || a.total - b.total);
  const bestSingle = results[0] || null;
  // best split between two stores
  let bestPair = null;
  for (let i = 0; i < results.length; i++) {
    for (let j = i + 1; j < results.length; j++) {
      const A = results[i], B = results[j];
      let total = 0, missing = 0;
      const split = [];
      list.forEach((line, idx) => {
        const a = A.lines[idx], b = B.lines[idx];
        const qty = line.qty || 1;
        const pa = a && a.item ? a.price : Infinity, pb = b && b.item ? b.price : Infinity;
        if (pa === Infinity && pb === Infinity) { missing++; split.push(null); return; }
        if (pa <= pb) { total += pa * qty; split.push({ store: A.store, ...a }); } else { total += pb * qty; split.push({ store: B.store, ...b }); }
      });
      total = round2(total);
      if (!bestPair || missing < bestPair.missing || (missing === bestPair.missing && total < bestPair.total)) bestPair = { stores: [A.store, B.store], total, missing, split };
    }
  }
  return { stores: results, bestSingle, bestPair };
}

// ------------------------------------------------------------------ receipts

const SKIP_WORDS = ["סה\"כ", "סהכ", "סה'כ", "לתשלום", "מע\"מ", "מעמ", "עודף", "אשראי", "מזומן", "ויזה", "כרטיס", "קופה", "קופאי", "תאריך", "שעה", "ח.פ", "עוסק", "טלפון", "חשבונית", "מס'", "פריטים", "תודה", "כתובת", "סניף", "שולם", "יתרה", "נקודות", "מועדון", "אישור", "עסקה", "מסוף", "ברקוד", "קבלה", "www", "http"];
const CHAINS = [
  ["שופרסל", "שופרסל"], ["רמי לוי", "רמי לוי"], ["יוחננוף", "יוחננוף"], ["אושר עד", "אושר עד"], ["ויקטורי", "ויקטורי"],
  ["טיב טעם", "טיב טעם"], ["קרפור", "קרפור"], ["יינות ביתן", "יינות ביתן"], ["חצי חינם", "חצי חינם"], ["מחסני השוק", "מחסני השוק"],
  ["סופר פארם", "סופר-פארם"], ["סופר-פארם", "סופר-פארם"], ["קשת טעמים", "קשת טעמים"], ["סטופ מרקט", "סטופ מרקט"], ["פרש מרקט", "פרשמרקט"],
  ["פרשמרקט", "פרשמרקט"], ["זול ובגדול", "זול ובגדול"], ["יילו", "יילו"], ["דור אלון", "דור אלון"], ["מגה", "מגה"], ["קינג סטור", "קינג סטור"], ["שוק העיר", "שוק העיר"],
];

const PRICE_RE = /-?\d{1,4}[.,]\d{2}(?!\d)/g;
const QTY_RE = /(\d+(?:[.,]\d{1,3})?)\s*(?:ק"?ג|יח'?)?\s*[xX×*]\s*(\d{1,4}[.,]\d{2})/;
const CODE_RE = /(?<![\d.,])(\d{7,14})(?![\d.,])/;

const toNum = (s) => parseFloat(String(s).replace(",", "."));

export function parseReceiptText(text) {
  const rawLines = String(text || "").split(/\r?\n/).map((l) => l.replace(/[\u200e\u200f]/g, "").replace(/\s+/g, " ").trim()).filter(Boolean);
  const out = [];
  let total = 0;
  let date = 0;
  let chain = "";
  const all = rawLines.join(" ");
  for (const [needle, name] of CHAINS) if (all.replace(/\s/g, "").includes(needle.replace(/\s/g, ""))) { chain = name; break; }
  const last = () => out[out.length - 1];
  for (const l of rawLines) {
    const dm = l.match(/(\d{1,2})[./-](\d{1,2})[./-](20\d{2})/) || l.match(/(\d{1,2})[./-](\d{1,2})[./-](\d{2})(?!\d)/);
    if (dm && !date) {
      const y = dm[3].length === 2 ? 2000 + +dm[3] : +dm[3];
      const d = new Date(y, +dm[2] - 1, +dm[1]);
      if (!isNaN(d) && d.getFullYear() > 2015 && d <= new Date(Date.now() + 864e5)) { date = d.getTime(); continue; }
    }
    if (/(סה["'״]?כ|לתשלום)/.test(l)) {
      const ps = l.match(PRICE_RE);
      if (ps) total = Math.max(total, toNum(ps[ps.length - 1]));
      continue;
    }
    if (SKIP_WORDS.some((w) => l.includes(w))) continue;
    const prices = (l.match(PRICE_RE) || []).map(toNum);
    const qm = l.match(QTY_RE);
    const cm = l.match(CODE_RE);
    const heb = l.replace(CODE_RE, " ").replace(QTY_RE, " ").replace(PRICE_RE, " ").replace(/[^\u0590-\u05FF0-9%"'. ]/g, " ").replace(/\s+/g, " ").trim();
    const hasWords = /[\u0590-\u05FF]{2,}/.test(heb);
    const isDiscount = /הנחה|הנחת|זיכוי/.test(l) || (prices.length > 0 && prices[prices.length - 1] < 0);
    const L = last();
    if (isDiscount && L && prices.length) {
      const d = Math.abs(prices[prices.length - 1]);
      if (d < L.total) { L.discount = round2((L.discount || 0) + d); L.total = round2(L.total - d); }
      continue;
    }
    if (!hasWords && !cm) {
      if (!prices.length) continue;
      // quantity line: "2 X 7.50 15.00" (the X is often lost by OCR: "2 15.00 7.50")
      let qty = 0, unit = 0, tot = 0;
      if (qm) { qty = toNum(qm[1]); unit = toNum(qm[2]); tot = prices.length > 1 ? Math.max(...prices) : round2(qty * unit); }
      else if (prices.length >= 2) {
        const ints = (l.replace(PRICE_RE, " ").match(/(?<![\d.])\d{1,2}(?:[.,]\d{1,3})?(?![\d])/g) || []).map(toNum).filter((n) => n > 0);
        const hi = Math.max(...prices), lo = Math.min(...prices);
        const n = ints.find((k) => Math.abs(k * lo - hi) < 0.05) || (lo > 0 && Math.abs(Math.round(hi / lo) * lo - hi) < 0.03 ? Math.round(hi / lo) : 0);
        if (n) { qty = n; unit = lo; tot = hi; }
      }
      if (L && qty) { L.qty = qty; L.unitPrice = unit; L.total = tot; L.needsPrice = false; continue; }
      if (L && L.needsPrice) { L.total = prices[prices.length - 1]; L.needsPrice = false; }
      continue;
    }
    // a text/barcode line
    if (L && L.needsPrice && L.code && !L.name && !cm) {
      L.name = heb;
      if (prices.length) { L.total = prices[prices.length - 1]; L.needsPrice = false; }
      continue;
    }
    const e = { raw: l, code: cm ? cm[1].replace(/^0+/, "") : "", name: heb, qty: 1, unitPrice: 0, total: prices.length ? prices[prices.length - 1] : 0, needsPrice: !prices.length };
    if (qm) { e.qty = toNum(qm[1]); e.unitPrice = toNum(qm[2]); if (prices.length < 2) e.total = round2(e.qty * e.unitPrice); }
    if (L && L.needsPrice && !L.total) out.pop(); // previous text line never got a price
    out.push(e);
  }
  const lines = out.filter((e) => e.total > 0 && e.total < 5000 && (e.name || e.code)).map((e) => {
    delete e.needsPrice;
    e.unitPrice = e.unitPrice || round2(e.total / (e.qty || 1));
    return e;
  });
  return { lines, total, date, chain };
}

const tokenize = (s) => String(s || "").replace(/[^֐-׿a-zA-Z0-9% ]/g, " ").split(/\s+/).filter((t) => t.length >= 2);

export function makeNameIndex(catalog) {
  const idx = new Map();
  for (const it of catalog.items.values()) {
    for (const t of new Set(tokenize(it.name))) {
      if (!idx.has(t)) idx.set(t, []);
      idx.get(t).push(it);
    }
  }
  return idx;
}

/** Fuzzy search by name; returns [{item, score}] */
export function searchByName(query, catalog, nameIndex, limit = 20, preferStores = null) {
  const qt = tokenize(query);
  if (!qt.length) return [];
  const scores = new Map();
  for (const t of qt) {
    const cands = nameIndex.get(t) || [];
    const partial = cands.length ? [] : [...nameIndex.keys()].filter((k) => k.startsWith(t) || (t.length >= 3 && k.includes(t))).slice(0, 30).flatMap((k) => nameIndex.get(k));
    for (const it of cands.length ? cands : partial) scores.set(it, (scores.get(it) || 0) + (cands.length ? 1 : 0.7));
  }
  const res = [];
  for (const [it, s] of scores) {
    const nt = tokenize(it.name).length || 1;
    let score = s / Math.max(qt.length, Math.min(nt, qt.length + 2));
    if (preferStores && [...it.at.keys()].some((k) => preferStores.has(k))) score += 0.05;
    res.push({ item: it, score });
  }
  res.sort((a, b) => b.score - a.score);
  return res.slice(0, limit);
}

export function matchReceiptLines(lines, catalog, nameIndex) {
  return lines.map((l) => {
    let item = null, how = "";
    if (l.code) {
      item = catalog.items.get(l.code) || catalog.items.get(l.code.replace(/^0+/, "")) || null;
      if (item) how = "barcode";
    }
    if (!item && l.name && l.name.length >= 3) {
      const r = searchByName(l.name, catalog, nameIndex, 1);
      if (r.length && r[0].score >= 0.5) { item = r[0].item; how = "name"; }
    }
    return { ...l, item, how };
  });
}

/** Overcharge check: lines paid above shelf/promo price at that store. */
export function checkReceipt(lines, storeKey, catalog, prefs, when = new Date()) {
  const issues = [];
  if (!storeKey) return issues;
  for (const l of lines) {
    if (!l.item) continue;
    const ep = effectivePrice(l.item, storeKey, catalog, prefs, when);
    if (!ep) continue;
    const paidUnit = l.qty ? l.total / l.qty : l.total;
    if (l.item.w) continue; // weighted goods: can't verify reliably
    const minQ = ep.offer ? ep.offer.promo.minQty || 1 : 1;
    const expected = ep.offer && (l.qty || 1) >= minQ ? ep.price : ep.regular;
    if (paidUnit > expected + 0.1 && paidUnit < expected * 3) {
      issues.push({ line: l, paid: round2(paidUnit), expected: round2(expected), diff: round2((paidUnit - expected) * (l.qty || 1)), promo: ep.offer && (l.qty || 1) >= minQ ? ep.offer.promo.desc : "" });
    }
  }
  return issues;
}

// ------------------------------------------------------------------ summaries

export function weeklySummary(deals) {
  const real = deals.filter((d) => d.type !== "fake" && d.type !== "cheaper");
  const total = real.reduce((a, d) => a + d.saveAmount, 0);
  return { count: real.length, potential: round2(total), top: real.slice(0, 3) };
}
