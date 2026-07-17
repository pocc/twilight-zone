import { describe, it, expect } from 'vitest';
import { workerSecretManualActions } from '../src/migrate/workers';

// Regression guard for the secret_text manual-action gap surfaced by the live
// e02 run (2026-06-07): a worker with a secret_text binding and NO supplied
// value migrated silently with no manual action, leaving the dest worker broken
// (env.SECRET undefined) and the user unwarned — a Principle 1/3/4 violation.
// workers-deploy now surfaces a manual action for every secret_text binding
// whose value wasn't provided via workerSecrets.

const SECRET_BINDING = { type: 'secret_text', name: 'SECRET' };

describe('workerSecretManualActions', () => {
  it('surfaces a manual action when a secret_text value is NOT provided', () => {
    const out = workerSecretManualActions([{ id: 'w1', bindings: [SECRET_BINDING] }], undefined);
    expect(out).toHaveLength(1);
    // Must match the phrasing assertSecretsManualAction looks for.
    expect(out[0]).toMatch(/provide\s+secret\s+values\s+in\s+step\s*3/i);
    expect(out[0]).toMatch(/wrangler\s+secret\s+put/i);
    expect(out[0]).toContain('w1 (SECRET)');
  });

  it('also fires when workerSecrets is provided but missing THIS secret', () => {
    const out = workerSecretManualActions(
      [{ id: 'w1', bindings: [SECRET_BINDING, { type: 'secret_text', name: 'OTHER' }] }],
      { w1: { OTHER: 'value' } }, // SECRET still unset
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('w1 (SECRET)');
    expect(out[0]).not.toContain('OTHER');
  });

  it('is silent when every secret_text value is supplied', () => {
    const out = workerSecretManualActions(
      [{ id: 'w1', bindings: [SECRET_BINDING] }],
      { w1: { SECRET: 'provided' } },
    );
    expect(out).toEqual([]);
  });

  it('is silent for workers with no secret_text bindings', () => {
    const out = workerSecretManualActions(
      [{ id: 'w1', bindings: [{ type: 'kv_namespace', name: 'KV' }, { type: 'r2_bucket', name: 'R2' }] }],
      undefined,
    );
    expect(out).toEqual([]);
  });

  it('reports multiple workers, only those with unset secrets', () => {
    const out = workerSecretManualActions(
      [
        { id: 'a', bindings: [SECRET_BINDING] },
        { id: 'b', bindings: [{ type: 'secret_text', name: 'TOKEN' }] },
        { id: 'c', bindings: [SECRET_BINDING] },
      ],
      { c: { SECRET: 'set' } }, // c is covered
    );
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('a (SECRET)');
    expect(out[0]).toContain('b (TOKEN)');
    expect(out[0]).not.toContain('c (');
  });
});
