"""Daily data pipeline.

Downloads the Stores / PriceFull / PromoFull files of every Israeli chain for
the stores located in the configured cities, normalises them, assigns product
categories, keeps a rolling price history and writes compact JSON files that
the web app reads.

usage: python run.py --prev <previous data dir> --out <output dir>
"""
from __future__ import annotations

import argparse
import datetime as dt
import glob
import gzip
import json
import os
import re
import shutil
import statistics
import sys
import tempfile
import time
import traceback
from multiprocessing import get_context

sys.path.insert(0, os.path.dirname(__file__))

from xmlparse import parse_stores, parse_prices, parse_promos, effective_unit_price  # noqa: E402
from categorize import categorize, LABELS  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
HISTORY_DAYS = 90
IL_TZ = dt.timezone(dt.timedelta(hours=2))

# CBS city codes used by chains that publish a numeric City field
CITY_CODES = {
    "רמת גן": ["8600"], "גבעתיים": ["6300"], "בני ברק": ["6100"], "תל אביב": ["5000"],
    "תל אביב יפו": ["5000"], "פתח תקווה": ["7900"], "חולון": ["6600"], "בת ים": ["6200"],
    "ראשון לציון": ["8300"], "הרצליה": ["6400"], "רעננה": ["8700"], "כפר סבא": ["6900"],
    "קרית אונו": ["2620"], "אור יהודה": ["2400"], "רמת השרון": ["2650"], "גבעת שמואל": ["681"],
    "ירושלים": ["3000"], "חיפה": ["4000"], "באר שבע": ["9000"], "נתניה": ["7400"],
    "ראש העין": ["2640"], "יהוד": ["9400"], "מודיעין": ["1200"], "רחובות": ["8400"],
}


def norm_city(s: str) -> str:
    s = (s or "").replace("-", " ").replace("־", " ")
    s = re.sub(r"[\"'׳״.,()]", "", s)
    return re.sub(r"\s+", "", s)


def store_in_area(store: dict, cities: list[str]) -> bool:
    city = (store.get("city") or "").strip()
    hay_city = norm_city(city)
    hay_all = norm_city(" ".join([city, store.get("address", ""), store.get("name", "")]))
    for c in cities:
        nc = norm_city(c)
        if hay_city and nc and (nc in hay_city or hay_city in nc) and not hay_city.isdigit():
            return True
        if city.isdigit() and city in CITY_CODES.get(c, []):
            return True
        if (not hay_city or hay_city.isdigit()) and nc and nc in hay_all:
            return True
    return False


# --------------------------------------------------------------- download

def _download(chain: str, files_types: list[str], store_id=None, workdir=None):
    """Download today's (or yesterday's) files of the given types. Returns paths."""
    from il_supermarket_scarper.scrapper_runner import scrape_one_wrap
    from il_supermarket_scarper.utils.databases import (
        create_file_output_for_scraper,
        create_status_database_for_scraper,
    )

    now = dt.datetime.now(IL_TZ).replace(tzinfo=None)
    for days_back in (0, 1, 2):
        when = (now - dt.timedelta(days=days_back)).replace(hour=0, minute=0, second=0, microsecond=0)
        out = tempfile.mkdtemp(dir=workdir)
        file_output = create_file_output_for_scraper(chain, {"output_mode": "disk", "base_storage_path": out})
        status_db = create_status_database_for_scraper(chain, {"database_type": "json", "base_path": os.path.join(out, "_status")})
        kwargs = dict(limit=None, single_pass=True, files_types=files_types, store_id=store_id,
                      when_date=when, file_output=file_output, status_database=status_db,
                      timeout_in_seconds=60)
        try:
            scrape_one_wrap(chain, kwargs)
        except Exception as e:  # noqa: BLE001
            print(f"  [{chain}] download error {files_types} store={store_id}: {e}", flush=True)
        files = [p for p in glob.glob(os.path.join(out, "**", "*"), recursive=True)
                 if os.path.isfile(p) and "_status" not in p and re.search(r"\.(xml|gz|zip)$|[0-9]$", p, re.I)]
        if files:
            return sorted(files)
    return []


def _latest_by_type(files: list[str], kind: str) -> str | None:
    cand = [f for f in files if kind in os.path.basename(f).lower()]
    if kind == "price":
        cand = [f for f in cand if "pricefull" in os.path.basename(f).lower()] or cand
    if kind == "promo":
        cand = [f for f in cand if "promofull" in os.path.basename(f).lower()] or cand
    if not cand:
        return None
    return sorted(cand, key=lambda p: re.sub(r"\D", "", os.path.basename(p))[-12:])[-1]


def process_chain(chain: str, cities: list[str], extra_stores: list[str], workdir: str, max_stores: int):
    t0 = time.time()
    result = {"chain": chain, "ok": False, "stores": [], "error": "", "seconds": 0}
    os.makedirs(workdir, exist_ok=True)
    try:
        store_files = _download(chain, ["STORE_FILE"], workdir=workdir)
        f = _latest_by_type(store_files, "store")
        if not f:
            result["error"] = "no stores file"
            return result
        stores = parse_stores(f)
        wanted = [s for s in stores if store_in_area(s, cities)
                  or f"{s['chainId']}-{s['storeId']}" in extra_stores]
        # de-dup store ids
        seen, uniq = set(), []
        for s in wanted:
            if s["storeId"] in seen:
                continue
            seen.add(s["storeId"])
            uniq.append(s)
        wanted = uniq[:max_stores]
        print(f"[{chain}] {len(stores)} stores, {len(wanted)} in area", flush=True)
        for s in wanted:
            try:
                files = _download(chain, ["PRICE_FULL_FILE", "PROMO_FULL_FILE"], store_id=int(s["storeId"]), workdir=workdir)
                pf = _latest_by_type(files, "price")
                if not pf:
                    print(f"  [{chain}] store {s['storeId']}: no price file", flush=True)
                    continue
                items = parse_prices(pf)
                prf = _latest_by_type(files, "promo")
                promos = parse_promos(prf) if prf else []
                s2 = dict(s)
                s2["chain"] = chain
                s2["items"] = items
                s2["promos"] = promos
                s2["priceFile"] = os.path.basename(pf)
                result["stores"].append(s2)
                print(f"  [{chain}] store {s['storeId']} {s['name']}: {len(items)} items, {len(promos)} promos", flush=True)
            except Exception as e:  # noqa: BLE001
                print(f"  [{chain}] store {s['storeId']} failed: {e}", flush=True)
        result["ok"] = bool(result["stores"]) or not wanted
        result["inArea"] = len(wanted)
    except Exception as e:  # noqa: BLE001
        result["error"] = f"{e}\n{traceback.format_exc()[-800:]}"
    finally:
        result["seconds"] = round(time.time() - t0)
        shutil.rmtree(workdir, ignore_errors=True)
    return result


# --------------------------------------------------------------- output

def parse_date(s: str):
    s = (s or "").strip()
    for fmt in ("%Y-%m-%d %H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y-%m-%dT%H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%Y%m%d"):
        try:
            return dt.datetime.strptime(s[: len(dt.datetime.now().strftime(fmt))], fmt)
        except ValueError:
            continue
    m = re.match(r"(\d{4})-(\d{2})-(\d{2})", s)
    if m:
        return dt.datetime(int(m.group(1)), int(m.group(2)), int(m.group(3)))
    return None


def build_store_json(s: dict, today: dt.datetime) -> dict:
    items_out, by_code = [], {}
    for it in s["items"]:
        if it["code"] in by_code:
            continue
        cat = categorize(it["name"])
        by_code[it["code"]] = it
        items_out.append([
            it["code"], it["name"], it["manuf"], it["price"], it["unit"], it["qty"], cat, 1 if it["weighted"] else 0,
        ])
    promos_out, item_promos = [], {}
    for p in s["promos"]:
        end = parse_date(p["end"])
        if end and end.date() < today.date():
            continue
        if p["coupon"]:
            continue
        codes = [c for c in p["codes"] if c in by_code]
        if not codes:
            continue
        idx = len(promos_out)
        clubs = sorted({c for c in p["clubs"] if c and c not in ("0", "00")})
        promos_out.append([
            p["desc"], (p["start"] or "")[:16], (p["end"] or "")[:16], p["minQty"] or 1, clubs,
            p["minPurchase"] or 0, len(codes),
        ])
        for c in codes:
            base = by_code[c]["price"]
            eff = effective_unit_price(p, base)
            if eff is None or eff <= 0 or eff >= base:
                continue
            item_promos.setdefault(c, []).append([idx, eff])
    key = f"{s['chainId']}-{s['storeId']}"
    return {
        "k": key,
        "chainId": s["chainId"],
        "u": today.strftime("%Y-%m-%d %H:%M"),
        "f": s.get("priceFile", ""),
        "items": items_out,
        "promos": promos_out,
        "ip": item_promos,
    }


def update_history(prev_dir: str, out_dir: str, chain_id: str, store_jsons: list[dict], today_str: str):
    path_prev = os.path.join(prev_dir, "state", f"hist-{chain_id}.json.gz")
    hist = {"dates": [], "p": {}}
    if os.path.exists(path_prev):
        try:
            with gzip.open(path_prev, "rt", encoding="utf-8") as f:
                hist = json.load(f)
        except Exception:  # noqa: BLE001
            pass
    # today's base price per code = median across this chain's stores in area
    prices: dict[str, list[float]] = {}
    for sj in store_jsons:
        for it in sj["items"]:
            prices.setdefault(it[0], []).append(it[3])
    today_p = {c: int(round(statistics.median(v) * 100)) for c, v in prices.items()}

    dates = hist.get("dates", [])
    p = hist.get("p", {})
    if dates and dates[-1] == today_str:
        dates = dates[:-1]
        p = {c: v[:-1] for c, v in p.items()}
    dates.append(today_str)
    n = len(dates)
    new_p = {}
    for c in set(p) | set(today_p):
        arr = p.get(c, [])
        arr = ([0] * (n - 1 - len(arr)) + arr)[-(n - 1):] if n > 1 else []
        arr.append(today_p.get(c, 0))
        new_p[c] = arr
    if n > HISTORY_DAYS:
        cut = n - HISTORY_DAYS
        dates = dates[cut:]
        new_p = {c: v[cut:] for c, v in new_p.items()}
    # drop codes with no price in the whole window
    new_p = {c: v for c, v in new_p.items() if any(v)}
    hist = {"dates": dates, "p": new_p}
    os.makedirs(os.path.join(out_dir, "state"), exist_ok=True)
    with gzip.open(os.path.join(out_dir, "state", f"hist-{chain_id}.json.gz"), "wt", encoding="utf-8") as f:
        json.dump(hist, f, separators=(",", ":"))

    # stats: code -> [median, min, max, daysSinceChange, previousPrice, nDays] (shekels)
    stats = {}
    for c, arr in new_p.items():
        vals = [v for v in arr if v]
        if not vals:
            continue
        cur = arr[-1] or vals[-1]
        since, prev = 0, 0
        for v in reversed(arr[:-1]):
            if not v:
                since += 1
                continue
            since += 1
            if v != cur:
                prev = v
                break
        if not prev:
            since = len(arr)
        stats[c] = [round(statistics.median(vals) / 100, 2), round(min(vals) / 100, 2), round(max(vals) / 100, 2),
                    since, round(prev / 100, 2), len(vals)]
    os.makedirs(os.path.join(out_dir, "stats"), exist_ok=True)
    with open(os.path.join(out_dir, "stats", f"{chain_id}.json"), "w", encoding="utf-8") as f:
        json.dump(stats, f, ensure_ascii=False, separators=(",", ":"))


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--prev", default="prev")
    ap.add_argument("--out", default="out")
    ap.add_argument("--chains", default="", help="comma separated subset (debug)")
    ap.add_argument("--procs", type=int, default=6)
    ap.add_argument("--chain-timeout", type=int, default=1500)
    args = ap.parse_args()

    with open(os.path.join(HERE, "config.json"), encoding="utf-8") as f:
        cfg = json.load(f)
    cities = cfg["cities"]
    extra = cfg.get("extraStores", [])
    max_stores = cfg.get("maxStoresPerChain", 40)

    from il_supermarket_scarper.scrappers_factory import ScraperFactory
    chains = [c for c in ScraperFactory.all_scrapers_name() if c not in cfg.get("skipChains", [])]
    if args.chains:
        chains = [c for c in args.chains.split(",") if c]

    os.makedirs(args.out, exist_ok=True)
    today = dt.datetime.now(IL_TZ).replace(tzinfo=None)
    today_str = today.strftime("%Y-%m-%d")
    work_root = tempfile.mkdtemp(prefix="scrape-")

    ctx = get_context("spawn")
    results = []
    with ctx.Pool(args.procs, maxtasksperchild=1) as pool:
        asyncs = {c: pool.apply_async(process_chain, (c, cities, extra, os.path.join(work_root, c), max_stores)) for c in chains}
        deadline = time.time() + args.chain_timeout
        for c, a in asyncs.items():
            try:
                results.append(a.get(timeout=max(5, deadline - time.time())))
            except Exception as e:  # noqa: BLE001
                results.append({"chain": c, "ok": False, "stores": [], "error": f"timeout/crash: {e}", "seconds": args.chain_timeout})
        pool.terminate()

    # previous store index (to carry over stores of chains that failed today)
    prev_index = []
    if os.path.exists(os.path.join(args.prev, "stores.json")):
        with open(os.path.join(args.prev, "stores.json"), encoding="utf-8") as f:
            prev_index = json.load(f).get("stores", [])

    os.makedirs(os.path.join(args.out, "s"), exist_ok=True)
    index, status = [], []
    fresh_chain_ids = set()
    by_chain_jsons: dict[str, list[dict]] = {}
    for r in results:
        status.append({"chain": r["chain"], "ok": r["ok"], "stores": len(r["stores"]), "inArea": r.get("inArea", 0),
                       "error": (r.get("error") or "")[:400], "seconds": r["seconds"]})
        for s in r["stores"]:
            sj = build_store_json(s, today)
            key = sj["k"]
            with open(os.path.join(args.out, "s", f"{key}.json"), "w", encoding="utf-8") as f:
                json.dump(sj, f, ensure_ascii=False, separators=(",", ":"))
            fresh_chain_ids.add(s["chainId"])
            by_chain_jsons.setdefault(s["chainId"], []).append(sj)
            index.append({
                "k": key, "chainId": s["chainId"], "chain": s["chain"], "chainName": s["chainName"],
                "sub": s["subChainName"], "storeId": s["storeId"], "name": s["name"], "address": s["address"],
                "city": s["city"], "items": len(sj["items"]), "promos": len(sj["promos"]), "u": sj["u"],
            })

    # carry over stale stores from chains that failed today
    have = {s["k"] for s in index}
    for s in prev_index:
        if s["k"] in have or s["chainId"] in fresh_chain_ids:
            continue
        src = os.path.join(args.prev, "s", f"{s['k']}.json")
        if os.path.exists(src):
            shutil.copy(src, os.path.join(args.out, "s", f"{s['k']}.json"))
            s = dict(s)
            s["stale"] = True
            index.append(s)
    # carry over stats & history for chains not refreshed today
    for sub in ("stats", "state"):
        src_dir = os.path.join(args.prev, sub)
        if os.path.isdir(src_dir):
            os.makedirs(os.path.join(args.out, sub), exist_ok=True)
            for fn in os.listdir(src_dir):
                cid = re.sub(r"^hist-|\.json(\.gz)?$", "", fn)
                if cid not in fresh_chain_ids:
                    shutil.copy(os.path.join(src_dir, fn), os.path.join(args.out, sub, fn))

    for chain_id, sjs in by_chain_jsons.items():
        update_history(args.prev, args.out, chain_id, sjs, today_str)

    index.sort(key=lambda s: (s.get("chainName") or "", s.get("city") or "", s.get("name") or ""))
    with open(os.path.join(args.out, "stores.json"), "w", encoding="utf-8") as f:
        json.dump({"u": today.strftime("%Y-%m-%d %H:%M"), "cities": cities, "stores": index}, f, ensure_ascii=False)
    with open(os.path.join(args.out, "categories.json"), "w", encoding="utf-8") as f:
        json.dump(LABELS, f, ensure_ascii=False)
    with open(os.path.join(args.out, "status.json"), "w", encoding="utf-8") as f:
        json.dump({"u": today.strftime("%Y-%m-%d %H:%M"), "chains": status}, f, ensure_ascii=False, indent=1)
    print(json.dumps(status, ensure_ascii=False, indent=1))
    print(f"wrote {len(index)} stores")
    shutil.rmtree(work_root, ignore_errors=True)


if __name__ == "__main__":
    main()
