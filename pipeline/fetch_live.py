"""Download the currently published data from the live site (GitHub Pages).

Used to (a) redeploy the web app without re-running the whole pipeline, and
(b) carry over stores of chains that failed in today's pipeline run.

usage: python fetch_live.py <site base url> <out dir>
"""
import json
import os
import sys
from concurrent.futures import ThreadPoolExecutor

import requests


def main():
    base, out = sys.argv[1].rstrip("/") + "/data", sys.argv[2]
    os.makedirs(os.path.join(out, "s"), exist_ok=True)
    os.makedirs(os.path.join(out, "stats"), exist_ok=True)
    s = requests.Session()
    r = s.get(f"{base}/stores.json", timeout=60)
    if r.status_code != 200:
        print(f"no live data at {base} ({r.status_code})")
        return 2
    index = r.json()
    with open(os.path.join(out, "stores.json"), "w", encoding="utf-8") as f:
        json.dump(index, f, ensure_ascii=False)
    files = ["categories.json", "status.json"]
    files += [f"s/{st['k']}.json" for st in index.get("stores", [])]
    files += [f"stats/{c}.json" for c in sorted({st["chainId"] for st in index.get("stores", [])})]

    def get(rel):
        try:
            rr = s.get(f"{base}/{rel}", timeout=120)
            if rr.status_code == 200:
                with open(os.path.join(out, rel), "wb") as f:
                    f.write(rr.content)
                return True
        except requests.RequestException:
            pass
        return False

    with ThreadPoolExecutor(12) as ex:
        ok = sum(ex.map(get, files))
    print(f"fetched {ok}/{len(files)} files from live site")
    return 0


if __name__ == "__main__":
    sys.exit(main())
