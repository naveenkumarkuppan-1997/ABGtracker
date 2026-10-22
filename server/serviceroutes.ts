import { timingSafeEqual } from 'node:crypto';
import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import type { LocalRepository } from '../src/data/localRepository';
import { computeDashboard } from '../src/domain/dashboard';
import { resolvePrefs } from '../src/domain/notifyPrefs';
import { isDone, statusOf } from '../src/domain/selectors';
import { localDate } from '../src/domain/timeZone';
import type { Accounts } from './accounts';
import { RateLimiter } from './auth';
import type { Db } from './db';
import { HttpError } from './errors';
import { isPlan, MockAiProvider, MockBillingProvider, MockSsoProvider, newState, PLANS, type AiProvider, type BillingProvider, type Plan, type ServiceModes, type SsoProvider } from './services';
import type { PostgresSnapshotStore } from './store';
import type { MongoSnapshotStore } from './mongoStore';

const SSO_COOKIE = 'abg_sso_state';
const esc = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

export interface ServiceDeps {
  app: FastifyInstance;
  db: Db;
  store: PostgresSnapshotStore | MongoSnapshotStore;
  repo: LocalRepository;
  accounts: Accounts;
  services: ServiceModes;
  publicUrl: string;
  secureCookies: boolean;
  allowSignup: boolean;
  audit: (orgId: string, actorId: string, action: string, detail?: string) => Promise<void>;
  requireUser: (req: FastifyRequest) => string;
  setSession: (reply: FastifyReply, token: string) => void;
  transact: <T>(mutates: boolean, fn: () => Promise<T>, orgs?: () => Promise<string[]>) => Promise<T>;
  ip: (req: FastifyRequest) => string;
  /** Only for tests and demos: a signing secret for the mock identity provider. */
  mockSecret: string;
  /** Test hook: lets tests plug in their own billing provider. */
  billingProvider?: BillingProvider;
  /** Test hook: lets tests plug in their own AI provider. */
  aiProvider?: AiProvider;
}

/** What an organization uses, to compare with its plan's limits. */
export async function usageOf(db: Db, store: PostgresSnapshotStore | MongoSnapshotStore, orgId: string) {
  const people = store.load().memberships.filter((m) => m.orgId === orgId).length;
  const pending = Number((await db.query(`select count(*) as n from invites where org_id = $1 and accepted_at is null and expires_at > now()`, [orgId]))[0].n);
  const projects = Number((await db.query(`select count(*) as n from projects where org_id = $1`, [orgId]))[0].n);
  return { people, pendingInvites: pending, projects };
}

export function registerServices(d: ServiceDeps) {
  const { app, db, store } = d;
  const billing: BillingProvider | null = d.billingProvider ?? (d.services.billing === 'mock' ? new MockBillingProvider(db) : null);
  const sso: (SsoProvider & { issueCode?: MockSsoProvider['issueCode'] }) | null = d.services.sso === 'mock' ? new MockSsoProvider(d.mockSecret) : null;
  const ai: AiProvider | null = d.aiProvider ?? (d.services.ai === 'mock' ? new MockAiProvider() : null);
  const briefLimiter = new RateLimiter(10, 60_000);
  const limiter = new RateLimiter(30, 60_000);
  const aiLimiter = new RateLimiter(20, 60_000);
  const planOf = (orgId: string): Plan => store.load().organizations.find((o) => o.id === orgId)?.plan ?? 'free';
  const role = (orgId: string, userId: string) => store.load().memberships.find((m) => m.orgId === orgId && m.userId === userId)?.role;

  /** What the screens need to know about optional services. */
  const describe = () => ({
    sso: sso ? { id: sso.id, label: sso.label, mock: sso.kind === 'mock' } : null,
    billing: billing ? { mock: billing.kind === 'mock' } : null,
    ai: ai ? { label: ai.label, mock: ai.kind === 'mock' } : null,
  });

  // ---- plans: limits are enforced whatever the payment provider is ------------------------------------

  /** Refuses to add a person beyond the plan. Counts people who are in and people who have been invited. */
  const assertSeat = async (orgId: string) => {
    const u = await usageOf(db, store, orgId);
    const plan = planOf(orgId);
    if (u.people + u.pendingInvites >= PLANS[plan].people) throw new HttpError(402, `Your ${PLANS[plan].label} plan includes ${PLANS[plan].people} people (including pending invitations). Upgrade to add more.`);
  };
  const assertProjectRoom = async (orgId: string) => {
    const u = await usageOf(db, store, orgId);
    const plan = planOf(orgId);
    if (u.projects >= PLANS[plan].projects) throw new HttpError(402, `Your ${PLANS[plan].label} plan includes ${PLANS[plan].projects} projects. Upgrade to create more.`);
  };

  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/billing', async (req) => {
    const userId = d.requireUser(req);
    const r = role(req.params.orgId, userId);
    if (!r) throw new HttpError(403, 'You are not a member of this organization.');
    if (r !== 'owner' && r !== 'admin') throw new HttpError(403, 'Only owners and admins can see billing.');
    return {
      mode: billing ? billing.kind : 'none',
      plan: planOf(req.params.orgId),
      plans: PLANS,
      usage: await usageOf(db, store, req.params.orgId),
      invoices: billing ? await billing.invoices(req.params.orgId) : [],
      canChange: !!billing && r === 'owner',
    };
  });

  app.post<{ Params: { orgId: string } }>('/api/orgs/:orgId/billing/plan', async (req) => {
    const userId = d.requireUser(req);
    if (!limiter.allow(userId)) throw new HttpError(429, 'Too many changes. Try again in a minute.');
    if (role(req.params.orgId, userId) !== 'owner') throw new HttpError(403, 'Only an owner can change the plan.');
    if (!billing) throw new HttpError(400, 'Plan changes are not available on this server yet. Contact your administrator.');
    const plan = (req.body as { plan?: unknown } | undefined)?.plan;
    if (!isPlan(plan)) throw new HttpError(400, 'Choose a plan.');
    const org = store.load().organizations.find((o) => o.id === req.params.orgId)!;
    if (org.plan === plan) throw new HttpError(409, `You are already on the ${PLANS[plan].label} plan.`);
    // Moving down must never strand work: refuse while the organization is above the smaller plan's limits.
    const u = await usageOf(db, store, org.id);
    const lim = PLANS[plan];
    if (u.people > lim.people || u.projects > lim.projects) {
      throw new HttpError(409, `The ${lim.label} plan includes ${lim.people} people and ${lim.projects} projects, and you have ${u.people} people and ${u.projects} projects. Remove some first.`);
    }
    const outcome = await billing.changePlan(org, plan, userId);
    if ('redirectTo' in outcome) return { redirectTo: outcome.redirectTo };
    const from = org.plan;
    await d.transact(true, async () => {
      store.load().organizations.find((o) => o.id === org.id)!.plan = plan;
    });
    await d.audit(org.id, userId, 'billing.plan', `${PLANS[from].label} → ${PLANS[plan].label}${billing.kind === 'mock' ? ' (mock billing, no real charge)' : ''}`).catch(() => undefined);
    return { ok: true, plan };
  });

  // ---- single sign-on ------------------------------------------------------------------------------------------

  const callbackUrl = `${d.publicUrl}/api/auth/sso/callback`;
  const fail = (reply: FastifyReply, code: string) => reply.clearCookie(SSO_COOKIE, { path: '/' }).redirect(`/?sso_error=${code}`);

  app.get('/api/auth/sso/start', async (req, reply) => {
    if (!sso) throw new HttpError(404, 'Single sign-on is not set up on this server.');
    const state = newState();
    reply.setCookie(SSO_COOKIE, state, { httpOnly: true, sameSite: 'lax', secure: d.secureCookies, path: '/', maxAge: 600 });
    return reply.redirect(sso.authorizeUrl(state, callbackUrl));
  });

  if (sso && sso.kind === 'mock') {
    const mock = sso as MockSsoProvider;
    // The pretend identity provider's pages. In real life these live at Google or Microsoft.
    app.get<{ Querystring: { state?: string; redirect_uri?: string } }>('/api/sso/mock/authorize', async (req, reply) => {
      if (req.query.redirect_uri !== callbackUrl || !req.query.state) throw new HttpError(400, 'Bad request.');
      return reply
        .header('content-type', 'text/html; charset=utf-8')
        .send(`<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Mock identity provider</title>
<body style="font-family:system-ui;max-width:26rem;margin:3rem auto;padding:0 1rem">
<h1 style="font-size:1.25rem">Mock identity provider</h1>
<p style="color:#555">For demos only: there is no real company login here. Choose who you are pretending to be.</p>
<form method="get" action="/api/sso/mock/approve" style="display:grid;gap:.75rem">
<input type="hidden" name="state" value="${esc(req.query.state)}">
<label>Email <input name="email" type="email" required style="width:100%;padding:.4rem"></label>
<label>Name <input name="name" required style="width:100%;padding:.4rem"></label>
<label><input type="checkbox" name="verified" value="1" checked> The provider has verified this email address</label>
<button style="padding:.5rem">Continue</button></form>`);
    });
    app.get<{ Querystring: { state?: string; email?: string; name?: string; verified?: string } }>('/api/sso/mock/approve', async (req, reply) => {
      const { state, email, name, verified } = req.query;
      if (!state || !email || !name) throw new HttpError(400, 'Bad request.');
      const code = mock.issueCode({ email: email.trim().toLowerCase(), name: name.trim().slice(0, 100), emailVerified: verified === '1' });
      return reply.redirect(`${callbackUrl}?code=${encodeURIComponent(code)}&state=${encodeURIComponent(state)}`);
    });
  }

  app.get<{ Querystring: { code?: string; state?: string } }>('/api/auth/sso/callback', async (req, reply) => {
    if (!sso) throw new HttpError(404, 'Single sign-on is not set up on this server.');
    const cookie = req.cookies[SSO_COOKIE];
    const state = req.query.state ?? '';
    // The attempt must come back to the same browser that started it.
    if (!cookie || cookie.length !== state.length || !timingSafeEqual(Buffer.from(cookie), Buffer.from(state))) return fail(reply, 'state');
    let identity;
    try {
      identity = await sso.exchange(String(req.query.code ?? ''), callbackUrl);
    } catch {
      return fail(reply, 'verify');
    }
    if (!identity.emailVerified) return fail(reply, 'unverified'); // an unverified address could belong to someone else
    const email = identity.email.trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 200) return fail(reply, 'verify');
    const meta = { userAgent: String(req.headers['user-agent'] ?? ''), ip: d.ip(req) };
    const existing = d.accounts.findUserByEmail(email);
    if (!existing && !d.allowSignup) return fail(reply, 'closed');
    const out = await d.transact(true, () => (existing ? d.accounts.loginSso(existing, meta) : d.accounts.registerSso(identity.name, email, meta)));
    reply.clearCookie(SSO_COOKIE, { path: '/' });
    d.setSession(reply, out.token);
    return reply.redirect('/');
  });

  // ---- AI assistant ------------------------------------------------------------------------------------------

  app.post<{ Params: { slug: string; key: string } }>('/api/orgs/:slug/issues/:key/summary', async (req) => {
    const userId = d.requireUser(req);
    if (!ai) throw new HttpError(404, 'The AI assistant is not set up on this server.');
    if (!aiLimiter.allow(userId)) throw new HttpError(429, 'Slow down a little: try again in a minute.');
    const org = store.load().organizations.find((o) => o.slug === req.params.slug);
    if (!org) throw new HttpError(404, 'Organization not found.');
    return d.transact(false, async () => {
      const data = await d.repo.loadOrg(org.id, userId); // membership and visibility are checked here, like everywhere else
      const issue = data.issues.find((i) => i.key.toLowerCase() === req.params.key.toLowerCase());
      if (!issue) throw new HttpError(404, 'Item not found.');
      // Only what the summary needs: the item's own text. Never emails, ids, files or other items.
      const comments = data.comments.filter((c) => c.issueId === issue.id).slice(-30).map((c) => ({ author: data.members.find((m) => m.id === c.authorId)?.name ?? 'Someone', body: c.body.slice(0, 2000) }));
      const summary = await ai.summarize({ title: issue.title, description: issue.description.slice(0, 6000), comments });
      return { summary, provider: ai.label, mock: ai.kind === 'mock' };
    }, async () => [org.id]);
  });

  /**
   * "Your day, in brief". The server works out the facts itself (from the person's own data, never from anything the browser
   * sends), hands the assistant only counts and a short list of their own open items, and checks what comes back: it may only
   * point at items that were in the list, and every piece of text is length-limited. It reads; it never changes anything.
   */
  app.post<{ Params: { slug: string } }>('/api/orgs/:slug/briefing', async (req) => {
    const userId = d.requireUser(req);
    if (!ai) throw new HttpError(404, 'The AI assistant is not set up on this server.');
    if (!briefLimiter.allow(userId)) throw new HttpError(429, 'Slow down a little: try again in a minute.');
    const org = store.load().organizations.find((o) => o.slug === req.params.slug);
    if (!org) throw new HttpError(404, 'Organization not found.');
    const me = store.load().users.find((u) => u.id === userId);
    const today = localDate(new Date(), resolvePrefs(me).timeZone); // the person's own "today"
    return d.transact(false, async () => {
      const data = await d.repo.loadOrg(org.id, userId); // membership is checked here, like everywhere else
      const stats = computeDashboard(data, userId, new Date(`${today}T12:00:00`));
      const days = (due?: string) => (due ? Math.round((Date.parse(due) - Date.parse(today)) / 86_400_000) : null);
      const blockedIds = new Set(stats.tiles.blocked.map((r) => r.issue.id));
      const items = stats.mine.slice(0, 15).map((r) => ({
        key: r.issue.key,
        title: r.issue.title.slice(0, 120),
        status: statusOf(r.project, r.issue.statusId)?.name ?? '',
        priority: r.issue.priority,
        dueInDays: days(r.issue.dueDate),
        blocked: blockedIds.has(r.issue.id),
      }));
      const weekAgo = new Date(Date.now() - 7 * 86_400_000).toISOString();
      const doneThisWeek = data.issues.filter((i) => i.assigneeId === userId && i.resolvedAt && i.resolvedAt >= weekAgo && isDone(data.projects.find((p) => p.id === i.projectId)!, i)).length;
      const input = {
        firstName: (me?.name ?? 'there').split(' ')[0].slice(0, 40),
        counts: {
          open: stats.kpis.myOpen,
          overdue: stats.kpis.myOverdue,
          blocked: stats.mine.filter((r) => blockedIds.has(r.issue.id)).length,
          dueThisWeek: stats.dueSoon.filter((r) => (r.issue.dueDate ?? '') >= today).length,
          awaitingMyApproval: stats.approvals.length,
          doneThisWeek,
        },
        items,
        approvals: stats.approvals.slice(0, 5).map((r) => ({ key: r.issue.key, title: r.issue.title.slice(0, 120) })),
      };
      let out;
      try {
        out = await ai.brief(input);
      } catch {
        throw new HttpError(502, 'The assistant could not answer right now. Try again in a moment.');
      }
      const known = new Map(items.map((i) => [i.key, i]));
      const seen = new Set<string>();
      const focus = (Array.isArray(out.focus) ? out.focus : [])
        .filter((f) => f && typeof f.key === 'string' && known.has(f.key) && !seen.has(f.key) && seen.add(f.key)) // only items it was actually given
        .slice(0, 5)
        .map((f) => ({ key: f.key, title: known.get(f.key)!.title, why: String(f.why ?? '').slice(0, 120) }));
      return {
        summary: String(out.summary ?? '').slice(0, 600),
        focus,
        watchouts: (Array.isArray(out.watchouts) ? out.watchouts : []).slice(0, 4).map((w) => String(w).slice(0, 200)),
        provider: ai.label,
        mock: ai.kind === 'mock',
        at: new Date().toISOString(),
      };
    }, async () => [org.id]);
  });

  return { describe, assertSeat, assertProjectRoom };
}
