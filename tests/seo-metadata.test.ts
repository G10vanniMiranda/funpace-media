import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('public pages expose consistent SEO and social metadata', () => {
  const app = readFileSync('src/App.tsx', 'utf8');
  const html = readFileSync('index.html', 'utf8');

  assert.match(html, /<meta name="description" content="Funpace Media conecta atletas/);
  assert.match(html, /<meta name="robots" content="index,follow" \/>/);
  assert.match(html, /<meta property="og:site_name" content="Funpace Media" \/>/);
  assert.match(html, /<meta property="og:type" content="website" \/>/);
  assert.match(html, /<meta property="og:locale" content="pt_BR" \/>/);
  assert.match(html, /<meta name="twitter:card" content="summary_large_image" \/>/);
  assert.match(html, /<link rel="canonical" href="\/" \/>/);

  assert.match(app, /function applySeoMetadata/);
  assert.match(app, /removeMetaTag\('meta\[property="og:image"\]'\)/);
  assert.match(app, /removeMetaTag\('meta\[name="twitter:image"\]'\)/);
  assert.match(app, /canonicalPath: '\/eventos'/);
  assert.match(app, /canonicalPath: '\/'/);
  assert.match(app, /canonicalPath: `\/\$\{publicSlug\}`/);
  assert.match(app, /canonicalPath: `\/evento\/\$\{event\.slug \|\| slug\}`/);
  assert.match(app, /setMetaTag\('meta\[property="og:locale"\]/);
  assert.match(app, /setMetaTag\('meta\[name="twitter:image"\]/);
});
