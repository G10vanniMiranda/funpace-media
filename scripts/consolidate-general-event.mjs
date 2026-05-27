import fs from 'node:fs';
import path from 'node:path';

function loadEnv() {
  const envPath = path.resolve(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;

  const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separatorIndex = trimmed.indexOf('=');
    if (separatorIndex < 0) continue;

    const key = trimmed.slice(0, separatorIndex).trim();
    const rawValue = trimmed.slice(separatorIndex + 1).trim();
    if (!key || process.env[key]) continue;
    process.env[key] = rawValue.replace(/^['"]|['"]$/g, '');
  }
}

function requireEnv(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Variavel ${name} ausente.`);
  return value;
}

async function supabaseRequest(pathname, init = {}) {
  const url = `${requireEnv('SUPABASE_URL').replace(/\/+$/, '')}${pathname}`;
  const serviceRoleKey = requireEnv('SUPABASE_SERVICE_ROLE_KEY');
  const response = await fetch(url, {
    ...init,
    headers: {
      apikey: serviceRoleKey,
      Authorization: `Bearer ${serviceRoleKey}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  const raw = await response.text();
  const payload = raw ? JSON.parse(raw) : null;
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${raw}`);
  }

  return payload;
}

loadEnv();

const events = await supabaseRequest('/rest/v1/events?select=*&status=in.(scheduled,active)&order=createdAt.desc');
if (!Array.isArray(events) || events.length !== 1) {
  throw new Error(`Esperado exatamente 1 evento ativo/cadastrado, recebido ${events?.length ?? 0}. Nada foi alterado.`);
}

const [targetEvent] = events;
const targetName = String(targetEvent.name || '').trim();
const targetCheckpoint = String(targetEvent.checkpoint || targetEvent.location || 'Ponto Principal').trim();
if (!targetName) throw new Error('Evento alvo sem nome.');

const before = await supabaseRequest('/rest/v1/products?select=id,event,checkpoint&event=ilike.geral');
const updated = await supabaseRequest('/rest/v1/products?event=ilike.geral&select=id,event,checkpoint', {
  method: 'PATCH',
  headers: { Prefer: 'return=representation' },
  body: JSON.stringify({
    event: targetName,
    checkpoint: targetCheckpoint,
  }),
});

console.log(JSON.stringify({
  targetEvent: {
    id: targetEvent.id,
    name: targetName,
    checkpoint: targetCheckpoint,
  },
  matchedBefore: before.length,
  updated: updated.length,
}, null, 2));
