import React, { useEffect, useState } from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App.tsx';
import './index.css';

function Root() {
  const [clientId, setClientId] = useState<string>(
    (import.meta.env['VITE_GOOGLE_CLIENT_ID'] as string | undefined) || '',
  );
  const [loading, setLoading] = useState(!clientId);

  useEffect(() => {
    if (clientId) return;

    fetch('/api/v1/auth/config')
      .then((res) => res.json())
      .then((data: { googleClientId?: string }) => {
        if (data.googleClientId) {
          setClientId(data.googleClientId);
        }
      })
      .catch((err) => {
        console.warn('[JBTDA-DWS-ERP] Failed to load auth config from backend:', err);
      })
      .finally(() => setLoading(false));
  }, [clientId]);

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-50 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-forest-800 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <GoogleOAuthProvider clientId={clientId || 'missing-client-id'}>
      <App />
    </GoogleOAuthProvider>
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <Root />
  </React.StrictMode>,
);

