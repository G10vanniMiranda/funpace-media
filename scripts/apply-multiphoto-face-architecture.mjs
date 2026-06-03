import fs from "node:fs/promises";
import pg from "pg";
import { getArgValue, getDbConfigForEnv, hasArg, parseEnvName } from "./db-env.mjs";

const envName = parseEnvName();
const dryRun = hasArg("--dry-run");
const confirmValue = getArgValue("--confirm");

if (process.env.ENABLE_DEFERRED_MULTIPHOTO_FACE_ARCHITECTURE !== "true") {
  console.error("Arquitetura multi-fotografo/face global esta adiada. Defina ENABLE_DEFERRED_MULTIPHOTO_FACE_ARCHITECTURE=true apenas quando a Fase 2 for retomada.");
  process.exit(1);
}

let envConfig;
try {
  envConfig = await getDbConfigForEnv(envName, { allowDefaultProduction: true });
} catch (error) {
  console.log("multiPhotoFaceArchitectureApplied:", false);
  console.log("failed:", {
    env: envName || null,
    name: error.name,
    message: error.message,
  });
  process.exit(1);
}
const { config, source } = envConfig;

if (envName === "production" && confirmValue !== "APPLY_PRODUCTION_MULTIPHOTO_FACE_ARCHITECTURE") {
  console.error("Para producao, use --confirm=APPLY_PRODUCTION_MULTIPHOTO_FACE_ARCHITECTURE depois de validar staging.");
  process.exit(1);
}

const sql = await fs.readFile(new URL("./add-multiphoto-face-architecture.sql", import.meta.url), "utf8");
const destructivePatterns = [
  /\bdrop\s+table\b/i,
  /\bdrop\s+column\b/i,
  /\btruncate\b/i,
  /\bdelete\s+from\b/i,
  /\balter\s+table\b[\s\S]*\bdrop\s+constraint\b/i,
  /\bdrop\s+schema\b/i,
];

const destructiveMatch = destructivePatterns.find((pattern) => pattern.test(sql));
if (destructiveMatch) {
  console.error("SQL rejeitado por conter padrao destrutivo:", String(destructiveMatch));
  process.exit(1);
}

const pool = new pg.Pool(config);

try {
  const vectorAvailability = await pool.query(
    "select name, default_version, installed_version from pg_available_extensions where name = 'vector'",
  );

  if (vectorAvailability.rows.length === 0) {
    console.log("pgvectorAvailable: false");
    console.log("Habilite a extensao vector/pgvector no Supabase antes de aplicar este patch.");
    process.exitCode = 1;
    return;
  }

  console.log("preflight:", {
    env: envName,
    dbSource: source,
    dryRun,
    pgvectorAvailable: true,
    pgvectorInstalled: Boolean(vectorAvailability.rows[0].installed_version),
    pgvectorDefaultVersion: vectorAvailability.rows[0].default_version,
  });

  await pool.query("begin");
  await pool.query(sql);

  if (dryRun) {
    await pool.query("rollback");
    console.log("multiPhotoFaceArchitectureApplied:", false);
    console.log("dryRunRollback:", true);
  } else {
    await pool.query("commit");
    console.log("multiPhotoFaceArchitectureApplied:", true);
  }
} catch (error) {
  try {
    await pool.query("rollback");
  } catch {
    // ignore rollback failures
  }

  console.log("multiPhotoFaceArchitectureApplied:", false);
  console.log("failed:", {
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
