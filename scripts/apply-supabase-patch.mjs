import dotenv from "dotenv";
import fs from "node:fs/promises";
import dns from "node:dns";
import pg from "pg";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

const patchFile = process.argv[2];
if (!patchFile) {
  console.error("Uso: node scripts/apply-supabase-patch.mjs <arquivo-sql>");
  process.exit(1);
}

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || process.env.SUPABASE_URL || "";
const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.HOST || (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DATABASE || "postgres",
      user: process.env.DB_USER || process.env.USER || "postgres",
      password: process.env.POSTGRES || process.env.RAILS_MASTER_KEY,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    };

if (!process.env.DATABASE_URL && dbConfig.host && /[a-z]/i.test(dbConfig.host)) {
  try {
    const lookup = await dns.promises.lookup(dbConfig.host, { family: 4 });
    if (lookup?.address) dbConfig.host = lookup.address;
  } catch {
    // pg will surface the connection failure.
  }
}

const sql = await fs.readFile(new URL(`./${patchFile}`, import.meta.url), "utf8");
const pool = new pg.Pool(dbConfig);

try {
  await pool.query("begin");
  await pool.query(sql);
  await pool.query("commit");
  console.log("patchApplied:", patchFile);
} catch (error) {
  try {
    await pool.query("rollback");
  } catch {
    // ignore
  }

  console.log("patchApplied: false");
  console.log("failed:", {
    name: error.name,
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
