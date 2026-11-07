"""Builds a small fake data set (for local UI testing only)."""
import json, os, random, sys
sys.path.insert(0, "pipeline")
from categorize import categorize, LABELS
out = sys.argv[1]
random.seed(4)
os.makedirs(f"{out}/s", exist_ok=True); os.makedirs(f"{out}/stats", exist_ok=True)
products = [
 ("7290000066318","מרכך כביסה בדין 4 ליטר","סנו",32.9,"l",4),("7290011194246","סוד מרכך כביסה מרוכז 3 ליטר","שטראוס",24.9,"l",3),
 ("7290000000555","מרכך כביסה שופרסל 4 ליטר","שופרסל",19.9,"l",4),("7290004131074","חלב 3% בקרטון 1 ליטר","תנובה",7.12,"l",1),
 ("7290004131081","חלב 1% בקרטון 1 ליטר","תנובה",7.12,"l",1),("7290000000123","במבה 80 גרם","אסם",5.9,"kg",0.08),
 ("7290000000200","קוטג' 5% 250 גרם","תנובה",6.29,"kg",0.25),("7290000000201","קוטג' 5% 250 גרם","טרה",5.9,"kg",0.25),
 ("7290000000300","נייר טואלט לילי 32 גלילים","חוגלה",54.9,"u",32),("7290000000301","נייר טואלט סנו 30 גלילים","סנו",45.9,"u",30),
 ("7290000000400","ג'ל כביסה אריאל 3 ליטר","P&G",49.9,"l",3),("7290000000401","נוזל כביסה סנו מקסימה 3 ליטר","סנו",34.9,"l",3),
 ("7290000000500","פסטה ספגטי 500 גרם","אסם",5.5,"kg",0.5),("7290000000501","ספגטי ברילה 500 גרם","ברילה",7.9,"kg",0.5),
 ("7290000000600","ביצים L תבנית 12","תנובה",13.4,"u",12),("7290000000700","קפה נמס עלית 200 גרם","עלית",29.9,"kg",0.2),
 ("7290000000800","שמן קנולה 1 ליטר","שמן",11.9,"l",1),("7290000000900","טונה בשמן 4 יח'","סטרקיסט",24.9,"u",4),
]
stores = [("7290058140886","רמי לוי","35","רמי לוי בני ברק","ז'בוטינסקי 2","בני ברק"),
          ("7290027600007","שופרסל","58","דיל רמת גן ביאליק","ביאליק 76","רמת גן"),
          ("7290103152017","אושר עד","12","אושר עד רמת גן","הרואה 10","רמת גן")]
index=[]
for cid,cname,sid,name,addr,city in stores:
    items=[];ip={};promos=[]
    for code,n,m,p,u,q in products:
        pr=round(p*random.uniform(0.85,1.15),2)
        items.append([code,n,m,pr,u,q,categorize(n),0])
    for code in random.sample([x[0] for x in products],6):
        base=[i for i in items if i[0]==code][0][3]
        mq=random.choice([1,2,3]); eff=round(base*random.uniform(0.55,0.8),2)
        promos.append([f"{'%d ב-%.0f'%(mq,eff*mq) if mq>1 else 'מבצע %.2f'%eff}","2026-11-01 00:00","2026-11-30 23:59",mq,random.choice([[],[],["1"]]),0,1])
        ip[code]=[[len(promos)-1,eff]]
    k=f"{cid}-{sid}"
    json.dump({"k":k,"chainId":cid,"u":"2026-11-07 06:00","items":items,"promos":promos,"ip":ip},open(f"{out}/s/{k}.json","w"),ensure_ascii=False)
    json.dump({c[0]:[round(c[3]*0.98,2),round(c[3]*0.9,2),round(c[3]*1.1,2),20,0,60] for c in items},open(f"{out}/stats/{cid}.json","w"))
    index.append({"k":k,"chainId":cid,"chain":"X","chainName":cname,"sub":"","storeId":sid,"name":name,"address":addr,"city":city,"items":len(items),"promos":len(promos),"u":"2026-11-07 06:00"})
json.dump({"u":"2026-11-07 06:00","cities":["רמת גן","בני ברק"],"stores":index},open(f"{out}/stores.json","w"),ensure_ascii=False)
json.dump(LABELS,open(f"{out}/categories.json","w"),ensure_ascii=False)
json.dump({"u":"x","chains":[{"chain":"RAMI_LEVY","ok":True,"stores":1,"error":"","seconds":3}]},open(f"{out}/status.json","w"))
