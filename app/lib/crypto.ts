// Config encryption/decryption (AES-256-GCM)

async function deriveKey(password: string, salt: Uint8Array): Promise<CryptoKey> {
  const keyMaterial = await crypto.subtle.importKey(
    'raw', new TextEncoder().encode(password) as BufferSource, { name: 'PBKDF2' }, false, ['deriveBits', 'deriveKey'],
  );
  // OWASP 2026 guidance for PBKDF2-SHA256: ≥ 600,000 iterations.
  // https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html#pbkdf2
  return crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt: salt as BufferSource, iterations: 600000, hash: 'SHA-256' },
    keyMaterial, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt'],
  );
}

// Encrypt a raw UTF-8 string → base64(salt[16] ++ iv[12] ++ AES-GCM ciphertext).
// The base unit all other helpers build on (config JSON, file downloads).
export async function encryptString(plaintext: string, password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await deriveKey(password, salt);
  const encoded = new TextEncoder().encode(plaintext);
  const encrypted = await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, key, encoded);
  const combined = new Uint8Array(salt.length + iv.length + encrypted.byteLength);
  combined.set(salt, 0);
  combined.set(iv, salt.length);
  combined.set(new Uint8Array(encrypted), salt.length + iv.length);
  return bytesToBase64(combined);
}

export async function encryptData(data: Record<string, unknown>, password: string): Promise<string> {
  return encryptString(JSON.stringify(data), password);
}

// Chunked base64 encode. Spreading a multi-MB Uint8Array into
// String.fromCharCode(...combined) can exceed the JS call-stack limit
// ("Maximum call stack size exceeded") when encrypting a large migration
// config (e.g. a zone with thousands of DNS records). Encode in fixed-size
// chunks to keep the argument count bounded.
function bytesToBase64(bytes: Uint8Array): string {
  const CHUNK = 0x8000; // 32 KiB worth of args per call — safely under the limit
  let binary = '';
  for (let i = 0; i < bytes.length; i += CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(binary);
}

export async function decryptString(encryptedBase64: string, password: string): Promise<string> {
  const combined = Uint8Array.from(atob(encryptedBase64), c => c.charCodeAt(0));
  const salt = combined.slice(0, 16);
  const iv = combined.slice(16, 28);
  const data = combined.slice(28);
  const key = await deriveKey(password, salt);
  const decrypted = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, data);
  return new TextDecoder().decode(decrypted);
}

export async function decryptData(encryptedBase64: string, password: string): Promise<Record<string, unknown>> {
  return JSON.parse(await decryptString(encryptedBase64, password));
}

// Self-describing envelope for an encrypted file download. Stored as a JSON
// sidecar (saved with a `.enc` extension) so it carries everything an importer
// needs to recognise and decrypt it — the `_encrypted: true` marker documented
// in docs/SECURITY.md (SC-28), the algorithm/KDF parameters, and the original
// filename. The plaintext lives only inside `ciphertext` (base64 AES-GCM).
export interface EncryptedEnvelope {
  _encrypted: true;
  alg: 'AES-256-GCM';
  kdf: { name: 'PBKDF2'; hash: 'SHA-256'; iterations: number };
  /** Original filename, so a decryptor can restore it. */
  filename: string;
  /** base64(salt ++ iv ++ AES-GCM ciphertext) of the file's UTF-8 bytes. */
  ciphertext: string;
}

export async function encryptFile(content: string, filename: string, password: string): Promise<string> {
  const ciphertext = await encryptString(content, password);
  const envelope: EncryptedEnvelope = {
    _encrypted: true,
    alg: 'AES-256-GCM',
    kdf: { name: 'PBKDF2', hash: 'SHA-256', iterations: 600000 },
    filename,
    ciphertext,
  };
  return JSON.stringify(envelope, null, 2);
}
