import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

/**
 * The link at the bottom of every email: "stop sending me these". It must work without signing in
 * (people click it from their mail app), so it carries its own proof: the person's id plus a signature
 * only this server can make. It can do exactly one thing (turn that person's email off) and never expires,
 * because an unsubscribe link that stops working is a trap.
 */
export class Unsubscribe {
  private secret: Promise<string> | null = null;

  constructor(private db: Db) {}

  /** Created once and kept in the database, so links stay valid across restarts (and across several servers). */
  private getSecret(): Promise<string> {
    this.secret ??= (async () => {
      await this.db.query(`insert into app_secrets (name, value) values ('unsubscribe', $1) on conflict (name) do nothing`, [randomBytes(32).toString('hex')]);
      return String((await this.db.query(`select value from app_secrets where name = 'unsubscribe'`))[0].value);
    })().catch((e) => {
      this.secret = null; // try again next time
      throw e;
    });
    return this.secret;
  }

  private async sign(userId: string): Promise<string> {
    return createHmac('sha256', await this.getSecret()).update(`unsubscribe:${userId}`).digest('hex').slice(0, 40);
  }

  async token(userId: string): Promise<string> {
    return `${userId}.${await this.sign(userId)}`;
  }

  /** The person the token was made for, or null for anything forged, damaged or made by another server. */
  async verify(token: unknown): Promise<string | null> {
    if (typeof token !== 'string' || token.length > 200) return null;
    const dot = token.lastIndexOf('.');
    if (dot < 1) return null;
    const userId = token.slice(0, dot);
    const given = Buffer.from(token.slice(dot + 1));
    const want = Buffer.from(await this.sign(userId));
    return given.length === want.length && timingSafeEqual(given, want) ? userId : null;
  }
}
