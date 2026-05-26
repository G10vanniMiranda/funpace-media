export const config = {
  api: {
    bodyParser: false,
  },
};

const mediaStorageProvider = process.env.MEDIA_STORAGE_PROVIDER || 'supabase';
const mediaBucket = process.env.MEDIA_BUCKET || process.env.BUCKET || '';
const externalBucketApiBaseUrl = (process.env.BUCKET_API_BASE_URL || 'https://99dev.pro/bucket/bucket/api').replace(/\/+$/, '');
const externalBucketToken = process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN || '';

function usesExternalBucket() {
  return mediaStorageProvider === 'external_bucket' || Boolean(process.env.BUCKET_API_TOKEN || process.env.BUCKET_X_API_TOKEN);
}

function getSupabaseConfig() {
  const supabaseUrl = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.VITE_SUPABASE_URL || '';
  const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.SERVICE_ROLE_KEY || '';

  if (!supabaseUrl || !supabaseKey) {
    throw new Error('SUPABASE_URL ou SUPABASE_SERVICE_ROLE_KEY nao configurado.');
  }

  return {
    supabaseUrl: supabaseUrl.replace(/\/+$/, ''),
    supabaseKey,
  };
}

function assertMediaBucketConfigured() {
  if (!mediaBucket) {
    throw new Error('MEDIA_BUCKET nao configurado no servidor.');
  }
}

function getBearerToken(req: any) {
  const header = String(req.headers.authorization || '');
  const match = header.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || '';
}

async function getAuthenticatedRequestUser(req: any): Promise<{ id: string; email: string | null } | null> {
  const token = getBearerToken(req);
  if (!token) return null;

  const { supabaseUrl, supabaseKey } = getSupabaseConfig();
  const response = await fetch(`${supabaseUrl}/auth/v1/user`, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) return null;

  const user: any = await response.json().catch(() => null);
  return user?.id ? { id: String(user.id), email: user.email ? String(user.email).toLowerCase() : null } : null;
}

function readRequestBuffer(req: any): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function decodeHeaderValue(value: string | string[] | undefined) {
  const raw = Array.isArray(value) ? value[0] : value;
  if (!raw) return '';

  try {
    return decodeURIComponent(raw);
  } catch {
    return raw;
  }
}

function createPublicMediaUrl(path: string) {
  if (/^https?:\/\//i.test(path)) return path;

  const mediaBaseUrl = process.env.MEDIA_PUBLIC_BASE_URL || process.env.VITE_MEDIA_PUBLIC_BASE_URL || '';
  if (mediaBaseUrl) {
    return `${mediaBaseUrl.replace(/\/+$/, '')}/${encodeURI(path.replace(/^\/+/, ''))}`;
  }

  return path;
}

function pickUploadedMediaUrl(payload: any) {
  const candidates = [
    payload?.url,
    payload?.publicUrl,
    payload?.public_url,
    payload?.downloadUrl,
    payload?.download_url,
    payload?.file?.url,
    payload?.file?.publicUrl,
    payload?.arquivo?.url,
    payload?.data?.url,
    payload?.data?.publicUrl,
  ];

  return candidates.find((value) => typeof value === 'string' && /^https?:\/\//i.test(value)) || '';
}

function cleanProviderErrorMessage(raw: string, fallback: string) {
  const withoutTags = raw
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const decoded = withoutTags
    .replace(/&nbsp;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .trim();

  if (/sess[aã]o expirada/i.test(decoded)) {
    return 'Credencial do bucket expirada ou invalida. Gere um novo BUCKET_API_TOKEN no provedor, atualize o .env/deploy e reinicie o backend.';
  }

  return decoded || fallback;
}

async function uploadToExternalBucket(path: string, fileName: string, contentType: string, buffer: Buffer) {
  if (!externalBucketToken) throw new Error('BUCKET_API_TOKEN nao configurado no servidor.');
  assertMediaBucketConfigured();

  const formData = new FormData();
  const safeFileName = path.split('/').pop() || fileName || 'arquivo';
  formData.set('bucket', mediaBucket);
  formData.set('arquivo', new Blob([buffer], { type: contentType || 'application/octet-stream' }), safeFileName);

  const response = await fetch(`${externalBucketApiBaseUrl}/upload`, {
    method: 'POST',
    headers: {
      'X-API-Token': externalBucketToken,
    },
    body: formData,
  });

  const raw = await response.text();
  let payload: any = {};
  try {
    payload = raw ? JSON.parse(raw) : {};
  } catch {
    payload = { raw };
  }

  if (!response.ok) {
    const providerMessage = payload?.error || payload?.message || payload?.raw || raw;
    throw new Error(cleanProviderErrorMessage(String(providerMessage || ''), `Upload externo falhou com status ${response.status}.`));
  }

  const publicUrl = pickUploadedMediaUrl(payload);
  return {
    path: publicUrl || payload?.path || payload?.key || path,
    publicUrl,
  };
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Metodo nao permitido.' });
  }

  try {
    const authUser = await getAuthenticatedRequestUser(req);
    const storagePath = decodeHeaderValue(req.headers['x-storage-path']);
    const fileName = decodeHeaderValue(req.headers['x-file-name']) || storagePath.split('/').pop() || 'arquivo';
    const contentType = String(req.headers['content-type'] || 'application/octet-stream');
    const fileBuffer = await readRequestBuffer(req);

    if (!authUser?.id) {
      return res.status(401).json({ error: 'Entre novamente no painel para enviar arquivos.' });
    }

    if (!storagePath || storagePath.includes('..') || storagePath.startsWith('/') || !storagePath.startsWith(`${authUser.id}/`)) {
      return res.status(403).json({ error: 'Caminho de upload invalido para este fotografo.' });
    }

    if (fileBuffer.length === 0) {
      return res.status(400).json({ error: 'Arquivo vazio ou nao enviado.' });
    }

    const uploaded = usesExternalBucket()
      ? await uploadToExternalBucket(storagePath, fileName, contentType, fileBuffer)
      : (() => {
          throw new Error('MEDIA_STORAGE_PROVIDER deve ser external_bucket para upload de midias.');
        })();

    return res.status(200).json({
      path: uploaded.publicUrl || uploaded.path,
      publicUrl: uploaded.publicUrl || uploaded.path,
    });
  } catch (error: any) {
    return res.status(500).json({ error: error?.message || 'Nao foi possivel enviar a midia.' });
  }
}
