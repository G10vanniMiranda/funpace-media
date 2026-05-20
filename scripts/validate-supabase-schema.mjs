import dotenv from "dotenv";
import dns from "node:dns";
import pg from "pg";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
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

// Some environments block outbound IPv6 connections; force an IPv4 address when using a hostname.
if (!process.env.DATABASE_URL && dbConfig.host && /[a-z]/i.test(dbConfig.host)) {
  try {
    const lookup = await dns.promises.lookup(dbConfig.host, { family: 4 });
    if (lookup?.address) dbConfig.host = lookup.address;
  } catch {
    // Ignore DNS errors; pg will surface connection failures.
  }
}

const requiredColumns = {
  photographers: ["id", "name", "email", "bio", "avatar", "phone", "cpf", "verified", "stats", "createdAt", "updatedAt"],
  products: ["id", "name", "price", "url", "type", "vendedorId", "bib", "event", "checkpoint", "thumbnailUrl", "duration", "storagePath", "status", "createdAt", "updatedAt"],
  orders: ["id", "userId", "buyerName", "buyerEmail", "buyerPhone", "buyerCpf", "total", "status", "paymentProvider", "paymentExternalId", "checkoutUrl", "createdAt", "updatedAt"],
  order_items: ["id", "orderId", "productId", "name", "type", "price", "url", "vendedorId", "bib", "event", "checkpoint", "thumbnailUrl", "createdAt"],
  payment_events: ["id", "provider", "eventId", "orderId", "status", "payload", "createdAt"],
  platform_settings: ["id", "platformFeePercent", "withdrawalFee", "autoBlockSuspicious", "createdAt", "updatedAt"],
};

const requiredPolicies = [
  "photographers_select_public_verified_or_owner_or_admin",
  "photographers_insert_own_profile",
  "photographers_update_own_non_verified_fields",
  "products_select_published_owner_or_admin",
  "products_insert_own_verified_photographer",
  "products_update_owner_or_admin",
  "products_delete_owner_or_admin",
  "orders_select_owner_email_or_admin",
  "orders_update_admin_only",
  "order_items_select_order_owner_or_admin",
  "payment_events_select_admin_only",
  "platform_settings_select_admin_only",
  "platform_settings_update_admin_only",
];

const requiredStoragePolicies = [
  "media_select_public",
  "media_insert_verified_owner_folder",
  "media_update_owner_folder_or_admin",
  "media_delete_owner_folder_or_admin",
];

const pool = new pg.Pool(dbConfig);

try {
  const columnRows = await pool.query(
    `
      select table_name, column_name
      from information_schema.columns
      where table_schema = 'public'
        and table_name = any($1::text[])
    `,
    [Object.keys(requiredColumns)],
  );

  const presentColumns = new Map();
  for (const row of columnRows.rows) {
    const columns = presentColumns.get(row.table_name) ?? new Set();
    columns.add(row.column_name);
    presentColumns.set(row.table_name, columns);
  }

  const missingColumns = [];
  for (const [table, columns] of Object.entries(requiredColumns)) {
    const present = presentColumns.get(table) ?? new Set();
    for (const column of columns) {
      if (!present.has(column)) missingColumns.push(`${table}.${column}`);
    }
  }

  const rlsRows = await pool.query(
    `
      select relname as table_name, relrowsecurity as rls_enabled
      from pg_class
      where relname = any($1::text[])
        and relnamespace = 'public'::regnamespace
    `,
    [Object.keys(requiredColumns)],
  );

  const rlsDisabled = rlsRows.rows
    .filter((row) => !row.rls_enabled)
    .map((row) => row.table_name);

  const policyRows = await pool.query(
    `
      select policyname
      from pg_policies
      where schemaname = 'public'
        and tablename = any($1::text[])
    `,
    [Object.keys(requiredColumns)],
  );

  const presentPolicies = new Set(policyRows.rows.map((row) => row.policyname));
  const missingPolicies = requiredPolicies.filter((policy) => !presentPolicies.has(policy));

  const bucketRows = await pool.query(
    `
      select id, public
      from storage.buckets
      where id = 'funpace-media'
    `,
  );
  const mediaBucketReady = bucketRows.rowCount === 1 && bucketRows.rows[0].public === true;

  const storagePolicyRows = await pool.query(
    `
      select policyname
      from pg_policies
      where schemaname = 'storage'
        and tablename = 'objects'
    `,
  );
  const presentStoragePolicies = new Set(storagePolicyRows.rows.map((row) => row.policyname));
  const missingStoragePolicies = requiredStoragePolicies.filter((policy) => !presentStoragePolicies.has(policy));

  const ok = missingColumns.length === 0 &&
    rlsDisabled.length === 0 &&
    missingPolicies.length === 0 &&
    mediaBucketReady &&
    missingStoragePolicies.length === 0;

  console.log("validation:", {
    ok,
    missingColumns,
    rlsDisabled,
    missingPolicies,
    mediaBucketReady,
    missingStoragePolicies,
  });

  if (!ok) process.exitCode = 1;
} catch (error) {
  console.log("validationFailed:", {
    name: error.name,
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
