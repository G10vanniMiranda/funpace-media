export default function handler(req: any, res: any) {
  res.status(200).json({
    ok: true,
    method: req.method,
    env: {
      DATABASE_URL: Boolean(process.env.DATABASE_URL),
      SUPABASE_URL: Boolean(process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL),
      INFINITEPAY_HANDLE: Boolean(process.env.INFINITEPAY_HANDLE),
      INFINITEPAY_BASE_URL: Boolean(process.env.INFINITEPAY_BASE_URL),
    },
    time: new Date().toISOString(),
  });
}
