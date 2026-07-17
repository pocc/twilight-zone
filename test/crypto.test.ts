import { describe, it, expect } from 'vitest';
import {
  encryptData, decryptData,
  encryptString, decryptString,
  encryptFile, type EncryptedEnvelope,
} from '../app/lib/crypto';

describe('app/lib/crypto.ts', () => {
  it('round-trips a small config', async () => {
    const data = { token: 'abc', nested: { a: 1, b: [1, 2, 3] } };
    const enc = await encryptData(data, 'correct horse battery staple');
    expect(typeof enc).toBe('string');
    const dec = await decryptData(enc, 'correct horse battery staple');
    expect(dec).toEqual(data);
  });

  it('fails to decrypt with the wrong password', async () => {
    const enc = await encryptData({ x: 1 }, 'pw-one');
    await expect(decryptData(enc, 'pw-two')).rejects.toBeTruthy();
  });

  // F-3: a large config previously crashed encryptData via
  // String.fromCharCode(...combined) ("Maximum call stack size exceeded").
  // The chunked encoder must handle multi-MB payloads without throwing.
  it('round-trips a large config without a stack overflow', async () => {
    const big = { records: Array.from({ length: 50_000 }, (_, i) => ({ i, name: `record-${i}.example.com` })) };
    const enc = await encryptData(big, 'pw');
    const dec = await decryptData(enc, 'pw') as typeof big;
    expect(dec.records).toHaveLength(50_000);
    expect(dec.records[49_999]).toEqual({ i: 49_999, name: 'record-49999.example.com' });
  });
});

describe('encryptString / decryptString (raw text, for non-JSON downloads)', () => {
  it('round-trips arbitrary text (e.g. a markdown report)', async () => {
    const md = '# Migration Report\n\n- DNS: ✅\n- Workers: 🟡 acknowledged\n';
    const enc = await encryptString(md, 'hunter2');
    expect(typeof enc).toBe('string');
    expect(enc).not.toContain('Migration Report'); // ciphertext, not plaintext
    expect(await decryptString(enc, 'hunter2')).toBe(md);
  });

  it('fails to decrypt text with the wrong password', async () => {
    const enc = await encryptString('secret csv,row', 'pw-one');
    await expect(decryptString(enc, 'pw-two')).rejects.toBeTruthy();
  });

  it('round-trips a large text payload without a stack overflow', async () => {
    const big = 'x,'.repeat(2_000_000); // ~4 MB of CSV-ish text
    const enc = await encryptString(big, 'pw');
    expect(await decryptString(enc, 'pw')).toBe(big);
  });
});

describe('encryptFile (self-describing envelope with _encrypted marker)', () => {
  it('produces a JSON envelope whose ciphertext decrypts back to the file content', async () => {
    const content = 'timestamp,action\n2026-01-01,created';
    const json = await encryptFile(content, 'migration-audit-log.csv', 'pw');
    const env = JSON.parse(json) as EncryptedEnvelope;
    expect(env._encrypted).toBe(true);
    expect(env.alg).toBe('AES-256-GCM');
    expect(env.kdf.iterations).toBe(600000);
    expect(env.filename).toBe('migration-audit-log.csv');
    expect(json).not.toContain('timestamp,action'); // plaintext must not leak into the envelope
    expect(await decryptString(env.ciphertext, 'pw')).toBe(content);
  });
});
