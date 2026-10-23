import test from 'node:test';
import assert from 'node:assert/strict';
import { createUser } from '../auth/accounts.ts';
import { createTestDb } from '../db/test-db.ts';
import { DEFAULT_SMS_GAP, DEFAULT_TEMPLATES } from '../../lib/parcel-logic.ts';
import { duplicateRule, importColumns } from '../importer/store.ts';
import { appSettings, saveAppSettings, smsGap } from './app-settings.ts';

async function users(t: test.TestContext) {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  const admin = await createUser(db, 'admin', 'correct horse battery', 'cli'); // the first account is the admin
  const staff = await createUser(db, 'staff', 'correct horse battery', 'cli');
  assert.ok(admin.ok && staff.ok);
  return { db, admin: admin.userId, staff: staff.userId };
}

test("the shared settings start from the importer's own defaults", async (t) => {
  const { db } = await users(t);
  assert.deepEqual(appSettings(db), { trackingColumn: 'scan order number', phoneColumn: 'consignee mobile', duplicateFile: 'warn', templates: DEFAULT_TEMPLATES, smsGap: DEFAULT_SMS_GAP });
});

test('the admin saves them for everyone, and the importer uses the saved columns and rule', async (t) => {
  const { db, admin } = await users(t);
  const r = saveAppSettings(db, admin, { trackingColumn: ' Tracking No ', duplicateFile: 'block', templates: { single: 'Hi {name}: {codes}', combined: 'Hi {name}, {count}: {codes}' } });
  assert.ok(r.ok);
  assert.equal(importColumns(db).tracking, 'Tracking No');
  assert.equal(importColumns(db).phone, 'consignee mobile'); // untouched fields keep their values
  assert.equal(importColumns(db).name, 'consignee name');
  assert.equal(duplicateRule(db), 'block');
  assert.equal(appSettings(db).templates.single, 'Hi {name}: {codes}');
  const audit = db.prepare(`SELECT detail FROM audit_log WHERE action = 'settings.changed'`).get() as { detail: string };
  assert.deepEqual(JSON.parse(audit.detail), { settings_keys: ['import.columns', 'import.duplicate_file', 'sms.templates'] }); // keys, never values
});

test('staff cannot change them, and a bad field saves nothing', async (t) => {
  const { db, admin, staff } = await users(t);
  const refused = saveAppSettings(db, staff, { duplicateFile: 'block' });
  assert.deepEqual(refused.ok ? null : refused.reason, 'not_admin');
  const bad = saveAppSettings(db, admin, { duplicateFile: 'block', templates: { single: 'Hi {name}', combined: 'Hi {codes}' } });
  assert.match(bad.ok ? '' : bad.message, /\{codes\}/);
  assert.equal(duplicateRule(db), 'warn');
  assert.equal(saveAppSettings(db, admin, { trackingColumn: '  ' }).ok, false);
  assert.equal(saveAppSettings(db, admin, {}).ok, false);
});

test('the gap between two SMS: the admin changes it, never under 15 seconds', async (t) => {
  const { db, admin, staff } = await users(t);
  assert.ok(saveAppSettings(db, admin, { smsGap: { from: 15, to: 40 } }).ok);
  assert.deepEqual(smsGap(db), { from: 15, to: 40 });
  for (const smsGap of [{ from: 14, to: 40 }, { from: 30, to: 20 }, { from: 15.5, to: 40 }, { from: 15, to: 601 }, { from: '20', to: 40 }, null]) {
    const r = saveAppSettings(db, admin, { smsGap });
    assert.equal(r.ok, false, JSON.stringify(smsGap));
  }
  assert.equal(saveAppSettings(db, staff, { smsGap: { from: 20, to: 30 } }).ok, false);
  assert.deepEqual(appSettings(db).smsGap, { from: 15, to: 40 }, 'refused saves change nothing');
});
