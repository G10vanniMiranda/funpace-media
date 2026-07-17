import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import fs from 'node:fs/promises';

const repositoryFiles = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { encoding: 'utf8' })
  .split(/\r?\n/).map((value) => value.trim()).filter(Boolean)
  .filter((file) => !file.startsWith('dist/') && !file.startsWith('node_modules/'));
const localRuntimeFiles = (await fs.readdir('.', { withFileTypes: true }))
  .filter((entry) => entry.isFile() && /\.(?:log|tmp|bak)$/i.test(entry.name))
  .map((entry) => entry.name);
const files = [...new Set([...repositoryFiles, ...localRuntimeFiles])];

const signatures = [
  ['private_key', /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/],
  ['aws_access_key', /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/],
  ['credential_url', /(?:postgres(?:ql)?|redis):\/\/[^\s/:]+:[^\s/@]+@/i],
  ['bearer_literal', /\bBearer\s+[A-Za-z0-9._~+/=-]{24,}/],
];
const sensitiveNames = /SECRET|TOKEN|PASSWORD|DATABASE_URL|SERVICE_ROLE|AWS_ACCESS_KEY/i;
const localSecrets = Object.entries(process.env)
  .filter(([name, value]) => sensitiveNames.test(name) && String(value || '').length >= 12)
  .map(([name, value]) => [name, String(value)]);
const findings = [];

for (const file of files) {
  let content;
  try { content = await fs.readFile(file, 'utf8'); } catch { continue; }
  for (const [kind, pattern] of signatures) if (pattern.test(content)) findings.push({ file, kind });
  for (const [name, secret] of localSecrets) if (content.includes(secret)) findings.push({ file, kind: 'local_secret_match', variable: name });
}

console.log(JSON.stringify({ scannedFiles: files.length, findings, passed: findings.length === 0 }, null, 2));
if (findings.length) process.exitCode = 1;
