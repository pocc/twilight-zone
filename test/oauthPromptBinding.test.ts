import { describe, expect, it } from 'vitest';

import { createOAuthPromptBinding } from '../src/worker/oauth/prompt-binding';
import { generateGrantId } from '../src/worker/oauth/crypto';

const resolvedRole = (role: 'source' | 'destination') => ({
  auth: { type: 'token' as const, token: `${role}-token` },
  grant: {
    version: 1 as const,
    role,
    accessToken: `${role}-token`,
    tokenType: 'Bearer',
    expiresAt: 1_800_000,
    scopes: ['zone:read'],
    nonceDigest: 'nonce-digest',
    grantId: generateGrantId(),
  },
});

describe('OAuth prompt binding', () => {
  it('derives a destination-only binding without inventing source authority', () => {
    const destination = resolvedRole('destination');
    expect(createOAuthPromptBinding({ nonceDigest: 'nonce-digest', destination })).toEqual({
      roles: ['destination'],
      auth: {
        nonceDigest: 'nonce-digest',
        destinationGrantId: destination.grant.grantId,
        roles: ['destination'],
      },
    });
  });

  it('derives the exact two-role binding for live API migrations', () => {
    const source = resolvedRole('source');
    const destination = resolvedRole('destination');
    expect(createOAuthPromptBinding({ nonceDigest: 'nonce-digest', source, destination })).toMatchObject({
      roles: ['source', 'destination'],
      auth: {
        sourceGrantId: source.grant.grantId,
        destinationGrantId: destination.grant.grantId,
        roles: ['source', 'destination'],
      },
    });
  });
});
