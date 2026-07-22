// Vetted platform crypto only (node:crypto). No custom hashing or token signing.
// Session tokens are opaque 256-bit random values; only their SHA-256 is stored,
// so a database read never yields a usable token, and no signing key exists.
import { createHash, randomBytes } from 'node:crypto';

/** SHA-256 of a UTF-8 string or Buffer, as a 32-byte Buffer (matches the DB hash length). */
export function sha256(input: string | Buffer): Buffer {
  return createHash('sha256').update(input).digest();
}

/** A fresh opaque session token: 256 bits of randomness, base64url-encoded. */
export function newSessionToken(): string {
  return randomBytes(32).toString('base64url');
}
