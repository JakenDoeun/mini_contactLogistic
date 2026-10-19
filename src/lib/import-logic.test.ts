import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFile } from './import-logic.ts';

test('validateFile accepts exports and rejects other files', () => {
  assert.equal(validateFile({ name: 'Arrivals.XLSX', size: 100 }), null);
  assert.equal(validateFile({ name: 'a.csv', size: 100 }), null);
  assert.match(validateFile({ name: 'a.pdf', size: 100 })!, /not an Excel or CSV/);
  assert.match(validateFile({ name: 'a.csv', size: 0 })!, /empty/);
  assert.match(validateFile({ name: 'a.csv', size: 11 * 1024 * 1024 })!, /10 MB/);
});
