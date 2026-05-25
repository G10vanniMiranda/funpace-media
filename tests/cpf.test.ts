import test from 'node:test';
import assert from 'node:assert/strict';
import { formatCpf, isValidCpf, onlyCpfDigits } from '../src/lib/cpf';

test('onlyCpfDigits removes non-digits and limits to eleven digits', () => {
  assert.equal(onlyCpfDigits('529.982.247-25abc999'), '52998224725');
});

test('formatCpf applies Brazilian CPF mask progressively', () => {
  assert.equal(formatCpf('52998224725'), '529.982.247-25');
  assert.equal(formatCpf('529982'), '529.982');
});

test('isValidCpf accepts valid CPF and rejects invalid values', () => {
  assert.equal(isValidCpf('529.982.247-25'), true);
  assert.equal(isValidCpf('111.111.111-11'), false);
  assert.equal(isValidCpf('529.982.247-24'), false);
  assert.equal(isValidCpf('123'), false);
});
