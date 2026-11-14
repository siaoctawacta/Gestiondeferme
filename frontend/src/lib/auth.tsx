import {
  createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode,
} from 'react';
import { useQueryClient } from '@tanstack/react-query';
import {
  api, refreshSession, setAccessToken, setFarmHeader, setSessionExpiredHandler,
  type SessionUser,
} from './api';
import type { Action, ModuleKey, Permissions } from './modules';

export interface Farm {
  id: string;
  name: string;
}

interface Me {
  user: SessionUser;
  farms: Farm[];
  permissions: Permissions;
  canSeeAllFarms: boolean;
}

type LoginResponse =
  | { accessToken: string; user: SessionUser }
  | { twoFactorRequired: true; challengeToken: string }
  | { twoFactorSetupRequired: true; setupToken: string };

export type LoginResult = { kind: 'ok' } | { kind: 'twoFactor' } | { kind: 'setup' };

export interface TwoFactorSetup {
  otpauthUrl: string;
  qrDataUrl: string;
  secret: string;
}

export const ALL_FARMS = 'all';
const FARM_KEY = 'ap_farm';

export interface AuthValue {
  status: 'loading' | 'anonymous' | 'authenticated';
  user: SessionUser | null;
  farms: Farm[];
  permissions: Permissions | null;
  /** Active farm id, the literal `all`, or null when the user has no farm. */
  farmId: string | null;
  setFarmId: (id: string) => void;
  canSeeAllFarms: boolean;
  can: (module: ModuleKey, action: Action) => boolean;
  login: (email: string, password: string) => Promise<LoginResult>;
  verify2fa: (code: string) => Promise<void>;
  /** Starts 2FA enrolment, with the setup token from login or the current session. */
  setupTwoFactor: () => Promise<TwoFactorSetup>;
  /** Confirms enrolment and returns the backup codes (shown once). */
  enableTwoFactor: (code: string) => Promise<string[]>;
  /** Ends a mandatory enrolment started at login, once the backup codes are saved. */
  completeSetup: () => Promise<void>;
  /** Reloads `/auth/me` (e.g. after the 2FA status changed). */
  reload: () => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthValue | null>(null);

function readStoredFarm(): string | null {
  try {
    return localStorage.getItem(FARM_KEY);
  } catch {
    return null;
  }
}

function storeFarm(id: string): void {
  try {
    localStorage.setItem(FARM_KEY, id);
  } catch {
    /* storage unavailable: the choice just isn't remembered */
  }
}

function pickFarm(me: Me): string | null {
  const stored = readStoredFarm();
  if (stored && (me.farms.some((f) => f.id === stored) || (stored === ALL_FARMS && me.canSeeAllFarms))) {
    return stored;
  }
  return me.farms[0]?.id ?? null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<AuthValue['status']>('loading');
  const [me, setMe] = useState<Me | null>(null);
  const [farmId, setFarmIdState] = useState<string | null>(null);
  // Short-lived 2FA tokens never leave memory.
  const stageToken = useRef<string | null>(null);
  const pendingSession = useRef<string | null>(null);

  const applyFarm = (id: string | null) => {
    setFarmHeader(id);
    setFarmIdState(id);
  };

  const loadMe = async () => {
    const data = await api.get<Me>('/auth/me');
    applyFarm(pickFarm(data));
    setMe(data);
    setStatus('authenticated');
  };

  const dropSession = () => {
    stageToken.current = null;
    pendingSession.current = null;
    setAccessToken(null);
    applyFarm(null);
    setMe(null);
    setStatus('anonymous');
    queryClient.clear();
  };

  const startSession = async (accessToken: string) => {
    stageToken.current = null;
    pendingSession.current = null;
    queryClient.clear();
    setAccessToken(accessToken);
    await loadMe();
  };

  useEffect(() => {
    setSessionExpiredHandler(dropSession);
    // Restore the session from the refresh cookie (the access token is memory-only).
    refreshSession()
      .then(loadMe)
      .catch(() => {
        setAccessToken(null);
        setStatus('anonymous');
      });
    return () => setSessionExpiredHandler(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const value = useMemo<AuthValue>(
    () => ({
      status,
      user: me?.user ?? null,
      farms: me?.farms ?? [],
      permissions: me?.permissions ?? null,
      farmId,
      canSeeAllFarms: me?.canSeeAllFarms ?? false,
      can: (module, action) => me?.permissions[module]?.includes(action) ?? false,
      setFarmId: (id) => {
        applyFarm(id);
        storeFarm(id);
        void queryClient.invalidateQueries();
      },
      login: async (email, password) => {
        const res = await api.post<LoginResponse>('/auth/login', { email, password });
        if ('twoFactorRequired' in res) {
          stageToken.current = res.challengeToken;
          return { kind: 'twoFactor' };
        }
        if ('twoFactorSetupRequired' in res) {
          stageToken.current = res.setupToken;
          return { kind: 'setup' };
        }
        await startSession(res.accessToken);
        return { kind: 'ok' };
      },
      verify2fa: async (code) => {
        const res = await api.post<{ accessToken: string }>('/auth/2fa/verify', { code }, {
          token: stageToken.current ?? undefined,
        });
        await startSession(res.accessToken);
      },
      setupTwoFactor: () =>
        api.post<TwoFactorSetup>('/auth/2fa/setup', undefined, { token: stageToken.current ?? undefined }),
      enableTwoFactor: async (code) => {
        const res = await api.post<{ backupCodes: string[]; accessToken?: string }>(
          '/auth/2fa/enable',
          { code },
          { token: stageToken.current ?? undefined },
        );
        if (stageToken.current) pendingSession.current = res.accessToken ?? null;
        else await loadMe();
        return res.backupCodes;
      },
      completeSetup: async () => {
        const token = pendingSession.current;
        if (!token) throw new Error('Aucune session en attente');
        await startSession(token);
      },
      reload: loadMe,
      logout: async () => {
        try {
          await api.post('/auth/logout');
        } catch {
          /* the local session is dropped either way */
        }
        dropSession();
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, me, farmId],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
