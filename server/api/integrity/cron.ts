import { runIntegrityScan } from '../../integrity/integrity-service.js';

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método não permitido.' });
  const expected = String(process.env.OPERATIONS_SECRET || process.env.CRON_SECRET || '');
  const supplied = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '').trim();
  if (!expected || supplied !== expected) return res.status(401).json({ error: 'Não autorizado.' });
  try {
    return res.status(200).json(await runIntegrityScan({ reconcile: true, triggerSource: 'external_cron' }));
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Falha na auditoria de integridade.' });
  }
}
