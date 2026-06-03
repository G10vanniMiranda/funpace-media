import test from 'node:test';
import assert from 'node:assert/strict';
import { isValidAuthEmail, normalizeAuthEmail } from '../src/lib/supabase';

test('normalizeAuthEmail trims, lowercases and normalizes email input', () => {
  assert.equal(normalizeAuthEmail('  Cliente@GMAIL.COM  '), 'cliente@gmail.com');
});

test('isValidAuthEmail accepts common customer email providers', () => {
  [
    'cliente@gmail.com',
    'cliente@hotmail.com',
    'cliente@outlook.com',
    'cliente@yahoo.com',
    'cliente@icloud.com',
    'cliente.nome+evento@gmail.com',
  ].forEach((email) => assert.equal(isValidAuthEmail(email), true, email));
});

test('isValidAuthEmail rejects malformed addresses', () => {
  [
    '',
    'cliente',
    'cliente@',
    '@gmail.com',
    'cliente@gmail',
    'cliente@@gmail.com',
    'cliente..teste@gmail.com',
    'cliente gmail@gmail.com',
  ].forEach((email) => assert.equal(isValidAuthEmail(email), false, email));
});
