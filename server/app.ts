import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import cookie from '@fastify/cookie';
import fastifyStatic from '@fastify/static';
import Fastify, { type FastifyInstance, type FastifyReply, type FastifyRequest } from 'fastify';
import type { LocalRepository } from '../src/data/localRepository';
import type { Comment, Issue } from '../src/domain/types';
import type { Accounts } from './accounts';
import { RateLimiter, SESSION_DAYS, deleteSession, deleteUserSessions, listSessions, revokeSession, sessionUser } from './auth';
import type { Db } from './db';
import { DomainError } from '../src/domain/errors';
import { HttpError } from './errors';
import { ConsoleMailer, type Mailer } from './mailer';
import type { FileStore } from './files';
import { UploadTickets } from './tickets';
import { makeThumbnail } from './thumbs';
import { Unsubscribe } from './unsubscribe';
import { DataOwner, issuesCsv } from './dataowner';
import { MAX_IMPORT_BYTES, planImport } from './csvimport';
import { ApiTokens } from './apitokens';
import { LiveBus } from './live';
import { registerServices } from './serviceroutes';
import { NO_SERVICES, type AiProvider, type BillingProvider, type ServiceModes } from './services';
import { randomBytes } from 'node:crypto';
import { verifyFirebaseIdToken } from './firebaseAdmin';
import { getMongoDb } from './mongodb';
import { provisionMongoUser } from './mongoAuth';
import { registerMongoTestRoutes } from './mongoTestRoute';
import { Webhooks, WEBHOOK_EVENTS } from './webhooks';
import { dueDatesIcs, makeEmitter, registerPublicApi } from './publicapi';
import { isDone } from '../src/domain/selectors';
import { resolvePrefs } from '../src/domain/notifyPrefs';
import { PUBLIC_MAX_FILES } from '../src/domain/forms';
import { BLOCKED_EXTENSIONS, cleanFileName, contentDisposition, DEFAULT_LIMITS, fileProblem, isInlineImage, sniffImage, type AttachmentLimits } from '../src/domain/attachments';
import type { PostgresSnapshotStore, ScopedTable } from './store';
import type { MongoSnapshotStore } from './mongoStore';

export interface AppConfig {
  /** Send cookies only over HTTPS (set in production). */
  secureCookies: boolean;
  /** Whether running in production mode. */
  production?: boolean;
  /** Public address of the web app, used in invitation links. */
  publicUrl: string;
  logger: boolean;
  /** Believe X-Forwarded-For. Only enable behind a reverse proxy you control, or clients can fake their address. */
  trustProxy?: boolean;
  /** When false, only invited people can join; creating a new organization is closed. */
  allowSignup?: boolean;
  /** Folder with the built web app. When present the server serves it, so one process is enough. */
  staticDir?: string;
  /** Development only: lets tests/devs read emails that were "sent" without SMTP. */
  devTools?: boolean;
  /** How many organizations stay in memory, and how long an idle one is kept. */
  orgCache?: { max: number; idleMs: number };
  /** Which outside services are plugged in. Mock ones are for development and demos only. */
  services?: ServiceModes;
  /** Registration policy: 'open' | 'invite_only' | 'admin_only'. */
  registrationPolicy?: 'open' | 'invite_only' | 'admin_only';
  /** Super admin email addresses allowed to manage platform settings. */
  superAdminEmails?: string[];
}

export interface AppDeps {
  db: Db;
  store: PostgresSnapshotStore | MongoSnapshotStore;
  repo: LocalRepository;
  accounts: Accounts;
  config: AppConfig;
  mailer?: Mailer;
  /** File storage. Without it, attachments are switched off. */
  files?: FileStore;
  attachmentLimits?: AttachmentLimits;
  blockedExtensions?: string[];
  /** Size limit for files sent by request-form visitors (smaller than for signed-in people). */
  publicMaxFileBytes?: number;
  /** Makes and checks the "stop these emails" links. Created from the database when not given. */
  unsubscribe?: Unsubscribe;
  /** Sends change notifications to other systems. Replaceable so tests (and an egress proxy) can control it. */
  webhooks?: Webhooks;
  /** Test hook: a payment provider to use instead of the configured one. */
  billingProvider?: BillingProvider;
  /** Test hook: an AI provider to use instead of the configured one. */
  aiProvider?: AiProvider;
}

const COOKIE = 'abg_session';
/** Scripts only from this origin: even if some text were ever rendered unsafely, injected scripts won't run. */
const CSP = "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'";
export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'abg-tracker';

/**
 * Methods the browser may call through /api/rpc/<name>. `n` is how many arguments the client
 * supplies; the signed-in user is always appended by the server as the final argument, so a
 * client can never act as someone else. Public methods get no user at all.
 */
/**
 * How a call says which organization's data it needs, so only that organization is loaded:
 * the argument is the organization id itself, the id of a record (looked up in `table`), or an organization link name.
 */
type Scope = { kind: 'org'; arg: number } | { kind: 'record'; table: ScopedTable; arg: number } | { kind: 'slug'; arg: number };
const org = (arg = 0): Scope => ({ kind: 'org', arg });
const rec = (table: ScopedTable, arg = 0): Scope => ({ kind: 'record', table, arg });

const RPC: Record<string, { n: number; mutates: boolean; public?: boolean; scope?: Scope }> = {
  listOrganizations: { n: 0, mutates: false },
  loadOrg: { n: 1, mutates: false, scope: org() },
  createProject: { n: 2, mutates: true, scope: org() },
  updateProject: { n: 2, mutates: true, scope: rec('projects') },
  deleteStatus: { n: 3, mutates: true, scope: rec('projects') },
  deleteIssueType: { n: 3, mutates: true, scope: rec('projects') },
  deleteAttachment: { n: 1, mutates: true, scope: rec('attachments') },
  markNotificationRead: { n: 1, mutates: true, scope: rec('notifications') },
  markAllNotificationsRead: { n: 1, mutates: true, scope: org() },
  setNotifyPrefs: { n: 1, mutates: true },
  setDashboardLayout: { n: 1, mutates: true },
  saveFilter: { n: 2, mutates: true, scope: org() },
  deleteFilter: { n: 1, mutates: true, scope: rec('filters') },
  createIssue: { n: 2, mutates: true, scope: org() },
  updateIssue: { n: 2, mutates: true, scope: rec('issues') },
  deleteIssue: { n: 1, mutates: true, scope: rec('issues') },
  addComment: { n: 2, mutates: true, scope: rec('issues') },
  setWatching: { n: 2, mutates: true, scope: rec('issues') },
  toggleReaction: { n: 2, mutates: true, scope: rec('comments') },
  createSprint: { n: 2, mutates: true, scope: rec('projects') },
  updateSprint: { n: 2, mutates: true, scope: rec('sprints') },
  startSprint: { n: 1, mutates: true, scope: rec('sprints') },
  completeSprint: { n: 2, mutates: true, scope: rec('sprints') },
  deleteSprint: { n: 1, mutates: true, scope: rec('sprints') },
  createForm: { n: 2, mutates: true, scope: rec('projects') },
  updateForm: { n: 2, mutates: true, scope: rec('forms') },
  deleteForm: { n: 1, mutates: true, scope: rec('forms') },
  createRule: { n: 2, mutates: true, scope: rec('projects') },
  updateRule: { n: 2, mutates: true, scope: rec('rules') },
  deleteRule: { n: 1, mutates: true, scope: rec('rules') },
  runScheduledAutomations: { n: 1, mutates: true, scope: org() },
  decideApproval: { n: 3, mutates: true, scope: rec('issues') },
  resetApproval: { n: 1, mutates: true, scope: rec('issues') },
  updateMemberRole: { n: 3, mutates: true, scope: org() },
  removeMember: { n: 2, mutates: true, scope: org() },
  getPublicForm: { n: 2, mutates: false, public: true, scope: { kind: 'slug', arg: 0 } },
  submitForm: { n: 5, mutates: true, public: true, scope: { kind: 'slug', arg: 0 } },
};

/** Maps a domain error message to an HTTP status. Domain messages are written for users, so they are safe to return. */
function statusFor(e: Error): number {
  if (/not a member|not allowed|only an owner|only the owner|only admins/i.test(e.message)) return 403;
  if (/not found|not available/i.test(e.message)) return 404;
  return 400;
}

declare module 'fastify' {
  interface FastifyInstance {
    /** Creates "due tomorrow / due today / overdue" Inbox items for assignees. Returns how many. */
    remindDue(at?: Date): Promise<number>;
  }
  interface FastifyRequest {
    userId: string | null;
    sessionToken: string | undefined;
  }
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const { db, store, repo, accounts, config, files } = deps;
  const limits = deps.attachmentLimits ?? DEFAULT_LIMITS;
  const blocked = deps.blockedExtensions ?? BLOCKED_EXTENSIONS;
  const publicLimits: AttachmentLimits = { ...limits, maxFileBytes: Math.min(limits.maxFileBytes, deps.publicMaxFileBytes ?? 10 * 1024 * 1024) };
  const tickets = new UploadTickets();
  const tokens = new ApiTokens(db);
  const webhooks = deps.webhooks ?? new Webhooks({ db, log: (l) => console.error(l) });
  const app = Fastify({ logger: config.logger ? { level: 'info', redact: ['req.headers.cookie'] } : false, bodyLimit: 1_000_000, trustProxy: config.trustProxy === true });
  await app.register(cookie);

  // All data access is serialized: the repository is synchronous and shares one in-memory data set.
  let chain: Promise<unknown> = Promise.resolve();
  const locked = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => undefined);
    return run;
  };

  const live = new LiveBus((userId, orgId) => store.load().memberships.some((m) => m.userId === userId && m.orgId === orgId));
  app.addHook('onClose', async () => live.closeAll());
  const cachePolicy = config.orgCache ?? { max: 50, idleMs: 30 * 60_000 };

  /**
   * Runs a data operation. The organizations it needs are loaded first; afterwards changes are
   * saved, and idle organizations are dropped from memory. If saving fails, memory is rolled back
   * from the database.
   */
  const transact = <T>(mutates: boolean, fn: () => Promise<T>, orgs: () => Promise<string[]> = async () => []): Promise<T> =>
    locked(async () => {
      let needed: string[] = [];
      try {
        needed = await orgs();
        for (const id of needed) await store.ensureOrg(id);
        const out = await fn();
        if (mutates) {
          await store.flush();
          live.publish(needed); // open browsers refresh themselves
          // Records are gone for good now: delete the stored bytes too.
          const gone = repo.drainFileDeletions();
          if (files && gone.length) {
            const results = await Promise.allSettled(gone.map((g) => files.remove(g.orgId, g.storageKey)));
            for (const r of results) if (r.status === 'rejected') app.log.error({ err: r.reason }, 'could not delete a stored file');
          }
        }
        return out;
      } catch (e) {
        // A failed write must not leave memory ahead of the database. Domain errors are thrown
        // before any change is saved, but reloading is cheap insurance for mutating calls.
        if (mutates) {
          await store.reload().catch(() => undefined);
          repo.drainFileDeletions(); // the removals were rolled back, so the files must stay
        }
        throw e;
      } finally {
        await store.evict(new Set(needed), cachePolicy).catch((err: unknown) => app.log.error({ err }, 'eviction failed'));
      }
    });

  /** Which organizations' data does this call need in memory? */
  const orgsFor = async (scope: Scope | undefined, args: unknown[]): Promise<string[]> => {
    const v = scope ? args[scope.arg] : undefined;
    if (!scope || typeof v !== 'string') return [];
    if (scope.kind === 'org') return [v];
    if (scope.kind === 'slug') return store.load().organizations.filter((o) => o.slug === v).map((o) => o.id);
    const owner = await store.orgOf(scope.table, v);
    return owner ? [owner] : [];
  };

  const loginLimiter = new RateLimiter(8, 10 * 60_000);
  const loginIpLimiter = new RateLimiter(40, 10 * 60_000);
  const publicLimiter = new RateLimiter(60, 60_000);
  const registerLimiter = new RateLimiter(10, 60 * 60_000);
  const forgotIpLimiter = new RateLimiter(10, 60 * 60_000);
  const forgotEmailLimiter = new RateLimiter(3, 60 * 60_000);
  /** Guesses at six-digit codes, per account (whatever addresses they come from). */
  const codeLimiter = new RateLimiter(10, 10 * 60_000);
  const twoFactorLimiter = new RateLimiter(10, 10 * 60_000);

  // ---- hooks -------------------------------------------------------------------------------

  app.addHook('onRequest', async (req, reply) => {
    reply.header('x-content-type-options', 'nosniff');
    reply.header('x-frame-options', 'DENY');
    reply.header('referrer-policy', 'no-referrer');
    if (config.secureCookies) reply.header('strict-transport-security', 'max-age=31536000; includeSubDomains');
    if (!req.url.startsWith('/api/')) {
      // The app shell and static files: no session lookup needed, but a strict content policy applies.
      reply.header('content-security-policy', CSP);
      return;
    }
    reply.header('cache-control', 'no-store');
    // The public API accepts only a personal token, never the browser cookie (so a web page can never drive it).
    if (req.url.startsWith('/api/v1/')) {
      const auth = req.headers.authorization;
      const t = typeof auth === 'string' && /^Bearer /i.test(auth) ? await tokens.verify(auth.slice(7).trim()) : null;
      if (!t || t.scope === 'calendar') throw new HttpError(401, 'Send a personal token as "Authorization: Bearer abg_…".');
      req.userId = t.userId;
      req.tokenScope = t.scope;
      req.tokenId = t.id;
      req.sessionToken = undefined;
      return;
    }
    // Check for Firebase ID token in Authorization header
    const authHeader = req.headers.authorization;
    if (typeof authHeader === 'string' && /^Bearer /i.test(authHeader)) {
      const fbToken = authHeader.slice(7).trim();
      const identity = await verifyFirebaseIdToken(fbToken);
      if (!identity || !identity.email) {
        throw new HttpError(401, 'Invalid or expired authorization token.');
      }
      const mongoDb = getMongoDb();
      if (mongoDb) {
        try {
          await provisionMongoUser(
            mongoDb,
            identity,
            {
              userAgent: String(req.headers['user-agent'] ?? ''),
              ip: ip(req),
            },
            config.registrationPolicy || 'open',
            config.superAdminEmails || []
          );
        } catch (e) {
          if (e instanceof HttpError) throw e;
        }
      }
      let u = accounts.findUserByEmail(identity.email);
      const policy = config.registrationPolicy || (config.allowSignup === false ? 'invite_only' : 'open');
      if (!u && policy === 'open') {
        const out = await transact(true, () =>
          accounts.registerSso(identity.name || identity.email!.split('@')[0], identity.email!, {
            userAgent: String(req.headers['user-agent'] ?? ''),
            ip: ip(req),
          })
        );
        u = out.user;
      }
      if (!u) {
        throw new HttpError(403, 'Account is not authorized.');
      }
      req.userId = u.id;
      req.sessionToken = undefined;
      return;
    }
    // Cross-site forms can't set custom headers, so requiring one blocks CSRF on cookie-authenticated calls.
    if (req.method !== 'GET' && req.method !== 'HEAD' && req.headers[CSRF_HEADER] !== CSRF_VALUE && !req.url.startsWith('/api/unsubscribe/')) {
      throw new HttpError(403, 'Missing request header.');
    }
    req.sessionToken = req.cookies[COOKIE];
    req.userId = await sessionUser(db, req.sessionToken);
  });

  app.setErrorHandler((err: Error & { statusCode?: number; validation?: unknown }, req, reply) => {
    if (err instanceof HttpError) return reply.code(err.status).send({ error: err.message });
    if (err.statusCode && err.statusCode < 500) return reply.code(err.statusCode).send({ error: err.statusCode === 413 ? 'Request too large.' : 'Invalid request.' });
    // Only errors written for users are shown. Anything else (database, bugs) is logged, never returned.
    if (err instanceof DomainError) return reply.code(statusFor(err)).send({ error: err.message });
    if (err instanceof TypeError || err instanceof RangeError) return reply.code(400).send({ error: 'Invalid request.' });
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'Something went wrong on our side.' });
  });

  const requireUser = (req: FastifyRequest): string => {
    if (!req.userId) throw new HttpError(401, 'Please sign in.');
    return req.userId;
  };

  const setSession = (reply: FastifyReply, token: string) =>
    reply.setCookie(COOKIE, token, { httpOnly: true, sameSite: 'lax', secure: config.secureCookies, path: '/', maxAge: SESSION_DAYS * 86400 });

  const baseUrl = (req: FastifyRequest) => (typeof req.headers.origin === 'string' && /^https?:\/\//.test(req.headers.origin) ? req.headers.origin : config.publicUrl);
  const ip = (req: FastifyRequest) => req.ip;

  // ---- health ----------------------------------------------------------------------------------

  /** A one-way stream of "organization X changed" notes (Server-Sent Events), so screens refresh without reloading. */
  app.get('/api/events', async (req, reply) => {
    const userId = requireUser(req);
    reply.hijack(); // from here the stream is written by hand
    reply.raw.writeHead(200, { ...reply.getHeaders(), 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', connection: 'keep-alive', 'x-accel-buffering': 'no' } as Record<string, string>);
    reply.raw.write('retry: 3000\n\n');
    live.add(userId, reply.raw);
  });

  app.get('/api/health', async () => ({ ok: true, database: db.kind, loadedOrganizations: store.loadedOrgCount }));

  // ---- auth --------------------------------------------------------------------------------------

  app.get('/api/config', async () => ({
    allowSignup: config.allowSignup !== false && config.registrationPolicy !== 'admin_only',
    registrationPolicy: config.registrationPolicy || 'open',
    superAdmins: config.superAdminEmails || [],
    emailEnabled: accounts.mailKind === 'smtp',
    database: getMongoDb() ? 'mongodb' : db.kind,
    ...svc.describe(),
    attachments: files ? { enabled: true, publicMaxFileBytes: publicLimits.maxFileBytes, maxFileBytes: limits.maxFileBytes, maxFilesPerIssue: limits.maxFilesPerIssue, blockedExtensions: blocked } : { enabled: false },
  }));

  app.post('/api/auth/register', async (req, reply) => {
    const policy = config.registrationPolicy || (config.allowSignup === false ? 'invite_only' : 'open');
    if (policy === 'invite_only') throw new HttpError(403, 'Registration is invitation-only. Please request an invitation from an administrator.');
    if (policy === 'admin_only') throw new HttpError(403, 'Registration is closed. Accounts must be provisioned by an administrator.');
    if (config.allowSignup === false) throw new HttpError(403, 'Creating new workspaces is closed. Ask an administrator for an invitation.');
    if (!registerLimiter.allow(ip(req))) throw new HttpError(429, 'Too many sign-ups from this address. Try again later.');
    const body = (req.body ?? {}) as { name?: unknown; email?: unknown; password?: unknown; orgName?: unknown };
    const out = await transact(true, () => accounts.register(body, { userAgent: String(req.headers['user-agent'] ?? ''), ip: ip(req) }));
    setSession(reply, out.token);
    return { user: out.user, ...accounts.me(out.user.id) };
  });

  app.post('/api/auth/login', async (req, reply) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    const key = `${ip(req)}|${email}`;
    if (!loginIpLimiter.allow(ip(req)) || !loginLimiter.allow(key)) throw new HttpError(429, 'Too many sign-in attempts. Please wait a few minutes.');
    const out = await locked(() => accounts.login(body.email, body.password, body.code, { userAgent: String(req.headers['user-agent'] ?? ''), ip: ip(req) }, (uid) => codeLimiter.allow(uid)));
    if (!out) throw new HttpError(401, 'Incorrect email or password.');
    if ('needsCode' in out) return { twoFactorRequired: true }; // the password was right; no session until the code is too
    loginLimiter.reset(key);
    codeLimiter.reset(out.user.id);
    setSession(reply, out.token);
    return accounts.me(out.user.id);
  });

  app.post('/api/auth/firebase-session', async (req, reply) => {
    const body = (req.body ?? {}) as { idToken?: unknown; orgName?: unknown; inviteToken?: unknown };
    if (typeof body.idToken !== 'string' || !body.idToken.trim()) {
      throw new HttpError(400, 'Missing idToken.');
    }
    const identity = await verifyFirebaseIdToken(body.idToken.trim());
    if (!identity || !identity.email) {
      throw new HttpError(401, 'Invalid or expired Firebase ID token.');
    }
    const email = identity.email.toLowerCase();
    const meta = { userAgent: String(req.headers['user-agent'] ?? ''), ip: ip(req) };

    const mongoDb = getMongoDb();
    if (mongoDb) {
      await provisionMongoUser(
        mongoDb,
        identity,
        {
          inviteToken: typeof body.inviteToken === 'string' ? body.inviteToken.trim() : undefined,
          orgName: typeof body.orgName === 'string' ? body.orgName.trim() : undefined,
          userAgent: meta.userAgent,
          ip: meta.ip,
        },
        config.registrationPolicy || 'open',
        config.superAdminEmails || []
      );
    }

    const existing = accounts.findUserByEmail(email);
    const policy = config.registrationPolicy || (config.allowSignup === false ? 'invite_only' : 'open');
    if (!existing && policy !== 'open' && !body.inviteToken) {
      throw new HttpError(403, 'Creating new workspaces is closed. Ask an administrator for an invitation.');
    }
    const out = await transact(true, () =>
      existing
        ? accounts.loginSso(existing, meta)
        : accounts.registerSso(identity.name || email.split('@')[0], email, meta)
    );
    setSession(reply, out.token);
    return accounts.me(out.user.id);
  });

  // ---- your account: profile, devices, two-factor ------------------------------------------------

  app.post('/api/me/profile', async (req) => {
    const userId = requireUser(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const user = await transact(true, () => accounts.updateName(userId, body.name));
    return { user };
  });

  app.get('/api/me/sessions', async (req) => ({ sessions: await listSessions(db, requireUser(req), req.sessionToken) }));

  app.delete<{ Params: { id: string } }>('/api/me/sessions/:id', async (req) => {
    const ok = await revokeSession(db, requireUser(req), req.params.id, req.sessionToken);
    if (!ok) throw new HttpError(404, 'That device is not signed in any more.');
    return { ok: true };
  });

  app.post('/api/me/sessions/sign-out-others', async (req) => {
    await deleteUserSessions(db, requireUser(req), req.sessionToken);
    return { ok: true };
  });

  app.get('/api/me/2fa', async (req) => accounts.twoFactorStatus(requireUser(req)));

  app.post('/api/me/2fa/begin', async (req) => {
    const userId = requireUser(req);
    if (!twoFactorLimiter.allow(userId)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.');
    return locked(() => accounts.twoFactorBegin(userId));
  });

  app.post('/api/me/2fa/confirm', async (req) => {
    const userId = requireUser(req);
    if (!codeLimiter.allow(userId)) throw new HttpError(429, 'Too many code attempts. Please wait a few minutes.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const recoveryCodes = await locked(() => accounts.twoFactorConfirm(userId, body.code));
    return { recoveryCodes };
  });

  app.post('/api/me/2fa/disable', async (req) => {
    const userId = requireUser(req);
    if (!twoFactorLimiter.allow(userId)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    await locked(() => accounts.twoFactorDisable(userId, body.password));
    return { ok: true };
  });

  app.post('/api/auth/logout', async (req, reply) => {
    await deleteSession(db, req.sessionToken);
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  app.get('/api/auth/me', async (req) => {
    const me = req.userId ? accounts.me(req.userId) : null;
    if (!me) throw new HttpError(401, 'Please sign in.');
    return me;
  });

  app.post('/api/auth/forgot', async (req) => {
    const body = (req.body ?? {}) as Record<string, unknown>;
    const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
    // Same answer for every request, so the form can't be used to discover who has an account.
    if (!forgotIpLimiter.allow(ip(req)) || !forgotEmailLimiter.allow(email)) return { ok: true };
    await locked(() => accounts.requestPasswordReset(email, baseUrl(req)));
    return { ok: true };
  });

  app.post<{ Params: { token: string } }>('/api/auth/reset/:token', async (req) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, 'Too many requests.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    await locked(() => accounts.resetPassword(req.params.token, body.password));
    return { ok: true };
  });

  app.post('/api/auth/password', async (req) => {
    const userId = requireUser(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    await locked(() => accounts.changePassword(userId, body.current, body.next, req.sessionToken));
    return { ok: true };
  });

  // ---- email: stop-these-emails link, and "does my email work?" ----------------------------------

  const unsubscribe = deps.unsubscribe ?? new Unsubscribe(db);
  const testMailLimiter = new RateLimiter(3, 60 * 60_000);
  // Mail apps send "List-Unsubscribe=One-Click" as a form post; the body carries nothing we need.
  app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string', bodyLimit: 1024 }, (_req, _body, done) => done(null, {}));

  app.get<{ Params: { token: string } }>('/api/unsubscribe/:token', async (req) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, 'Too many requests.');
    const userId = await unsubscribe.verify(req.params.token);
    const user = userId ? store.load().users.find((u) => u.id === userId) : undefined;
    if (!user) throw new HttpError(404, 'This link is not valid.');
    return { name: user.name }; // just enough to say who it is for; never the address
  });

  // Needs no session and no custom header (mail apps cannot send one); the signed link is the proof,
  // and all it can do is switch that person's email off.
  app.post<{ Params: { token: string } }>('/api/unsubscribe/:token', async (req) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, 'Too many requests.');
    const userId = await unsubscribe.verify(req.params.token);
    if (!userId) throw new HttpError(404, 'This link is not valid.');
    await transact(true, async () => {
      const user = store.load().users.find((u) => u.id === userId);
      if (!user) throw new HttpError(404, 'This link is not valid.');
      await repo.setNotifyPrefs({ ...resolvePrefs(user), email: 'off' }, userId);
    });
    return { ok: true };
  });

  // Sends the signed-in person a short message at their own address, so they (or an admin) can see that email really works.
  app.post('/api/me/test-email', async (req) => {
    const userId = requireUser(req);
    if (!testMailLimiter.allow(userId)) throw new HttpError(429, 'You have sent a few test emails already. Try again in an hour.');
    const user = store.load().users.find((u) => u.id === userId);
    if (!user) throw new HttpError(401, 'Please sign in.');
    if (!deps.mailer || deps.mailer.kind !== 'smtp') return { sent: false, reason: 'Email is not set up on this server yet. An administrator needs to set SMTP_URL.' };
    try {
      await deps.mailer.send({ to: user.email, subject: 'ABG Tracker test email', text: `Hi ${user.name},\n\nThis is a test. If you can read it, notification emails from ABG Tracker can reach you.\n` });
      return { sent: true };
    } catch (err) {
      app.log.error({ err }, 'test email failed'); // details stay in the log; the screen gets a plain message
      return { sent: false, reason: 'The mail server did not accept the message. An administrator should check the SMTP settings and the server log.' };
    }
  });

  // ---- invitations -------------------------------------------------------------------------------

  app.post<{ Params: { orgId: string } }>('/api/orgs/:orgId/invites', async (req) => {
    const userId = requireUser(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    await svc.assertSeat(req.params.orgId);
    const { token, invite } = await locked(() => accounts.createInvite(req.params.orgId, body.email, body.role, userId));
    await owner.audit(req.params.orgId, userId, 'invite.create', ` as ${invite.role}`).catch(() => undefined);
    const link = `${baseUrl(req)}/invite/${token}`;
    accounts.sendInviteEmail(invite, accounts.orgName(req.params.orgId), accounts.userName(userId), link);
    // The link is also returned, so an admin can share it by hand when email isn't configured.
    return { invite, link, emailed: accounts.mailKind === 'smtp' };
  });

  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/invites', async (req) => ({ invites: await locked(() => accounts.listInvites(req.params.orgId, requireUser(req))) }));

  app.delete<{ Params: { orgId: string; id: string } }>('/api/orgs/:orgId/invites/:id', async (req) => {
    const userId = requireUser(req);
    await locked(() => accounts.revokeInvite(req.params.orgId, req.params.id, userId));
    await owner.audit(req.params.orgId, userId, 'invite.revoke').catch(() => undefined);
    return { ok: true };
  });

  app.get<{ Params: { token: string } }>('/api/invites/:token', async (req) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, 'Too many requests.');
    return locked(() => accounts.getInvite(req.params.token));
  });

  app.post<{ Params: { token: string } }>('/api/invites/:token/accept', async (req, reply) => {
    if (!publicLimiter.allow(ip(req))) throw new HttpError(429, 'Too many requests.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const out = await transact(true, () => accounts.acceptInvite(req.params.token, body, req.userId));
    if (out.token) setSession(reply, out.token);
    const joined = store.load().organizations.find((o) => o.slug === out.orgSlug);
    if (joined) await owner.audit(joined.id, out.user.id, 'member.join', out.user.name).catch(() => undefined);
    return { orgSlug: out.orgSlug };
  });

  // ---- repository calls -----------------------------------------------------------------------------

  app.post<{ Params: { method: string } }>('/api/rpc/:method', async (req) => {
    const spec = Object.prototype.hasOwnProperty.call(RPC, req.params.method) ? RPC[req.params.method] : undefined;
    if (!spec) throw new HttpError(404, 'Unknown method.');
    const body = (req.body ?? {}) as { args?: unknown };
    if (!Array.isArray(body.args) || body.args.length > spec.n) throw new HttpError(400, 'Invalid request.');
    // Pad to the exact arity so the server-appended user id can never be displaced by extra client arguments.
    const args = Array.from({ length: spec.n }, (_, i) => (body.args as unknown[])[i]);

    if (spec.public) {
      if (!publicLimiter.allow(ip(req))) throw new HttpError(429, 'Too many requests. Please slow down.');
      const call = (repo as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[req.params.method];
      const result = await transact(
        spec.mutates,
        async () => {
          const out = await call.apply(repo, args);
          // A request form that asks for files gets a short-lived, limited ticket for uploading them.
          if (req.params.method === 'submitForm' && files && out && typeof (out as { key?: unknown }).key === 'string') {
            const org = store.load().organizations.find((o) => o.slug === args[0]);
            const form = org && repo.snapshot.forms.find((f) => f.orgId === org.id && f.slug === args[1]);
            const issue = org && repo.snapshot.issues.find((i) => i.orgId === org.id && i.key === (out as { key: string }).key);
            if (form && issue && form.fields.some((f) => f.kind === 'file')) {
              const who = String((args[3] as { name?: unknown } | undefined)?.name ?? '').trim().slice(0, 100) || 'Request form sender';
              (out as Record<string, unknown>).upload = {
                token: tickets.create({ issueId: issue.id, actorId: form.createdBy, submitterName: who, maxFiles: PUBLIC_MAX_FILES }),
                maxFiles: PUBLIC_MAX_FILES,
                maxFileBytes: publicLimits.maxFileBytes,
              };
            }
          }
          return out;
        },
        () => orgsFor(spec.scope, args)
      );
      return { result: result ?? null };
    }
    const userId = requireUser(req);
    if (req.params.method === 'createProject' && typeof args[0] === 'string') await svc.assertProjectRoom(args[0]);
    let doomed: Issue | undefined; // a deleted item is gone afterwards, so remember how it looked
    const result = await transact(
      spec.mutates,
      async () => {
        if (req.params.method === 'deleteIssue') doomed = repo.snapshot.issues.find((i) => i.id === args[0]) && structuredClone(repo.snapshot.issues.find((i) => i.id === args[0])!);
        return (repo as unknown as Record<string, (...a: unknown[]) => Promise<unknown>>)[req.params.method](...args, userId);
      },
      () => orgsFor(spec.scope, args)
    );
    // Other systems that asked to be told hear about changes to items and comments.
    if (req.params.method === 'createIssue' && result) emitter.issue('issue.created', result as Issue);
    else if (req.params.method === 'updateIssue' && result) emitter.issue('issue.updated', result as Issue);
    else if (req.params.method === 'deleteIssue' && doomed) emitter.issue('issue.deleted', doomed);
    else if (req.params.method === 'addComment' && result) {
      const issue = repo.snapshot.issues.find((i) => i.id === args[0]);
      if (issue) emitter.comment(issue, result as Comment);
    }
    // Changes to who is in an organization, and with what power, are written to its audit log.
    if ((req.params.method === 'updateMemberRole' || req.params.method === 'removeMember') && typeof args[0] === 'string') {
      const who = store.load().users.find((u) => u.id === args[1])?.name ?? 'someone';
      await owner.audit(args[0], userId, req.params.method === 'updateMemberRole' ? 'member.role' : args[1] === userId ? 'member.leave' : 'member.remove', req.params.method === 'updateMemberRole' ? `${who} is now ${String(args[2])}` : who).catch(() => undefined);
    }
    return { result: result ?? null };
  });

  // ---- your data: export, audit log, delete --------------------------------------------------------

  const owner = new DataOwner(db, store, repo.snapshot, accounts.twoFactor);
  const dangerLimiter = new RateLimiter(5, 10 * 60_000);
  const svc = registerServices({ app, db, store, repo, accounts, services: config.services ?? NO_SERVICES, publicUrl: config.publicUrl, secureCookies: config.secureCookies, allowSignup: config.allowSignup !== false, audit: (o, a, x, y) => owner.audit(o, a, x, y), requireUser, setSession, transact, ip, mockSecret: randomBytes(32).toString('hex'), billingProvider: deps.billingProvider, aiProvider: deps.aiProvider });
  const stamp = () => new Date().toISOString().slice(0, 10);

  const exportOrg = async (req: FastifyRequest & { params: { orgId: string } }) => {
    const userId = requireUser(req);
    return transact(false, async () => {
      owner.requireOwner(req.params.orgId, userId);
      const { notifications: _mine, ...data } = await repo.loadOrg(req.params.orgId, userId); // the owner's personal Inbox is not the organization's data
      return data;
    }, async () => [req.params.orgId]);
  };

  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/export', async (req, reply) => {
    const data = await exportOrg(req);
    await owner.audit(req.params.orgId, req.userId!, 'org.export', 'Full export (JSON)').catch(() => undefined);
    return reply
      .header('content-type', 'application/json; charset=utf-8')
      .header('content-disposition', `attachment; filename="${data.org.slug}-export-${stamp()}.json"`)
      .send(JSON.stringify({ format: 'abg-tracker-export-v1', exportedAt: new Date().toISOString(), ...data }, null, 2));
  });

  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/export.csv', async (req, reply) => {
    const data = await exportOrg(req);
    await owner.audit(req.params.orgId, req.userId!, 'org.export', 'Work items (CSV)').catch(() => undefined);
    return reply
      .header('content-type', 'text/csv; charset=utf-8')
      .header('content-disposition', `attachment; filename="${data.org.slug}-items-${stamp()}.csv"`)
      .send(issuesCsv(data));
  });

  // Bring work in from a spreadsheet (CSV exported from Jira, Asana, Excel…). Every row goes through the normal
  // create-item rules and permissions, so an import can never do more than the person could do by hand.
  app.addContentTypeParser('text/csv', { parseAs: 'string', bodyLimit: MAX_IMPORT_BYTES }, (_req, body, done) => done(null, body));
  const importLimiter = new RateLimiter(10, 60 * 60_000);
  app.post<{ Params: { projectId: string } }>('/api/projects/:projectId/import', { bodyLimit: MAX_IMPORT_BYTES }, async (req) => {
    const userId = requireUser(req);
    if (!importLimiter.allow(userId)) throw new HttpError(429, 'You have imported several times this hour. Try again later.');
    if (typeof req.body !== 'string') throw new HttpError(400, 'Send the CSV text as the request body.');
    const projectId = req.params.projectId;
    return transact(
      true,
      async () => {
        const project = repo.snapshot.projects.find((p) => p.id === projectId);
        if (!project || !store.load().memberships.some((m) => m.orgId === project.orgId && m.userId === userId)) throw new HttpError(404, 'Project not found.');
        const members = store.load().memberships.filter((m) => m.orgId === project.orgId).flatMap((m) => store.load().users.filter((u) => u.id === m.userId));
        let plan: ReturnType<typeof planImport>;
        try {
          plan = planImport(req.body as string, project, members);
        } catch (e) {
          throw new HttpError(400, (e as Error).message);
        }
        const result = { created: 0, skipped: [...plan.skipped] };
        for (const { row, input } of plan.items) {
          try {
            await repo.createIssue(project.orgId, input, userId);
            result.created++;
          } catch (e) {
            if (e instanceof DomainError && /not allowed|not a member/i.test(e.message)) throw new HttpError(403, e.message); // no permission: stop at once
            result.skipped.push({ row, reason: e instanceof DomainError ? e.message : 'Could not create this item.' });
          }
        }
        return result;
      },
      async () => {
        const o = await store.orgOf('projects', projectId);
        return o ? [o] : [];
      }
    );
  });

  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/audit', async (req) => ({ events: await owner.listAudit(req.params.orgId, requireUser(req)) }));

  app.post<{ Params: { orgId: string } }>('/api/orgs/:orgId/delete', async (req) => {
    const userId = requireUser(req);
    if (!dangerLimiter.allow(userId)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    await transact(true, () => owner.deleteOrganization(req.params.orgId, userId, body.password, body.confirmName, body.code), async () => [req.params.orgId]);
    await webhooks.removeAllFor(req.params.orgId).catch(() => undefined);
    await files?.removeOrg(req.params.orgId).catch((err) => app.log.error({ err }, 'could not delete stored files'));
    return { ok: true };
  });

  app.post('/api/me/delete', async (req, reply) => {
    const userId = requireUser(req);
    if (!dangerLimiter.allow(userId)) throw new HttpError(429, 'Too many attempts. Please wait a few minutes.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    await transact(true, () => owner.deleteAccount(userId, body.password, body.code), async () => store.load().memberships.filter((m) => m.userId === userId).map((m) => m.orgId));
    await tokens.revokeAll(userId); // their tokens stop working at once
    reply.clearCookie(COOKIE, { path: '/' });
    return { ok: true };
  });

  // ---- integrations: tokens, webhooks, calendar feed, public API ------------------------------------------

  const emitter = makeEmitter({ store: store as PostgresSnapshotStore, repo, webhooks, baseUrl: config.publicUrl });
  registerPublicApi({ app, store: store as PostgresSnapshotStore, repo, webhooks, baseUrl: config.publicUrl, transact });
  const tokenLimiter = new RateLimiter(20, 60 * 60_000);
  const calendarLimiter = new RateLimiter(60, 60 * 60_000);

  app.get('/api/me/tokens', async (req) => ({ tokens: await tokens.list(requireUser(req)) }));
  app.post('/api/me/tokens', async (req) => {
    const userId = requireUser(req);
    if (!tokenLimiter.allow(userId)) throw new HttpError(429, 'Too many tokens created. Try again later.');
    const body = (req.body ?? {}) as Record<string, unknown>;
    const { token, view } = await tokens.create(userId, body.name, body.scope);
    return { token, view }; // the only time the token is shown
  });
  app.delete<{ Params: { id: string } }>('/api/me/tokens/:id', async (req) => {
    if (!(await tokens.revoke(requireUser(req), req.params.id))) throw new HttpError(404, 'Token not found.');
    return { ok: true };
  });

  /** The due-date calendar: the secret address *is* the login, so it only ever shows that person's due dates. */
  app.get<{ Params: { file: string } }>('/api/cal/:file', async (req, reply) => {
    const m = /^(abg_[A-Za-z0-9_-]{20,80})\.ics$/.exec(req.params.file);
    const t = m ? await tokens.verify(m[1]) : null;
    if (!t || t.scope !== 'calendar') throw new HttpError(404, 'Not found.');
    if (!calendarLimiter.allow(t.id)) throw new HttpError(429, 'Too many requests.');
    const orgIds = store.load().memberships.filter((x) => x.userId === t.userId).map((x) => x.orgId);
    const items = await transact(false, async () => {
      const out: Parameters<typeof dueDatesIcs>[0] = [];
      for (const issue of repo.snapshot.issues) {
        if (issue.assigneeId !== t.userId || !issue.dueDate || !orgIds.includes(issue.orgId)) continue;
        const project = repo.snapshot.projects.find((p) => p.id === issue.projectId);
        const org = store.load().organizations.find((o) => o.id === issue.orgId);
        if (project && org && !isDone(project, issue)) out.push({ issue, project, orgName: org.name, url: `${config.publicUrl}/${org.slug}/p/${project.key}/board?issue=${issue.key}` });
      }
      return out;
    }, async () => orgIds);
    return reply.header('content-type', 'text/calendar; charset=utf-8').header('cache-control', 'private, max-age=900').send(dueDatesIcs(items));
  });

  const requireAdmin = (orgId: string, userId: string) => {
    const role = store.load().memberships.find((m) => m.orgId === orgId && m.userId === userId)?.role;
    if (!role) throw new HttpError(403, 'You are not a member of this organization.');
    if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only owners and admins can manage webhooks.');
  };
  const orgSlug = (orgId: string) => store.load().organizations.find((o) => o.id === orgId)?.slug ?? '';

  app.get<{ Params: { orgId: string } }>('/api/orgs/:orgId/webhooks', async (req) => {
    requireAdmin(req.params.orgId, requireUser(req));
    return { hooks: await webhooks.list(req.params.orgId), events: WEBHOOK_EVENTS };
  });
  app.post<{ Params: { orgId: string } }>('/api/orgs/:orgId/webhooks', async (req) => {
    const userId = requireUser(req);
    requireAdmin(req.params.orgId, userId);
    const out = await webhooks.create(req.params.orgId, userId, (req.body ?? {}) as Record<string, unknown>);
    await owner.audit(req.params.orgId, userId, 'webhook.create', out.hook.url).catch(() => undefined);
    return out; // includes the signing secret, shown only now
  });
  app.delete<{ Params: { orgId: string; id: string } }>('/api/orgs/:orgId/webhooks/:id', async (req) => {
    const userId = requireUser(req);
    requireAdmin(req.params.orgId, userId);
    if (!(await webhooks.remove(req.params.orgId, req.params.id))) throw new HttpError(404, 'Webhook not found.');
    await owner.audit(req.params.orgId, userId, 'webhook.delete').catch(() => undefined);
    return { ok: true };
  });
  app.post<{ Params: { orgId: string; id: string } }>('/api/orgs/:orgId/webhooks/:id/active', async (req) => {
    requireAdmin(req.params.orgId, requireUser(req));
    const on = ((req.body ?? {}) as { active?: unknown }).active === true;
    if (!(await webhooks.setActive(req.params.orgId, req.params.id, on))) throw new HttpError(404, 'Webhook not found.');
    return { ok: true };
  });
  app.post<{ Params: { orgId: string; id: string } }>('/api/orgs/:orgId/webhooks/:id/test', async (req) => {
    const userId = requireUser(req);
    requireAdmin(req.params.orgId, userId);
    if (!tokenLimiter.allow(`test:${userId}`)) throw new HttpError(429, 'Too many tests. Try again later.');
    return { result: await webhooks.ping(req.params.orgId, orgSlug(req.params.orgId), req.params.id) };
  });

  // ---- file attachments -------------------------------------------------------------------------------

  if (files) {
    const uploadLimiter = new RateLimiter(30, 60_000);
    const publicUploadLimiter = new RateLimiter(20, 60_000);
    const bodyLimit = limits.maxFileBytes + 4096;
    // The file is the request body, sent as-is (no multipart), with its name in a header.
    app.addContentTypeParser('application/octet-stream', { parseAs: 'buffer', bodyLimit }, (_req, body, done) => done(null, body));

    /**
     * The one place a file is accepted, for signed-in people and for request-form visitors alike:
     * checks the file, checks permission *before* writing, stores the bytes, records them, and
     * removes the bytes again if anything fails.
     */
    const acceptUpload = async (a: {
      issueId: string;
      actorId: string;
      bytes: Buffer;
      rawName: string;
      lim: AttachmentLimits;
      reg?: { commentId?: string; externalName?: string };
    }) => {
      const name = cleanFileName(a.rawName);
      const problem = fileProblem(name, a.bytes.length, a.lim, blocked);
      if (problem) throw new HttpError(a.bytes.length > a.lim.maxFileBytes ? 413 : 400, problem);
      const mime = sniffImage(a.bytes) ?? 'application/octet-stream'; // the file's own bytes decide, never the claimed type

      let written: { orgId: string; key: string } | null = null;
      try {
        return await transact(
          true,
          async () => {
            const { orgId } = repo.assertCanAttach(a.issueId, a.actorId); // permission first, bytes second
            const w = await files.write(orgId, a.bytes);
            written = { orgId, key: w.key };
            const attachment = await repo.registerAttachment(a.issueId, { name, size: w.size, mime, sha256: w.sha256, storageKey: w.key }, a.lim, a.actorId, a.reg);
            return { attachment };
          },
          () => orgsFor({ kind: 'record', table: 'issues', arg: 0 }, [a.issueId])
        );
      } catch (e) {
        const w = written as { orgId: string; key: string } | null;
        if (w) await files.remove(w.orgId, w.key).catch(() => undefined);
        throw e;
      }
    };

    const nameFrom = (req: FastifyRequest) => {
      try {
        return decodeURIComponent(String(req.headers['x-file-name'] ?? ''));
      } catch {
        return ''; // an undecodable name just becomes "file"
      }
    };

    app.post<{ Params: { issueId: string }; Querystring: { comment?: string } }>(
      '/api/issues/:issueId/attachments',
      {
        bodyLimit,
        // Refuse anonymous uploads before the (large) body is even read.
        onRequest: async (req) => {
          if (!req.userId) throw new HttpError(401, 'Please sign in.');
        },
      },
      async (req) => {
        const userId = requireUser(req);
        if (!uploadLimiter.allow(userId)) throw new HttpError(429, 'You are uploading too quickly. Wait a moment and try again.');
        if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the file itself as the request body.');
        const commentId = typeof req.query.comment === 'string' && req.query.comment ? req.query.comment : undefined;
        return acceptUpload({ issueId: req.params.issueId, actorId: userId, bytes: req.body, rawName: nameFrom(req), lim: limits, reg: { commentId } });
      }
    );

    // Visitors who filled in a request form may attach the files it asked for. The form submission
    // hands out a short-lived, limited upload ticket; the ticket is the only thing that authorizes this.
    const publicBodyLimit = publicLimits.maxFileBytes + 4096;
    app.post<{ Params: { token: string } }>('/api/public/uploads/:token', { bodyLimit: publicBodyLimit }, async (req) => {
      if (!publicUploadLimiter.allow(ip(req))) throw new HttpError(429, 'Too many uploads. Please wait a moment.');
      if (!Buffer.isBuffer(req.body)) throw new HttpError(400, 'Send the file itself as the request body.');
      const ticket = tickets.use(req.params.token);
      if (!ticket) throw new HttpError(403, 'This upload link has expired or was already used up. Send your request again.');
      return acceptUpload({ issueId: ticket.issueId, actorId: ticket.actorId, bytes: req.body, rawName: nameFrom(req), lim: publicLimits, reg: { externalName: ticket.submitterName } });
    });

    app.get<{ Params: { id: string }; Querystring: { inline?: string; thumb?: string } }>('/api/files/:id', async (req, reply) => {
      const userId = requireUser(req);
      // The record may belong to an organization that isn't in memory, so read it directly.
      const rows = await db.query(`select data from attachments where id = $1`, [req.params.id]);
      const att = rows.length ? ((typeof rows[0].data === 'string' ? JSON.parse(rows[0].data) : rows[0].data) as { orgId: string; storageKey: string; name: string; mime: string; size: number }) : null;
      // Not a member? Same answer as "doesn't exist", so file ids can't be probed.
      const member = att && store.load().memberships.some((m) => m.orgId === att.orgId && m.userId === userId);
      if (!att || !member) throw new HttpError(404, 'File not found.');
      if (!(await files.exists(att.orgId, att.storageKey))) throw new HttpError(404, 'This file is missing from storage.');

      const sealed = (r: FastifyReply) =>
        r
          .header('content-security-policy', "default-src 'none'; sandbox") // even if opened directly, it can run nothing
          .header('cache-control', 'private, no-cache'); // always re-check: a removed file or a removed member must stop working at once

      if (req.query.thumb === '1') {
        if (!isInlineImage(att.mime)) throw new HttpError(415, 'There is no preview for this kind of file.');
        if (!(await files.hasThumb(att.orgId, att.storageKey))) {
          try {
            await files.writeThumb(att.orgId, att.storageKey, await makeThumbnail(await files.readAll(att.orgId, att.storageKey)));
          } catch {
            throw new HttpError(415, 'This picture could not be previewed.'); // corrupt, or too large to open safely
          }
        }
        return sealed(reply)
          .header('content-type', 'image/webp')
          .header('content-disposition', contentDisposition('inline', att.name.replace(/\.[^.]*$/, '') + '.webp'))
          .send(files.readThumb(att.orgId, att.storageKey));
      }

      const inline = req.query.inline === '1' && isInlineImage(att.mime);
      return sealed(reply)
        .header('content-type', inline ? att.mime : 'application/octet-stream')
        .header('content-disposition', contentDisposition(inline ? 'inline' : 'attachment', att.name))
        .header('content-length', att.size)
        .send(files.read(att.orgId, att.storageKey));
    });
  }

  if (config.devTools && deps.mailer instanceof ConsoleMailer) {
    app.get('/api/dev/outbox', async () => ({ messages: (deps.mailer as ConsoleMailer).outbox }));
  }

  registerMongoTestRoutes(app, !!config.production, requireUser);

  // ---- the web app -------------------------------------------------------------------------------

  if (config.staticDir && existsSync(path.join(config.staticDir, 'index.html'))) {
    await app.register(fastifyStatic, {
      root: config.staticDir, // files are looked up per request, so a new build is served without restarting
      setHeaders: (res, filePath) => {
        // Built files are named by content hash, so they can be cached for a year; the page itself must stay fresh.
        res.header('cache-control', /[\\/]assets[\\/]/.test(filePath) ? 'public, max-age=31536000, immutable' : 'no-cache');
      },
    });

    const indexPath = path.join(config.staticDir, 'index.html');
    // Single-page app: any other address (e.g. /acme/p/PLT/board) gets the app, and the app routes it.
    app.setNotFoundHandler((req, reply) => {
      if (req.method === 'GET' && !req.url.startsWith('/api/') && (req.headers.accept ?? '').includes('text/html')) {
        return reply.header('content-type', 'text/html; charset=utf-8').header('cache-control', 'no-cache').send(readFileSync(indexPath)); // read each time: a rebuild changes the file names inside
      }
      return reply.code(404).send({ error: 'Not found.' });
    });
  }

  // Due-date reminders. Only organizations that actually have something due soon are loaded, one at a time.
  app.decorate('remindDue', async (at: Date = new Date()): Promise<number> => {
    const day = (d: Date) => d.toISOString().slice(0, 10);
    // Wide enough for every time zone (UTC-12 to UTC+14); each person's own "today" is applied afterwards.
    // Older overdue items are not asked about: no flood of history.
    const from = day(new Date(at.getTime() - 4 * 86_400_000));
    const to = day(new Date(at.getTime() + 9 * 86_400_000)); // the longest reminder lead (7 days) plus time-zone slack
    const rows = await db.query(`select distinct org_id from issues where data->>'dueDate' >= $1 and data->>'dueDate' <= $2 and data->>'assigneeId' is not null`, [from, to]);
    let created = 0;
    for (const r of rows) {
      const orgId = String(r.org_id);
      created += await transact(true, async () => repo.createDueReminders(orgId, at), async () => [orgId]);
    }
    return created;
  });

  return app;
}
