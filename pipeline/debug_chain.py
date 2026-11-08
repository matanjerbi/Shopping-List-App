"""Debug helper: print every store of a chain and the FTP listing of a Cerberus chain."""
import ftplib, os, sys, tempfile
sys.path.insert(0, os.path.dirname(__file__))
import run
from xmlparse import parse_stores

chain, ftp_user = sys.argv[1], (sys.argv[2] if len(sys.argv) > 2 else "")
wd = tempfile.mkdtemp()
files = run._download(chain, ["STORE_FILE"], workdir=wd)
f = run._latest_by_type(files, "store")
print("stores file:", f)
for s in parse_stores(f) if f else []:
    print(f"  {s['storeId']:>4} | {s['name']} | {s['address']} | city={s['city']!r} | sub={s['subChainName']}")
if ftp_user:
    ftp = ftplib.FTP("url.retail.publishedprices.co.il", timeout=60)
    ftp.login(ftp_user, "")
    names = ftp.nlst()
    print("ftp files:", len(names))
    for n in sorted(names):
        if n.lower().startswith(("pricefull", "promofull")) and "202611" in n:
            print("  ", n)
