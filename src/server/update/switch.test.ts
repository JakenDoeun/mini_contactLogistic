import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import assert from 'node:assert/strict';
import { saveBackup } from '../db/backup.ts';
import { writeSetting } from '../db/settings.ts';
import { MIGRATIONS_FOLDER } from '../db/paths.ts';
import { createTestDb } from '../db/test-db.ts';
import { databaseNewer, newestPreMigration, smsBusy } from './switch.ts';

const NOW = new Date('2026-10-29T03:00:00Z');
const ago = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();

test('the updater waits while an SMS is handed over or a batch is sending, not for a stalled batch', async (t) => {
  const { db, cleanup } = await createTestDb();
  t.after(cleanup);
  assert.equal(smsBusy(db, NOW), false);

  const batch = (created: string) =>
    Number(db.prepare(`INSERT INTO send_batches (request_key, arrival_date, planned_messages, planned_parcels, status, created_at) VALUES (?, '2026-10-29', 1, 1, 'running', ?)`)
      .run(crypto.randomUUID(), created).lastInsertRowid);
  const attempt = (batchId: number | null, state: string, submitted: string | null) => {
    const n = db.prepare(`INSERT INTO notifications (phone_normalized, arrival_date, message_text, reason, batch_id, created_at) VALUES ('012345678', '2026-10-29', 'Hi', 'initial', ?, ?) RETURNING id`)
      .get(batchId, ago(60)) as { id: number };
    db.prepare(`INSERT INTO sms_attempts (id, notification_id, attempt_no, state, queued_at, submitted_at) VALUES (?, ?, 1, ?, ?, ?)`).run(crypto.randomUUID(), n.id, state, ago(60), submitted);
  };

  const stalled = batch(ago(30));
  attempt(stalled, 'queued', null);
  attempt(stalled, 'sent', ago(20));
  assert.equal(smsBusy(db, NOW), false, 'running for 30 minutes, nothing handed over for 20: stalled');

  attempt(stalled, 'sent', ago(2));
  assert.equal(smsBusy(db, NOW), true, 'handed one over 2 minutes ago: sending');
  db.prepare(`UPDATE send_batches SET status = 'paused'`).run();
  assert.equal(smsBusy(db, NOW), false, 'a paused batch is not sending');

  batch(ago(1));
  assert.equal(smsBusy(db, NOW), true, 'a batch started a minute ago');
  db.prepare(`UPDATE send_batches SET status = 'done'`).run();
  attempt(null, 'submitting', null);
  assert.equal(smsBusy(db, NOW), true, 'a single SMS being handed to the phone');
});

test('an older version cannot open a database with migrations it does not know; the pre-migration copy is found', async (t) => {
  const { db, dir, cleanup } = await createTestDb();
  t.after(cleanup);
  assert.equal(databaseNewer(db, MIGRATIONS_FOLDER), false);

  const older = path.join(dir, 'older-drizzle');
  fs.cpSync(MIGRATIONS_FOLDER, older, { recursive: true });
  const journal = path.join(older, 'meta', '_journal.json');
  const j = JSON.parse(fs.readFileSync(journal, 'utf8'));
  j.entries.pop();
  fs.writeFileSync(journal, JSON.stringify(j));
  assert.equal(databaseNewer(db, older), true);

  assert.equal(newestPreMigration(dir), null);
  saveBackup(db, dir, new Date(NOW.getTime() - 60_000), 'pre-migration');
  writeSetting(db, 'test.changed', { at: NOW.toISOString() }, null, NOW.toISOString());
  saveBackup(db, dir, NOW, 'backup');
  assert.equal(newestPreMigration(dir), 2, 'the start-up backup after it is number 1');
});
