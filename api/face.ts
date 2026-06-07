import { handleOptions, rateLimit, rejectUntrustedBrowserOrigin } from './_security.js';
import { indexPhotoHandler, searchFaceHandler, testFaceHandler } from '../server/face/face-handlers.js';

export const config = {
  api: {
    bodyParser: false,
  },
};

function routeName(req: any) {
  const route = String(req.query?.route || '').trim();
  if (route) return route;
  const url = String(req.url || '');
  if (url.includes('/search')) return 'search';
  if (url.includes('/index')) return 'index';
  return 'test';
}

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res, 'GET,POST,OPTIONS', 'Authorization, Content-Type, X-Photo-Id, X-Event-Id')) return;
  if (rateLimit(req, res, { keyPrefix: 'face', windowMs: 60 * 1000, max: 30 })) return;
  if (rejectUntrustedBrowserOrigin(req, res)) return;

  const route = routeName(req);
  if (route === 'search' && req.method === 'POST') return searchFaceHandler(req, res);
  if (route === 'index' && req.method === 'POST') return indexPhotoHandler(req, res);
  if (route === 'test' && req.method === 'GET') return testFaceHandler(req, res);
  return res.status(405).json({ error: 'Metodo nao permitido.' });
}
