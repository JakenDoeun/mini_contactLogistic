import test from 'node:test';
import assert from 'node:assert/strict';
import { folderError, gatewayUrlError, templateError } from './settings-logic.ts';

test('folder path must be absolute', () => {
  for (const ok of ['D:\\Logistics\\Exports', '\\\\server\\exports', '/srv/exports']) assert.equal(folderError(ok), null);
  assert.equal(folderError('')?.key, 'settingsError.folderEmpty');
  assert.equal(folderError('Exports\\Arrivals')?.key, 'settingsError.folderPath');
});

test('templates need {codes} and only known placeholders', () => {
  assert.equal(templateError('Hi {name}, {count} parcels: {codes}.'), null);
  assert.equal(templateError('Hi {name}, your parcel arrived.')?.key, 'settingsError.templateCodes');
  assert.deepEqual(templateError('Hi {nmae}: {codes}'), { key: 'settingsError.templateUnknown', vars: { token: '{nmae}' } });
});

test('gateway address is optional but must be http(s)', () => {
  assert.equal(gatewayUrlError(''), null);
  assert.equal(gatewayUrlError('http://192.168.1.20:8080'), null);
  assert.equal(gatewayUrlError('ftp://x')?.key, 'settingsError.urlScheme');
  assert.equal(gatewayUrlError('192.168.1.20')?.key, 'settingsError.urlFull');
});
