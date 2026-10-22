import { createHash, randomBytes, scrypt, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

// ---- passwords --------------------------------------------------------------------

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 } as const;

const scryptAsync = (password: string, salt: Buffer): Promise<Buffer> =>
  new Promise((resolve, reject) =>
    scrypt(password, salt, SCRYPT.keylen, { N: SCRYPT.N, r: SCRYPT.r, p: SCRYPT.p }, (err, key) => (err ? reject(err) : resolve(key)))
  );

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await scryptAsync(password, salt);
  return `scrypt$${SCRYPT.N}$${SCRYPT.r}$${SCRYPT.p}$${salt.toString('base64')}$${key.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [alg, , , , saltB64, keyB64] = stored.split('$');
  if (alg !== 'scrypt' || !saltB64 || !keyB64) return false;
  const expected = Buffer.from(keyB64, 'base64');
  const actual = await scryptAsync(password, Buffer.from(saltB64, 'base64'));
  return actual.length === expected.length && timingSafeEqual(actual, expected);
}

/** A hash to compare against when the account does not exist, so timing doesn't reveal it. */
let dummyHash: Promise<string> | null = null;
export const getDummyHash = () => (dummyHash ??= hashPassword('not-a-real-password'));

export function passwordProblem(password: unknown): string | null {
  if (typeof password !== 'string') return 'Password is required.';
  if (password.length < 10) return 'Use at least 10 characters for your password.';
  if (password.length > 200) return 'That password is too long.';
  if (/^(.)\1+$/.test(password)) return 'Choose a less repetitive password.';
  return null;
}

// ---- tokens -----------------------------------------------------------------------

export const newToken = () => randomBytes(32).toString('base64url');
export const hashToken = (t: string) => createHash('sha256').update(t).digest('hex');
export const newId = (p: string) => `${p}_${randomBytes(6).toString('hex')}`;

// ---- sessions ---------------------------------------------------------------------

export const SESSION_DAYS = 14;

export interface SessionMeta {
  userAgent?: string;
  ip?: string;
}

export async function createSession(db: Db, userId: string, meta: SessionMeta = {}): Promise<string> {
  const token = newToken();
  await db.query(`insert into sessions (token_hash, user_id, expires_at, user_agent, ip) values ($1, $2, now() + ($3 || ' days')::interval, $4, $5)`, [
    hashToken(token),
    userId,
    String(SESSION_DAYS),
    (meta.userAgent ?? '').slice(0, 300) || null,
    (meta.ip ?? '').slice(0, 64) || null,
  ]);
  return token;
}

/** "Chrome on Windows" from a browser's own description: good enough to recognise your devices. */
export function deviceName(userAgent: string | null | undefined): string {
  const ua = userAgent ?? '';
  const browser = /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'A browser';
  const os = /Windows/.test(ua) ? 'Windows' : /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Android/.test(ua) ? 'Android' : /Mac OS X|Macintosh/.test(ua) ? 'macOS' : /Linux/.test(ua) ? 'Linux' : '';
  return os ? `${browser} on ${os}` : browser;
}

export interface SessionView {
  id: string;
  device: string;
  ip: string;
  createdAt: string;
  current: boolean;
}

/** Where this person is signed in. The id is only a short piece of the stored fingerprint, never the cookie itself. */
export async function listSessions(db: Db, userId: string, currentToken?: string): Promise<SessionView[]> {
  const mine = currentToken ? hashToken(currentToken) : '';
  const rows = await db.query(`select token_hash, user_agent, ip, created_at from sessions where user_id = $1 and expires_at > now() order by created_at desc`, [userId]);
  return rows.map((r) => ({
    id: String(r.token_hash).slice(0, 16),
    device: deviceName(r.user_agent as string | null),
    ip: String(r.ip ?? ''),
    createdAt: new Date(String(r.created_at)).toISOString(),
    current: String(r.token_hash) === mine,
  }));
}

/** Signs out one other device. Never the one making the request (that is "sign out"), and never someone else's. */
export async function revokeSession(db: Db, userId: string, id: string, currentToken?: string): Promise<boolean> {
  if (!/^[a-f0-9]{16}$/.test(id)) return false;
  const rows = await db.query(`delete from sessions where user_id = $1 and token_hash like $2 and token_hash <> $3 returning token_hash`, [userId, `${id}%`, currentToken ? hashToken(currentToken) : '']);
  return rows.length > 0;
}

export async function sessionUser(db: Db, token: string | undefined): Promise<string | null> {
  if (!token) return null;
  const rows = await db.query(`select user_id from sessions where token_hash = $1 and expires_at > now()`, [hashToken(token)]);
  return rows.length ? String(rows[0].user_id) : null;
}

export async function deleteSession(db: Db, token: string | undefined): Promise<void> {
  if (token) await db.query(`delete from sessions where token_hash = $1`, [hashToken(token)]);
}

export async function deleteUserSessions(db: Db, userId: string, exceptToken?: string): Promise<void> {
  if (exceptToken) await db.query(`delete from sessions where user_id = $1 and token_hash <> $2`, [userId, hashToken(exceptToken)]);
  else await db.query(`delete from sessions where user_id = $1`, [userId]);
}

export async function purgeExpired(db: Db): Promise<void> {
  await db.query(`delete from sessions where expires_at <= now()`);
  await db.query(`delete from invites where expires_at <= now() and accepted_at is null`);
  await db.query(`delete from password_resets where expires_at <= now()`);
}

// ---- throttling ---------------------------------------------------------------------

/** Sliding-window counter, per key. In memory: fine for one process; use Redis when scaling out. */
export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs: number) {}

  /** Records an attempt; returns false when the key is over its limit. */
  allow(key: string, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (recent.length >= this.max) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    if (this.hits.size > 10000) this.hits.clear(); // crude memory bound
    return true;
  }

  reset(key: string) {
    this.hits.delete(key);
  }
}
