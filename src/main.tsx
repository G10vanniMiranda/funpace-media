import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import { AuthProvider } from './contexts/AuthContext';
import { ToastProvider } from './contexts/ToastContext';
import { handleOAuthCallbackFromUrl } from './lib/supabase';

async function boot() {
  try {
    await handleOAuthCallbackFromUrl();
  } catch (error) {
    console.error('OAuth callback error:', error);
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <AuthProvider>
        <ToastProvider>
          <App />
        </ToastProvider>
      </AuthProvider>
    </StrictMode>,
  );
}

boot();
