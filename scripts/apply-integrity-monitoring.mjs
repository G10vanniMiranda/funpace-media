import 'dotenv/config';
import fs from 'node:fs/promises';
import pg from 'pg';

const connectionString = process.env.DATABASE_URL;
if (!connectionString) throw new Error('DATABASE_URL é obrigatória para aplicar a camada de integridade.');

const sql = await fs.readFile(new URL('./add-integrity-monitoring.sql', import.meta.url), 'utf8');
const pool = new pg.Pool({ connectionString, ssl: { rejectUnauthorized: false }, max: 1 });
try {
  await pool.query(sql);
  const tables = (await pool.query(`select table_name from information_schema.tables where table_schema='public' and table_name like 'integrity_%' order by table_name`)).rows.map((row) => row.table_name);
  console.log(JSON.stringify({ schemaApplied: true, tables }, null, 2));
} finally {
  await pool.end();
}
