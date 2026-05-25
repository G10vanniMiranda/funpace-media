import test from 'node:test';
import assert from 'node:assert/strict';
import { formatWhatsapp, onlyWhatsappDigits } from '../src/lib/phone';

test('onlyWhatsappDigits removes non-digits and limits to Brazilian mobile length', () => {
  assert.equal(onlyWhatsappDigits('(62) 99857-9084'), '62998579084');
  assert.equal(onlyWhatsappDigits('629985790844444'), '62998579084');
});

test('onlyWhatsappDigits removes Brazil country code from pasted numbers', () => {
  assert.equal(onlyWhatsappDigits('+55 (62) 99857-9084'), '62998579084');
});

test('formatWhatsapp applies Brazilian phone masks', () => {
  assert.equal(formatWhatsapp('62998579084'), '(62) 99857-9084');
  assert.equal(formatWhatsapp('6233334444'), '(62) 3333-4444');
  assert.equal(formatWhatsapp('62'), '62');
  assert.equal(formatWhatsapp('6299'), '(62) 99');
});
