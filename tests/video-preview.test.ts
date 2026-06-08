import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

test('video storefront uses watermark thumbnail fallback and polished video labels', () => {
  const source = readFileSync('src/components/VideoGrid.tsx', 'utf8');

  assert.match(source, /poster=\{video\.thumbnailUrl \|\| video\.watermarkUrl\}/);
  assert.match(source, /VÍDEO/);
  assert.match(source, /video\.duration \|\| 'Preview'/);
  assert.doesNotMatch(source, /Preview indispon/i);
});

test('protected video preview never renders unavailable copy', () => {
  const source = readFileSync('src/components/ProtectedVideoPreview.tsx', 'utf8');

  assert.match(source, /generatedPoster/);
  assert.match(source, /Preview do vídeo/);
  assert.match(source, /canvas\.toDataURL\('image\/jpeg', 0\.82\)/);
  assert.match(source, /controlsList="nodownload noplaybackrate noremoteplayback"/);
  assert.doesNotMatch(source, /Preview indispon/i);
});

test('media signing includes watermarkUrl previews without exposing protected originals', () => {
  const source = readFileSync('src/lib/services.ts', 'utf8');

  assert.match(source, /watermarkUrl\?: string \| null/);
  assert.match(source, /const watermark = mediaPathKey\(item\.watermarkUrl\)/);
  assert.match(source, /watermarkUrl: item\.watermarkUrl && urls\[item\.watermarkUrl\]/);
  assert.match(source, /url: shouldProtectOriginal\(item\) \? ''/);
});
