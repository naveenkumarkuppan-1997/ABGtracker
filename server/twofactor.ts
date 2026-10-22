import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Db } from './db';

// ---- authenticator codes (RFC 6238: 6 digits, 30 seconds, SHA-1, as every authenticator app expects) ------

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text: string): Buffer {
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of text.toUpperCase().replace(/[\s=-]/g, '')) {
    const i = B32.indexOf(ch);
    if (i < 0) throw new Error('Not base32.');
    value = (value << 5) | i;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export const STEP_SECONDS = 30;
export const stepOf = (at: number) => Math.floor(at / 1000 / STEP_SECONDS);

export function hotp(secret: Buffer, counter: number): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const h = createHmac('sha1', secret).update(msg).digest();
  const off = h[h.length - 1] & 15;
  const n = ((h[off] & 0x7f) << 24) | (h[off + 1] << 16) | (h[off + 2] << 8) | h[off + 3];
  return String(n % 1_000_000).padStart(6, '0');
}

/** The step the code belongs to, if it is right for now (one step of clock drift either way), else null. */
export function matchStep(secret: Buffer, code: string, at: number): number | null {
  if (!/^\d{6}$/.test(code)) return null;
  const now = stepOf(at);
  for (const s of [now, now - 1, now + 1]) {
    const want = Buffer.from(hotp(secret, s));
    if (timingSafeEqual(want, Buffer.from(code))) return s;
  }
  return null;
}

export const otpauthUri = (secretB32: string, account: string, issuer = 'ABG Tracker') =>
  `otpauth://totp/${encodeURIComponent(issuer)}:${encodeURIComponent(account)}?secret=${secretB32}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=6&period=${STEP_SECONDS}`;

// ---- storage ---------------------------------------------------------------------------------------------

const RECOVERY_COUNT = 8;
const hashCode = (code: string) => createHash('sha256').update(code).digest('hex');
/** "ABCD-EFGH-JK" is typed in many ways; compare only letters and digits. */
const normRecovery = (c: string) => c.replace(/[\s-]/g, '').toLowerCase();

/**
 * Two-step sign-in. The shared secret is stored encrypted (AES-256-GCM, key kept in the database's
 * secrets table, so a stolen copy of the table alone is not enough), recovery codes are stored only as hashes
 * and work once, and a code that was already accepted can never be used again (replay protection).
 */
export class TwoFactor {
  private key: Promise<Buffer> | null = null;

  constructor(private db: Db) {}

  private getKey(): Promise<Buffer> {
    this.key ??= (async () => {
      await this.db.query(`insert into app_secrets (name, value) values ('totp-key', $1) on conflict (name) do nothing`, [randomBytes(32).toString('hex')]);
      return Buffer.from(String((await this.db.query(`select value from app_secrets where name = 'totp-key'`))[0].value), 'hex');
    })().catch((e) => {
      this.key = null;
      throw e;
    });
    return this.key;
  }

  private async seal(plain: string): Promise<string> {
    const iv = randomBytes(12);
    const c = createCipheriv('aes-256-gcm', await this.getKey(), iv);
    const ct = Buffer.concat([c.update(plain, 'utf8'), c.final()]);
    return Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
  }

  private async open(sealed: string): Promise<string> {
    const raw = Buffer.from(sealed, 'base64');
    const d = createDecipheriv('aes-256-gcm', await this.getKey(), raw.subarray(0, 12));
    d.setAuthTag(raw.subarray(12, 28));
    return Buffer.concat([d.update(raw.subarray(28)), d.final()]).toString('utf8');
  }

  async isEnabled(userId: string): Promise<boolean> {
    const r = await this.db.query(`select enabled from two_factor where user_id = $1`, [userId]);
    return r.length > 0 && r[0].enabled === true;
  }

  /** Starts set-up: makes a fresh secret that does nothing until a first code proves the phone has it. */
  async begin(userId: string): Promise<string> {
    if (await this.isEnabled(userId)) throw new Error('Two-factor sign-in is already on.');
    const secret = base32Encode(randomBytes(20));
    await this.db.query(
      `insert into two_factor (user_id, secret_enc, enabled, last_step) values ($1, $2, false, 0)
       on conflict (user_id) do update set secret_enc = excluded.secret_enc, enabled = false, last_step = 0`,
      [userId, await this.seal(secret)]
    );
    return secret;
  }

  /** Checks a code against the stored secret; true at most once per 30-second step. */
  private async verifyTotp(userId: string, code: string, at: number): Promise<boolean> {
    const r = await this.db.query(`select secret_enc, last_step from two_factor where user_id = $1`, [userId]);
    if (!r.length) return false;
    const step = matchStep(base32Decode(await this.open(String(r[0].secret_enc))), code, at);
    if (step === null || step <= Number(r[0].last_step)) return false; // wrong, or already used
    // Only the first request to claim this step wins, even if two arrive together.
    const claimed = await this.db.query(`update two_factor set last_step = $2 where user_id = $1 and last_step < $2 returning user_id`, [userId, step]);
    return claimed.length > 0;
  }

  /** Turns it on after the first correct code, and returns the one-time recovery codes (shown once, never again). */
  async confirm(userId: string, code: string, at = Date.now()): Promise<string[] | null> {
    const r = await this.db.query(`select enabled from two_factor where user_id = $1`, [userId]);
    if (!r.length || r[0].enabled === true) return null;
    if (!(await this.verifyTotp(userId, code, at))) return null;
    const codes = Array.from({ length: RECOVERY_COUNT }, () => {
      const raw = base32Encode(randomBytes(7)).slice(0, 10).toLowerCase();
      return `${raw.slice(0, 5)}-${raw.slice(5)}`;
    });
    await this.db.tx(async (q) => {
      await q(`delete from recovery_codes where user_id = $1`, [userId]);
      for (const c of codes) await q(`insert into recovery_codes (user_id, code_hash) values ($1, $2)`, [userId, hashCode(normRecovery(c))]);
      await q(`update two_factor set enabled = true where user_id = $1`, [userId]);
    });
    return codes;
  }

  /** A sign-in code from the app, or a recovery code (which is used up by being accepted). */
  async check(userId: string, code: unknown, at = Date.now()): Promise<boolean> {
    if (typeof code !== 'string' || code.length > 40) return false;
    const trimmed = code.replace(/\s/g, '');
    if (/^\d{6}$/.test(trimmed)) return this.verifyTotp(userId, trimmed, at);
    const used = await this.db.query(`update recovery_codes set used_at = now() where user_id = $1 and code_hash = $2 and used_at is null returning code_hash`, [userId, hashCode(normRecovery(code))]);
    return used.length > 0;
  }

  async recoveryLeft(userId: string): Promise<number> {
    return Number((await this.db.query(`select count(*) as n from recovery_codes where user_id = $1 and used_at is null`, [userId]))[0].n);
  }

  async disable(userId: string): Promise<void> {
    await this.db.query(`delete from two_factor where user_id = $1`, [userId]);
    await this.db.query(`delete from recovery_codes where user_id = $1`, [userId]);
  }
}
