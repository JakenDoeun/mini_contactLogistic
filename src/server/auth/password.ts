// Staff passwords: scrypt from Node's crypto (no auth library), stored as `scrypt$N$r$p$salt$hash` (base64).
import crypto from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number, options: crypto.ScryptOptions) => Promise<Buffer>;

const N = 2 ** 15;
const R = 8;
const P = 1;
const KEYLEN = 64;
const maxmem = (n: number, r: number) => 128 * n * r * 2; // scrypt needs 128·N·r bytes; Node's default limit is lower

export const PASSWORD_MIN = 12;
export const PASSWORD_MAX = 256;
const USERNAME_RULE = /^[a-z0-9][a-z0-9._-]{2,31}$/;

/** Usernames are case-insensitive: stored and compared trimmed and lower-cased. */
export const normalizeUsername = (raw: unknown) => (typeof raw === 'string' ? raw.trim().toLowerCase() : '');
export const validUsername = (username: string) => USERNAME_RULE.test(username);
export const validPassword = (password: unknown): password is string =>
  typeof password === 'string' && password.length >= PASSWORD_MIN && password.length <= PASSWORD_MAX && password.trim() !== '';

// The same text typed on a phone and a laptop can differ only in Unicode composition.
const prepare = (password: string) => password.normalize('NFC');

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const key = await scrypt(prepare(password), salt, KEYLEN, { N, r: R, p: P, maxmem: maxmem(N, R) });
  return `scrypt$${N}$${R}$${P}$${salt.toString('base64')}$${key.toString('base64')}`;
}

/** Constant-time check. A malformed stored value, or parameters outside sane bounds, never verifies. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = parts.slice(1, 4).map(Number);
  if (!Number.isInteger(n) || n < 2 ** 14 || n > 2 ** 20 || (n & (n - 1)) !== 0 || r !== R || p !== P) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  if (salt.length !== 16 || expected.length !== KEYLEN) return false;
  const key = await scrypt(prepare(password), salt, KEYLEN, { N: n, r, p, maxmem: maxmem(n, r) });
  return crypto.timingSafeEqual(key, expected);
}

let dummy: Promise<string> | undefined;
/** A real hash of a random password, so an unknown username costs the same scrypt work as a known one. */
export const dummyHash = () => (dummy ??= hashPassword(crypto.randomBytes(24).toString('base64')));
