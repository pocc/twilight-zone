import type { SourceMode } from '../components/steps/step0/operationMode';

export const OAUTH_NONCE_STORAGE_KEY = 'twilight.oauth.tab-nonce';

export type BrowserStorage = Pick<Storage, 'getItem' | 'setItem' | 'removeItem'>;
export type BrowserLock = { name: string };
export type BrowserLockManager = {
  request: <T>(
    name: string,
    options: { ifAvailable: true; mode: 'exclusive' },
    callback: (lock: BrowserLock | null) => Promise<T> | T,
  ) => Promise<T>;
};
export type OAuthNonceOwner = {
  getNonce: (storage?: BrowserStorage, locks?: BrowserLockManager | null) => Promise<string>;
  clearNonce: (storage?: BrowserStorage) => void;
};
export type BrowserAuthMode = 'manual' | 'oauth';
export type OAuthRole = 'source' | 'destination';

export type OAuthRoleStatus = {
  connected: boolean;
  expiresAt?: number;
  scopes?: string[];
};

export type OAuthRoles = Record<OAuthRole, OAuthRoleStatus>;

const base64Url = (bytes: Uint8Array): string => {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
};

const defaultStorage = (): BrowserStorage => sessionStorage;
const defaultLocks = (): BrowserLockManager | undefined =>
  typeof navigator === 'undefined' ? undefined : navigator.locks;

const createNonce = (storage: BrowserStorage): string => {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  const nonce = base64Url(bytes);
  storage.setItem(OAUTH_NONCE_STORAGE_KEY, nonce);
  return nonce;
};

export class OAuthNonceOwnershipError extends Error {
  constructor(message = 'oauth_nonce_ownership_failed') {
    super(message);
    this.name = 'OAuthNonceOwnershipError';
  }
}

export const createOAuthNonceOwner = (): OAuthNonceOwner => {
  let ownership: Promise<string> | undefined;
  let release: (() => void) | undefined;

  const getNonce = (
    storage: BrowserStorage = defaultStorage(),
    locks: BrowserLockManager | null | undefined = defaultLocks(),
  ): Promise<string> => {
    if (ownership) return ownership;
    if (!locks) return Promise.reject(new OAuthNonceOwnershipError('oauth_browser_web_locks_unsupported'));

    ownership = new Promise<string>((resolve, reject) => {
      const acquire = (nonce: string, attempts: number): void => {
        void locks.request(`twilight.oauth.tab-nonce:${nonce}`, {
          ifAvailable: true,
          mode: 'exclusive',
        }, async (lock) => {
          if (!lock) {
            if (attempts >= 3) {
              reject(new OAuthNonceOwnershipError());
              return;
            }
            acquire(createNonce(storage), attempts + 1);
            return;
          }
          const held = new Promise<void>((resolveRelease) => { release = resolveRelease; });
          resolve(nonce);
          await held;
        }).catch(() => reject(new OAuthNonceOwnershipError()));
      };
      acquire(storage.getItem(OAUTH_NONCE_STORAGE_KEY) || createNonce(storage), 0);
    });
    return ownership;
  };

  const clearNonce = (storage: BrowserStorage = defaultStorage()): void => {
    release?.();
    release = undefined;
    ownership = undefined;
    storage.removeItem(OAUTH_NONCE_STORAGE_KEY);
  };

  return { getNonce, clearNonce };
};

const defaultNonceOwner = createOAuthNonceOwner();

export const getOAuthNonce = (
  storage: BrowserStorage = defaultStorage(),
  locks: BrowserLockManager | null | undefined = defaultLocks(),
): Promise<string> => defaultNonceOwner.getNonce(storage, locks);

export const clearOAuthNonce = (storage: BrowserStorage = defaultStorage()): void => {
  defaultNonceOwner.clearNonce(storage);
};

export const requiredOAuthRoles = (sourceMode: SourceMode): OAuthRole[] =>
  sourceMode === 'api' ? ['source', 'destination'] : ['destination'];

const READINESS_THRESHOLDS = {
  migration: 35 * 60 * 1000,
  'phase-two': 20 * 60 * 1000,
  preset: (15 + 5) * 60 * 1000,
} as const;

export const oauthReadiness = (
  sourceMode: SourceMode,
  roles: OAuthRoles,
  nowMs: number,
  phase: keyof typeof READINESS_THRESHOLDS,
): { ready: boolean; reconnectRoles: OAuthRole[] } => {
  const threshold = READINESS_THRESHOLDS[phase];
  const reconnectRoles = requiredOAuthRoles(sourceMode).filter((role) => {
    const status = roles[role];
    return !status.connected || !Number.isFinite(status.expiresAt) || status.expiresAt! - nowMs < threshold;
  });
  return { ready: reconnectRoles.length === 0, reconnectRoles };
};

export const runPresetApplyIfAuthorized = async (
  options: {
    authMode: BrowserAuthMode;
    sourceMode: SourceMode;
    roles: OAuthRoles;
    now: number;
    onReauthorizationRequired: (role: OAuthRole) => void;
  },
  apply: () => Promise<void>,
): Promise<boolean> => {
  if (options.authMode === 'oauth') {
    const readiness = oauthReadiness(options.sourceMode, options.roles, options.now, 'preset');
    if (!readiness.ready) {
      const role = readiness.reconnectRoles[0];
      if (role) options.onReauthorizationRequired(role);
      return false;
    }
  }
  await apply();
  return true;
};
