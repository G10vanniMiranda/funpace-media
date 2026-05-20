import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const adminEmail = process.argv[2] || process.env.ADMIN_EMAIL;

if (!adminEmail) {
  console.log("missingAdminEmail: passe o e-mail como argumento. Ex: npm run supabase:admin:set -- admin@exemplo.com");
  process.exit(1);
}

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

const pool = new pg.Pool(dbConfig);

try {
  const result = await pool.query(
    `
      update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
      where lower(email) = lower($1)
      returning id, email, raw_app_meta_data
    `,
    [adminEmail],
  );

  if (result.rowCount === 0) {
    console.log("adminSet: false");
    console.log("reason: usuario nao encontrado em auth.users");
    process.exitCode = 1;
  } else {
    console.log("adminSet: true");
    console.log("user:", {
      id: result.rows[0].id,
      email: result.rows[0].email,
      role: result.rows[0].raw_app_meta_data?.role,
    });
  }
} catch (error) {
  console.log("adminSet: false");
  console.log("failed:", {
    name: error.name,
    code: error.code,
    message: error.message,
  });
  process.exitCode = 1;
} finally {
  await pool.end();
}
