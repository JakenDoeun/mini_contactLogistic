import test from 'node:test';
import assert from 'node:assert/strict';
import { carrierFromName, carrierOf, splitBySim } from './carriers.ts';

test('every TRC prefix maps to its carrier, in any number format', () => {
  const expected = {
    cellcard: ['011', '012', '014', '017', '061', '076', '077', '078', '085', '089', '092', '095', '099'],
    smart: ['010', '015', '016', '069', '070', '081', '086', '087', '093', '096', '098'],
    metfone: ['031', '060', '066', '067', '068', '071', '088', '090', '097'],
    seatel: ['018'],
  };
  for (const [carrier, prefixes] of Object.entries(expected)) for (const p of prefixes) assert.equal(carrierOf(`${p}345678`), carrier, p);
  for (const n of ['012-345-678', '+855 12 345 678', '12345678', '855 12 345 678']) assert.equal(carrierOf(n), 'cellcard', n);
  assert.equal(carrierOf('097 123 4567'), 'metfone'); // a 10-digit number
});

test('an unknown prefix or an invalid number has no carrier', () => {
  for (const n of ['013 345 678', '019 345 678', '023 456 789', '012', '', 'abc']) assert.equal(carrierOf(n), null, n);
});

test("a SIM's carrier name is matched in any capitals, inside longer names", () => {
  assert.equal(carrierFromName('CELLCARD'), 'cellcard');
  assert.equal(carrierFromName('Smart 4G'), 'smart');
  assert.equal(carrierFromName('KH Metfone'), 'metfone');
  assert.equal(carrierFromName('Viettel'), null);
  assert.equal(carrierFromName(null), null);
});

test('customers split into automatic (their carrier has a confirmed SIM) and by hand, with no fallback SIM', () => {
  const sims = [
    { simNumber: 1, carrierName: 'Cellcard', phoneNumber: null, suggested: 'cellcard' as const, carrier: 'cellcard' as const },
    { simNumber: 2, carrierName: 'SMART', phoneNumber: null, suggested: 'smart' as const, carrier: null },
  ];
  const { auto, byHand } = splitBySim([{ phone: '012 345 678' }, { phone: '010 345 678' }, { phone: '097 123 4567' }, { phone: '019 345 678' }], sims);
  assert.deepEqual(auto.map((i) => [i.phone, i.sim]), [['012 345 678', 1]]);
  assert.deepEqual(byHand.map((i) => i.carrier), ['smart', 'metfone', null], 'an unconfirmed SIM sends nothing');
});
