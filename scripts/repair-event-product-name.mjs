import dotenv from "dotenv";
import dns from "node:dns";
import pg from "pg";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

const [previousName, nextName, photographerIdArg] = process.argv.slice(2);

if (!previousName || !nextName) {
  console.error("Uso: node scripts/repair-event-product-name.mjs <nome-antigo> <nome-novo> [photographerId]");
  process.exit(1);
}

function dbConfigFromEnv() {
  const supabaseUrl =
    process.env.NEXT_PUBLIC_SUPABASE_URL ||
    process.env.VITE_SUPABASE_URL ||
    process.env.SUPABASE_URL ||
    "";
  const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];

  return process.env.DATABASE_URL
    ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
    : {
        host:
          process.env.DB_HOST ||
          process.env.PGHOST ||
          (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
        port: Number(process.env.DB_PORT || process.env.PGPORT || 5432),
        database: process.env.DATABASE || process.env.PGDATABASE || "postgres",
        user: process.env.DB_USER || process.env.PGUSER || "postgres",
        password:
          process.env.DB_PASSWORD ||
          process.env.POSTGRES_PASSWORD ||
          process.env.PGPASSWORD ||
          process.env.POSTGRES ||
          process.env.RAILS_MASTER_KEY,
        ssl: { rejectUnauthorized: false },
        connectionTimeoutMillis: 15000,
      };
}

async function main() {
  const config = dbConfigFromEnv();
  if (config.host && /[a-z]/i.test(config.host)) {
    try {
      const lookup = await dns.promises.lookup(config.host, { family: 4 });
      if (lookup?.address) config.host = lookup.address;
    } catch {
      // Let pg report the actual connection failure.
    }
  }

  const pool = new pg.Pool(config);
  const photographerId = photographerIdArg || null;

  const before = await pool.query(
    `
      select "vendedorId", "event", count(*)::int as total
      from public.products
      where "event" = $1
        and ($2::text is null or "vendedorId" = $2)
      group by "vendedorId", "event"
      order by total desc
    `,
    [previousName, photographerId],
  );
  console.log("Antes:");
  console.table(before.rows);

  const updated = await pool.query(
    `
      update public.products
      set "event" = $1
      where "event" = $2
        and ($3::text is null or "vendedorId" = $3)
      returning id, "vendedorId", "event"
    `,
    [nextName, previousName, photographerId],
  );
  console.log(`Produtos atualizados: ${updated.rowCount}`);

  const after = await pool.query(
    `
      select "vendedorId", "event", count(*)::int as total
      from public.products
      where "event" in ($1, $2)
        and ($3::text is null or "vendedorId" = $3)
      group by "vendedorId", "event"
      order by "event"
    `,
    [previousName, nextName, photographerId],
  );
  console.log("Depois:");
  console.table(after.rows);

  await pool.end();
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
