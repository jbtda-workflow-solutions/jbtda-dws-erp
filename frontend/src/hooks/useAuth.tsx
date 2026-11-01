/**
 * AuthContext — global authentication state.
 *
 * States:
 *  - loading:       initial cookie-check in flight
 *  - unauthenticated: no valid session
 *  - onboarding:    authenticated user, no organization yet
 *  - authenticated: full session (userId + organizationId + role)
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import { authApi, ApiError } from '@/api/client';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'onboarding'
  | 'authenticated';

export interface AuthState {
  status: AuthStatus;
  userId: string | null;
  organizationId: string | null;
  role: string | null;
}

interface AuthContextValue extends AuthState {
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Called after successful org creation to promote onboarding → authenticated */
  completeOnboarding: (organizationId: string, role: string) => void;
}

// ---------------------------------------------------------------------------
// Context
// ---------------------------------------------------------------------------

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    userId: null,
    organizationId: null,
    role: null,
  });

  // On mount, check session via /api/v1/auth/me
  useEffect(() => {
    let mounted = true;
    authApi
      .me()
      .then((res) => {
        if (!mounted) return;
        if (res.status === 'onboarding') {
          setState({
            status: 'onboarding',
            userId: res.user?.id ?? null,
            organizationId: null,
            role: null,
          });
        } else {
          setState({
            status: 'authenticated',
            userId: res.user?.id ?? null,
            organizationId: res.organizationId ?? null,
            role: res.role ?? null,
          });
        }
      })
      .catch(() => {
        if (mounted) {
          setState({
            status: 'unauthenticated',
            userId: null,
            organizationId: null,
            role: null,
          });
        }
      });

    return () => {
      mounted = false;
    };
  }, []);

  const loginWithGoogle = useCallback(async (idToken: string) => {
    const res = await authApi.loginWithGoogle(idToken);
    if (res.status === 'onboarding') {
      setState({
        status: 'onboarding',
        userId: null,
        organizationId: null,
        role: null,
      });
    } else {
      setState({
        status: 'authenticated',
        userId: null, // backend does not expose userId in response yet
        organizationId: res.organizationId ?? null,
        role: res.role ?? null,
      });
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      await authApi.logout();
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) {
        // Already unauthenticated
      } else {
        throw err;
      }
    }
    setState({
      status: 'unauthenticated',
      userId: null,
      organizationId: null,
      role: null,
    });
  }, []);

  const completeOnboarding = useCallback(
    (organizationId: string, role: string) => {
      setState((s) => ({
        ...s,
        status: 'authenticated',
        organizationId,
        role,
      }));
    },
    [],
  );

  return (
    <AuthContext.Provider
      value={{ ...state, loginWithGoogle, logout, completeOnboarding }}
    >
      {children}
    </AuthContext.Provider>
  );
}

