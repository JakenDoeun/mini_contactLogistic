"""Writes a mock courier export for one arrival day: the same template as the real Scan_record.xls (26 headers in the
same order, text cells, an .xlsx saved under an .xls name), with made-up customers on every carrier (Phase 12).

    python3 test/fixtures/make-sample-day.py                      # today (Phnom Penh), ./new-Scan_record.xls
    python3 test/fixtures/make-sample-day.py --date 2026-10-24 --out /path/new-Scan_record.xls

WARNING: the phone numbers are made up (the digits after the prefix start with 000), but a made-up number can still
belong to someone. Use this file only with the emulator or a stand-in gateway phone, or never press Notify for it.
Before real use, discard its import or restore a backup taken before it.

About 114 rows, like the real export: Shopee SHPE parcels with repeat scans, other outlets that are not imported, two
"Whole package" split rows; customers on Cellcard, Smart, Metfone and Seatel, two on unknown prefixes, one with no
number and one with a broken number; some customers with two or three parcels (one combined SMS each).
"""
import argparse, datetime, importlib.util, random, sys

sys.dont_write_bytecode = True  # importing make-scan-record.py must not leave a __pycache__ in the repo
from pathlib import Path

spec = importlib.util.spec_from_file_location('scan', Path(__file__).with_name('make-scan-record.py'))
scan = importlib.util.module_from_spec(spec)
spec.loader.exec_module(scan)

# The TRC prefixes (src/lib/carriers.ts); the 10-digit ones carry 7 digits after the prefix.
PREFIXES = {
    'cellcard': ['011', '012', '014', '017', '061', '076', '077', '078', '085', '089', '092', '095', '099'],
    'smart': ['010', '015', '016', '069', '070', '081', '086', '087', '093', '096', '098'],
    'metfone': ['031', '060', '066', '067', '068', '071', '088', '090', '097'],
    'seatel': ['018'],
    'unknown': ['013', '019'],
}
LONG = {'076', '096', '031', '071', '088', '097', '018'}
# Customers per carrier, close to a branch's mix; parcels per customer are drawn below.
MIX = [('cellcard', 12), ('smart', 9), ('metfone', 7), ('seatel', 1), ('unknown', 2)]
OTHER_OUTLETS = ['Taobao ZTO PP transit warehouse', 'ZTO Guangzhou International Warehouse', 'Siem Reap Province SRP-01', 'Other Outlet']


def phone_as_exported(local, rnd):
    """Mostly 855 without the 0, sometimes with the 0, a few in other shapes, as in the real export."""
    r = rnd.random()
    if r < 0.85:
        return '855' + local[1:]
    if r < 0.93:
        return local
    return rnd.choice(['+855-' + local[1:], '855-' + local])


def main():
    phnom_penh = datetime.timezone(datetime.timedelta(hours=7))
    ap = argparse.ArgumentParser(description='Mock courier export for one arrival day (made-up customers).')
    ap.add_argument('--date', default=datetime.datetime.now(phnom_penh).date().isoformat(), help='arrival day, YYYY-MM-DD (default: today in Phnom Penh)')
    ap.add_argument('--out', default='new-Scan_record.xls', help='file to write (default: ./new-Scan_record.xls)')
    a = ap.parse_args()
    day = datetime.date.fromisoformat(a.date)
    rnd = random.Random(day.isoformat())  # the same day gives the same file
    stamp = day.strftime('%y%m%d')
    seq = iter(range(1, 10_000))
    code = lambda: f'9{stamp}{next(seq):07d}'  # 14 digits like the real codes, unique per day
    at = lambda h, m, s: f'{day.isoformat()} {h:02d}:{m:02d}:{s:02d}'

    customers = []
    n = 0
    for carrier, count in MIX:
        for _ in range(count):
            n += 1
            prefix = rnd.choice(PREFIXES[carrier])
            local = prefix + '000' + f'{n:0{4 if prefix in LONG else 3}d}'
            customers.append((f'Mock Customer {n:02d}', phone_as_exported(local, rnd)))
    customers.append(('Mock Customer No Number', ''))
    customers.append(('Mock Customer Broken Number', '85512'))

    rows = []
    for name, phone in customers:
        for _ in range(rnd.choices([1, 2, 3], weights=[70, 22, 8])[0]):
            c = code()
            h, m = rnd.randint(8, 10), rnd.randint(0, 59)
            rows.append((c, 'Delivery', at(h, m, rnd.randint(0, 59)), 'Shopee SHPE', name, phone))
            if rnd.random() < 0.6:  # an earlier "arrived" scan of the same parcel: collapsed to one parcel on import
                rows.append((c, 'arrived', at(7, rnd.randint(0, 59), rnd.randint(0, 59)), 'Shopee SHPE', name, phone))
    while len(rows) < 112:  # other outlets: listed in the file, never imported
        o = len(rows)
        rows.append((code(), 'Delivery', at(9, o % 60, 0), OTHER_OUTLETS[o % len(OTHER_OUTLETS)], f'Mock Other {o:03d}', '855' + '12000' + f'{o:03d}'[-3:]))
    rows.append((f'X{stamp}01', 'Whole package to piece scanning', at(8, 30, 0), '', '', ''))
    rows.append((f'X{stamp}02', 'Whole package to piece scanning', at(8, 31, 0), '', '', ''))
    rows.sort(key=lambda r: r[2])

    grid = []
    for r in rows:
        rec = scan.record(*r)
        rec['Upload Time'] = at(11, 30, 0)
        grid.append([rec[h] for h in scan.HEADERS])
    out = Path(a.out)
    out.write_bytes(scan.xlsx_bytes(scan.HEADERS, grid))
    shopee = sum(1 for r in rows if r[3] == 'Shopee SHPE')
    print(f'{out}: {len(rows)} rows for {day}, {shopee} Shopee SHPE rows, {len(customers)} made-up customers')


if __name__ == '__main__':
    main()
