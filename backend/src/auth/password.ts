// Argon2id password hashing using Node's built-in implementation (Node >= 24.7).
// Hashes are stored in the standard PHC string format, so parameters can be raised
// later without breaking existing hashes:
//   $argon2id$v=19$m=19456,t=2,p=1$<salt base64>$<hash base64>

import { argon2, randomBytes, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { z } from 'zod';

const argon2Async = promisify(argon2);

// OWASP Password Storage Cheat Sheet minimum for Argon2id.
const PARAMS = { memory: 19_456, passes: 2, parallelism: 1, tagLength: 32 } as const;

export const passwordPolicy = z
  .string()
  .min(10, 'Password must be at least 10 characters')
  .max(128, 'Password must be at most 128 characters')
  .regex(/[A-Za-z]/, 'Password must contain a letter')
  .regex(/[0-9]/, 'Password must contain a number');

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const hash = await argon2Async('argon2id', { message: password, nonce: salt, ...PARAMS });
  return `$argon2id$v=19$m=${PARAMS.memory},t=${PARAMS.passes},p=${PARAMS.parallelism}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  // ['', 'argon2id', 'v=19', 'm=..,t=..,p=..', salt, hash]
  if (parts.length !== 6 || parts[1] !== 'argon2id') return false;
  const params = Object.fromEntries(parts[3]!.split(',').map((kv) => kv.split('='))) as Record<string, string>;
  const salt = Buffer.from(parts[4]!, 'base64');
  const expected = Buffer.from(parts[5]!, 'base64');
  const actual = await argon2Async('argon2id', {
    message: password,
    nonce: salt,
    memory: Number(params.m),
    passes: Number(params.t),
    parallelism: Number(params.p),
    tagLength: expected.length,
  });
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

function b64(buf: Buffer): string {
  return buf.toString('base64').replace(/=+$/, '');
}

// Verified against when the email is unknown, so response time does not reveal
// whether an account exists.
let dummyHash: Promise<string> | undefined;
export function getDummyHash(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(24).toString('hex'));
  return dummyHash;
}
