"""Tolerant parsers for the Israeli price-transparency XML files.

Every chain uses a slightly different flavour of the same government schema
(different tag casing, Item vs Product, Promotion vs Sale, wrapped in
asx:abap envelopes, ...). These parsers match tags case-insensitively by
local name so one implementation handles all of them.
"""
from __future__ import annotations

import gzip
import io
import re
import zipfile
from lxml import etree


def _local(tag) -> str:
    if not isinstance(tag, str):
        return ""
    if "}" in tag:
        tag = tag.rsplit("}", 1)[1]
    return tag.lower()


def _open_bytes(path: str) -> bytes:
    with open(path, "rb") as f:
        data = f.read()
    if data[:2] == b"\x1f\x8b":
        data = gzip.decompress(data)
    elif data[:2] == b"PK":
        with zipfile.ZipFile(io.BytesIO(data)) as z:
            data = z.read(z.namelist()[0])
    return data


def _root(path: str):
    data = _open_bytes(path)
    # Some files are UTF-16 with BOM, some declare an encoding they don't use.
    if data[:2] in (b"\xff\xfe", b"\xfe\xff"):
        data = data.decode("utf-16").encode("utf-8")
        data = re.sub(rb"encoding=\"[^\"]+\"", b'encoding="utf-8"', data, count=1)
    parser = etree.XMLParser(recover=True, huge_tree=True, remove_blank_text=True)
    root = etree.fromstring(data, parser)
    if root is None:
        # last resort: assume windows-1255 / utf-8 text with a broken header
        text = data.decode("utf-8", errors="replace")
        text = re.sub(r"^<\?xml[^>]*\?>", "", text.strip())
        root = etree.fromstring(text.encode("utf-8"), parser)
    return root


def _children(el) -> dict:
    """Map lower-cased local child tag -> stripped text (first occurrence)."""
    out = {}
    for c in el:
        k = _local(c.tag)
        if k and k not in out:
            out[k] = (c.text or "").strip()
    return out


def _get(d: dict, *names, default=""):
    for n in names:
        v = d.get(n.lower())
        if v not in (None, ""):
            return v
    return default


def _num(s, default=0.0) -> float:
    if s is None:
        return default
    s = str(s).strip().replace(",", ".")
    m = re.search(r"-?\d+(?:\.\d+)?", s)
    if not m:
        return default
    try:
        return float(m.group(0))
    except ValueError:
        return default


def _iter_named(root, names: set[str]):
    for el in root.iter():
        if _local(el.tag) in names:
            yield el


# ----------------------------------------------------------------- stores

def parse_stores(path: str) -> list[dict]:
    root = _root(path)
    if root is None:
        return []
    top = _children(root)
    chain_id = _get(top, "ChainId", "ChainID")
    chain_name = _get(top, "ChainName")
    stores = []
    # SubChains/SubChain/Stores/Store  or  STORES/STORE  or Branches/Branch
    for el in _iter_named(root, {"store", "branch"}):
        d = _children(el)
        sid = _get(d, "StoreId", "StoreID", "Store_Id")
        if not sid or not re.search(r"\d", sid):
            continue
        parent_chain = chain_id or _get(d, "ChainId", "ChainID")
        p = el.getparent()
        sub_name = ""
        while p is not None:
            pd = _children(p)
            if not parent_chain:
                parent_chain = _get(pd, "ChainId", "ChainID")
            if not chain_name:
                chain_name = _get(pd, "ChainName")
            if not sub_name:
                sub_name = _get(pd, "SubChainName")
            p = p.getparent()
        stores.append({
            "chainId": parent_chain or _get(d, "ChainId", "ChainID"),
            "chainName": chain_name or _get(d, "ChainName"),
            "subChainName": _get(d, "SubChainName") or sub_name,
            "storeId": str(int(_num(sid))),
            "name": _get(d, "StoreName", "Store_Name"),
            "address": _get(d, "Address", "StoreAddress"),
            "city": _get(d, "City", "StoreCity"),
            "zip": _get(d, "ZipCode", "Zip"),
        })
    return stores


# ----------------------------------------------------------------- prices

UNIT_PATTERNS = [
    # (regex on unit text, base unit, multiplier to base)
    (r"^(ק\"?ג|קג|קילו|קילוגרם|קילוגרמים|kg)", "kg", 1.0),
    (r"^(גרם|גרמים|גר|ג'|ג|gr|g)", "kg", 0.001),
    (r"^(מ\"?ל|מל|מיליליטר|מיליליטרים|ml)", "l", 0.001),
    (r"^(ליטר|ליטרים|ל'|ל|lt|l)", "l", 1.0),
    (r"^(מטר|מטרים|מ'|m)", "m", 1.0),
    (r"^(יח|יחידה|יחידות|יח'|unit|units|ש\"?ב|זוג)", "u", 1.0),
]


def normalize_unit(unit_text: str, qty: float):
    t = (unit_text or "").strip().lower().replace("׳", "'").replace("״", '"')
    t = re.sub(r"^\d+(\.\d+)?\s*", "", t)
    for pat, base, mult in UNIT_PATTERNS:
        if re.match(pat, t):
            return base, qty * mult
    return None, qty


NAME_QTY = re.compile(
    r"(\d+(?:[.,]\d+)?)\s*(ק\"?ג|קג|קילו|גרם|גר'?|ג'|מ\"?ל|מל|ליטר|ל'|יח'?|יחידות)(?![א-ת])"
)
NAME_MULTI = re.compile(r"(\d+)\s*[x×*]\s*(\d+(?:[.,]\d+)?)\s*(גרם|גר'?|ג'|מ\"?ל|מל|ליטר|ל'|ק\"?ג)")


def qty_from_name(name: str):
    m = NAME_MULTI.search(name or "")
    if m:
        n = float(m.group(1))
        base, q = normalize_unit(m.group(3), _num(m.group(2)))
        if base:
            return base, n * q
    m = NAME_QTY.search(name or "")
    if m:
        base, q = normalize_unit(m.group(2), _num(m.group(1)))
        if base:
            return base, q
    return None, 0.0


def parse_prices(path: str) -> list[dict]:
    root = _root(path)
    if root is None:
        return []
    items = []
    for el in _iter_named(root, {"item", "product", "line"}):
        d = _children(el)
        code = _get(d, "ItemCode", "ItemId", "Barcode")
        price = _num(_get(d, "ItemPrice", "Price"), 0)
        if not code or price <= 0:
            continue
        name = _get(d, "ItemName", "ItemNm", "ManufacturerItemDescription", "ItemDesc")
        weighted = _get(d, "bIsWeighted", "BisWeighted", "IsWeighted") in ("1", "true", "True")
        qty_raw = _num(_get(d, "Quantity", "UnitQty_Num"), 0)
        unit_raw = _get(d, "UnitOfMeasure", "UnitMeasure", "UnitQty")
        base, q = normalize_unit(unit_raw, qty_raw) if qty_raw > 0 else (None, 0)
        if not base or q <= 0:
            nb, nq = qty_from_name(name)
            if nb:
                base, q = nb, nq
        if weighted:
            # price is per kg (or per unit) for weighted produce
            base, q = (base or "kg"), 1.0 if (base or "kg") == "kg" else q
        in_pkg = _num(_get(d, "QtyInPackage"), 0)
        items.append({
            "code": code.strip().lstrip("0") or code.strip(),
            "rawCode": code.strip(),
            "type": _get(d, "ItemType"),
            "name": re.sub(r"\s+", " ", name).strip(),
            "manuf": _get(d, "ManufacturerName", "ManufactureName"),
            "price": round(price, 2),
            "unit": base or "",
            "qty": round(q, 4) if q else 0,
            "inPkg": in_pkg,
            "weighted": weighted,
        })
    return items


# ----------------------------------------------------------------- promos

def _promo_from_children(d: dict, el) -> dict:
    codes, gifts = [], []
    for it in _iter_named(el, {"item"}):
        idd = _children(it)
        c = _get(idd, "ItemCode")
        if not c:
            continue
        c = c.strip().lstrip("0") or c.strip()
        if _get(idd, "IsGiftItem") == "1":
            gifts.append(c)
        else:
            codes.append(c)
    clubs = []
    for c in _iter_named(el, {"clubid"}):
        if c.text and c.text.strip():
            clubs.append(c.text.strip())
    if not clubs and _get(d, "ClubId", "ClubID"):
        clubs.append(_get(d, "ClubId", "ClubID"))
    restr = {}
    for r in _iter_named(el, {"additionalrestrictions"}):
        restr = _children(r)
    is_coupon = (_get(d, "AdditionalIsCoupon") or _get(restr, "AdditionalIsCoupon")) == "1"
    return {
        "id": _get(d, "PromotionId", "PromotionID"),
        "desc": re.sub(r"\s+", " ", _get(d, "PromotionDescription", "PromotionDesc")).strip(),
        "start": (_get(d, "PromotionStartDate") + " " + _get(d, "PromotionStartHour")).strip(),
        "end": (_get(d, "PromotionEndDate") + " " + _get(d, "PromotionEndHour")).strip(),
        "reward": _get(d, "RewardType"),
        "minQty": _num(_get(d, "MinQty"), 0),
        "maxQty": _num(_get(d, "MaxQty"), 0),
        "discRate": _num(_get(d, "DiscountRate"), 0),
        "discType": _get(d, "DiscountType"),
        "price": _num(_get(d, "DiscountedPrice"), 0),
        "pricePerUnit": _num(_get(d, "DiscountedPricePerMipuy"), 0),
        "minPurchase": _num(_get(d, "MinPurchaseAmnt", "MinPurchaseAmount"), 0),
        "clubs": clubs,
        "coupon": is_coupon,
        "codes": codes,
        "gifts": gifts,
    }


def parse_promos(path: str) -> list[dict]:
    root = _root(path)
    if root is None:
        return []
    promos = []
    for el in _iter_named(root, {"promotion"}):
        d = _children(el)
        p = _promo_from_children(d, el)
        if p["id"]:
            promos.append(p)
    if promos:
        return promos
    # Flat "Sale" format: one row per (promotion, item)
    grouped: dict[str, dict] = {}
    for el in _iter_named(root, {"sale"}):
        d = _children(el)
        pid = _get(d, "PromotionId", "PromotionID")
        if not pid:
            continue
        if pid not in grouped:
            p = _promo_from_children(d, el)
            p["codes"] = []
            grouped[pid] = p
        c = _get(d, "ItemCode")
        if c:
            grouped[pid]["codes"].append(c.strip().lstrip("0") or c.strip())
    return list(grouped.values())


def effective_unit_price(promo: dict, base_price: float):
    """Price per single item when buying the promo quantity. None if unknown."""
    if base_price <= 0:
        return None
    min_qty = promo["minQty"] if promo["minQty"] and promo["minQty"] > 0 else 1
    ppu = promo["pricePerUnit"]
    if ppu and 0 < ppu < base_price * 1.5:
        return round(ppu, 2)
    price = promo["price"]
    rate = promo["discRate"]
    if price and price > 0:
        if min_qty > 1 and price > base_price * 1.05:
            return round(price / min_qty, 2)
        if price < base_price * 1.5:
            return round(price, 2)
    if rate and rate > 0:
        r = rate
        if r > 100:
            r = r / 100.0
        if r >= 100:
            return None
        # DiscountType 1 = percentage on base price in most chains
        return round(base_price * (1 - r / 100.0), 2)
    return None
