import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('optional public modals are lazy loaded outside the initial app bundle', () => {
  const app = readFileSync('src/App.tsx', 'utf8');

  assert.match(app, /const AuthView = React\.lazy\(\(\) => import\('\.\/components\/AuthView'\)/);
  assert.match(app, /const FaceSearchModal = React\.lazy\(\(\) => import\('\.\/components\/FaceSearchModal'\)/);
  assert.match(app, /const WelcomeVoucherModal = React\.lazy\(\(\) => import\('\.\/components\/WelcomeVoucherModal'\)/);
  assert.match(app, /const PhotoGrid = React\.lazy\(\(\) => import\('\.\/components\/PhotoGrid'\)/);
  assert.match(app, /const VideoGrid = React\.lazy\(\(\) => import\('\.\/components\/VideoGrid'\)/);
  assert.match(app, /function LazyModalBoundary/);
  assert.match(app, /function LazyGridBoundary/);
  assert.match(app, /<React\.Suspense fallback=\{null\}>/);

  assert.doesNotMatch(app, /import \{ AuthView \} from '\.\/components\/AuthView'/);
  assert.doesNotMatch(app, /import \{ FaceSearchModal \} from '\.\/components\/FaceSearchModal'/);
  assert.doesNotMatch(app, /import \{ WelcomeVoucherModal \} from '\.\/components\/WelcomeVoucherModal'/);
  assert.doesNotMatch(app, /import \{ PhotoGrid \} from '\.\/components\/PhotoGrid'/);
  assert.doesNotMatch(app, /import \{ VideoGrid \} from '\.\/components\/VideoGrid'/);
});

test('secondary routes are lazy loaded outside the storefront bundle', () => {
  const app = readFileSync('src/App.tsx', 'utf8');

  [
    ['PhotographerLogin', './components/PhotographerLogin'],
    ['PhotographerPasswordSetup', './components/PhotographerPasswordSetup'],
    ['AdminLogin', './components/AdminLogin'],
    ['PagamentoSucesso', './routes/pagamento/sucesso'],
    ['DownloadSeguro', './routes/DownloadSeguro'],
    ['ParaFotografos', './routes/ParaFotografos'],
    ['Precos', './routes/Precos'],
    ['Faq', './routes/Faq'],
    ['Contato', './routes/Contato'],
    ['Termos', './routes/Termos'],
    ['Privacidade', './routes/Privacidade'],
  ].forEach(([component, path]) => {
    assert.match(app, new RegExp(`const ${component} = React\\.lazy\\(\\(\\) => import\\('${path.replace(/\//g, '\\/')}'\\)`), component);
    assert.doesNotMatch(app, new RegExp(`import \\{ ${component} \\} from '${path.replace(/\//g, '\\/')}'`), component);
  });
});
