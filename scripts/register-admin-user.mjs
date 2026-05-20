import dotenv from "dotenv";

dotenv.config();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY || process.env.API_KEY || process.env.ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
const email = "lucasromulocompany@gmail.com";
const password = "admin@123";

if (!SUPABASE_URL || !ANON_KEY) {
  console.error("❌ ERRO: SUPABASE_URL ou ANON_KEY não configurados");
  console.error("   SUPABASE_URL:", SUPABASE_URL);
  console.error("   ANON_KEY:", ANON_KEY ? "✓" : "✗");
  process.exit(1);
}

console.log("🔐 Registrando usuário admin...");
console.log("   Email:", email);
console.log("   Supabase URL:", SUPABASE_URL);

try {
  const signupResponse = await fetch(`${SUPABASE_URL}/auth/v1/signup`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  const signupData = await signupResponse.json();

  if (!signupResponse.ok) {
    console.error("❌ Erro ao registrar usuário:");
    console.error(signupData);
    
    // Se o usuário já existe, tenta fazer login para confirmar
    if (signupData?.error_code === "user_already_exists") {
      console.log("\n⚠️  Usuário já existe. Testando login...");
      
      const loginResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: ANON_KEY,
        },
        body: JSON.stringify({
          email,
          password,
        }),
      });

      const loginData = await loginResponse.json();

      if (!loginResponse.ok) {
        console.error("❌ Erro ao fazer login:", loginData);
        process.exit(1);
      }

      console.log("✅ Login bem-sucedido!");
      console.log("   ID do usuário:", loginData.user.id);
      console.log("   Email:", loginData.user.email);
      process.exit(0);
    }
    
    process.exit(1);
  }

  console.log("✅ Usuário registrado com sucesso!");
  console.log("   ID:", signupData.user?.id);
  console.log("   Email:", signupData.user?.email);
  
  // Testa o login para confirmar
  console.log("\n🔑 Testando login...");
  
  const loginResponse = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=password`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: ANON_KEY,
    },
    body: JSON.stringify({
      email,
      password,
    }),
  });

  const loginData = await loginResponse.json();

  if (!loginResponse.ok) {
    console.error("❌ Erro ao fazer login:", loginData);
    process.exit(1);
  }

  console.log("✅ Login funcionando!");
  console.log("   Access Token recebido");
  console.log("   Role atual:", loginData.user?.app_metadata?.role || "user");
  
  console.log("\n📋 Próximo passo: Execute 'npm run supabase:admin:set -- lucasromulocompany@gmail.com'");
  console.log("   Isto definirá o usuário como admin.");

} catch (error) {
  console.error("❌ Erro na requisição:", error.message);
  process.exit(1);
}
