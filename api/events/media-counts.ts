import mediaCountsHandler from '../../server/api/events/media-counts.js';
import { handleOptions, rateLimit, setSecurityHeaders } from '../_security.js';

export default function handler(req: any, res: any) {
  if (handleOptions(req, res, 'GET,OPTIONS')) return;
  if (rateLimit(req, res, { keyPrefix: 'events-media-counts', windowMs: 60 * 1000, max: 120 })) return;
  setSecurityHeaders(res);

  if (req.method !== 'GET') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  return mediaCountsHandler(req, res);
}
