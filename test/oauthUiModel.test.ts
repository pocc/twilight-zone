import { describe, expect, it, vi } from 'vitest';

import {
  oauthReadiness,
  requiredOAuthRoles,
  runPresetApplyIfAuthorized,
  type OAuthRoleStatus,
} from '../app/lib/oauth';

const connected = (expiresAt: number): OAuthRoleStatus => ({ connected: true, expiresAt, scopes: ['zone:read'] });

describe('OAuth setup readiness model', () => {
  it.each([
    ['api', ['source', 'destination']],
    ['json', ['destination']],
    ['terraform', ['destination']],
    ['maxconfig', ['destination']],
    ['minconfig', ['destination']],
  ] as const)('requires operation-aware roles for %s mode', (sourceMode, expected) => {
    expect(requiredOAuthRoles(sourceMode)).toEqual(expected);
  });

  it('accepts equality and rejects one millisecond below the 35-minute migration threshold', () => {
    const now = 1_700_000_000_000;
    const roles = { source: connected(now + 2_100_000), destination: connected(now + 2_100_000) };
    expect(oauthReadiness('api', roles, now, 'migration').ready).toBe(true);

    roles.destination = connected(now + 2_100_000 - 1);
    expect(oauthReadiness('api', roles, now, 'migration')).toMatchObject({
      ready: false,
      reconnectRoles: ['destination'],
    });
  });

  it('accepts equality and rejects one millisecond below the 20-minute phase-two threshold', () => {
    const now = 1_700_000_000_000;
    expect(oauthReadiness('api', {
      source: connected(now + 1_200_000), destination: connected(now + 1_200_000),
    }, now, 'phase-two').ready).toBe(true);
    expect(oauthReadiness('api', {
      source: connected(now + 1_200_000), destination: connected(now + 1_200_000 - 1),
    }, now, 'phase-two').ready).toBe(false);
  });

  it('blocks unknown expiry but allows destination-only modes without a source grant', () => {
    const now = 1_700_000_000_000;
    expect(oauthReadiness('json', {
      source: { connected: false }, destination: connected(now + 2_100_000),
    }, now, 'migration').ready).toBe(true);
    expect(oauthReadiness('api', {
      source: { connected: true, scopes: [] }, destination: connected(now + 2_100_000),
    }, now, 'migration')).toMatchObject({ ready: false, reconnectRoles: ['source'] });
  });

  it('accepts equality and rejects one millisecond below the 20-minute preset threshold', async () => {
    const now = 1_700_000_000_000;
    const apply = vi.fn(async () => undefined);
    const reconnect = vi.fn();

    const accepted = await runPresetApplyIfAuthorized({
      authMode: 'oauth',
      sourceMode: 'maxconfig',
      roles: { source: { connected: false }, destination: connected(now + 1_200_000) },
      now,
      onReauthorizationRequired: reconnect,
    }, apply);
    expect(accepted).toBe(true);
    expect(apply).toHaveBeenCalledTimes(1);
    expect(reconnect).not.toHaveBeenCalled();

    const rejected = await runPresetApplyIfAuthorized({
      authMode: 'oauth',
      sourceMode: 'minconfig',
      roles: { source: { connected: false }, destination: connected(now + 1_200_000 - 1) },
      now,
      onReauthorizationRequired: reconnect,
    }, apply);

    expect(rejected).toBe(false);
    expect(reconnect).toHaveBeenCalledWith('destination');
    expect(apply).toHaveBeenCalledTimes(1);
  });
});
