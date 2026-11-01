import React from 'react';
import ReactDOM from 'react-dom/client';
import { GoogleOAuthProvider } from '@react-oauth/google';
import App from './App.tsx';
import './index.css';

const GOOGLE_CLIENT_ID =
  (import.meta.env['VITE_GOOGLE_CLIENT_ID'] as string | undefined) ??
  'placeholder-client-id.apps.googleusercontent.com';

if (!import.meta.env['VITE_GOOGLE_CLIENT_ID']) {
  console.warn(
    '[JBTDA-DWS-ERP] VITE_GOOGLE_CLIENT_ID is not configured. Set it in frontend/.env for production Google OAuth.',
  );
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <GoogleOAuthProvider clientId={GOOGLE_CLIENT_ID}>
      <App />
    </GoogleOAuthProvider>
  </React.StrictMode>,
);

