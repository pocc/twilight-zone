import { createHash, randomUUID } from 'node:crypto';
import { createServer } from 'node:http';

type Authorization = {
  challenge: string;
  clientId: string;
  redirectUri: string;
  scope: string;
};

const host = '127.0.0.1';
const port = 4174;
const authorizations = new Map<string, Authorization>();
let exchanges = 0;
let revocations = 0;

const respondJson = (response: import('node:http').ServerResponse, status: number, value: unknown): void => {
  response.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' });
  response.end(JSON.stringify(value));
};

const readBody = async (request: import('node:http').IncomingMessage): Promise<string> => {
  let body = '';
  for await (const chunk of request) body += String(chunk);
  return body;
};

const server = createServer(async (request, response) => {
  const url = new URL(request.url ?? '/', `http://${host}:${port}`);
  if (request.method === 'GET' && url.pathname === '/health') {
    respondJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/test/reset') {
    authorizations.clear();
    exchanges = 0;
    revocations = 0;
    respondJson(response, 200, { ok: true });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/test/state') {
    respondJson(response, 200, { exchanges, revocations });
    return;
  }
  if (request.method === 'GET' && url.pathname === '/oauth2/auth') {
    const redirectUri = url.searchParams.get('redirect_uri');
    const state = url.searchParams.get('state');
    const clientId = url.searchParams.get('client_id');
    const scope = url.searchParams.get('scope');
    const challenge = url.searchParams.get('code_challenge');
    if (
      url.searchParams.get('response_type') !== 'code'
      || url.searchParams.get('code_challenge_method') !== 'S256'
      || !redirectUri || !state || !clientId || !scope || !challenge
    ) {
      respondJson(response, 400, { error: 'invalid_authorization_request' });
      return;
    }
    const code = randomUUID();
    authorizations.set(code, { challenge, clientId, redirectUri, scope });
    const callback = new URL(redirectUri);
    callback.searchParams.set('code', code);
    callback.searchParams.set('state', state);
    response.writeHead(302, { Location: callback.href, 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  if (request.method === 'POST' && url.pathname === '/oauth2/token') {
    const body = new URLSearchParams(await readBody(request));
    const code = body.get('code') ?? '';
    const authorization = authorizations.get(code);
    const verifier = body.get('code_verifier') ?? '';
    const challenge = createHash('sha256').update(verifier).digest('base64url');
    if (
      body.get('grant_type') !== 'authorization_code'
      || !authorization
      || authorization.clientId !== body.get('client_id')
      || authorization.redirectUri !== body.get('redirect_uri')
      || authorization.challenge !== challenge
    ) {
      respondJson(response, 400, { error: 'invalid_grant' });
      return;
    }
    authorizations.delete(code);
    exchanges++;
    respondJson(response, 200, {
      access_token: `local-oauth-access-token-canary-${exchanges}`,
      token_type: 'Bearer',
      expires_in: 3600,
      scope: authorization.scope,
    });
    return;
  }
  if (request.method === 'POST' && url.pathname === '/oauth2/revoke') {
    const body = new URLSearchParams(await readBody(request));
    if (!body.get('token')) {
      respondJson(response, 400, { error: 'invalid_token' });
      return;
    }
    revocations++;
    response.writeHead(204, { 'Cache-Control': 'no-store' });
    response.end();
    return;
  }
  respondJson(response, 404, { error: 'not_found' });
});

server.listen(port, host);

const shutdown = (): void => server.close(() => process.exit(0));
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
