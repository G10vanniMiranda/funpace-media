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

    // Re-sync when SPA route changes (pushState/replaceState/popstate).
    const patchHistory = () => {
      const w = window as any;
      if (w.__funpaceHistoryPatched) return;
      w.__funpaceHistoryPatched = true;

      const originalPushState = history.pushState;
      const originalReplaceState = history.replaceState;

      history.pushState = function (...args) {
        const ret = originalPushState.apply(this, args as any);
        window.dispatchEvent(new Event('funpace-route-changed'));
        return ret;
      } as any;

      history.replaceState = function (...args) {
        const ret = originalReplaceState.apply(this, args as any);
        window.dispatchEvent(new Event('funpace-route-changed'));
        return ret;
      } as any;
    };

    patchHistory();
    syncUser();
    window.addEventListener('supabase-auth-changed', syncUser);
    window.addEventListener('popstate', syncUser);
    window.addEventListener('funpace-route-changed', syncUser);

    return () => {
      window.removeEventListener('supabase-auth-changed', syncUser);
      window.removeEventListener('popstate', syncUser);
      window.removeEventListener('funpace-route-changed', syncUser);
    };
  }, []);

  return (
    <AuthContext.Provider value={{ user, loading }}>
      {!loading && children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
