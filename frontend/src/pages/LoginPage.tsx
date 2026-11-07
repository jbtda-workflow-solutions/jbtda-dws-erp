import { useState } from 'react';
import { GoogleLogin } from '@react-oauth/google';
import { useAuth } from '@/hooks/useAuth';
import { ApiError } from '@/api/client';

/**
 * LoginPage — the unauthenticated landing screen.
 *
 * Displays the brand mark and a "Sign in with Google" button.
 * On success, the AuthContext updates the app state and triggers navigation.
 */
export function LoginPage() {
  const { loginWithGoogle } = useAuth();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center justify-center p-6">
      <div className="w-full max-w-sm space-y-8">
        {/* Brand */}
        <div className="text-center space-y-3">
          <div className="inline-flex items-center justify-center w-14 h-14 rounded-2xl bg-forest-900 shadow-lg shadow-forest-900/25">
            <svg viewBox="0 0 32 32" fill="none" className="w-8 h-8">
              <path
                d="M6 22V10h4l4 8 4-8h4v12h-3v-7.5l-3.5 7h-3L9 14.5V22H6z"
                fill="#EAF3EE"
              />
            </svg>
          </div>
          <div>
            <h1 className="text-2xl font-medium tracking-tight text-slate-900">
              JBTDA DWS
            </h1>
            <p className="text-sm font-light text-slate-500 mt-1">
              Financial Management Platform
            </p>
          </div>
        </div>

        {/* Sign-in card */}
        <div className="bg-white rounded-2xl border border-slate-200 shadow-sm p-8 space-y-5">
          <div className="space-y-1">
            <h2 className="text-base font-medium text-slate-900">
              Sign in to your account
            </h2>
            <p className="text-sm font-light text-slate-500">
              Use your Google Workspace account to continue.
            </p>
          </div>

          {error && (
            <div className="rounded-lg bg-red-50 border border-red-200 px-4 py-3">
              <p className="text-sm text-red-700">{error}</p>
            </div>
          )}

          <GoogleSignInButton
            loading={loading}
            setLoading={setLoading}
            setError={setError}
            loginWithGoogle={loginWithGoogle}
          />

          <p className="text-xs font-light text-center text-slate-400">
            By signing in, you agree to our terms of service and privacy policy.
          </p>
        </div>

        <p className="text-center text-xs text-slate-400">
          © {new Date().getFullYear()} JBTDA DWS. All rights reserved.
        </p>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Google Sign-In Button (using @react-oauth/google GoogleLogin component)
// ---------------------------------------------------------------------------

interface GoogleSignInButtonProps {
  loading: boolean;
  setLoading: (v: boolean) => void;
  setError: (msg: string | null) => void;
  loginWithGoogle: (idToken: string) => Promise<void>;
}

function GoogleSignInButton({
  loading,
  setLoading,
  setError,
  loginWithGoogle,
}: GoogleSignInButtonProps) {
  return (
    <div className={loading ? 'opacity-50 pointer-events-none' : ''}>
      <GoogleLogin
        onSuccess={async (credentialResponse) => {
          const idToken = credentialResponse.credential;
          if (!idToken) {
            setError('No credential received from Google.');
            return;
          }
          setLoading(true);
          setError(null);
          try {
            await loginWithGoogle(idToken);
          } catch (err) {
            if (err instanceof ApiError) {
              setError(err.message);
            } else {
              setError('An unexpected error occurred. Please try again.');
            }
          } finally {
            setLoading(false);
          }
        }}
        onError={() => {
          setError('Google sign-in failed. Please try again.');
        }}
        useOneTap={false}
        width="100%"
        text="signin_with"
        shape="rectangular"
        logo_alignment="center"
        theme="outline"
      />
    </div>
  );
}

