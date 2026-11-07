import os, sys, datetime as dt
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))
from xmlparse import parse_stores, parse_prices, parse_promos
from categorize import categorize
from run import store_in_area, build_store_json

F = os.path.join(os.path.dirname(__file__), "fixtures")

def test_all():
    s1 = parse_stores(os.path.join(F, "Stores7290027600007-000-202611070200.xml"))
    assert len(s1) == 2 and s1[0]["storeId"] == "58" and s1[0]["chainName"] == "שופרסל", s1
    cities = ["רמת גן", "גבעתיים", "בני ברק"]
    assert store_in_area(s1[0], cities) and not store_in_area(s1[1], cities)
    s2 = parse_stores(os.path.join(F, "Stores7290058140886-000.xml"))
    assert s2[0]["chainId"] == "7290058140886" and s2[0]["storeId"] == "35" and s2[0]["chainName"] == "רמי לוי", s2
    assert store_in_area(s2[0], cities) and not store_in_area(s2[1], cities)
    items = parse_prices(os.path.join(F, "PriceFull7290058140886-035-202611070300.xml"))
    by = {i["code"]: i for i in items}
    assert by["7290000066318"]["unit"] == "l" and by["7290000066318"]["qty"] == 4
    assert by["7290004131074"]["unit"] == "l" and by["7290004131074"]["qty"] == 1
    assert by["7290000000123"]["unit"] == "kg" and abs(by["7290000000123"]["qty"] - 0.08) < 1e-9, by["7290000000123"]
    assert by["1234"]["weighted"]
    promos = parse_promos(os.path.join(F, "PromoFull7290058140886-035-202611070300.xml"))
    assert len(promos) == 3
    assert categorize("מרכך כביסה בדין 4 ליטר") == "softener"
    assert categorize("סוד מרכך כביסה מרוכז 3 ל'") == "softener"
    assert categorize("מרכך שיער פינוק") == "conditioner"
    assert categorize("חלב 3% בקרטון 1 ליטר") == "milk"
    assert categorize("שוקו בקרטון") == "choco_milk"
    assert categorize("במבה 80 גרם") == "salty_snacks"
    s = dict(s2[0]); s["items"] = items; s["promos"] = promos
    sj = build_store_json(s, dt.datetime(2026, 11, 7))
    assert sj["k"] == "7290058140886-35"
    assert sj["ip"]["7290011194246"][0][1] == 12.5
    assert abs(sj["ip"]["7290000000123"][0][1] - 4.0) < 1e-9
    assert "7290004131074" not in sj["ip"]   # expired promo dropped
    assert sj["promos"][1][4] == ["1"]      # club promo
    print("ok")

if __name__ == "__main__":
    test_all()
