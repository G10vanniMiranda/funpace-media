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

function getAuthToken(useAuth: boolean) {
  const session = getStoredSession();
  return useAuth && session?.access_token ? session.access_token : supabaseConfig.anonKey;
}

function toAppUser(user: SupabaseAuthUser | null): AppUser | null {
  if (!user) return null;

  const metadataName = user.user_metadata?.name ?? user.user_metadata?.full_name ?? null;

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

async function supabaseFetch<T>(path: string, init: RequestInit = {}, useAuth = false): Promise<T> {
  assertSupabaseConfig();

  const token = getAuthToken(useAuth);
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

    const response = await fetch(`${supabaseConfig.url}/storage/v1/object/${bucket}/${path}`, {
      method: 'POST',
      headers: {
        apikey: supabaseConfig.anonKey,
        Authorization: `Bearer ${getAuthToken(true)}`,
        'Content-Type': file.type || 'application/octet-stream',
        'x-upsert': 'false',
      },
      body: file,
    });

    if (!response.ok) {
      const message = await response.text();
      throw new Error(message || `Supabase storage upload failed with status ${response.status}`);
    }

    return {
      path,
      publicUrl: this.getPublicUrl(bucket, path),
    };
  },
};

export const getCurrentUser = () => toAppUser(getStoredSession()?.user ?? null);

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

export const loginWithGoogle = () => {
  assertSupabaseConfig();
  const redirectTo = `${window.location.origin}/`;
  const url = new URL(`${supabaseConfig.url}/auth/v1/authorize`);
  url.searchParams.set('provider', 'google');
  url.searchParams.set('redirect_to', redirectTo);
  // Use implicit flow for a lightweight integration without supabase-js.
  url.searchParams.set('response_type', 'token');
  window.location.assign(url.toString());
};

// Call on app start: when returning from Supabase OAuth, the session comes in the URL hash.
export const handleOAuthCallbackFromUrl = async () => {
  const parsed = parseHashParams(window.location.hash);
  if (!parsed.access_token) return false;

  if (parsed.error) {
    // Clear hash so it doesn't loop.
    window.history.replaceState({}, '', window.location.pathname + window.location.search);
    throw new Error(decodeURIComponent(parsed.error_description || parsed.error));
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

  // Remove hash after successful login.
  window.history.replaceState({}, '', window.location.pathname + window.location.search);
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
