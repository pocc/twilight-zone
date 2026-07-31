import {
  getOAuthNonce,
  type BrowserAuthMode,
  type BrowserLockManager,
  type BrowserStorage,
  type OAuthNonceOwner,
  type OAuthRole,
} from './oauth';

const MANUAL_CREDENTIAL_FIELDS = new Set([
  'token', 'sourceToken', 'destToken', 'apiKey', 'apiEmail',
  'sourceApiKey', 'sourceApiEmail', 'destApiKey', 'destApiEmail', 'useApiKey',
]);

type RequestOptions = {
  authMode: BrowserAuthMode;
  storage?: BrowserStorage;
  locks?: BrowserLockManager | null;
  nonceOwner?: OAuthNonceOwner;
  fetchImpl?: typeof fetch;
  signal?: AbortSignal;
};

export class OAuthReauthorizationError extends Error {
  constructor(public readonly role?: OAuthRole) {
    super('oauth_reauthorization_required');
    this.name = 'OAuthReauthorizationError';
  }
}

export const routeOAuthReauthorization = (
  error: unknown,
  onReauthorizationRequired?: (role: OAuthRole) => void,
): boolean => {
  if (!(error instanceof OAuthReauthorizationError) || !error.role || !onReauthorizationRequired) return false;
  onReauthorizationRequired(error.role);
  return true;
};

const oauthBody = (body: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(body).filter(([key]) => !MANUAL_CREDENTIAL_FIELDS.has(key)));

const requestInit = async (
  body: Record<string, unknown>,
  options: RequestOptions,
): Promise<RequestInit> => {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  const payload = options.authMode === 'oauth' ? oauthBody(body) : body;
  if (options.authMode === 'oauth') {
    headers.set('X-Twilight-Auth', 'oauth');
    const nonce = options.nonceOwner
      ? await options.nonceOwner.getNonce(options.storage, options.locks)
      : await getOAuthNonce(options.storage, options.locks);
    headers.set('X-Twilight-OAuth-Nonce', nonce);
  }
  return { method: 'POST', headers, body: JSON.stringify(payload), signal: options.signal };
};

export const browserJsonRequest = async <T = unknown>(
  url: string,
  body: Record<string, unknown>,
  options: RequestOptions,
): Promise<T> => {
  const response = await (options.fetchImpl ?? fetch)(url, await requestInit(body, options));
  const data = await response.json() as Record<string, unknown>;
  if (!response.ok) {
    if (data.error === 'oauth_reauthorization_required') {
      throw new OAuthReauthorizationError(
        data.role === 'source' || data.role === 'destination' ? data.role : undefined,
      );
    }
    throw new Error(
      typeof data.error === 'string'
        ? data.error
        : typeof data.message === 'string' ? data.message : `HTTP ${response.status}`,
    );
  }
  return data as T;
};

export type BrowserStreamPrompt = {
  migrationId?: string;
  promptId: string;
  question: string;
  options: { value: string; label: string }[];
};

export type BrowserStreamCallbacks = {
  onLog: (message: string, progress?: { current: number; total: number }) => void;
  onDone: (data: Record<string, unknown>) => void;
  onError: (error: string) => void;
  onPrompt?: (prompt: BrowserStreamPrompt) => void;
  onReauthorizationRequired?: (role: OAuthRole, reason: string) => void;
};

const dispatchStreamEvent = (data: Record<string, unknown>, callbacks: BrowserStreamCallbacks): void => {
  if (data.type === 'log' && typeof data.message === 'string') {
    callbacks.onLog(data.message, data.progress as { current: number; total: number } | undefined);
  } else if (data.type === 'prompt' && typeof data.promptId === 'string' && typeof data.question === 'string') {
    callbacks.onPrompt?.({
      migrationId: typeof data.migrationId === 'string' ? data.migrationId : undefined,
      promptId: data.promptId,
      question: data.question,
      options: Array.isArray(data.options) ? data.options as BrowserStreamPrompt['options'] : [],
    });
  } else if (data.type === 'done') {
    callbacks.onDone(data);
  } else if (data.type === 'reauthorization_required' && (data.role === 'source' || data.role === 'destination')) {
    const reason = typeof data.reason === 'string' ? data.reason : 'oauth_reauthorization_required';
    if (callbacks.onReauthorizationRequired) callbacks.onReauthorizationRequired(data.role, reason);
    else callbacks.onError(reason);
  } else if (data.type === 'error') {
    callbacks.onError(typeof data.error === 'string' ? data.error : 'Stream failed');
  }
};

export type BrowserPromptResponse = {
  promptId: string;
  answer: string;
  migrationId?: string;
};

export const browserPromptResponse = async (
  body: BrowserPromptResponse,
  options: RequestOptions,
  onReauthorizationRequired?: (role: OAuthRole) => void,
): Promise<boolean> => {
  try {
    await browserJsonRequest('/api/migrate/respond', {
      promptId: body.promptId,
      answer: body.answer,
      ...(body.migrationId ? { migrationId: body.migrationId } : {}),
    }, options);
    return true;
  } catch (error) {
    routeOAuthReauthorization(error, onReauthorizationRequired);
    return false;
  }
};

export const browserStreamRequest = async (
  url: string,
  body: Record<string, unknown>,
  callbacks: BrowserStreamCallbacks,
  options: RequestOptions,
): Promise<void> => {
  try {
    const response = await (options.fetchImpl ?? fetch)(url, await requestInit(body, options));
    if (!response.ok) {
      const data = await response.json() as Record<string, unknown>;
      if (data.error === 'oauth_reauthorization_required') {
        const role = data.role === 'source' || data.role === 'destination' ? data.role : undefined;
        if (role && callbacks.onReauthorizationRequired) {
          callbacks.onReauthorizationRequired(role, 'oauth_reauthorization_required');
        } else callbacks.onError('oauth_reauthorization_required');
        return;
      }
      callbacks.onError(typeof data.error === 'string' ? data.error : `HTTP ${response.status}`);
      return;
    }
    const reader = response.body?.getReader();
    if (!reader) { callbacks.onError('No response body'); return; }
    const decoder = new TextDecoder();
    let buffer = '';
    const process = (value: string) => {
      for (const line of value.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        try { dispatchStreamEvent(JSON.parse(line.slice(6)) as Record<string, unknown>, callbacks); } catch { /* malformed SSE */ }
      }
    };
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      process(lines.join('\n'));
    }
    if (buffer.trim()) process(buffer);
  } catch (error) {
    if (options.signal?.aborted) return;
    callbacks.onError(error instanceof Error ? error.message : 'Stream connection failed');
  }
};
