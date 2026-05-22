import { createPool, handleOptions, setCors } from './_utils';

export default async function handler(req: any, res: any) {
  if (handleOptions(req, res)) return;
  setCors(req, res);

  const status: any = {
    env: {
      DATABASE_URL: !!process.env.DATABASE_URL,
      SUPABASE_URL: !!(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL),
      INFINITEPAY_HANDLE: !!process.env.INFINITEPAY_HANDLE,
    },
    database: 'unchecked',
  };

  const pool = createPool();
  try {
    const result = await pool.query('select now()');
    status.database = 'connected';
    status.serverTime = result.rows[0].now;
    res.status(200).json(status);
  } catch (error: any) {
    status.database = `failed: ${error?.message || 'unknown error'}`;
    res.status(500).json(status);
  } finally {
    await pool.end().catch(() => undefined);
  }
}
