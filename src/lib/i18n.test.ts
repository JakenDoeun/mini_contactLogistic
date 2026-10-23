import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { format, placeholders } from './i18n.ts';

const catalog = (locale: string) => JSON.parse(fs.readFileSync(path.join(import.meta.dirname, '..', 'locales', `${locale}.json`), 'utf8')) as Record<string, string>;

test('messages fill their placeholders and plurals', () => {
  assert.equal(format('Hi {name}', { name: 'Dara' }), 'Hi Dara');
  const m = '{count, plural, one {# parcel} other {# parcels}} for {phone}';
  assert.equal(format(m, { count: 1, phone: '012' }), '1 parcel for 012');
  assert.equal(format(m, { count: 3, phone: '012' }), '3 parcels for 012');
  assert.equal(format('{count, plural, other {កញ្ចប់ #}}', { count: 3 }, 'km'), 'កញ្ចប់ 3');
  assert.equal(format('{count, plural, =0 {none} other {#}}', { count: 0 }), 'none');
  assert.equal(format('Hi {name}'), 'Hi {name}', 'a missing value shows the gap instead of hiding it');
  assert.deepEqual(placeholders(m), ['count', 'phone']);
});

test('km.json has exactly the keys of en.json, each with the same placeholders (empty means not translated yet)', () => {
  const en = catalog('en');
  const km = catalog('km');
  assert.deepEqual(Object.keys(km).sort(), Object.keys(en).sort(), 'add or remove keys in km.json to match en.json');
  for (const [key, text] of Object.entries(km)) {
    if (text === '') continue;
    assert.deepEqual(placeholders(text), placeholders(en[key]), `${key}: keep the {placeholders} exactly as in en.json`);
  }
});

test('every plural in the catalogues is one the formatter can read', () => {
  // An option text holding another {placeholder} would not parse and would show raw on screen.
  for (const locale of ['en', 'km']) {
    for (const [key, text] of Object.entries(catalog(locale))) {
      const plurals = text.split(', plural,').length - 1;
      const filled = format(text, Object.fromEntries(placeholders(text).map((n) => [n, 2])), locale as 'en' | 'km');
      assert.ok(!plurals || !filled.includes(', plural,'), `${locale} ${key}`);
    }
  }
});
