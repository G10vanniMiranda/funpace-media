import { timingSafeEqual } from 'node:crypto';
import { createPool } from '../_utils.js';

function secretMatches(value: string, expected: string) {
  if (!value || !expected) return false;
  const left = Buffer.from(value);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

function buildInfo() {
  return {
    version: String(process.env.APP_VERSION || process.env.npm_package_version || 'unknown'),
    commit: String(process.env.GIT_COMMIT || process.env.VERCEL_GIT_COMMIT_SHA || 'unknown').slice(0, 40),
    builtAt: process.env.BUILD_TIMESTAMP || null,
  };
}

export default async function handler(req: any, res: any) {
  res.setHeader('Cache-Control', 'no-store');
  const expected = String(process.env.OPERATIONS_SECRET || process.env.CRON_SECRET || '');
  const bearer = String(req.headers?.authorization || '').match(/^Bearer\s+(.+)$/i)?.[1]?.trim() || '';
  const authorized = secretMatches(bearer, expected);
  const response: Record<string, any> = { ok: true, ...buildInfo(), time: new Date().toISOString() };

  if (!authorized) return res.status(200).json(response);

  const pool = await createPool();
  try {
    const database = await pool.query('select now() server_time');
    response.diagnostics = {
      database: 'connected',
      serverTime: database.rows[0]?.server_time || null,
      configuration: {
        database: Boolean(process.env.DATABASE_URL),
        supabase: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL),
        rekognition: Boolean(process.env.AWS_REKOGNITION_COLLECTION && process.env.AWS_REGION),
        storage: Boolean((process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN) && (process.env.MEDIA_BUCKET || process.env.BUCKET)),
      },
    };
  } catch {
    response.ok = false;
    response.diagnostics = { database: 'unavailable' };
  } finally {
    await pool.end();
  }

  return res.status(response.ok ? 200 : 503).json(response);
}
