import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const compiledServerPath = path.join(__dirname, "dist", "server.cjs");

if (!fs.existsSync(compiledServerPath)) {
  console.error("dist/server.cjs nao encontrado. Rode `npm run build` antes de iniciar com `node server.js`.");
  process.exit(1);
}

await import("./dist/server.cjs");
