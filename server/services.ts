import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import type { Organization } from '../src/domain/types';
import { newId } from './auth';
import type { Db } from './db';
import { HttpError } from './errors';

/**
 * Seams for the outside services a company will plug in later (payments, single sign-on, an AI model).
 * Each has a small interface, a clearly labelled MOCK that behaves like the real thing for development and demos,
 * and the product code only ever talks to the interface. To go live, a developer writes one class per service
 * (see docs/INTEGRATION-HANDOFF.md) and selects it with an environment variable; no screen or rule changes.
 */
export type ServiceMode = 'none' | 'mock';
export interface ServiceModes {
  billing: ServiceMode;
  sso: ServiceMode;
  ai: ServiceMode;
}
export const NO_SERVICES: ServiceModes = { billing: 'none', sso: 'none', ai: 'none' };

// ================================ billing ==================================================================

export type Plan = Organization['plan'];
export interface PlanLimits {
  people: number;
  projects: number;
}
/** What each plan allows. Prices and names are placeholders for the business to decide. */
export const PLANS: Record<Plan, PlanLimits & { label: string; priceUsdPerMonth: number }> = {
  free: { label: 'Free', priceUsdPerMonth: 0, people: 10, projects: 5 },
  team: { label: 'Team', priceUsdPerMonth: 49, people: 50, projects: 50 },
  business: { label: 'Business', priceUsdPerMonth: 199, people: 1000, projects: 1000 },
};
export const isPlan = (p: unknown): p is Plan => p === 'free' || p === 'team' || p === 'business';

export interface InvoiceView {
  id: string;
  plan: Plan;
  amountUsd: number;
  at: string;
  mock: boolean;
}

/** The payment company (Stripe or similar) goes behind this. The mock "charges" instantly and records a fake invoice. */
export interface BillingProvider {
  readonly kind: 'mock' | 'live';
  /** Changes the paid plan. A live provider would return a checkout address to send the person to instead of finishing at once. */
  changePlan(org: Organization, plan: Plan, actorId: string): Promise<{ done: true } | { redirectTo: string }>;
  invoices(orgId: string): Promise<InvoiceView[]>;
}

export class MockBillingProvider implements BillingProvider {
  readonly kind = 'mock' as const;
  constructor(private db: Db) {}

  async changePlan(org: Organization, plan: Plan): Promise<{ done: true }> {
    if (plan !== 'free') {
      await this.db.query(`insert into mock_invoices (id, org_id, plan, amount_usd) values ($1, $2, $3, $4)`, [newId('inv'), org.id, plan, PLANS[plan].priceUsdPerMonth]);
    }
    return { done: true };
  }

  async invoices(orgId: string): Promise<InvoiceView[]> {
    return (await this.db.query(`select id, plan, amount_usd, created_at from mock_invoices where org_id = $1 order by created_at desc limit 24`, [orgId])).map((r) => ({
      id: String(r.id),
      plan: r.plan as Plan,
      amountUsd: Number(r.amount_usd),
      at: new Date(String(r.created_at)).toISOString(),
      mock: true,
    }));
  }
}

// ================================ single sign-on ===========================================================

export interface SsoIdentity {
  email: string;
  name: string;
  /** Only an address the identity provider has verified may be trusted to be the person's. */
  emailVerified: boolean;
}

/** Google, Microsoft or a company's own identity provider go behind this (OpenID Connect). */
export interface SsoProvider {
  readonly id: string;
  readonly label: string;
  readonly kind: 'mock' | 'live';
  /** Where to send the browser to sign in. */
  authorizeUrl(state: string, redirectUri: string): string;
  /** Turns what the provider sent back into who the person is. Throws if it is not valid. */
  exchange(code: string, redirectUri: string): Promise<SsoIdentity>;
}

/**
 * A pretend identity provider for development: "signs in" whoever you tell it to, no password. It is
 * refused outside development unless ALLOW_MOCK_SERVICES is set, because it would let anyone in as anyone.
 */
export class MockSsoProvider implements SsoProvider {
  readonly id = 'mock';
  readonly label = 'Sign in with Mock SSO (demo)';
  readonly kind = 'mock' as const;
  constructor(private secret: string) {}

  private sign(payload: string) {
    return createHmac('sha256', this.secret).update(payload).digest('base64url');
  }

  /** The mock provider's own page lives in this server, and issues a signed one-time-style code. */
  authorizeUrl(state: string, redirectUri: string): string {
    return `/api/sso/mock/authorize?state=${encodeURIComponent(state)}&redirect_uri=${encodeURIComponent(redirectUri)}`;
  }

  issueCode(identity: SsoIdentity): string {
    const payload = Buffer.from(JSON.stringify({ ...identity, exp: Date.now() + 2 * 60_000 })).toString('base64url');
    return `${payload}.${this.sign(payload)}`;
  }

  async exchange(code: string): Promise<SsoIdentity> {
    const [payload, sig] = String(code).split('.');
    if (!payload || !sig || sig.length !== this.sign(payload).length || !timingSafeEqual(Buffer.from(sig), Buffer.from(this.sign(payload)))) throw new HttpError(400, 'The sign-in could not be verified.');
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as SsoIdentity & { exp: number };
    if (!(data.exp > Date.now())) throw new HttpError(400, 'The sign-in took too long. Please try again.');
    return { email: data.email, name: data.name, emailVerified: data.emailVerified };
  }
}

/** The state value ties a sign-in attempt to the browser that started it (stops someone else's sign-in being pushed onto you). */
export const newState = () => randomBytes(24).toString('base64url');

// ================================ AI assistant =============================================================

/** What the briefing is allowed to know: counts, and a short list of the person's own open items. No emails, ids, comments or other people's work. */
export interface BriefInput {
  firstName: string;
  counts: { open: number; overdue: number; blocked: number; dueThisWeek: number; awaitingMyApproval: number; doneThisWeek: number };
  items: { key: string; title: string; status: string; priority: string; dueInDays: number | null; blocked: boolean }[];
  approvals: { key: string; title: string }[];
}
export interface BriefOutput {
  summary: string;
  focus: { key: string; why: string }[];
  watchouts: string[];
}

/** A language model goes behind this. Receives only what is needed for the task, never account details. */
export interface AiProvider {
  readonly kind: 'mock' | 'live';
  readonly label: string;
  summarize(input: { title: string; description: string; comments: { author: string; body: string }[] }): Promise<string>;
  /** A short read on someone's day. Item titles are people's own words: a real model must treat them as data, never as instructions. */
  brief(input: BriefInput): Promise<BriefOutput>;
}

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

/** Deterministic and offline: the shape of a real answer without a model. Clearly labelled so nobody mistakes it for one. */
export class MockAiProvider implements AiProvider {
  readonly kind = 'mock' as const;
  readonly label = 'Mock AI (no real model connected)';

  /** Rules, not a model: late work first, then what is due soon and urgent. Same shape a real model must return. */
  async brief(input: BriefInput): Promise<BriefOutput> {
    const { counts: c } = input;
    const weight = { critical: 30, high: 15, medium: 5, low: 0 } as Record<string, number>;
    const score = (i: BriefInput['items'][number]) => {
      const d = i.dueInDays;
      const base = d === null ? 0 : d < 0 ? 100 + Math.min(-d, 30) : d === 0 ? 80 : d <= 2 ? 60 : d <= 7 ? 30 : 5;
      return base + (weight[i.priority] ?? 0) - (i.blocked ? 25 : 0); // blocked work cannot be started, so it is not today's focus
    };
    const why = (i: BriefInput['items'][number]) => {
      const bits: string[] = [];
      const d = i.dueInDays;
      if (d !== null) bits.push(d < 0 ? `${plural(-d, 'day')} overdue` : d === 0 ? 'due today' : `due in ${plural(d, 'day')}`);
      if (i.priority === 'critical' || i.priority === 'high') bits.push(`${i.priority} priority`);
      return (bits.join(', ') || 'next in line').replace(/^./, (x) => x.toUpperCase());
    };
    const ranked = [...input.items].filter((i) => !i.blocked || i.dueInDays !== null).sort((a, b) => score(b) - score(a)).slice(0, 3);

    const summary =
      c.open === 0
        ? `Hi ${input.firstName}. You have nothing open right now, so this is a good moment to look at what the team needs.`
        : `Hi ${input.firstName}. You have ${plural(c.open, 'open item')}${c.overdue ? `, ${c.overdue} of them overdue` : ''}${c.dueThisWeek ? `, and ${c.dueThisWeek} due in the next 7 days` : ''}.${c.overdue === 0 && c.dueThisWeek === 0 ? ' Nothing is pressing.' : ''}`;

    const watchouts: string[] = [];
    if (c.awaitingMyApproval) watchouts.push(`${plural(c.awaitingMyApproval, 'item')} ${c.awaitingMyApproval === 1 ? 'is' : 'are'} waiting for your approval${input.approvals[0] ? `, starting with ${input.approvals[0].key}` : ''}.`);
    const blocked = input.items.filter((i) => i.blocked);
    if (blocked.length) watchouts.push(`${blocked.slice(0, 2).map((i) => i.key).join(' and ')}${blocked.length > 2 ? ` and ${blocked.length - 2} more` : ''} ${blocked.length === 1 ? 'is' : 'are'} blocked by other work.`);
    const urgent = input.items.filter((i) => i.priority === 'critical').length;
    if (urgent) watchouts.push(`${plural(urgent, 'critical item')} ${urgent === 1 ? 'is' : 'are'} still open.`);
    if (c.overdue > 0 && c.doneThisWeek === 0) watchouts.push('Nothing has been finished this week yet.');
    return { summary, focus: ranked.map((i) => ({ key: i.key, why: why(i) })), watchouts: watchouts.slice(0, 4) };
  }

  async summarize(input: { title: string; description: string; comments: { author: string; body: string }[] }): Promise<string> {
    const clip = (s: string, n: number) => (s.replace(/\s+/g, ' ').trim().length > n ? `${s.replace(/\s+/g, ' ').trim().slice(0, n - 1)}…` : s.replace(/\s+/g, ' ').trim());
    const people = [...new Set(input.comments.map((c) => c.author))];
    const lines = [`“${clip(input.title, 120)}”`];
    if (input.description.trim()) lines.push(`What it is: ${clip(input.description, 240)}`);
    if (input.comments.length) {
      lines.push(`${input.comments.length} comment${input.comments.length === 1 ? '' : 's'} from ${people.slice(0, 4).join(', ')}${people.length > 4 ? ` and ${people.length - 4} more` : ''}.`);
      const last = input.comments[input.comments.length - 1];
      lines.push(`Latest (${last.author}): ${clip(last.body, 200)}`);
    } else lines.push('No comments yet.');
    return lines.join('\n');
  }
}
