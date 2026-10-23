import test from 'node:test';
import assert from 'node:assert/strict';
import { validateFile } from './import-logic.ts';

test('validateFile accepts exports and rejects other files', () => {
  assert.equal(validateFile({ name: 'Arrivals.XLSX', size: 100 }), null);
  assert.equal(validateFile({ name: 'a.csv', size: 100 }), null);
  assert.deepEqual(validateFile({ name: 'a.pdf', size: 100 }), { key: 'file.notExport', vars: { file: 'a.pdf' } });
  assert.equal(validateFile({ name: 'a.csv', size: 0 })?.key, 'file.empty');
  assert.equal(validateFile({ name: 'a.csv', size: 11 * 1024 * 1024 })?.key, 'file.tooLarge');
});
