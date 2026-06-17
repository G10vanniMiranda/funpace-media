import dotenv from "dotenv";
import dns from "node:dns";
import pg from "pg";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];
const dbPassword = process.env.DB_PASSWORD || process.env.POSTGRES_PASSWORD || process.env.PGPASSWORD || process.env.POSTGRES;

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.DB_HOST || process.env.PGHOST || process.env.HOST || (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DATABASE || process.env.PGDATABASE || "postgres",
      user: process.env.DB_USER || process.env.PGUSER || process.env.POSTGRES_USER || "postgres",
      password: dbPassword,
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
  photographers: ["id", "slug", "username", "isPublic", "displayName", "profilePhoto", "coverPhoto", "city", "name", "email", "bio", "avatar", "phone", "cpf", "verified", "role", "commissionPercent", "referralCode", "referredByPhotographerId", "blockedAt", "lastLoginAt", "stats", "createdAt", "updatedAt"],
  customers: ["id", "email", "name", "phone", "cpf", "avatarUrl", "preferences", "createdAt", "updatedAt"],
  events: ["id", "photographerId", "name", "slug", "description", "date", "location", "checkpoint", "coverImage", "coverMediaId", "bannerImage", "cover_position", "isPublished", "isFeatured", "moderationStatus", "status", "createdAt", "updatedAt"],
  products: ["id", "name", "price", "url", "type", "vendedorId", "bib", "event", "checkpoint", "thumbnailUrl", "watermarkUrl", "duration", "storagePath", "fileHash", "fileSize", "originalFileName", "thumbnailHash", "uploadBatchId", "status", "viewCount", "salesCount", "createdAt", "updatedAt"],
  orders: ["id", "userId", "buyerName", "buyerEmail", "buyerPhone", "buyerCpf", "total", "subtotal", "discountTotal", "status", "paymentMethod", "paymentProvider", "paymentExternalId", "checkoutUrl", "paidEmailSentAt", "createdAt", "updatedAt"],
  order_items: ["id", "orderId", "productId", "name", "type", "price", "url", "vendedorId", "bib", "event", "checkpoint", "thumbnailUrl", "createdAt"],
  payment_events: ["id", "provider", "eventId", "orderId", "status", "payload", "createdAt"],
  payments: ["id", "orderId", "provider", "providerPaymentId", "method", "status", "rawResponse", "createdAt", "updatedAt"],
  download_access: ["id", "orderId", "photoId", "orderItemId", "userId", "customerEmail", "isActive", "expiresAt", "createdAt", "updatedAt"],
  customer_favorites: ["id", "userId", "customerEmail", "photoId", "createdAt"],
  user_sessions: ["id", "userId", "userAgent", "createdAt"],
  downloads: ["id", "userId", "orderId", "photoId", "downloadedAt"],
  withdrawal_requests: ["id", "photographerId", "amount", "pixKey", "status", "note", "createdAt", "updatedAt", "processedAt"],
  photographer_referrals: ["id", "referrerPhotographerId", "referredPhotographerId", "referralCode", "status", "createdAt", "approvedAt", "firstSaleAt", "rewardAmount", "rewardStatus", "paidAt", "canceledAt", "audit"],
  photographer_wallets: ["id", "photographerId", "balance", "pendingBalance", "updatedAt"],
  photographer_transactions: ["id", "photographerId", "orderId", "orderItemId", "grossAmount", "platformFee", "netAmount", "status", "createdAt"],
  media_processing_jobs: ["id", "productId", "photographerId", "kind", "status", "sourceUrl", "outputUrl", "error", "createdAt", "updatedAt"],
  coupons: ["id", "code", "type", "value", "maxUses", "usedCount", "startsAt", "expiresAt", "isActive", "createdAt", "updatedAt"],
  admin_activity_logs: ["id", "actorId", "actorEmail", "action", "targetType", "targetId", "metadata", "createdAt"],
  platform_settings: ["id", "platformFeePercent", "withdrawalFee", "autoBlockSuspicious", "paymentProvider", "brandName", "supportEmail", "maxUploadBytes", "createdAt", "updatedAt"],
  face_search_consents: ["id", "user_id", "session_id", "accepted", "accepted_at", "ip_address", "user_agent", "created_at"],
};

const requiredPolicies = [
  "photographers_select_public_verified_or_owner_or_admin",
  "photographers_insert_own_profile",
  "photographers_update_own_non_verified_fields",
  "customers_select_owner_or_admin",
  "customers_insert_own_profile",
  "customers_update_owner_or_admin",
  "products_select_published_owner_or_admin",
  "products_insert_own_verified_photographer",
  "products_update_owner_or_admin",
  "products_delete_owner_or_admin",
  "events_select_published_owner_or_admin",
  "events_insert_admin_or_owner_photographer",
  "events_update_admin_or_owner_photographer",
  "events_delete_admin_or_owner_photographer",
  "orders_select_owner_email_or_admin",
  "orders_update_admin_only",
  "order_items_select_order_owner_or_admin",
  "payment_events_select_admin_only",
  "payments_select_order_owner_or_admin",
  "download_access_select_owner_or_admin",
  "customer_favorites_owner_all",
  "user_sessions_owner_or_admin",
  "downloads_owner_or_admin",
  "withdrawal_requests_select_owner_or_admin",
  "withdrawal_requests_insert_owner",
  "withdrawal_requests_update_admin_only",
  "photographer_referrals_select_owner_or_admin",
  "photographer_referrals_admin_all",
  "photographer_wallets_select_owner_or_admin",
  "photographer_transactions_select_owner_or_admin",
  "media_processing_jobs_select_owner_or_admin",
  "media_processing_jobs_insert_owner_or_admin",
  "coupons_admin_all",
  "admin_activity_logs_admin_select_insert",
  "platform_settings_select_public",
  "platform_settings_update_admin_only",
  "face_search_consents_admin_only",
];

const requiredIndexes = [
  "products_public_event_created_at_idx",
  "products_public_vendor_event_created_at_idx",
  "products_face_backfill_pending_idx",
  "face_search_consents_session_accepted_idx",
  "face_search_consents_created_at_idx",
  "orders_pending_provider_created_at_idx",
  "payment_events_order_provider_created_at_idx",
  "payments_order_provider_updated_at_idx",
  "photographers_referral_code_key",
  "photographers_referred_by_idx",
  "photographer_referrals_referred_key",
  "photographer_referrals_referrer_status_idx",
];

const requiredStorageBuckets = [
  "photographer-avatars",
  "photographer-covers",
  "event-covers",
];

const requiredStoragePolicies = [
  "photographer_profile_images_public_select",
  "event_covers_public_select",
  "event_covers_insert_own_folder",
  "event_covers_update_own_folder",
  "event_covers_delete_own_folder",
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

  const indexRows = await pool.query(
    `
      select indexname
      from pg_indexes
      where schemaname = 'public'
        and indexname = any($1::text[])
    `,
    [requiredIndexes],
  );
  const presentIndexes = new Set(indexRows.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((index) => !presentIndexes.has(index));

  const bucketRows = await pool.query(
    `
      select id
      from storage.buckets
      where id = any($1::text[])
    `,
    [requiredStorageBuckets],
  );
  const presentBuckets = new Set(bucketRows.rows.map((row) => row.id));
  const missingBuckets = requiredStorageBuckets.filter((bucket) => !presentBuckets.has(bucket));

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
    missingIndexes.length === 0 &&
    missingBuckets.length === 0 &&
    missingStoragePolicies.length === 0;

  console.log("validation:", {
    ok,
    missingColumns,
    rlsDisabled,
    missingPolicies,
    missingIndexes,
    missingBuckets,
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
