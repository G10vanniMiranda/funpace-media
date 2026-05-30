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
    instagram?: string;
    avatar_url?: string;
    cpf?: string;
    phone?: string;
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
  phone: string | null;
  cpf: string | null;
  emailVerified: boolean;
  role: string | null;
  isAdmin: boolean;
};

function getSessionStorageKey() {
  // Keep admin, photographer and customer auth isolated from each other.
  try {
    if (window.location.pathname.startsWith('/admin')) return 'funpace:supabase-session:admin';
    if (window.location.pathname.startsWith('/fotografo')) return 'funpace:supabase-session:photographer';
    return 'funpace:supabase-session:customer';
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

export function clearStoredSession(scope: 'admin' | 'customer' | 'photographer') {
  localStorage.removeItem(`funpace:supabase-session:${scope}`);
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
    phone: user.user_metadata?.phone ?? null,
    cpf: user.user_metadata?.cpf ?? null,
    emailVerified: true,
    role: user.app_metadata?.role ?? null,
    isAdmin: user.app_metadata?.role === 'admin' || user.app_metadata?.role === 'super_admin',
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
    let parsed: any = null;
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = null;
    }

    if (parsed) {
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
        msgUpper.includes('INFINITE RECURSION DETECTED IN POLICY') &&
        msgUpper.includes('ORDERS')
      ) {
        throw new Error('A politica de seguranca dos pedidos precisa ser atualizada. Aplique scripts/fix-order-rls-recursion.sql no Supabase e tente novamente.');
      }

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

export const getCurrentUser = () => toAppUser(getStoredSession()?.user ?? null);

export const getCurrentAccessToken = async (forceRefresh = false) => {
  const session = await refreshStoredSession(forceRefresh);
  return session?.access_token ?? null;
};

function clearOAuthParamsFromUrl() {
  const storedReturnPath = sessionStorage.getItem('funpace:oauth-return-path');
  sessionStorage.removeItem('funpace:oauth-return-path');
  const nextPath = storedReturnPath || (window.location.pathname === '/auth/callback' ? '/' : window.location.pathname);
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

export const loginWithGoogle = async (returnPath = window.location.pathname) => {
  assertSupabaseConfig();
  const redirectTo = `${window.location.origin}/auth/callback`;
  const codeVerifier = randomCodeVerifier();
  const codeChallenge = await createCodeChallenge(codeVerifier);
  sessionStorage.setItem('funpace:oauth-code-verifier', codeVerifier);
  sessionStorage.setItem('funpace:oauth-return-path', returnPath || '/');

  const url = new URL(`${supabaseConfig.url}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  url.searchParams.set('code_challenge', codeChallenge);
  url.searchParams.set('code_challenge_method', 's256');
  window.location.assign(url.toString());
};

// Call on app start: Supabase can return either PKCE `code` in query or legacy token data in hash.
export const handleOAuthCallbackFromUrl = async () => {
  if (window.location.pathname.startsWith('/fotografo/definir-senha')) {
    return false;
  }

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

export const completePasswordSetupFromUrl = async () => {
  const query = parseSearchParams(window.location.search);
  if (query.error) {
    throw new Error(decodeURIComponent(query.error_description || query.error));
  }

  const parsed = parseHashParams(window.location.hash);
  if (parsed.error) {
    throw new Error(decodeURIComponent(parsed.error_description || parsed.error));
  }

  if (!parsed.access_token) {
    return getCurrentUser();
  }

  if (!isJwtLikeToken(parsed.access_token)) {
    throw new Error('Link de definicao de senha invalido. Solicite um novo convite.');
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

  window.history.replaceState({}, '', window.location.pathname);
  window.dispatchEvent(new Event('supabase-auth-changed'));
  return toAppUser(user);
};

export const updateCurrentUserPassword = async (password: string) => {
  assertSupabaseConfig();

  const token = await getCurrentAccessToken();
  if (!token) {
    throw new Error('Link expirado. Solicite um novo convite para definir sua senha.');
  }

  const response = await fetch(`${supabaseConfig.url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ password }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Nao foi possivel atualizar a senha.');
  }

  const payload = await response.json() as SupabaseAuthUser | { user?: SupabaseAuthUser };
  const user = 'user' in payload && payload.user ? payload.user : payload as SupabaseAuthUser;
  const session = getStoredSession();
  if (session) {
    setStoredSession({ ...session, user });
  }

  window.dispatchEvent(new Event('supabase-auth-changed'));
  return toAppUser(user);
};

export const updateCurrentUserProfile = async (input: { name?: string; avatarUrl?: string; phone?: string | null; cpf?: string | null }) => {
  assertSupabaseConfig();

  const token = await getCurrentAccessToken();
  if (!token) {
    throw new Error('Entre novamente para atualizar seu perfil.');
  }

  const current = getCurrentUser();
  const response = await fetch(`${supabaseConfig.url}/auth/v1/user`, {
    method: 'PUT',
    headers: {
      apikey: supabaseConfig.anonKey,
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      data: {
        name: input.name,
        full_name: input.name,
        avatar_url: input.avatarUrl,
        phone: input.phone ?? current?.phone ?? null,
        cpf: input.cpf ?? current?.cpf ?? null,
      },
    }),
  });

  if (!response.ok) {
    const message = await response.text();
    throw new Error(message || 'Nao foi possivel atualizar seu perfil.');
  }

  const payload = await response.json() as SupabaseAuthUser | { user?: SupabaseAuthUser };
  const user = 'user' in payload && payload.user ? payload.user : payload as SupabaseAuthUser;
  const session = getStoredSession();
  if (session) {
    setStoredSession({ ...session, user });
  }

  window.dispatchEvent(new Event('supabase-auth-changed'));
  return toAppUser(user);
};

export const requestPasswordReset = async (email: string) => {
  assertSupabaseConfig();
  const redirectTo = `${window.location.origin}/minha-conta`;
  await supabaseFetch('/auth/v1/recover', {
    method: 'POST',
    body: JSON.stringify({ email, redirect_to: redirectTo }),
  });
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

export const registerWithEmail = async (email: string, password: string, name: string, cpf?: string, phone?: string | null, instagram?: string | null) => {
  const response = await supabaseFetch<SupabaseSignupResponse>('/auth/v1/signup', {
    method: 'POST',
    body: JSON.stringify({
      email,
      password,
      data: { name, cpf: cpf || null, phone: phone || null, instagram: instagram || null, preferred_username: instagram || null },
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
