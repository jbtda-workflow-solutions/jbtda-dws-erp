/**
 * AuthContext — global authentication & multi-entity workspace state.
 *
 * States:
 *  - loading:         initial cookie-check in flight
 *  - unauthenticated: no valid session
 *  - onboarding:      authenticated user, no organization yet
 *  - authenticated:   full session (user + active organization + role + memberships)
 */

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
} from 'react';
import {
  authApi,
  ApiError,
  type Organization,
  type OrganizationMembership,
  type MemberProfile,
  type Role,
} from '@/api/client';

export type AuthStatus =
  | 'loading'
  | 'unauthenticated'
  | 'onboarding'
  | 'authenticated';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  avatarUrl?: string | null;
}

export interface AuthState {
  status: AuthStatus;
  userId: string | null;
  user: AuthUser | null;
  organizationId: string | null;
  organization: Organization | null;
  role: Role | null;
  memberProfile: MemberProfile | null;
  memberships: OrganizationMembership[];
}

interface AuthContextValue extends AuthState {
  loginWithGoogle: (idToken: string) => Promise<void>;
  logout: () => Promise<void>;
  switchOrganization: (organizationId: string) => Promise<void>;
  refreshSession: () => Promise<void>;
  /** Called after successful org creation to promote onboarding → authenticated */
  completeOnboarding: (organizationId: string, role: string) => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    status: 'loading',
    userId: null,
    user: null,
    organizationId: null,
    organization: null,
    role: null,
    memberProfile: null,
    memberships: [],
  });

  const refreshSession = useCallback(async () => {
    try {
      const res = await authApi.me();
      if (res.status === 'onboarding') {
        setState({
          status: 'onboarding',
          userId: res.user?.id ?? null,
          user: res.user ?? null,
          organizationId: null,
          organization: null,
          role: null,
          memberProfile: null,
          memberships: [],
        });
      } else {
        setState({
          status: 'authenticated',
          userId: res.user?.id ?? null,
          user: res.user ?? null,
          organizationId: res.organizationId ?? null,
          organization: res.organization ?? null,
          role: (res.role as Role) ?? null,
          memberProfile: res.memberProfile ?? null,
          memberships: res.memberships ?? [],
        });
      }
    } catch {
      setState({
        status: 'unauthenticated',
        userId: null,
        user: null,
        organizationId: null,
        organization: null,
        role: null,
        memberProfile: null,
        memberships: [],
      });
    }
  }, []);

  useEffect(() => {
    void refreshSession();
  }, [refreshSession]);

  const loginWithGoogle = useCallback(
    async (idToken: string) => {
      const res = await authApi.loginWithGoogle(idToken);
      if (res.status === 'onboarding') {
        setState({
          status: 'onboarding',
          userId: res.user?.id ?? null,
          user: res.user ?? null,
          organizationId: null,
          organization: null,
          role: null,
          memberProfile: null,
          memberships: [],
        });
      } else {
        await refreshSession();
      }
    },
    [refreshSession],
  );

  const switchOrganization = useCallback(
    async (organizationId: string) => {
      await authApi.switchOrganization(organizationId);
      await refreshSession();
    },
    [refreshSession],
  );

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
      user: null,
      organizationId: null,
      organization: null,
      role: null,
      memberProfile: null,
      memberships: [],
    });
  }, []);

  const completeOnboarding = useCallback(
    (organizationId: string, role: string) => {
      setState((s) => ({
        ...s,
        status: 'authenticated',
        organizationId,
        role: role as Role,
      }));
      void refreshSession();
    },
    [refreshSession],
  );

  return (
    <AuthContext.Provider
      value={{
        ...state,
        loginWithGoogle,
        logout,
        switchOrganization,
        refreshSession,
        completeOnboarding,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
