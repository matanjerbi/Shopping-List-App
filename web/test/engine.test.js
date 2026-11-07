import { test } from "node:test";
import assert from "node:assert";
import * as E from "../js/engine.js";

const A = { k: "1-1", chainId: "1", chainName: "רמי לוי", name: "בני ברק" };
const B = { k: "2-5", chainId: "2", chainName: "שופרסל", name: "רמת גן" };
const dataA = {
  items: [
    ["7290000000111", "מרכך כביסה בדין 4 ליטר", "סנו", 32.9, "l", 4, "softener", 0],
    ["222", "סוד מרכך כביסה 3 ליטר", "שטראוס", 19.9, "l", 3, "softener", 0],
    ["333", "חלב 3% 1 ליטר", "תנובה", 7.12, "l", 1, "milk", 0],
    ["444", "במבה 80 גרם", "אסם", 5.9, "kg", 0.08, "salty_snacks", 0],
  ],
  promos: [["סוד 2 ב-25", "2026-11-01 00:00", "2026-11-20 23:59", 2, [], 0, 1], ["במבה 3 ב 12", "", "2026-12-01", 3, ["1"], 0, 1]],
  ip: { "222": [[0, 12.5]], "444": [[1, 4]] },
};
const dataB = {
  items: [["7290000000111", "מרכך כביסה בדין 4 ליטר", "סנו", 34.9, "l", 4, "softener", 0], ["333", "חלב 3% 1 ליטר", "תנובה", 6.9, "l", 1, "milk", 0], ["444", "במבה 80 גרם", "אסם", 3.5, "kg", 0.08, "salty_snacks", 0]],
  promos: [["בדין במבצע", "", "2026-11-30", 1, [], 0, 1]],
  ip: { "7290000000111": [[0, 22.9]] },
};
const cat = E.buildCatalog([{ meta: A, data: dataA }, { meta: B, data: dataB }]);
const now = new Date(2026, 10, 7);

test("deals: same product, alternative, club, cheaper elsewhere", () => {
  const products = [{ code: "7290000000111", name: "מרכך בדין" }, { code: "444", name: "במבה" }];
  const deals = E.findDeals({ products, catalog: cat, prefs: { threshold: 20 }, now });
  const same = deals.find((d) => d.type === "same" && d.item.code === "7290000000111");
  assert.ok(same, "bedin promo at B");
  assert.equal(same.store.k, "2-5");
  const alt = deals.find((d) => d.type === "alt" && d.item.code === "222");
  assert.ok(alt, "sod 2 for 25 is an alternative");
  assert.ok(alt.savingsPct > 0.4, String(alt.savingsPct));
  // bamba promo at A (4.0) is pricier than regular at B (3.5): flagged fake, not a real deal
  const fake = deals.find((d) => d.item.code === "444" && d.store.k === "1-1");
  assert.equal(fake.type, "fake");
  assert.ok(fake.flags.cheaperElsewhere);
  // no club membership -> club promo excluded
  const d2 = E.findDeals({ products, catalog: cat, prefs: { threshold: 20, noClub: { "1": true } }, now });
  assert.ok(!d2.find((d) => d.item.code === "444" && d.store.k === "1-1"));
  console.log(deals.filter(d=>d.type!=='fake').map(E.dealText).join("\n"));
});

test("raised price detection via stats", () => {
  const stats = { "2": { "7290000000111": [26, 25, 34.9, 5, 26, 40] } };
  const deals = E.findDeals({ products: [{ code: "7290000000111", name: "בדין" }], catalog: cat, stats, prefs: { threshold: 20 }, now });
  const d = deals.find((x) => x.item.code === "7290000000111" && x.store.k === "2-5");
  assert.ok(d.flags.raised);
  assert.equal(d.type, "fake"); // 22.9 vs real median 26 is only 12%
});

test("target price", () => {
  const deals = E.findDeals({ products: [{ code: "333", name: "חלב", target: 7 }], catalog: cat, prefs: {}, now });
  assert.ok(deals.find((d) => d.type === "target" && d.store.k === "2-5"));
});

test("run-out prediction", () => {
  const day = 864e5, t0 = new Date(2026, 9, 1).getTime();
  const p = E.predictRunOut([{ date: t0, qty: 1 }, { date: t0 + 10 * day, qty: 1 }, { date: t0 + 20 * day, qty: 1 }]);
  assert.equal(p.avgDays, 10);
  assert.equal(Math.round((p.next - t0) / day), 30);
});

test("basket compare", () => {
  const r = E.compareBasket([{ text: "חלב", code: "333", qty: 2 }, { text: "בדין", code: "7290000000111", qty: 1 }, { text: "סוד", code: "222", qty: 2 }], cat, {}, now);
  assert.equal(r.stores.length, 2);
  assert.ok(r.bestPair.total <= r.bestSingle.total);
  console.log(r.stores.map((s) => `${s.store.chainName} ${s.total} missing ${s.missing}`), r.bestPair.total);
});

test("receipt parsing + matching + overcharge", () => {
  const text = `שופרסל דיל רמת גן
07/11/2026 18:32
7290000000111 מרכך כביסה בדין 4 ליטר 34.90
חלב 3% 1 ליטר 6.90
2 X 6.90 13.80
במבה 80 גרם 3.50
הנחה -0.50
סה"כ לתשלום 52.20
ויזה 52.20`;
  const r = E.parseReceiptText(text);
  assert.equal(r.chain, "שופרסל");
  assert.equal(r.total, 52.2);
  assert.equal(new Date(r.date).getDate(), 7);
  assert.equal(r.lines.length, 3, JSON.stringify(r.lines));
  assert.equal(r.lines[0].code, "7290000000111");
  assert.equal(r.lines[1].qty, 2);
  assert.equal(r.lines[2].total, 3);
  const idx = E.makeNameIndex(cat);
  const m = E.matchReceiptLines(r.lines, cat, idx);
  assert.equal(m[0].item.code, "7290000000111");
  assert.equal(m[1].item.code, "333");
  assert.equal(m[2].item.code, "444");
  // bedin had a promo of 22.9 at B but was charged 34.90
  const issues = E.checkReceipt(m, "2-5", cat, {}, now);
  assert.equal(issues.length, 1);
  assert.equal(issues[0].line.item.code, "7290000000111");
});

test("receipt parsing: messy OCR output", () => {
  const text = ` שופרסל דיל רמתגן
 05/11/202618:32
 ‎PDN 7290000066318‏ כביסה בדין 4ליטר
39.90
 4 חלב 3% בקרטון 1ליטר
 2 15.00 7.50א
 במבה 80 גרם5.90
 סה"כ לתשלום60.80`;
  const r = E.parseReceiptText(text);
  assert.equal(r.chain, "שופרסל");
  assert.equal(new Date(r.date).getMonth(), 10);
  assert.equal(r.total, 60.8);
  assert.equal(r.lines.length, 3, JSON.stringify(r.lines, null, 1));
  assert.equal(r.lines[0].code, "7290000066318");
  assert.equal(r.lines[0].total, 39.9);
  assert.equal(r.lines[1].qty, 2);
  assert.equal(r.lines[1].total, 15);
  assert.equal(r.lines[2].total, 5.9);
});
