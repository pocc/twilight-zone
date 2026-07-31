import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  createOAuthNonceOwner,
  OAUTH_NONCE_STORAGE_KEY,
  type BrowserLock,
  type BrowserLockManager,
  type BrowserStorage,
} from '../app/lib/oauth';
import { checkCapabilities } from '../app/lib/api';
import { browserJsonRequest, browserPromptResponse, browserStreamRequest } from '../app/lib/request';

class MemoryStorage implements BrowserStorage {
  private readonly values = new Map<string, string>();

  getItem(key: string): string | null { return this.values.get(key) ?? null; }
  setItem(key: string, value: string): void { this.values.set(key, value); }
  removeItem(key: string): void { this.values.delete(key); }
}

const sharedLockManagers = () => {
  const held = new Set<string>();
  const create = (): BrowserLockManager => ({
    request: async (name, _options, callback) => {
      if (held.has(name)) return callback(null);
      held.add(name);
      try {
        return await callback({ name });
      } finally {
        held.delete(name);
      }
    },
  });
  return { first: create(), second: create() };
};

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { 'Content-Type': 'application/json' },
});

afterEach(() => vi.unstubAllGlobals());

describe('central browser OAuth transport', () => {
  it('owns one nonce per page and rotates a cloned sessionStorage nonce', async () => {
    const firstTab = new MemoryStorage();
    const secondTab = new MemoryStorage();
    const firstOwner = createOAuthNonceOwner();
    const secondOwner = createOAuthNonceOwner();
    const locks = sharedLockManagers();

    const first = await firstOwner.getNonce(firstTab, locks.first);
    secondTab.setItem(OAUTH_NONCE_STORAGE_KEY, first);
    expect(await firstOwner.getNonce(firstTab, locks.first)).toBe(first);
    expect(await secondOwner.getNonce(secondTab, locks.second)).not.toBe(first);
    expect(firstTab.getItem(OAUTH_NONCE_STORAGE_KEY)).toBe(first);

    firstOwner.clearNonce(firstTab);
    expect(firstTab.getItem(OAUTH_NONCE_STORAGE_KEY)).toBeNull();

    const replacementPage = new MemoryStorage();
    replacementPage.setItem(OAUTH_NONCE_STORAGE_KEY, first);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(await createOAuthNonceOwner().getNonce(replacementPage, locks.first)).toBe(first);
  });

  it('fails closed when Web Locks are unavailable', async () => {
    await expect(createOAuthNonceOwner().getNonce(new MemoryStorage(), null)).rejects.toThrow(
      'oauth_browser_web_locks_unsupported',
    );
  });

  it('waits for nonce ownership before sending an OAuth request', async () => {
    const storage = new MemoryStorage();
    const owner = createOAuthNonceOwner();
    let acquire: ((lock: BrowserLock) => void) | undefined;
    const locks: BrowserLockManager = {
      request: (_name, _options, callback) => new Promise((resolve, reject) => {
        acquire = (lock) => { void Promise.resolve(callback(lock)).then(resolve, reject); };
      }),
    };
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));

    const pending = browserJsonRequest('/api/oauth/status', {}, {
      authMode: 'oauth', storage, fetchImpl, nonceOwner: owner, locks,
    });
    await Promise.resolve();
    expect(fetchImpl).not.toHaveBeenCalled();
    acquire?.({ name: 'owned' });
    await pending;
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('keeps manual requests operational without Web Locks', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ ok: true }));
    await browserJsonRequest('/api/export', { token: 'manual-token' }, {
      authMode: 'manual', fetchImpl, locks: undefined,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it('sends only OAuth headers and strips every manual credential field', async () => {
    const storage = new MemoryStorage();
    const owner = createOAuthNonceOwner();
    const locks = sharedLockManagers().first;
    const expectedNonce = await owner.getNonce(storage, locks);
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Twilight-Auth')).toBe('oauth');
      expect(headers.get('X-Twilight-OAuth-Nonce')).toBe(expectedNonce);
      expect(headers.get('Authorization')).toBeNull();
      expect(headers.get('X-Auth-Key')).toBeNull();
      expect(headers.get('X-Auth-Email')).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual({ accountId: 'a'.repeat(32), oauthRole: 'destination' });
      return jsonResponse({ ok: true });
    });

    await browserJsonRequest('/api/accounts', {
      token: 'provider-secret', sourceToken: 'provider-secret', destToken: 'provider-secret',
      useApiKey: true, apiKey: 'provider-secret', apiEmail: 'secret@example.com',
      destApiKey: 'provider-secret', destApiEmail: 'secret@example.com',
      accountId: 'a'.repeat(32), oauthRole: 'destination',
    }, { authMode: 'oauth', storage, fetchImpl, nonceOwner: owner, locks });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('preserves manual payloads without attaching OAuth headers', async () => {
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      const headers = new Headers(init?.headers);
      expect(headers.get('X-Twilight-Auth')).toBeNull();
      expect(headers.get('X-Twilight-OAuth-Nonce')).toBeNull();
      expect(JSON.parse(String(init?.body))).toEqual({ token: 'manual-token' });
      return jsonResponse({ ok: true });
    });

    await browserJsonRequest('/api/export', { token: 'manual-token' }, { authMode: 'manual', fetchImpl });
  });

  it('uses destination OAuth for the preset capability probe without sending manual credentials', async () => {
    const storage = new MemoryStorage();
    vi.stubGlobal('sessionStorage', storage);
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      expect(input).toBe('/api/check-capabilities');
      expect(new Headers(init?.headers).get('X-Twilight-Auth')).toBe('oauth');
      expect(JSON.parse(String(init?.body))).toEqual({ destAccountId: 'a'.repeat(32) });
      return jsonResponse({ capabilities: {} });
    });
    vi.stubGlobal('fetch', fetchImpl);

    await checkCapabilities({ authMode: 'oauth', destToken: 'must-not-be-sent' }, 'a'.repeat(32));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('propagates migrationId on prompts and handles typed reauthorization exactly once', async () => {
    const storage = new MemoryStorage();
    const encoded = new TextEncoder().encode([
      `data: {"type":"prompt","migrationId":"migration-1","promptId":"prompt-1","sourceAccountId":"${'a'.repeat(32)}","destinationAccountId":"${'b'.repeat(32)}","oauthRoles":["source","destination"],"question":"Continue?","options":[]}\n\n`,
      'data: {"type":"reauthorization_required","role":"source","reason":"oauth_reauthorization_required"}\n\n',
    ].join(''));
    const onPrompt = vi.fn();
    const onReauthorizationRequired = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoded); controller.close(); },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await browserStreamRequest('/api/migrate/stream', {}, {
      onLog: () => undefined,
      onDone: () => undefined,
      onError: () => undefined,
      onPrompt,
      onReauthorizationRequired,
    }, { authMode: 'oauth', storage, fetchImpl });

    expect(onPrompt).toHaveBeenCalledWith({
      migrationId: 'migration-1', promptId: 'prompt-1', question: 'Continue?', options: [],
    });
    expect(onReauthorizationRequired).toHaveBeenCalledTimes(1);
    expect(onReauthorizationRequired).toHaveBeenCalledWith('source', 'oauth_reauthorization_required');
  });

  it('reports typed SSE reauthorization as an error when no role callback is registered', async () => {
    const encoded = new TextEncoder().encode(
      'data: {"type":"reauthorization_required","role":"source","reason":"oauth_reauthorization_required"}\n\n',
    );
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () => new Response(new ReadableStream({
      start(controller) { controller.enqueue(encoded); controller.close(); },
    }), { status: 200, headers: { 'Content-Type': 'text/event-stream' } }));

    await browserStreamRequest('/api/analytics/probe/stream', {}, {
      onLog: () => undefined,
      onDone: () => undefined,
      onError,
    }, { authMode: 'oauth', storage: new MemoryStorage(), fetchImpl });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('oauth_reauthorization_required');
  });

  it('reports HTTP reauthorization as an error when no role callback is registered', async () => {
    const onError = vi.fn();
    const fetchImpl = vi.fn(async () => jsonResponse({
      error: 'oauth_reauthorization_required', role: 'destination',
    }, 401));

    await browserStreamRequest('/api/analytics/export/stream', {}, {
      onLog: () => undefined,
      onDone: () => undefined,
      onError,
    }, { authMode: 'oauth', storage: new MemoryStorage(), fetchImpl });

    expect(onError).toHaveBeenCalledOnce();
    expect(onError).toHaveBeenCalledWith('oauth_reauthorization_required');
  });

  it('propagates prompt-response reauthorization to the role-clearing callback', async () => {
    const onReauthorizationRequired = vi.fn();
    const fetchImpl = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      expect(JSON.parse(String(init?.body))).toEqual({
        migrationId: 'migration-1', promptId: 'prompt-1', answer: 'overwrite',
      });
      return jsonResponse({ error: 'oauth_reauthorization_required', role: 'destination' }, 401);
    });

    await expect(browserPromptResponse({
      promptId: 'prompt-1', answer: 'overwrite', migrationId: 'migration-1',
      sourceAccountId: 'a'.repeat(32), destinationAccountId: 'b'.repeat(32),
      oauthRoles: ['destination'],
    } as never, {
      authMode: 'oauth', storage: new MemoryStorage(), fetchImpl,
    }, onReauthorizationRequired)).resolves.toBe(false);

    expect(onReauthorizationRequired).toHaveBeenCalledTimes(1);
    expect(onReauthorizationRequired).toHaveBeenCalledWith('destination');
  });
});
