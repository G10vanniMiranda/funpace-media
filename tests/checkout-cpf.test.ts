import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('checkout page requires and sends buyer CPF before payment', () => {
  const source = readFileSync('src/components/CheckoutPage.tsx', 'utf8');

  assert.match(source, /label="CPF"/);
  assert.match(source, /isValidCpf\(cpfDigits\)/);
  assert.match(source, /cpf:\s*cpfDigits/);
  assert.doesNotMatch(source, /console\.log\('CPF digitado:'/);
  assert.doesNotMatch(source, /console\.log\('Payload checkout:'/);
});

test('checkout backend rejects invalid CPF before creating gateway checkout', () => {
  const source = readFileSync('server.ts', 'utf8');

  assert.match(source, /const buyerCpf = onlyCpfDigits/);
  assert.match(source, /if \(!isValidCpf\(buyerCpf\)\)/);
  assert.match(source, /Informe um CPF valido para continuar o pagamento/);
  assert.match(source, /cpf: buyerCpf/);
});

test('InfinitePay checkout payload includes customer document fields', () => {
  const source = readFileSync('server/payments/providers/infinitepay.ts', 'utf8');

  assert.match(source, /const cpfDigits = String\(input\.buyer\.cpf/);
  assert.match(source, /payload\.customer = \{/);
  assert.match(source, /document: cpfDigits/);
  assert.match(source, /cpf: cpfDigits/);
});
