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

/** Thrown when credentials were accepted but the session could not be loaded afterwards. */
export class SessionStartError extends Error {
  constructor() {
    super('Connexion impossible : la session n\'a pas pu être chargée. Réessayez.');
    this.name = 'SessionStartError';
  }
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
  /** True after an explicit sign-out (so the login page forgets where the user was). */
  signedOut: boolean;
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
  const [signedOut, setSignedOut] = useState(false);
  // Short-lived 2FA tokens never leave memory.
  const stageToken = useRef<string | null>(null);
  const pendingSession = useRef<string | null>(null);

  const applyFarm = (id: string | null) => {
    setFarmHeader(id);
    setFarmIdState(id);
  };

  const loadMe = async () => {
    const data = await api.get<Me>('/auth/me');
    setSignedOut(false);
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
    try {
      await loadMe();
    } catch {
      dropSession();
      throw new SessionStartError();
    }
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
      signedOut,
      can: (module, action) => me?.permissions[module]?.includes(action) ?? false,
      setFarmId: (id) => {
        storeFarm(id);
        // Drop everything cached for the previous farm (and any response still in flight)
        // before the new farm is applied, so its data can never show under the new one.
        void queryClient
          .cancelQueries()
          .then(() => queryClient.removeQueries())
          .then(() => applyFarm(id));
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
        else {
          // The one-time backup codes must reach the user even if this refresh fails.
          try {
            await loadMe();
          } catch {
            /* the status badge catches up on the next reload */
          }
        }
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
        setSignedOut(true);
      },
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [status, me, farmId, signedOut],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth doit être utilisé dans <AuthProvider>');
  return ctx;
}
