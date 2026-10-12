import test from 'node:test';
import assert from 'node:assert/strict';
import { folderError, gatewayUrlError, templateError } from './settings-logic.ts';

test('folder path must be absolute', () => {
  for (const ok of ['D:\\Logistics\\Exports', '\\\\server\\exports', '/srv/exports']) assert.equal(folderError(ok), null);
  assert.match(folderError('')!, /Enter/);
  assert.match(folderError('Exports\\Arrivals')!, /full path/);
});

test('templates need {codes} and only known placeholders', () => {
  assert.equal(templateError('Hi {name}, {count} parcels: {codes}.'), null);
  assert.match(templateError('Hi {name}, your parcel arrived.')!, /\{codes\}/);
  assert.match(templateError('Hi {nmae}: {codes}')!, /\{nmae\} is not a placeholder/);
});

test('gateway address is optional but must be http(s)', () => {
  assert.equal(gatewayUrlError(''), null);
  assert.equal(gatewayUrlError('http://192.168.1.20:8080'), null);
  assert.match(gatewayUrlError('ftp://x')!, /http/);
  assert.match(gatewayUrlError('192.168.1.20')!, /full address/);
});
