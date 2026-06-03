import dotenv from "dotenv";
import dns from "node:dns";

dotenv.config();
dns.setDefaultResultOrder("ipv4first");

export function parseEnvName(argv = process.argv.slice(2)) {
  const envArg = argv.find((arg) => arg.startsWith("--env="));
  return (envArg?.split("=")[1] || "").trim().toLowerCase();
}

export function hasArg(name, argv = process.argv.slice(2)) {
  return argv.includes(name);
}

export function getArgValue(name, argv = process.argv.slice(2)) {
  const prefix = `${name}=`;
  return argv.find((arg) => arg.startsWith(prefix))?.slice(prefix.length) || "";
}

function readFirstEnv(names) {
  for (const name of names) {
    const value = process.env[name];
    if (value) return value;
  }
  return "";
}

export async function getDbConfigForEnv(envName, { allowDefaultProduction = false } = {}) {
  if (!["staging", "production"].includes(envName)) {
    throw new Error("Informe --env=staging ou --env=production.");
  }

  const upper = envName.toUpperCase();
  const connectionString = readFirstEnv([
    `${upper}_DATABASE_URL`,
    `DATABASE_URL_${upper}`,
    ...(envName === "production" && allowDefaultProduction ? ["DATABASE_URL"] : []),
  ]);

  if (connectionString) {
    return {
      config: { connectionString, ssl: { rejectUnauthorized: false } },
      source: connectionString === process.env.DATABASE_URL ? "DATABASE_URL" : `${upper}_DATABASE_URL`,
    };
  }

  const supabaseUrl = readFirstEnv([
    `${upper}_SUPABASE_URL`,
    `SUPABASE_URL_${upper}`,
    ...(envName === "production" && allowDefaultProduction ? ["SUPABASE_URL", "VITE_SUPABASE_URL"] : []),
  ]);
  const supabaseRef = supabaseUrl.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];
  const host = readFirstEnv([`${upper}_DB_HOST`, `DB_HOST_${upper}`]) || (supabaseRef ? `db.${supabaseRef}.supabase.co` : "");
  const password = readFirstEnv([
    `${upper}_DB_PASSWORD`,
    `${upper}_POSTGRES_PASSWORD`,
    `${upper}_PGPASSWORD`,
    `DB_PASSWORD_${upper}`,
    `POSTGRES_PASSWORD_${upper}`,
    ...(envName === "production" && allowDefaultProduction ? ["DB_PASSWORD", "POSTGRES_PASSWORD", "PGPASSWORD", "POSTGRES"] : []),
  ]);

  if (!host || !password) {
    throw new Error(
      envName === "staging"
        ? "Staging nao configurado. Defina STAGING_DATABASE_URL ou STAGING_SUPABASE_URL + STAGING_DB_PASSWORD."
        : "Producao nao configurada. Defina PRODUCTION_DATABASE_URL, DATABASE_URL, ou SUPABASE_URL + senha.",
    );
  }

  let resolvedHost = host;
  if (/[a-z]/i.test(host)) {
    try {
      const lookup = await dns.promises.lookup(host, { family: 4 });
      if (lookup?.address) resolvedHost = lookup.address;
    } catch {
      // pg will surface the connection failure.
    }
  }

  return {
    config: {
      host: resolvedHost,
      port: Number(readFirstEnv([`${upper}_DB_PORT`, `DB_PORT_${upper}`]) || 5432),
      database: readFirstEnv([`${upper}_DATABASE`, `${upper}_PGDATABASE`, `DATABASE_${upper}`]) || "postgres",
      user: readFirstEnv([`${upper}_DB_USER`, `${upper}_PGUSER`, `DB_USER_${upper}`]) || "postgres",
      password,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    },
    source: `${upper}_DB_*`,
  };
}
