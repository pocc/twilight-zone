import { describe, expect, it, vi } from 'vitest';

import { base64UrlEncode, generateGrantId, generateMigrationId } from '../src/worker/oauth/crypto';
import { createMigrationPromptRegistry } from '../src/worker/oauth/prompt-registry';

const auth = () => ({
  nonceDigest: base64UrlEncode(new Uint8Array(32).fill(5)),
  sourceGrantId: generateGrantId(),
  destinationGrantId: generateGrantId(),
  roles: ['source', 'destination'] as const,
});

describe('OAuth migration prompt registry', () => {
  it('resolves only with the opaque migration/prompt pair and matching server-derived grant context', async () => {
    const registry = createMigrationPromptRegistry();
    const migrationId = generateMigrationId();
    const currentAuth = auth();
    const resolver = vi.fn();
    const promptId = await registry.register({
      migrationId,
      auth: currentAuth,
      roles: ['source', 'destination'],
      sourceAccountId: 'a'.repeat(32),
      destinationAccountId: 'b'.repeat(32),
      resolver,
    });

    await expect(registry.resolve({
      migrationId, promptId, answer: 'overwrite',
    }, currentAuth)).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith('overwrite');
    await expect(registry.resolve({
      migrationId, promptId, answer: 'replay',
    }, currentAuth)).resolves.toBe(false);
  });

  it.each(['tab', 'source grant', 'destination grant', 'migration'])('rejects a different %s context', async (mutation) => {
    const registry = createMigrationPromptRegistry();
    const migrationId = generateMigrationId();
    const currentAuth = auth();
    const resolver = vi.fn();
    const promptId = await registry.register({
      migrationId,
      auth: currentAuth,
      roles: ['source', 'destination'],
      sourceAccountId: 'a'.repeat(32),
      destinationAccountId: 'b'.repeat(32),
      resolver,
    });
    const changed = { ...currentAuth };
    if (mutation === 'tab') changed.nonceDigest = base64UrlEncode(new Uint8Array(32).fill(6));
    if (mutation === 'source grant') changed.sourceGrantId = generateGrantId();
    if (mutation === 'destination grant') changed.destinationGrantId = generateGrantId();
    const responseMigrationId = mutation === 'migration' ? generateMigrationId() : migrationId;

    await expect(registry.resolve({
      migrationId: responseMigrationId, promptId, answer: 'overwrite',
    }, changed)).resolves.toBe(false);
    expect(resolver).not.toHaveBeenCalled();
  });

  it('keeps required roles and account identifiers in server-owned prompt context', async () => {
    const registry = createMigrationPromptRegistry();
    const migrationId = generateMigrationId();
    const currentAuth = auth();
    const resolver = vi.fn();
    const sourceAccountId = 'a'.repeat(32);
    const destinationAccountId = 'b'.repeat(32);
    const promptId = await registry.register({
      migrationId, auth: currentAuth, roles: ['source', 'destination'],
      sourceAccountId, destinationAccountId, resolver,
    });

    expect(registry.getContext(migrationId, promptId)).toEqual({
      roles: ['source', 'destination'], sourceAccountId, destinationAccountId,
    });
  });

  it('binds destination-only prompts to exactly the destination role', async () => {
    const registry = createMigrationPromptRegistry();
    const migrationId = generateMigrationId();
    const destinationGrantId = generateGrantId();
    const nonceDigest = base64UrlEncode(new Uint8Array(32).fill(5));
    const resolver = vi.fn();
    const promptId = await registry.register({
      migrationId,
      auth: { nonceDigest, destinationGrantId, roles: ['destination'] } as never,
      roles: ['destination'],
      sourceAccountId: 'a'.repeat(32),
      destinationAccountId: 'b'.repeat(32),
      resolver,
    });

    await expect(registry.resolve({
      migrationId, promptId, answer: 'wrong-role-set',
    }, {
      nonceDigest,
      sourceGrantId: generateGrantId(),
      destinationGrantId,
      roles: ['source', 'destination'],
    } as never)).resolves.toBe(false);
    expect(resolver).not.toHaveBeenCalled();

    await expect(registry.resolve({
      migrationId, promptId, answer: 'overwrite',
    }, { nonceDigest, destinationGrantId, roles: ['destination'] } as never)).resolves.toBe(true);
    expect(resolver).toHaveBeenCalledWith('overwrite');
  });
});
