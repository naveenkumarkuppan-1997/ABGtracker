import { createHmac, randomBytes } from 'node:crypto';
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { newId } from './auth';
import type { Db } from './db';
import { HttpError } from './errors';

export const WEBHOOK_EVENTS = ['issue.created', 'issue.updated', 'issue.deleted', 'comment.created'] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];
export type WebhookFormat = 'json' | 'slack';
const MAX_HOOKS = 10;

export interface WebhookView {
  id: string;
  url: string;
  format: WebhookFormat;
  events: WebhookEvent[];
  active: boolean;
  lastStatus: string | null;
  lastAt: string | null;
}

// ---- keeping requests away from the inside of the network ---------------------------------------------

/** True for addresses that must never be called from here: this machine, private networks, link-local (cloud metadata), shared ranges. */
export function isPrivateAddress(addr: string): boolean {
  const a = addr.toLowerCase().replace(/^\[|\]$/g, '');
  if (a.startsWith('::ffff:')) return isPrivateAddress(a.slice(7)); // IPv4 inside IPv6
  if (isIP(a) === 4) {
    const [p, q] = a.split('.').map(Number);
    return p === 0 || p === 10 || p === 127 || (p === 100 && q >= 64 && q <= 127) || (p === 169 && q === 254) || (p === 172 && q >= 16 && q <= 31) || (p === 192 && q === 168) || (p === 192 && q === 0) || (p === 198 && (q === 18 || q === 19)) || p >= 224;
  }
  if (isIP(a) === 6) return a === '::' || a === '::1' || /^f[cd]/.test(a) || /^fe[89ab]/.test(a) || a.startsWith('ff');
  return true; // not an address at all
}

export type Resolver = (host: string) => Promise<string[]>;
const defaultResolver: Resolver = async (host) => (await lookup(host, { all: true })).map((r) => r.address);

/** Throws a plain-language error unless the address is a public https (or, when allowed, http) address. */
export async function assertSafeUrl(raw: unknown, opts: { allowInsecure?: boolean; resolve?: Resolver } = {}): Promise<URL> {
  let u: URL;
  try {
    u = new URL(String(raw));
  } catch {
    throw new HttpError(400, 'Enter a full web address, such as https://example.com/hook.');
  }
  if (u.protocol !== 'https:' && !(opts.allowInsecure && u.protocol === 'http:')) throw new HttpError(400, 'The address must start with https://.');
  if (u.username || u.password) throw new HttpError(400, 'Do not put a user name or password in the address.');
  if (String(raw).length > 500) throw new HttpError(400, 'That address is too long.');
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.internal') || host.endsWith('.local')) throw new HttpError(400, 'That address points inside your network, which is not allowed.');
  let addrs: string[];
  try {
    addrs = isIP(host) ? [host] : await (opts.resolve ?? defaultResolver)(host);
  } catch {
    throw new HttpError(400, 'That address could not be found.');
  }
  if (!addrs.length || addrs.some(isPrivateAddress)) throw new HttpError(400, 'That address points inside a private network, which is not allowed.');
  return u;
}

// ---- signing and delivery ---------------------------------------------------------------------------------

/** The receiver recomputes this with its copy of the secret to know the call is genuine and fresh. */
export const signPayload = (secret: string, timestamp: string, body: string) => `sha256=${createHmac('sha256', secret).update(`${timestamp}.${body}`).digest('hex')}`;

export interface WebhookDeps {
  db: Db;
  /** Replaceable for tests (and for an egress proxy in production). */
  fetchImpl?: typeof fetch;
  resolve?: Resolver;
  allowInsecure?: boolean;
  /** Waits between tries, in ms. */
  retryDelays?: number[];
  log?: (line: string) => void;
}

/**
 * Tells other systems when something happens (an item is created, changed, deleted, or commented on). Each call is
 * signed with the hook's own secret, is limited to public https addresses, never follows redirects, times out, and
 * is retried a couple of times. Delivery never slows down or fails the person's own action.
 */
export class Webhooks {
  private fetchImpl: typeof fetch;
  private delays: number[];
  /** Resolves when everything started so far has finished: lets tests wait without sleeping. */
  private inflight = new Set<Promise<void>>();

  constructor(private deps: WebhookDeps) {
    this.fetchImpl = deps.fetchImpl ?? fetch;
    this.delays = deps.retryDelays ?? [1_000, 5_000];
  }

  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  private view(r: Record<string, unknown>): WebhookView {
    return {
      id: String(r.id),
      url: String(r.url),
      format: r.format as WebhookFormat,
      events: String(r.events).split(',').filter(Boolean) as WebhookEvent[],
      active: r.active === true,
      lastStatus: r.last_status ? String(r.last_status) : null,
      lastAt: r.last_at ? new Date(String(r.last_at)).toISOString() : null,
    };
  }

  async list(orgId: string): Promise<WebhookView[]> {
    return (await this.deps.db.query(`select * from webhooks where org_id = $1 order by created_at`, [orgId])).map((r) => this.view(r));
  }

  /** The secret is returned here once, and never again. */
  async create(orgId: string, userId: string, input: { url?: unknown; events?: unknown; format?: unknown }): Promise<{ hook: WebhookView; secret: string }> {
    const u = await assertSafeUrl(input.url, this.deps);
    const events = Array.isArray(input.events) ? WEBHOOK_EVENTS.filter((e) => (input.events as unknown[]).includes(e)) : [];
    if (!events.length) throw new HttpError(400, 'Choose at least one thing to be told about.');
    const format: WebhookFormat = input.format === 'slack' ? 'slack' : 'json';
    const count = Number((await this.deps.db.query(`select count(*) as n from webhooks where org_id = $1`, [orgId]))[0].n);
    if (count >= MAX_HOOKS) throw new HttpError(400, `An organization can have ${MAX_HOOKS} webhooks. Remove one first.`);
    const id = newId('wh');
    const secret = `whsec_${randomBytes(24).toString('base64url')}`;
    await this.deps.db.query(`insert into webhooks (id, org_id, url, secret, format, events, created_by) values ($1,$2,$3,$4,$5,$6,$7)`, [id, orgId, u.toString(), secret, format, events.join(','), userId]);
    return { hook: { id, url: u.toString(), format, events, active: true, lastStatus: null, lastAt: null }, secret };
  }

  async setActive(orgId: string, id: string, active: boolean): Promise<boolean> {
    return (await this.deps.db.query(`update webhooks set active = $3 where id = $1 and org_id = $2 returning id`, [id, orgId, active])).length > 0;
  }

  async remove(orgId: string, id: string): Promise<boolean> {
    return (await this.deps.db.query(`delete from webhooks where id = $1 and org_id = $2 returning id`, [id, orgId])).length > 0;
  }

  async removeAllFor(orgId: string): Promise<void> {
    await this.deps.db.query(`delete from webhooks where org_id = $1`, [orgId]);
  }

  /** Starts deliveries and returns immediately. */
  emit(orgId: string, orgSlug: string, event: WebhookEvent, data: Record<string, unknown>): void {
    const job = (async () => {
      const hooks = await this.deps.db.query(`select * from webhooks where org_id = $1 and active = true`, [orgId]);
      for (const h of hooks) if (String(h.events).split(',').includes(event)) await this.deliver(h, event, orgSlug, data);
    })()
      .catch((e) => this.deps.log?.(`webhook error: ${e instanceof Error ? e.message : e}`))
      .finally(() => void this.inflight.delete(job));
    this.inflight.add(job);
  }

  /** Sends a harmless "ping" so a person can check their receiving end. Reports the outcome. */
  async ping(orgId: string, orgSlug: string, id: string): Promise<string> {
    const rows = await this.deps.db.query(`select * from webhooks where id = $1 and org_id = $2`, [id, orgId]);
    if (!rows.length) throw new HttpError(404, 'Webhook not found.');
    return this.deliver(rows[0], 'ping', orgSlug, { message: 'This is a test from ABG Tracker.' });
  }

  private text(event: string, data: Record<string, unknown>): string {
    if (event === 'ping') return 'ABG Tracker: test message.';
    const key = String(data.key ?? '');
    const title = String(data.title ?? '');
    const verb = event === 'issue.created' ? 'created' : event === 'issue.deleted' ? 'deleted' : event === 'comment.created' ? 'commented on' : 'updated';
    return `${key} ${verb}: ${title}${data.url ? ` (${data.url})` : ''}`.replace(/[\r\n]+/g, ' ').slice(0, 500);
  }

  private async deliver(h: Record<string, unknown>, event: string, orgSlug: string, data: Record<string, unknown>): Promise<string> {
    const body = JSON.stringify(
      h.format === 'slack' ? { text: this.text(event, data) } : { event, at: new Date().toISOString(), organization: orgSlug, data }
    );
    let outcome = '';
    for (let attempt = 0; attempt <= this.delays.length; attempt++) {
      try {
        const url = await assertSafeUrl(h.url, this.deps); // checked again now: addresses can change after a hook was saved
        const ts = String(Math.floor(Date.now() / 1000));
        const res = await this.fetchImpl(url, {
          method: 'POST',
          redirect: 'manual', // a redirect could lead somewhere private
          signal: AbortSignal.timeout(5_000),
          headers: { 'content-type': 'application/json', 'user-agent': 'ABG-Tracker-Webhook', 'x-abg-event': event, 'x-abg-timestamp': ts, 'x-abg-signature': signPayload(String(h.secret), ts, body) },
          body,
        });
        outcome = res.ok ? `OK (${res.status})` : `Failed (${res.status})`;
        if (res.ok || (res.status >= 400 && res.status < 500 && res.status !== 429)) break; // the receiver said no: retrying will not help
      } catch (e) {
        outcome = e instanceof HttpError ? `Blocked: ${e.message}` : 'Failed (no answer)';
        if (e instanceof HttpError) break;
      }
      if (attempt < this.delays.length) await new Promise((r) => setTimeout(r, this.delays[attempt]));
    }
    await this.deps.db.query(`update webhooks set last_status = $2, last_at = now() where id = $1`, [h.id, outcome]).catch(() => undefined);
    return outcome;
  }
}
