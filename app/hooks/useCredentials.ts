import { useReducer, useCallback, useEffect, useMemo, useRef } from 'react';
import { STORAGE_KEYS } from '../lib/constants';
import type { Credentials } from '../lib/api';

// [C13] Sensitive tokens use sessionStorage (auto-clears on tab close).
// Non-sensitive values (account IDs, domain name) stay in localStorage for convenience.
const SESSION_KEYS = new Set<string>([
  STORAGE_KEYS.authMode,
  STORAGE_KEYS.apiKey,
  STORAGE_KEYS.destApiKey,
  STORAGE_KEYS.sourceToken,
  STORAGE_KEYS.destToken,
]);

function load(key: string): string {
  if (SESSION_KEYS.has(key)) {
    return sessionStorage.getItem(key) || '';
  }
  return localStorage.getItem(key) || '';
}

function save(key: string, value: string) {
  const storage = SESSION_KEYS.has(key) ? sessionStorage : localStorage;
  if (value) storage.setItem(key, value);
  else storage.removeItem(key);
}

// Single source of truth for the full credential state. Replaces the
// previous 11 parallel useState + 11 parallel useEffect with one reducer,
// one storage-sync effect, and stable per-field setters returned via
// memoization for back-compat with the original `useCredentials()` shape.
type Field = keyof Credentials;
type Action =
  | { type: 'set'; field: Field; value: string | boolean }
  | { type: 'clear' };

const FIELDS: Field[] = [
  'authMode', 'useApiKey', 'apiKey', 'apiEmail', 'destApiKey', 'destApiEmail',
  'sourceToken', 'destToken', 'sourceAccountId', 'sourceZoneId',
  'destAccountId', 'domainName',
];

const FIELD_TO_STORAGE_KEY: Record<Field, string> = {
  authMode: STORAGE_KEYS.authMode,
  useApiKey: STORAGE_KEYS.useApiKey,
  apiKey: STORAGE_KEYS.apiKey,
  apiEmail: STORAGE_KEYS.apiEmail,
  destApiKey: STORAGE_KEYS.destApiKey,
  destApiEmail: STORAGE_KEYS.destApiEmail,
  sourceToken: STORAGE_KEYS.sourceToken,
  destToken: STORAGE_KEYS.destToken,
  sourceAccountId: STORAGE_KEYS.sourceAccountId,
  sourceZoneId: STORAGE_KEYS.sourceZoneId,
  destAccountId: STORAGE_KEYS.destAccountId,
  domainName: STORAGE_KEYS.domainName,
};

const EMPTY_CREDENTIALS: Credentials = {
  authMode: 'manual',
  useApiKey: false,
  apiKey: '',
  apiEmail: '',
  destApiKey: '',
  destApiEmail: '',
  sourceToken: '',
  destToken: '',
  sourceAccountId: '',
  sourceZoneId: '',
  destAccountId: '',
  domainName: '',
};

function initFromStorage(): Credentials {
  return {
    authMode: typeof location !== 'undefined' && new URLSearchParams(location.search).has('oauth_result')
      ? 'oauth'
      : load(STORAGE_KEYS.authMode) === 'oauth' ? 'oauth' : 'manual',
    useApiKey: load(STORAGE_KEYS.useApiKey) === 'true',
    apiKey: load(STORAGE_KEYS.apiKey),
    apiEmail: load(STORAGE_KEYS.apiEmail),
    destApiKey: load(STORAGE_KEYS.destApiKey),
    destApiEmail: load(STORAGE_KEYS.destApiEmail),
    sourceToken: load(STORAGE_KEYS.sourceToken),
    destToken: load(STORAGE_KEYS.destToken),
    sourceAccountId: load(STORAGE_KEYS.sourceAccountId),
    sourceZoneId: load(STORAGE_KEYS.sourceZoneId),
    destAccountId: load(STORAGE_KEYS.destAccountId),
    domainName: load(STORAGE_KEYS.domainName),
  };
}

function reducer(state: Credentials, action: Action): Credentials {
  switch (action.type) {
    case 'set':
      return { ...state, [action.field]: action.value };
    case 'clear':
      return { ...EMPTY_CREDENTIALS };
    default:
      return state;
  }
}

export function useCredentials() {
  const [credentials, dispatch] = useReducer(reducer, undefined, initFromStorage);

  // Persist on change. One effect that diffs against the previous render
  // and only writes the fields that changed, instead of 11 separate effects.
  const prevRef = useRef<Credentials>(credentials);
  useEffect(() => {
    const prev = prevRef.current;
    for (const field of FIELDS) {
      if (prev[field] === credentials[field]) continue;
      if (field === 'authMode') continue;
      const value = credentials[field];
      save(FIELD_TO_STORAGE_KEY[field], typeof value === 'boolean' ? String(value) : value);
    }
    prevRef.current = credentials;
  }, [credentials]);
  useEffect(() => save(STORAGE_KEYS.authMode, credentials.authMode), [credentials.authMode]);

  const setField = useCallback(<F extends Field>(field: F, value: Credentials[F]) => {
    dispatch({ type: 'set', field, value: value as string | boolean });
  }, []);

  const clearAll = useCallback(() => {
    Object.values(STORAGE_KEYS).forEach(k => {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    });
    dispatch({ type: 'clear' });
  }, []);

  // Stable per-field setters for back-compat with the previous useState-per-field
  // API. Memoized so component re-renders triggered by parent state don't
  // cause Step 1 / Step 2 to re-bind every input on every render.
  const setters = useMemo(() => ({
    setAuthMode: (v: Credentials['authMode']) => setField('authMode', v),
    setUseApiKey: (v: boolean) => setField('useApiKey', v),
    setApiKey: (v: string) => setField('apiKey', v),
    setApiEmail: (v: string) => setField('apiEmail', v),
    setDestApiKey: (v: string) => setField('destApiKey', v),
    setDestApiEmail: (v: string) => setField('destApiEmail', v),
    setSourceToken: (v: string) => setField('sourceToken', v),
    setDestToken: (v: string) => setField('destToken', v),
    setSourceAccountId: (v: string) => setField('sourceAccountId', v),
    setSourceZoneId: (v: string) => setField('sourceZoneId', v),
    setDestAccountId: (v: string) => setField('destAccountId', v),
    setDomainName: (v: string) => setField('domainName', v),
  }), [setField]);

  const hasAuth = credentials.authMode === 'oauth'
    ? false
    : credentials.useApiKey
      ? !!(credentials.apiKey && credentials.apiEmail)
      : !!credentials.sourceToken;

  return {
    credentials,
    hasAuth,
    ...credentials,
    ...setters,
    clearAll,
  };
}
