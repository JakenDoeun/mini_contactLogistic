import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestDb } from '../db/test-db.ts';
import { confirmSim, routeFor, scanSims, simState } from './sims.ts';
import { GatewayError, writeGatewayConfig, type SimCard, type SmsGate } from './smsgate.ts';

async function phoneWith(t: test.TestContext, cards: SimCard[] | 'away') {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  writeGatewayConfig(dir, { url: 'http://phone:8080', username: 'sms', password: 'secret' });
  const state = { cards };
  const make = () =>
    ({
      async sims() {
        if (state.cards === 'away') throw new GatewayError('unreachable', 'away');
        return state.cards;
      },
    }) as unknown as SmsGate;
  return { db, dir, make, state };
}

test("a SIM's carrier is suggested from its name, else from its own number, and used only once confirmed", async (t) => {
  const { db, dir, make } = await phoneWith(t, [
    { simNumber: 1, carrierName: null, phoneNumber: '+85596 123 4567' },
    { simNumber: 2, carrierName: 'Viettel', phoneNumber: null },
  ]);
  const s = await scanSims(db, dir, make);
  assert.deepEqual(s.sims.map((x) => [x.suggested, x.carrier]), [['smart', null], [null, null]]);
  assert.equal(confirmSim(db, null, { simNumber: 2, carrier: 'metfone', ownNumber: '097 123 4567' }).ok, true);
  const after = simState(db);
  assert.deepEqual(after.sims[1], { simNumber: 2, carrierName: 'Viettel', phoneNumber: '0971234567', suggested: null, carrier: 'metfone' });
  assert.equal(routeFor(after)('097 880 1123'), 2);
  assert.equal(routeFor(after)('096 123 456'), null, 'SIM 1 is not confirmed yet');
});

test('a confirmation is refused for a SIM not in the phone, an unknown carrier or a wrong own number; the audit has no number', async (t) => {
  const { db, dir, make } = await phoneWith(t, [{ simNumber: 1, carrierName: 'Cellcard', phoneNumber: null }]);
  await scanSims(db, dir, make);
  assert.equal(confirmSim(db, null, { simNumber: 2, carrier: 'smart' }).ok, false);
  assert.equal(confirmSim(db, null, { simNumber: 1, carrier: 'mobitel' }).ok, false);
  assert.equal(confirmSim(db, null, { simNumber: 1, carrier: 'cellcard', ownNumber: '123' }).ok, false);
  assert.equal(confirmSim(db, null, { simNumber: 1, carrier: 'cellcard', ownNumber: '012 999 888' }).ok, true);
  const audit = db.prepare(`SELECT detail FROM audit_log WHERE action = 'gateway.sim_confirmed'`).pluck().all() as string[];
  assert.equal(audit.length, 1);
  assert.doesNotMatch(audit[0], /999/);
});

test('when the phone cannot be asked, the last scan stands and the problem is said', async (t) => {
  const { db, dir, make, state } = await phoneWith(t, [{ simNumber: 1, carrierName: 'Cellcard', phoneNumber: null }]);
  await scanSims(db, dir, make);
  state.cards = 'away';
  const s = await scanSims(db, dir, make);
  assert.equal(s.problemKind, 'unreachable');
  assert.equal(s.sims.length, 1);
});
