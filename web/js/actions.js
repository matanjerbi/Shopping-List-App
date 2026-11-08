// State-changing helpers shared across views.
import { state, update, uid, toast } from "./store.js";
import { productKey, recomputeDeals } from "./data.js";
import { scheduleProfileSync } from "./api.js";
import { predictRunOut } from "./engine.js";

export function productFromItem(item) {
  return { code: item.code, name: item.name, cat: item.cat || "", unit: item.unit || "", qty: item.qty || 0, purchases: [], addedAt: Date.now() };
}

export function addProduct(itemOrProduct, silent = false) {
  const p = itemOrProduct.at ? productFromItem(itemOrProduct) : itemOrProduct;
  const key = productKey(p);
  const products = { ...state.products };
  if (products[key]) {
    products[key] = { ...products[key], hidden: false };
  } else {
    products[key] = p;
  }
  update({ products });
  afterProductsChange();
  if (!silent) toast(`נוסף למוצרים שלי: ${p.name}`);
  return key;
}

export function patchProduct(key, patch) {
  const products = { ...state.products };
  if (!products[key]) return;
  products[key] = { ...products[key], ...patch };
  update({ products });
  afterProductsChange();
}

export function removeProduct(key) {
  const products = { ...state.products };
  delete products[key];
  update({ products });
  afterProductsChange();
}

export function afterProductsChange() {
  recomputeDeals();
  scheduleProfileSync();
}

/** Save a confirmed receipt and learn the products in it. */
export function saveReceipt(rec) {
  const products = { ...state.products };
  for (const l of rec.lines) {
    if (l.skip) continue;
    const base = l.item
      ? { code: l.item.code, name: l.item.name, cat: l.item.cat || "", unit: l.item.unit || "", qty: l.item.qty || 0 }
      : { code: "", name: l.name, cat: "", unit: "", qty: 0 };
    if (!base.name) continue;
    const key = productKey(base);
    const p = products[key] ? { ...products[key] } : { ...base, purchases: [], addedAt: Date.now() };
    p.hidden = false;
    p.purchases = [...(p.purchases || []).filter((x) => x.receipt !== rec.id), { date: rec.date, qty: l.qty || 1, price: l.qty ? l.total / l.qty : l.total, storeKey: rec.storeKey || "", receipt: rec.id }].sort((a, b) => a.date - b.date).slice(-30);
    products[key] = p;
  }
  const receipts = [rec, ...state.receipts.filter((r) => r.id !== rec.id)].sort((a, b) => b.date - a.date);
  // savings: a receipt line that bought an item at (or below) a deal price we showed
  const taken = [...state.taken];
  for (const l of rec.lines) {
    if (l.skip || !l.code) continue;
    const paid = l.qty ? l.total / l.qty : l.total;
    const d = (state.deals || []).find((x) => x.type !== "fake" && x.item.code === l.code && paid <= x.price + 0.05 && x.ref > paid);
    if (d && !taken.some((t) => t.key === d.key && t.receipt === rec.id)) taken.unshift({ date: rec.date, name: d.item.name, saved: Math.round((d.ref - paid) * (l.qty || 1) * 100) / 100, key: d.key, store: rec.storeKey || "", receipt: rec.id });
  }
  update({ products, receipts, taken: taken.slice(0, 500) });
  afterProductsChange();
}

export function deleteReceipt(id) {
  const products = { ...state.products };
  for (const [k, p] of Object.entries(products)) {
    if ((p.purchases || []).some((x) => x.receipt === id)) products[k] = { ...p, purchases: p.purchases.filter((x) => x.receipt !== id) };
  }
  update({ receipts: state.receipts.filter((r) => r.id !== id), products });
  afterProductsChange();
}

// ------------------------------------------------------------ private list

export function addToList(entry) {
  const list = [...state.list];
  const same = list.find((x) => !x.done && ((entry.code && x.code === entry.code) || (!entry.code && x.text === entry.text)));
  if (same) {
    same.qty = (same.qty || 1) + (entry.qty || 1);
    update({ list });
    toast(`עודכנה כמות: ${same.text}`);
    return;
  }
  list.push({ id: uid(), text: entry.text, code: entry.code || "", cat: entry.cat || "", qty: entry.qty || 1, done: false, note: entry.note || "", at: Date.now() });
  update({ list });
  toast(`נוסף לרשימה: ${entry.text}`);
}

export function itemToListEntry(item) {
  return { text: item.name, code: item.code, cat: item.cat };
}

/** Products that are predicted to run out within `days` and are not on the list. */
export function runningOut(days = 4) {
  const until = Date.now() + days * 864e5;
  const onList = new Set(state.list.filter((x) => !x.done).map((x) => x.code || x.text));
  const out = [];
  for (const p of Object.values(state.products)) {
    if (p.hidden) continue;
    const pr = predictRunOut(p.purchases || []);
    if (!pr.next || pr.next > until) continue;
    if (onList.has(p.code || p.name)) continue;
    out.push({ p, next: pr.next, avgDays: pr.avgDays });
  }
  return out.sort((a, b) => a.next - b.next);
}

export function logSaving(deal) {
  const taken = [{ date: Date.now(), name: deal.item.name, saved: deal.saveAmount, key: deal.key, store: deal.store.k }, ...state.taken].slice(0, 500);
  update({ taken });
  toast(`נרשם חיסכון של ₪${deal.saveAmount.toFixed(2)} 🎉`);
}

export function dismissDeal(key) {
  update({ dismissed: { ...state.dismissed, [key]: Date.now() } });
  scheduleProfileSync();
}
