# Story 001: OAuth Cryptographic Core

## Summary
Build and test the pure PKCE, nonce hashing, key parsing, and AES-256-GCM envelope primitives.

## Dependencies
- Depends on: None

## Requirements
- Generate state, PKCE verifier/challenge, and unique 96-bit IVs with Web Crypto.
- Strictly parse a 32-byte base64url key and versioned transaction/grant payloads.
- Authenticate version, key ID, role, purpose, and origin as AES-GCM additional data.
- Generate independent 128-bit grant/migration IDs and compare fixed-length state, nonce, and context digests without early exit.

## Acceptance Criteria
1. **Given** deterministic PKCE vectors, **When** challenge generation runs, **Then** output matches the vectors.
2. **Given** a valid envelope, **When** it round-trips, **Then** the validated payload is recovered.
3. **Given** altered ciphertext or context, **When** decryption runs, **Then** it fails without plaintext.
4. **Given** repeated encryption, **When** IVs are inspected, **Then** they are unique.
5. **Given** equal and unequal fixed-length digests, **When** comparison runs, **Then** equal values pass and every changed-byte position fails without ordinary early-return comparison.

## Technical Notes
- **Files:** `src/worker/oauth/crypto.ts`, `src/worker/oauth/types.ts`, `test/oauthCrypto.test.ts`
- **APIs:** Web Crypto only
- **Patterns:** Pure functions, strict boundary parsing, no secret-bearing errors

## Estimated Complexity
Medium
