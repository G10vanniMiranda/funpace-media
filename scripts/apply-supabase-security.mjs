import dotenv from 'dotenv';
import fs from 'node:fs/promises';
import dns from 'node:dns';
import pg from 'pg';

dotenv.config();
dns.setDefaultResultOrder('ipv4first');

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];
const dbPassword = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || process.env.POSTGRES;

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST || process.env.PGHOST || process.env.HOST || (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DATABASE || process.env.PGDATABASE || 'postgres',
      user: process.env.DB_USER || process.env.PGUSER || process.env.POSTGRES_USER || 'postgres',
      password: dbPassword,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    };

if (!process.env.DATABASE_URL && dbConfig.host && /[a-z]/i.test(dbConfig.host)) {
  try {
    const lookup = await dns.promises.lookup(dbConfig.host, { family: 4 });
    if (lookup?.address) dbConfig.host = lookup.address;
  } catch {
    // Ignore DNS errors.
  }
}

const sql = await fs.readFile(new URL('./supabase-security-hardening.sql', import.meta.url), 'utf8');
const pool = new pg.Pool(dbConfig);

try {
  await pool.query('begin');
  await pool.query(sql);
  await pool.query('commit');
  console.log('securityPolicyApplied: true');
} catch (error) {
  try {
    await pool.query('rollback');
  } catch {
    // Ignore rollback failures.
  }

  console.log('securityPolicyApplied: false');
  console.error(error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
