import pg from "pg";
import { getDbConfigForEnv, parseEnvName } from "./db-env.mjs";

const envName = parseEnvName();
let envConfig;
try {
  envConfig = await getDbConfigForEnv(envName, { allowDefaultProduction: true });
} catch (error) {
  console.log("multiPhotoFaceArchitectureVerificationFailed:", {
    env: envName || null,
    name: error.name,
    message: error.message,
  });
  process.exit(1);
}
const { config, source } = envConfig;

const requiredTables = [
  "media_face_embeddings",
  "media_ocr_indexes",
  "media_indexing_jobs",
  "face_search_queries",
];

const requiredColumns = {
  products: ["eventId", "ownerId", "uploadDate", "faceIndexStatus", "ocrIndexStatus"],
  order_items: ["eventId", "ownerId", "platformFeePercent", "platformFee", "photographerAmount"],
  photographer_transactions: ["productId", "eventId", "platformFeePercent", "currency", "availableAt"],
  media_face_embeddings: ["id", "productId", "photographerId", "eventId", "ownerId", "uploadDate", "storagePath", "faceEmbedding", "faceBoundingBox", "embeddingProvider", "embeddingModel", "qualityScore", "createdAt"],
  media_ocr_indexes: ["id", "productId", "photographerId", "eventId", "ownerId", "bib", "category", "confidenceScore", "boundingBox", "ocrProvider", "ocrModel", "createdAt"],
  media_indexing_jobs: ["id", "productId", "photographerId", "eventId", "kind", "status", "priority", "attempts", "maxAttempts", "runAfter", "lockedAt", "lockedBy", "error", "metadata", "createdAt", "updatedAt"],
  face_search_queries: ["id", "userId", "customerEmail", "ipHash", "resultCount", "threshold", "provider", "processingMs", "metadata", "createdAt"],
};

const requiredIndexes = [
  "products_event_id_idx",
  "products_owner_id_idx",
  "products_upload_date_idx",
  "products_face_index_status_idx",
  "products_ocr_index_status_idx",
  "order_items_event_id_idx",
  "order_items_owner_id_idx",
  "photographer_transactions_product_id_idx",
  "photographer_transactions_event_id_idx",
  "photographer_transactions_status_idx",
  "media_face_embeddings_product_id_idx",
  "media_face_embeddings_photographer_id_idx",
  "media_face_embeddings_event_id_idx",
  "media_face_embeddings_owner_id_idx",
  "media_face_embeddings_upload_date_idx",
  "media_face_embeddings_vector_idx",
  "media_ocr_indexes_bib_idx",
  "media_ocr_indexes_product_id_idx",
  "media_ocr_indexes_event_id_idx",
  "media_ocr_indexes_photographer_id_idx",
  "media_ocr_indexes_owner_id_idx",
  "media_indexing_jobs_queue_idx",
  "media_indexing_jobs_product_kind_idx",
  "media_indexing_jobs_photographer_id_idx",
  "face_search_queries_user_id_idx",
  "face_search_queries_customer_email_idx",
  "face_search_queries_created_at_idx",
];

const requiredPolicies = [
  "media_face_embeddings_admin_only",
  "media_ocr_indexes_admin_only",
  "media_indexing_jobs_admin_only",
  "face_search_queries_admin_only",
];

const pool = new pg.Pool(config);

try {
  const [vectorAvailability, vectorExt, tableRows, columnRows, indexRows, rlsRows, policyRows] = await Promise.all([
    pool.query("select name, default_version from pg_available_extensions where name = 'vector'"),
    pool.query("select extname, extversion from pg_extension where extname = 'vector'"),
    pool.query(
      `
        select table_name
        from information_schema.tables
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [requiredTables],
    ),
    pool.query(
      `
        select table_name, column_name
        from information_schema.columns
        where table_schema = 'public'
          and table_name = any($1::text[])
      `,
      [Object.keys(requiredColumns)],
    ),
    pool.query(
      `
        select indexname
        from pg_indexes
        where schemaname = 'public'
          and indexname = any($1::text[])
      `,
      [requiredIndexes],
    ),
    pool.query(
      `
        select relname as table_name, relrowsecurity as rls_enabled
        from pg_class
        where relnamespace = 'public'::regnamespace
          and relname = any($1::text[])
      `,
      [requiredTables],
    ),
    pool.query(
      `
        select policyname
        from pg_policies
        where schemaname = 'public'
          and policyname = any($1::text[])
      `,
      [requiredPolicies],
    ),
  ]);

  const presentTables = new Set(tableRows.rows.map((row) => row.table_name));
  const missingTables = requiredTables.filter((table) => !presentTables.has(table));

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

  const presentIndexes = new Set(indexRows.rows.map((row) => row.indexname));
  const missingIndexes = requiredIndexes.filter((index) => !presentIndexes.has(index));

  const rlsDisabled = rlsRows.rows
    .filter((row) => !row.rls_enabled)
    .map((row) => row.table_name);

  const presentPolicies = new Set(policyRows.rows.map((row) => row.policyname));
  const missingPolicies = requiredPolicies.filter((policy) => !presentPolicies.has(policy));

  const ok = vectorExt.rows.length > 0 &&
    missingTables.length === 0 &&
    missingColumns.length === 0 &&
    missingIndexes.length === 0 &&
    rlsDisabled.length === 0 &&
    missingPolicies.length === 0;

  console.log("multiPhotoFaceArchitectureVerification:", {
    env: envName,
    dbSource: source,
    ok,
    pgvectorAvailable: vectorAvailability.rows.length > 0,
    pgvectorDefaultVersion: vectorAvailability.rows[0]?.default_version ?? null,
    pgvectorActive: vectorExt.rows.length > 0,
    pgvectorVersion: vectorExt.rows[0]?.extversion ?? null,
    missingTables,
    missingColumns,
    missingIndexes,
    rlsDisabled,
    missingPolicies,
  });

  if (!ok) process.exitCode = 1;
} catch (error) {
  console.log("multiPhotoFaceArchitectureVerificationFailed:", {
    env: envName,
    dbSource: source,
    name: error.name,
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
