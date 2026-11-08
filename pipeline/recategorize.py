"""Re-apply the current category rules to already published store files (no re-download).

usage: python recategorize.py <data dir>
Prints a summary per category with sample product names, for checking the rules.
"""
import glob, json, os, random, sys
from collections import Counter, defaultdict
sys.path.insert(0, os.path.dirname(__file__))
from categorize import categorize, LABELS

d = sys.argv[1]
names = {}
for f in glob.glob(os.path.join(d, "s", "*.json")):
    with open(f, encoding="utf-8") as fh:
        sj = json.load(fh)
    changed = False
    for it in sj.get("items", []):
        c = categorize(it[1])
        names[it[0]] = (it[1], c)
        if it[6] != c:
            it[6] = c
            changed = True
    if changed:
        with open(f, "w", encoding="utf-8") as fh:
            json.dump(sj, fh, ensure_ascii=False, separators=(",", ":"))
with open(os.path.join(d, "categories.json"), "w", encoding="utf-8") as fh:
    json.dump(LABELS, fh, ensure_ascii=False)

by = defaultdict(list)
for code, (n, c) in names.items():
    by[c].append(n)
cnt = Counter({c: len(v) for c, v in by.items()})
print(f"recategorized {len(names)} distinct products, {len(by.get('', []))} without category")
random.seed(1)
for c, k in sorted(cnt.items(), key=lambda x: -x[1]):
    sample = random.sample(by[c], min(12, len(by[c])))
    print(f"== {c or '(none)'} [{k}]: " + " | ".join(sample))
