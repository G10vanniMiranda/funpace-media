import { createContext, useContext, useEffect, useState, ReactNode } from 'react';
import { AppUser, getCurrentUser } from '../lib/supabase';

interface AuthContextType {
  user: AppUser | null;
  loading: boolean;
}

const AuthContext = createContext<AuthContextType>({ user: null, loading: true });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<AppUser | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const syncUser = () => {
      setUser(getCurrentUser());
      setLoading(false);
    };

    syncUser();
    window.addEventListener('supabase-auth-changed', syncUser);
    window.addEventListener('popstate', syncUser);

    return () => {
      window.removeEventListener('supabase-auth-changed', syncUser);
      window.removeEventListener('popstate', syncUser);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
