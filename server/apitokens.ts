import { randomBytes } from 'node:crypto';
import { hashToken, newId } from './auth';
import type { Db } from './db';
import { HttpError } from './errors';

export type TokenScope = 'read' | 'write' | 'calendar';
export const TOKEN_PREFIX = 'abg_';
const MAX_TOKENS = 20;

export interface TokenView {
  id: string;
  name: string;
  scope: TokenScope;
  /** First characters only, so a person can recognise which one it is. The token itself is shown once. */
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

/**
 * Personal access tokens for scripts and other tools. Like passwords they are stored only as hashes, shown once,
 * revocable, and limited: `read`, `write` (never more than the person could do themselves), or `calendar`
 * (only the due-date feed). A token is never accepted anywhere except the public API and the calendar feed.
 */
export class ApiTokens {
  constructor(private db: Db) {}

  async create(userId: string, nameRaw: unknown, scopeRaw: unknown): Promise<{ token: string; view: TokenView }> {
    const name = typeof nameRaw === 'string' ? nameRaw.trim().replace(/\s+/g, ' ') : '';
    if (name.length < 1 || name.length > 60) throw new HttpError(400, 'Give the token a name (up to 60 characters), such as "Reporting script".');
    if (scopeRaw !== 'read' && scopeRaw !== 'write' && scopeRaw !== 'calendar') throw new HttpError(400, 'Choose what the token may do.');
    const count = Number((await this.db.query(`select count(*) as n from api_tokens where user_id = $1`, [userId]))[0].n);
    if (count >= MAX_TOKENS) throw new HttpError(400, `You have ${MAX_TOKENS} tokens already. Remove one you no longer use.`);
    const token = TOKEN_PREFIX + randomBytes(24).toString('base64url');
    const id = newId('tok');
    await this.db.query(`insert into api_tokens (id, user_id, name, scope, token_hash, hint) values ($1, $2, $3, $4, $5, $6)`, [id, userId, name, scopeRaw, hashToken(token), token.slice(0, 8)]);
    return { token, view: { id, name, scope: scopeRaw, hint: token.slice(0, 8), createdAt: new Date().toISOString(), lastUsedAt: null } };
  }

  async list(userId: string): Promise<TokenView[]> {
    const rows = await this.db.query(`select id, name, scope, hint, created_at, last_used_at from api_tokens where user_id = $1 order by created_at desc`, [userId]);
    return rows.map((r) => ({
      id: String(r.id),
      name: String(r.name),
      scope: r.scope as TokenScope,
      hint: String(r.hint),
      createdAt: new Date(String(r.created_at)).toISOString(),
      lastUsedAt: r.last_used_at ? new Date(String(r.last_used_at)).toISOString() : null,
    }));
  }

  async revoke(userId: string, id: string): Promise<boolean> {
    return (await this.db.query(`delete from api_tokens where id = $1 and user_id = $2 returning id`, [id, userId])).length > 0;
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.query(`delete from api_tokens where user_id = $1`, [userId]);
  }

  /** Who the token belongs to and what it may do, or null. Remembers when it was last used (at most every few minutes). */
  async verify(token: unknown): Promise<{ userId: string; scope: TokenScope; id: string } | null> {
    if (typeof token !== 'string' || !token.startsWith(TOKEN_PREFIX) || token.length > 100) return null;
    const rows = await this.db.query(`select id, user_id, scope, last_used_at from api_tokens where token_hash = $1`, [hashToken(token)]);
    if (!rows.length) return null;
    const r = rows[0];
    if (!r.last_used_at || Date.now() - new Date(String(r.last_used_at)).getTime() > 5 * 60_000) {
      await this.db.query(`update api_tokens set last_used_at = now() where id = $1`, [r.id]);
    }
    return { userId: String(r.user_id), scope: r.scope as TokenScope, id: String(r.id) };
  }
}
