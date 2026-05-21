declare const __SUPABASE_URL__: string;
declare const __SUPABASE_ANON_KEY__: string;

type SupabaseSession = {
  access_token: string;
  refresh_token?: string;
  expires_at?: number;
  user: SupabaseAuthUser;
};

type SupabaseSignupResponse = Partial<SupabaseSession> & {
  user?: SupabaseAuthUser;
};

type SupabaseUserResponse = SupabaseAuthUser;

export type SupabaseAuthUser = {
  id: string;
  email?: string;
  user_metadata?: {
    name?: string;
    full_name?: string;
    display_name?: string;
    preferred_username?: string;
    avatar_url?: string;
    cpf?: string;
  };
  app_metadata?: {
    role?: string;
  };
};

export type AppUser = {
  uid: string;
  id: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  cpf: string | null;
  emailVerified: boolean;
  role: string | null;
  isAdmin: boolean;
};

function getSessionStorageKey() {
  // Keep admin auth isolated from customer auth. This prevents admin login from leaking into the storefront.
  // `/admin` uses its own key, everything else uses the customer key.
  try {
    return window.location.pathname.startsWith('/admin')
      ? 'funpace:supabase-session:admin'
      : 'funpace:supabase-session:customer';
  } catch {
    // In non-browser contexts, fall back to the customer key.
    return 'funpace:supabase-session:customer';
  }
}

export const supabaseConfig = {
  url: __SUPABASE_URL__,
  anonKey: __SUPABASE_ANON_KEY__,
};

function assertSupabaseConfig() {
  if (!supabaseConfig.url || !supabaseConfig.anonKey) {
    throw new Error('Supabase nao configurado. Defina NEXT_PUBLIC_SUPABASE_URL e NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY.');
  }
}

function getStoredSession(): SupabaseSession | null {
  const raw = localStorage.getItem(getSessionStorageKey());
  if (!raw) return null;

  try {
    return JSON.parse(raw) as SupabaseSession;
  } catch {
    localStorage.removeItem(getSessionStorageKey());
    return null;
  }
}

function setStoredSession(session: SupabaseSession | null) {
  if (!session) {
    localStorage.removeItem(getSessionStorageKey());
    return;
  }

  localStorage.setItem(getSessionStorageKey(), JSON.stringify(session));
}

async function refreshStoredSession(force = false): Promise<SupabaseSession | null> {
  const session = getStoredSession();
  if (!session) return null;

  const expiresAtMs = session.expires_at ? session.expires_at * 1000 : 0;
  const hasUsableAccessToken = session.access_token && (!expiresAtMs || expiresAtMs > Date.now() + 60_000);

  if (!force && hasUsableAccessToken) {
    return session;
  }

  if (!session.refresh_token) {
    setStoredSession(null);
    window.dispatchEvent(new Event('supabase-auth-changed'));
    throw new Error('Sessao expirada. Entre novamente para continuar.');
  }

  assertSupabaseConfig();
  const response = await fetch(`${supabaseConfig.url}/auth/v1/token?grant_type=refresh_token`, {
    method: 'POST',
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${supabaseConfig.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ refresh_token: session.refresh_token }),
  });

  if (!response.ok) {
    setStoredSession(null);
    window.dispatchEvent(new Event('supabase-auth-changed'));
    throw new Error('Sessao expirada. Entre novamente para continuar.');
  }

  const refreshed = await response.json() as SupabaseSession;
  const nextSession = {
    ...refreshed,
    user: refreshed.user ?? session.user,
  };
  setStoredSession(nextSession);
  window.dispatchEvent(new Event('supabase-auth-changed'));
  return nextSession;
}

async function getAuthToken(useAuth: boolean) {
  const session = getStoredSession();
  if (!useAuth) return supabaseConfig.anonKey;
  if (!session?.access_token) {
    throw new Error('Sessao de fotografo ausente. Entre novamente no painel para enviar arquivos.');
  }
  return (await refreshStoredSession())?.access_token ?? supabaseConfig.anonKey;
}

function toAppUser(user: SupabaseAuthUser | null): AppUser | null {
  if (!user) return null;

  const metadataName =
    user.user_metadata?.name ||
    user.user_metadata?.full_name ||
    user.user_metadata?.display_name ||
    user.user_metadata?.preferred_username ||
    null;

  return {
    uid: user.id,
    id: user.id,
    email: user.email ?? null,
    // Do not fall back to email here; UI can choose a safe fallback without exposing the full address.
    displayName: metadataName,
    photoURL: user.user_metadata?.avatar_url ?? null,
    cpf: user.user_metadata?.cpf ?? null,
    emailVerified: true,
    role: user.app_metadata?.role ?? null,
    isAdmin: user.app_metadata?.role === 'admin',
  };
}

async function supabaseFetch<T>(path: string, init: RequestInit = {}, useAuth = false, retriedAuth = false): Promise<T> {
  assertSupabaseConfig();

  const token = await getAuthToken(useAuth);
  const response = await fetch(`${supabaseConfig.url}${path}`, {
    ...init,
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    const raw = await response.text();
    const rawUpper = raw.toUpperCase();

    if (
      useAuth &&
      !retriedAuth &&
      (
        rawUpper.includes('EXP') && rawUpper.includes('TIMESTAMP') ||
        rawUpper.includes('JWT EXPIRED') ||
        rawUpper.includes('INVALID JWT')
      )
    ) {
      await refreshStoredSession(true);
      return supabaseFetch<T>(path, init, useAuth, true);
    }

    // Supabase errors are often JSON strings; surface a human message when possible.
    try {
      const parsed = JSON.parse(raw);
      const errorCodeRaw = String(
        parsed?.error_code ||
        parsed?.ERROR_CODE ||
        parsed?.code ||
        parsed?.CODE ||
        parsed?.error ||
        parsed?.ERROR ||
        '',
      );
      const errorCode = errorCodeRaw.toUpperCase();
      const msg = String(
        parsed?.msg ||
        parsed?.MSG ||
        parsed?.message ||
        parsed?.MESSAGE ||
        parsed?.error_description ||
        parsed?.ERROR_DESCRIPTION ||
        parsed?.error ||
        parsed?.ERROR ||
        raw ||
        '',
      );

      const msgUpper = msg.toUpperCase();

      if (
        errorCode === 'INVALID_API_KEY' ||
        msgUpper.includes('INVALID API KEY') ||
        msgUpper.includes('SUPABASE_ANON') ||
        msgUpper.includes('SERVICE_ROLE API KEY')
      ) {
        throw new Error('Chave do Supabase invalida. Confira VITE_SUPABASE_PUBLISHABLE_KEY ou VITE_SUPABASE_ANON_KEY no .env e reinicie o servidor.');
      }

      if (
        errorCode === 'INVALID_CREDENTIALS' ||
        errorCode === 'INVALID_LOGIN_CREDENTIALS' ||
        errorCode.includes('INVALID_CREDENTIAL') ||
        msgUpper.includes('INVALID_LOGIN_CREDENTIALS') ||
        msgUpper.includes('INVALID LOGIN CREDENTIALS') ||
        msgUpper.includes('INVALID_CREDENTIALS')
      ) {
        throw new Error('Login ou senha incorretos.');
      }

      if (
        errorCode === 'EMAIL_NOT_CONFIRMED' ||
        errorCode === 'EMAIL_NOT_CONFIRMED_ERROR' ||
        errorCode === 'EMAIL_NOT_CONFIRMED_EXCEPTION' ||
        errorCode.includes('EMAIL_NOT_CONFIRMED') ||
        msgUpper.includes('EMAIL_NOT_CONFIRMED') ||
        msgUpper.includes('EMAIL NOT CONFIRMED') ||
        msgUpper.includes('NOT CONFIRMED')
      ) {
        throw new Error('E-mail nao confirmado. Verifique sua caixa de entrada e SPAM para confirmar, ou use Google para entrar.');
      }

      if (msg) throw new Error(msg);
    } catch {
      // ignore JSON parse errors
    }

    throw new Error(raw || `Supabase request failed with status ${response.status}`);
  }

  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}

export const supabaseRest = {
  get<T>(path: string, useAuth = false) {
    return supabaseFetch<T>(path, { method: 'GET' }, useAuth);
  },

  post<T>(path: string, body: unknown, useAuth = false) {
    return supabaseFetch<T>(
      path,
      {
        method: 'POST',
        body: JSON.stringify(body),
        headers: { Prefer: 'return=representation' },
      },
      useAuth,
    );
  },

  patch<T>(path: string, body: unknown, useAuth = false) {
    return supabaseFetch<T>(
      path,
      {
        method: 'PATCH',
        body: JSON.stringify(body),
        headers: { Prefer: 'return=representation' },
      },
      useAuth,
    );
  },
};

export const supabaseStorage = {
  getPublicUrl(bucket: string, path: string) {
    assertSupabaseConfig();
    return `${supabaseConfig.url}/storage/v1/object/public/${bucket}/${path}`;
  },

  async upload(bucket: string, path: string, file: File) {
    assertSupabaseConfig();

    const token = await getAuthToken(true);
    const response = await fetch(`${supabaseConfig.url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${token}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: file,
    });

    if (!response.ok) {
      const raw = await response.text();
      let message = raw || `Supabase storage upload failed with status ${response.status}`;

      if (
        raw.toUpperCase().includes('EXP') && raw.toUpperCase().includes('TIMESTAMP') ||
        raw.toUpperCase().includes('JWT EXPIRED') ||
        raw.toUpperCase().includes('INVALID JWT')
      ) {
        await refreshStoredSession(true);
        return this.upload(bucket, path, file);
      }

      try {
        const parsed = JSON.parse(raw);
        message = parsed?.message || parsed?.msg || parsed?.error || raw || message;
      } catch {
        // Keep raw text when Supabase does not return JSON.
      }

      const normalized = message.toLowerCase();
      if (normalized.includes('row-level security') || normalized.includes('violates policy')) {
        throw new Error('Upload bloqueado pela policy do Supabase Storage. Confirme se o fotografo esta aprovado e se o arquivo esta sendo enviado para a pasta do proprio usuario.');
      }

      if (normalized.includes('mime') || normalized.includes('not allowed')) {
        throw new Error(`Tipo de arquivo nao permitido no bucket funpace-media: ${file.type || file.name}`);
      }

      if (normalized.includes('payload') || normalized.includes('too large') || response.status === 413) {
        throw new Error(`Arquivo muito grande para upload: ${file.name}`);
      }

      throw new Error(message);
    }

    return {
      path,
      publicUrl: this.getPublicUrl(bucket, path),
    };
  },
};

export const getCurrentUser = () => toAppUser(getStoredSession()?.user ?? null);

function clearOAuthParamsFromUrl() {
  const nextPath = window.location.pathname === '/auth/callback' ? '/' : window.location.pathname;
  window.history.replaceState({}, '', nextPath);
}

function parseHashParams(hash: string) {
  const raw = hash.startsWith('#') ? hash.slice(1) : hash;
  const params = new URLSearchParams(raw);
  return {
    access_token: params.get('access_token') ?? '',
    refresh_token: params.get('refresh_token') ?? undefined,
    expires_in: params.get('expires_in') ?? undefined,
    expires_at: params.get('expires_at') ?? undefined,
    type: params.get('type') ?? undefined,
    error: params.get('error') ?? undefined,
    error_description: params.get('error_description') ?? undefined,
  };
}

function parseSearchParams(search: string) {
  const params = new URLSearchParams(search);
  return {
    code: params.get('code') ?? '',
    error: params.get('error') ?? '',
    error_description: params.get('error_description') ?? '',
  };
}

function isJwtLikeToken(token: string) {
  return token.split('.').length === 3;
}

function base64UrlEncode(input: ArrayBuffer) {
  return btoa(String.fromCharCode(...new Uint8Array(input)))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomCodeVerifier() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return base64UrlEncode(bytes.buffer);
}

async function createCodeChallenge(verifier: string) {
  const data = new TextEncoder().encode(verifier);
  const digest = await crypto.subtle.digest('SHA-256', data);
  return base64UrlEncode(digest);
}

async function exchangeOAuthCodeForSession(code: string) {
  assertSupabaseConfig();
  const codeVerifier = sessionStorage.getItem('funpace:oauth-code-verifier');
  sessionStorage.removeItem('funpace:oauth-code-verifier');

  if (!codeVerifier) {
    throw new Error('Sessao OAuth expirada. Tente entrar com Google novamente.');
  }

  const response = await fetch(`${supabaseConfig.url}/auth/v1/token?grant_type=pkce`, {
    method: 'POST',
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${supabaseConfig.anonKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      auth_code: code,
      code_verifier: codeVerifier,
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase OAuth exchange failed with status ${response.status}`);
  }

  return response.json() as Promise<SupabaseSession>;
}

async function fetchUserWithToken(accessToken: string) {
  assertSupabaseConfig();
  const response = await fetch(`${supabaseConfig.url}/auth/v1/user`, {
    method: 'GET',
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || `Supabase user request failed with status ${response.status}`);
  }

  return response.json() as Promise<SupabaseUserResponse>;
}

export const validateGoogleAuth = async () => {
  let response: Response;
  let payload: any = {};

  try {
    response = await fetch('/api/auth/google/status', {
      headers: { Accept: 'application/json' },
    });
    const contentType = response.headers.get('content-type') || '';
    payload = contentType.includes('application/json')
      ? await response.json().catch(() => ({}))
      : {};
  } catch (error) {
    console.warn('Nao foi possivel validar Google OAuth no backend; continuando pelo Supabase.', error);
    return true;
  }

  if (response.status === 404 || response.status === 405) {
    console.warn('Endpoint /api/auth/google/status indisponivel; continuando pelo Supabase.');
    return true;
  }

  if (!response.ok || !payload?.enabled) {
    const providerDisabled = String(payload?.error || '').toLowerCase().includes('provider is not enabled') ||
      String(payload?.error || '').toLowerCase().includes('unsupported provider');
    const redirectMismatch = String(payload?.error || '').toLowerCase().includes('callback') ||
      String(payload?.error || '').toLowerCase().includes('redirect_uri');

    throw new Error(
      providerDisabled
        ? 'Login com Google ainda nao esta habilitado no Supabase. Ative o provider Google em Authentication > Providers.'
        : redirectMismatch
          ? `Google OAuth precisa autorizar a URL de callback: ${payload?.redirectUri || 'confira o redirect URI no Google Cloud.'}`
        : payload?.error || 'Nao foi possivel validar o login com Google.',
    );
  }

  return true;
};

export const loginWithGoogle = async () => {
  assertSupabaseConfig();
  const redirectTo = `${window.location.origin}/auth/callback`;
  const codeVerifier = randomCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  sessionStorage.setItem('funpace:oauth-code-verifier', codeVerifier);

  const url = new URL(`${supabaseConfig.url}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 's256');
  window.location.assign(url.toString());
};

// Call on app start: Supabase can return either PKCE `code` in query or legacy token data in hash.
export const handleOAuthCallbackFromUrl = async () => {
  const query = parseSearchParams(window.location.search);
  if (query.error) {
    clearOAuthParamsFromUrl();
    throw new Error(decodeURIComponent(query.error_description || query.error));
  }

  if (query.code) {
    const session = await exchangeOAuthCodeForSession(query.code);
    if (!session?.access_token || !session?.user) {
      clearOAuthParamsFromUrl();
      throw new Error('Supabase nao retornou uma sessao valida no login com Google.');
    }

    setStoredSession(session);
    clearOAuthParamsFromUrl();
    window.dispatchEvent(new Event('supabase-auth-changed'));
    return true;
  }

  const parsed = parseHashParams(window.location.hash);

  if (parsed.error) {
    clearOAuthParamsFromUrl();
    throw new Error(decodeURIComponent(parsed.error_description || parsed.error));
  }

  if (!parsed.access_token) return false;

  if (!isJwtLikeToken(parsed.access_token)) {
    clearOAuthParamsFromUrl();
    throw new Error('Retorno OAuth invalido: o Supabase nao retornou um access_token JWT valido.');
  }

  const expiresAt = parsed.expires_at
    ? Number(parsed.expires_at)
    : parsed.expires_in
      ? Math.floor(Date.now() / 1000) + Number(parsed.expires_in)
      : undefined;

  const user = await fetchUserWithToken(parsed.access_token);
  setStoredSession({
    access_token: parsed.access_token,
    refresh_token: parsed.refresh_token,
    expires_at: expiresAt,
    user,
  });

  clearOAuthParamsFromUrl();
  window.dispatchEvent(new Event('supabase-auth-changed'));
  return true;
};

export const loginWithEmail = async (email: string, password: string) => {
  const session = await supabaseFetch<SupabaseSession>('/auth/v1/token?grant_type=password', {
    method: 'POST',
    body: JSON.stringify({ email, password }),
  });
  setStoredSession(session);
  window.dispatchEvent(new Event('supabase-auth-changed'));
  return toAppUser(session.user);
};

export const registerWithEmail = async (email: string, password: string, name: string, cpf?: string) => {
  const response = await supabaseFetch<SupabaseSignupResponse>('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      data: { name, cpf: cpf || null },
    }),
  });

  if (response.access_token && response.user) {
    setStoredSession(response as SupabaseSession);
  }

  window.dispatchEvent(new Event('supabase-auth-changed'));
  return toAppUser(response.user ?? null);
};

export const logout = async () => {
  const session = getStoredSession();

  if (session?.access_token) {
    try {
      await supabaseFetch('/auth/v1/logout', { method: 'POST' }, true);
    } catch {
      // Local logout should still complete if the remote session is already invalid.
    }
  }

  setStoredSession(null);
  window.dispatchEvent(new Event('supabase-auth-changed'));
};
