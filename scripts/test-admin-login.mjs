import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.API_KEY;
const email = "lucasromulocompany@gmail.com";
const password = "admin@123";

console.log("🔑 Testando login do admin...");
console.log("   Email:", email);

try {
  const response = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    },
    body: JSON.stringify({ email, password }),
  });

  const data = await response.json();

  if (!response.ok) {
    console.error("❌ Login falhou:", data);
    process.exit(1);
  }

  console.log("\n✅ LOGIN FUNCIONANDO!");
  console.log("\n📊 Dados do usuário:");
  console.log("   ID:", data.user.id);
  console.log("   Email:", data.user.email);
  console.log("   Email confirmado:", data.user.email_confirmed_at ? "✓ Sim" : "✗ Não");
  console.log("   Role:", data.user.app_metadata?.role);
  console.log("   É Admin:", data.user.app_metadata?.role === "admin" ? "✓ Sim" : "✗ Não");
  
  console.log("\n🔐 Token recebido:");
  console.log("   Tipo:", data.token_type);
  console.log("   Expira em: ~" + (data.expires_in / 3600).toFixed(0) + " horas");
  
  console.log("\n🎉 Admin pronto para usar o painel!");

} catch (error) {
  console.error("❌ Erro na requisição:", error.message);
  process.exit(1);
}
