import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const publicClientFiles = [
  'src/components/FaceSearchModal.tsx',
  'src/components/CheckoutPage.tsx',
  'src/hooks/useContentProtection.ts',
  'src/components/EventGrid.tsx',
  'src/lib/welcome-voucher.ts',
];

test('public customer flows do not emit diagnostic console logs with personal data', () => {
  for (const file of publicClientFiles) {
    const source = readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /console\.log\(/, file);
    assert.doesNotMatch(source, /console\.info\(/, file);
  }

  const app = readFileSync('src/App.tsx', 'utf8');
  assert.doesNotMatch(app, /\[public-photographer\]/);
  assert.doesNotMatch(app, /console\.info\(/);
});
