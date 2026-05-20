import dotenv from "dotenv";
import pg from "pg";

dotenv.config();

const email = "lucasromulocompany@gmail.com";
const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || "";
const supabaseRef = SUPABASE_URL.match(/^https:\/\/([^.]+)\.supabase\.co$/)?.[1];

const dbConfig = process.env.DATABASE_URL
  ? { connectionString: process.env.DATABASE_URL, ssl: { rejectUnauthorized: false } }
  : {
      host: process.env.HOST || (supabaseRef ? `db.${supabaseRef}.supabase.co` : undefined),
      port: Number(process.env.DB_PORT || 5432),
      database: process.env.DATABASE || "postgres",
      user: process.env.DB_USER || "postgres",
      password: process.env.POSTGRES_PASSWORD || process.env.RAILS_MASTER_KEY,
      ssl: { rejectUnauthorized: false },
      connectionTimeoutMillis: 15000,
    };

console.log("📧 Confirmando email do usuário...");
console.log("   Email:", email);
console.log("   Host:", dbConfig.host);

const pool = new pg.Pool(dbConfig);

try {
  // Confirma o email no banco de dados
  const result = await pool.query(
    `
      update auth.users
      set email_confirmed_at = now()
      where lower(email) = lower($1)
      returning id, email, email_confirmed_at
    `,
    [email],
  );

  if (result.rowCount === 0) {
    console.error("❌ Usuário não encontrado");
    process.exit(1);
  }

  console.log("✅ Email confirmado!");
  console.log("   ID:", result.rows[0].id);
  console.log("   Email:", result.rows[0].email);
  console.log("   Confirmado em:", result.rows[0].email_confirmed_at);

  // Agora marca como admin
  console.log("\n🔐 Marcando como admin...");
  
  const adminResult = await pool.query(
    `
      update auth.users
      set raw_app_meta_data = coalesce(raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', 'admin')
      where lower(email) = lower($1)
      returning id, email, raw_app_meta_data
    `,
    [email],
  );

  if (adminResult.rowCount === 0) {
    console.error("❌ Erro ao marcar como admin");
    process.exit(1);
  }

  console.log("✅ Usuário marcado como admin!");
  console.log("   Role:", adminResult.rows[0].raw_app_meta_data?.role);

  console.log("\n🎉 Tudo pronto! Agora você pode fazer login com:");
  console.log("   Email: " + email);
  console.log("   Senha: admin@123");

} catch (error) {
  console.error("❌ Erro:", error.message);
  if (error.code === 'ECONNREFUSED') {
    console.error("\n⚠️  Não foi possível conectar ao banco de dados.");
    console.error("   Verifique se as credenciais estão corretas em .env");
    console.error("   - RAILS_MASTER_KEY");
    console.error("   - DATABASE_URL ou configurações de host/port");
  }
  process.exit(1);
} finally {
  await pool.end();
}
