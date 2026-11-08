"""Debug helper: list the price files a chain publishes (no store filter)."""
import glob, os, sys, tempfile, datetime as dt
sys.path.insert(0, os.path.dirname(__file__))
from il_supermarket_scarper.scrapper_runner import scrape_one_wrap
from il_supermarket_scarper.utils.databases import create_file_output_for_scraper, create_status_database_for_scraper

chain = sys.argv[1]
store = int(sys.argv[2]) if len(sys.argv) > 2 and sys.argv[2] else None
for days in (0, 1, 2):
    when = (dt.datetime.now() - dt.timedelta(days=days)).replace(hour=0, minute=0, second=0, microsecond=0)
    out = tempfile.mkdtemp()
    kw = dict(limit=None, single_pass=True, files_types=["PRICE_FULL_FILE"], store_id=store, when_date=when,
              file_output=create_file_output_for_scraper(chain, {"output_mode": "disk", "base_storage_path": out}),
              status_database=create_status_database_for_scraper(chain, {"database_type": "json", "base_path": out + "/_s"}),
              timeout_in_seconds=60)
    scrape_one_wrap(chain, kw)
    fs = sorted(os.path.basename(p) for p in glob.glob(out + "/**/*", recursive=True) if os.path.isfile(p) and "_s" not in p)
    print(f"--- {when.date()} store={store}: {len(fs)} files")
    for f in fs:
        print("   ", f)
