"""Writes the synthetic Scan_record fixtures (all names, phones and codes are fake).

Mirrors the real company export: 26 headers in the same order, text cells, an .xlsx saved under an .xls name.
Run: python3 test/fixtures/make-scan-record.py
Legacy .xls copy (scan-record-mixed-biff.xls) was made from the .xlsx with
  soffice --headless --convert-to xls:"MS Excel 97" scan-record-mixed.xlsx   (round-trip to CSV: identical)
"""
import csv, io, zipfile
from pathlib import Path
from xml.sax.saxutils import escape

HEADERS = ['scan order number', 'Data Source', 'scanTypeDesc', 'scan time', 'scan person', 'scan site',
           'Up/Next Site', 'Receiver/Dispatch Member', 'Upload Time', 'Send Outlet', 'Destination Outlet',
           'number of pieces', 'weight', 'netWeight', 'payment on arrival', 'collected payment', 'item type',
           'consignee name', 'consignee mobile', 'consignee address', ' Remarks', 'signMan', 'isRefundDesc',
           'problemReason', 'customerCodeDesc', 'customerCode']
NUMERIC = {'number of pieces', 'weight', 'netWeight', 'payment on arrival', 'collected payment'}
NBSP = ' '

# (code, scan type, time, Send Outlet, name, phone)
ROWS = [
    ('10000000000001', 'Delivery', '08:01:10', 'Shopee SHPE', 'Test Customer A', '855123456701'),
    ('10000000000001', 'arrived', '07:15:00', 'Shopee SHPE', 'Test Customer A', '855123456701'),  # repeat in file
    ('10000000000002', 'Delivery', '08:02:20', ' shopee shpe ', 'Test Customer B', '85512345670'),
    ('10000000000003', 'Delivery', '08:03:30', 'SHOPEE SHPE', 'Test Customer C', '855-0123456703'),
    ('10000000000004', 'Delivery', '08:04:40', NBSP + 'Shopee SHPE' + NBSP, 'Test Customer D', '+855-12345670'),
    ('10000000000005', 'Delivery', '08:05:50', 'Shopee SHPE', 'Test Customer E', '012345670'),
    ('10000000000006', 'Delivery', '08:06:00', 'Taobao ZTO PP transit warehouse', 'Test Customer F', '855123456706'),
    ('10000000000007', 'Delivery', '08:07:00', 'ZTO Guangzhou International Warehouse', 'Test Customer G', '855123456707'),
    ('10000000000008', 'Delivery', '08:08:00', 'Siem Reap Province SRP-01', 'Test Customer H', '855123456708'),
    ('X000000001', 'Whole package to piece scanning', '08:09:00', '', '', ''),  # blank outlet, split row
    ('10000000000009', 'Delivery', '08:10:00', 'Shopee', 'Test Customer J', '855123456709'),
    ('10000000000010', 'Delivery', '08:11:00', 'Shopee SHPE Extra', 'Test Customer K', '855123456710'),
    ('10000000000011', 'Delivery', '08:12:00', 'Shopee  SHPE', 'Test Customer L', '855123456711'),
    ('10000000000012', 'Delivery', '08:13:00', 'Other Outlet', 'Test Customer M', '855123456712'),
    ('10000000000002', 'Delivery', '08:14:00', 'Taobao ZTO PP transit warehouse', 'Test Customer N', '855123456713'),  # non-Shopee, shares a Shopee code
]


def record(code, scan_type, time, outlet, name, phone):
    split = scan_type.startswith('Whole')
    r = dict.fromkeys(HEADERS, '')
    r.update({'scan order number': code, 'Data Source': 'Test-Device', 'scanTypeDesc': scan_type,
              'scan time': f'2026-10-10 {time}', 'scan person': 'Test Staff', 'scan site': 'Test Branch TB-01',
              'Receiver/Dispatch Member': 'Test Staff', 'Upload Time': f'2026-10-10 {time}',
              'number of pieces': '' if split else '1', 'weight': '0.5'})
    if not split:
        r.update({'Up/Next Site': 'Test Hub', 'Send Outlet': outlet, 'Destination Outlet': 'Test Branch TB-01',
                  'netWeight': '0.5', 'payment on arrival': '0', 'collected payment': '0', 'item type': 'Parcel',
                  'consignee name': name, 'consignee mobile': phone, 'consignee address': 'Test Street 1',
                  'customerCodeDesc': outlet, 'customerCode': 'TEST01'})
    return r


def col(i):
    return chr(ord('A') + i)  # 26 columns, A-Z


def xlsx_bytes(records):
    strings, index = [], {}
    def sid(s):
        if s not in index:
            index[s] = len(strings); strings.append(s)
        return index[s]
    rows_xml = []
    for n, row in enumerate([dict(zip(HEADERS, HEADERS))] + records, start=1):
        cells = []
        for i, h in enumerate(HEADERS):
            v = row[h]
            if v == '':
                continue
            ref = f'{col(i)}{n}'
            if n > 1 and h in NUMERIC:
                cells.append(f'<c r="{ref}"><v>{v}</v></c>')
            else:
                cells.append(f'<c r="{ref}" t="s" s="1"><v>{sid(v)}</v></c>')
        rows_xml.append(f'<row r="{n}">{"".join(cells)}</row>')
    ns = 'xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"'
    rel = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships'
    sst = ''.join(f'<si><t xml:space="preserve">{escape(s)}</t></si>' for s in strings)
    files = {
        '[Content_Types].xml': '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
            '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
            '<Default Extension="xml" ContentType="application/xml"/>'
            '<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>'
            '<Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>'
            '<Override PartName="/xl/sharedStrings.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sharedStrings+xml"/>'
            '<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/></Types>',
        '_rels/.rels': f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{rel}/officeDocument" Target="xl/workbook.xml"/></Relationships>',
        'xl/workbook.xml': f'<?xml version="1.0" encoding="UTF-8"?><workbook {ns} xmlns:r="{rel}"><sheets><sheet name="Sheet1" sheetId="1" r:id="rId1"/></sheets></workbook>',
        'xl/_rels/workbook.xml.rels': f'<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
            f'<Relationship Id="rId1" Type="{rel}/worksheet" Target="worksheets/sheet1.xml"/>'
            f'<Relationship Id="rId2" Type="{rel}/sharedStrings" Target="sharedStrings.xml"/>'
            f'<Relationship Id="rId3" Type="{rel}/styles" Target="styles.xml"/></Relationships>',
        # style 1 = number format 49 (text), as in the real export
        'xl/styles.xml': f'<?xml version="1.0" encoding="UTF-8"?><styleSheet {ns}><fonts count="1"><font/></fonts><fills count="1"><fill/></fills>'
            '<borders count="1"><border/></borders><cellStyleXfs count="1"><xf/></cellStyleXfs>'
            '<cellXfs count="2"><xf/><xf numFmtId="49" applyNumberFormat="1"/></cellXfs></styleSheet>',
        'xl/sharedStrings.xml': f'<?xml version="1.0" encoding="UTF-8"?><sst {ns} count="{len(strings)}" uniqueCount="{len(strings)}">{sst}</sst>',
        'xl/worksheets/sheet1.xml': f'<?xml version="1.0" encoding="UTF-8"?><worksheet {ns}><sheetData>{"".join(rows_xml)}</sheetData></worksheet>',
    }
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, 'w', zipfile.ZIP_DEFLATED) as z:
        for name, text in files.items():
            z.writestr(zipfile.ZipInfo(name, (2026, 10, 10, 0, 0, 0)), text)  # fixed time: same bytes every run
    return buf.getvalue()


if __name__ == '__main__':
    out = Path(__file__).parent
    records = [record(*r) for r in ROWS]
    with open(out / 'scan-record-mixed.csv', 'w', newline='', encoding='utf-8') as f:
        w = csv.DictWriter(f, HEADERS); w.writeheader(); w.writerows(records)
    data = xlsx_bytes(records)
    (out / 'scan-record-mixed.xlsx').write_bytes(data)
    (out / 'scan-record-mixed-xlsx-named.xls').write_bytes(data)  # like the real export: XLSX content, .xls name

    # Self-check against the rule in docs/import-rules.md
    eligible = [r for r in records if r['Send Outlet'].strip(' \t' + NBSP).lower() == 'shopee shpe']
    codes = [r['scan order number'] for r in eligible]
    assert (len(records), len(eligible), len(records) - len(eligible), len(set(codes))) == (15, 6, 9, 5)
    print('15 rows: 6 Shopee SHPE, 9 excluded, 5 unique Shopee codes (1 repeated in file)')
