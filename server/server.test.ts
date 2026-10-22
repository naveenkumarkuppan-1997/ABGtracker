import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import { LocalRepository } from '../src/data/localRepository';
import { Accounts, DEMO_PASSWORD } from './accounts';
import { buildApp, CSRF_HEADER, CSRF_VALUE } from './app';
import { loadConfig } from './config';
import { migrate, openDb, type Db } from './db';
import { ConsoleMailer, type Mailer } from './mailer';
import { mkdtempSync, mkdirSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { FileStore } from './files';
import { NotificationEmailer } from './notifier';
import { Unsubscribe } from './unsubscribe';
import { assertSafeUrl, isPrivateAddress, signPayload, Webhooks } from './webhooks';
import { dueDatesIcs } from './publicapi';
import { NO_SERVICES, PLANS, MockAiProvider, MockSsoProvider, type AiProvider, type BriefInput, type ServiceModes } from './services';
import { base32Decode, base32Encode, hotp, matchStep, stepOf } from './twofactor';
import { localDate, localHour } from '../src/domain/timeZone';
import { DEFAULT_LIMITS, type AttachmentLimits } from '../src/domain/attachments';
import { tmpdir } from 'node:os';
import { get as httpGet } from 'node:http';
import path from 'node:path';
import { PostgresSnapshotStore } from './store';

interface Ctx {
  filesDir?: string;
  app: FastifyInstance;
  db: Db;
  store: PostgresSnapshotStore;
  breakWrites: (on: boolean) => void;
}

const open: Ctx[] = [];
const tempDirs: string[] = [];

async function server(opts: { demo?: boolean; allowSignup?: boolean; staticDir?: string; mailer?: Mailer; production?: boolean; limits?: Partial<AttachmentLimits>; webhooks?: (db: Db) => Webhooks; services?: Partial<ServiceModes>; aiProvider?: AiProvider } = {}): Promise<Ctx & { mailer: Mailer; mailErrors: unknown[]; filesDir: string }> {
  const real = await openDb({}); // in-memory PGlite
  let broken = false;
  const db: Db = {
    ...real,
    tx: (fn) => (broken ? Promise.reject(new Error('disk full')) : real.tx(fn)),
  };
  await migrate(db);
  const store = await PostgresSnapshotStore.open(db);
  const repo = new LocalRepository(store);
  const mailer = opts.mailer ?? new ConsoleMailer(() => undefined);
  const mailErrors: unknown[] = [];
  const filesDir = mkdtempSync(path.join(tmpdir(), 'abg-files-'));
  tempDirs.push(filesDir);
  const accounts = new Accounts(db, store, repo.snapshot, mailer, (e) => mailErrors.push(e));
  if (opts.demo) await accounts.seedDemo();
  const app = await buildApp({
    db,
    store,
    repo,
    accounts,
    mailer,
    files: new FileStore(filesDir),
    attachmentLimits: { ...DEFAULT_LIMITS, ...opts.limits },
    webhooks: opts.webhooks?.(db),
    aiProvider: opts.aiProvider,
    config: { secureCookies: !!opts.production, publicUrl: 'http://localhost:3001', logger: false, allowSignup: opts.allowSignup, staticDir: opts.staticDir, devTools: !opts.production, services: { ...NO_SERVICES, ...opts.services } },
  });
  const ctx = { app, db, store, filesDir, breakWrites: (on: boolean) => (broken = on), mailer, mailErrors };
  open.push(ctx);
  return ctx;
}

afterEach(async () => {
  for (const d of tempDirs.splice(0)) rmSync(d, { recursive: true, force: true });
  const closed = new Set<Db>();
  while (open.length) {
    const c = open.pop()!;
    await c.app.close();
    if (!closed.has(c.db)) {
      closed.add(c.db);
      await c.db.close();
    }
  }
});

/** A new server process on the same database: empty memory, everything must come from PostgreSQL. */
async function restart(prev: Ctx, orgCache?: { max: number; idleMs: number }): Promise<Ctx> {
  const store = await PostgresSnapshotStore.open(prev.db);
  const repo = new LocalRepository(store);
  const mailer = new ConsoleMailer(() => undefined);
  const accounts = new Accounts(prev.db, store, repo.snapshot, mailer);
  const app = await buildApp({
    db: prev.db,
    store,
    repo,
    accounts,
    mailer,
    files: prev.filesDir ? new FileStore(prev.filesDir) : undefined,
    config: { secureCookies: false, publicUrl: 'http://localhost:3001', logger: false, devTools: true, orgCache },
  });
  const ctx = { app, db: prev.db, store, filesDir: prev.filesDir, breakWrites: prev.breakWrites };
  open.push(ctx);
  return ctx;
}

class Client {
  cookie = '';
  constructor(private app: FastifyInstance) {}

  async call(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method,
      url,
      payload: body === undefined ? undefined : (body as object),
      headers: { [CSRF_HEADER]: CSRF_VALUE, ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    const set = res.cookies.find((c) => c.name === 'abg_session');
    if (set) this.cookie = set.value ? `abg_session=${set.value}` : '';
    return { status: res.statusCode, body: res.json() as any, res }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  async upload(issueId: string, name: string, bytes: Buffer | string, headers: Record<string, string> = {}) {
    const res = await this.app.inject({
      method: 'POST',
      url: `/api/issues/${issueId}/attachments`,
      payload: typeof bytes === 'string' ? Buffer.from(bytes) : bytes,
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), [CSRF_HEADER]: CSRF_VALUE, ...(this.cookie ? { cookie: this.cookie } : {}), ...headers },
    });
    return { status: res.statusCode, body: res.json() as any }; // eslint-disable-line @typescript-eslint/no-explicit-any
  }

  download(id: string, query = '') {
    return this.app.inject({ method: 'GET', url: `/api/files/${id}${query}`, headers: this.cookie ? { cookie: this.cookie } : {} });
  }

  rpc(method: string, ...args: unknown[]) {
    return this.call('POST', `/api/rpc/${method}`, { args });
  }

  async login(email: string, password = DEMO_PASSWORD) {
    return this.call('POST', '/api/auth/login', { email, password });
  }
}

describe('accounts', () => {
  it('registers an organization owner, signs in with a secure cookie, and rejects bad sign-ups', async () => {
    const { app } = await server();
    const c = new Client(app);
    const weak = await c.call('POST', '/api/auth/register', { name: 'Ann', email: 'ann@x.com', password: 'short', orgName: 'Ann Co' });
    expect(weak.status).toBe(400);

    const ok = await c.call('POST', '/api/auth/register', { name: 'Ann Lee', email: 'Ann@X.com', password: 'a-long-passphrase', orgName: 'Ann Co' });
    expect(ok.status).toBe(200);
    expect(ok.body.orgs[0]).toMatchObject({ name: 'Ann Co', slug: 'ann-co' });
    const cookie = ok.res.cookies.find((x) => x.name === 'abg_session')!;
    expect(cookie.httpOnly).toBe(true);
    expect(cookie.sameSite).toBe('Lax');

    const me = await c.call('GET', '/api/auth/me');
    expect(me.body.user.email).toBe('ann@x.com');
    expect(JSON.stringify(me.body)).not.toMatch(/password|hash/i);

    const dup = await new Client(app).call('POST', '/api/auth/register', { name: 'Other', email: 'ann@x.com', password: 'another-long-one', orgName: 'Second' });
    expect(dup.status).toBe(409);

    // a second organization with the same name gets its own link name; reserved names are avoided
    const c2 = new Client(app);
    const second = await c2.call('POST', '/api/auth/register', { name: 'Bo', email: 'bo@x.com', password: 'a-long-passphrase', orgName: 'Ann Co' });
    expect(second.body.orgs[0].slug).toBe('ann-co-2');
    const reserved = await new Client(app).call('POST', '/api/auth/register', { name: 'Cy', email: 'cy@x.com', password: 'a-long-passphrase', orgName: 'Forms' });
    expect(reserved.body.orgs[0].slug).not.toBe('forms');
  });

  it('signs in and out; wrong passwords and unknown users look identical; attempts are throttled', async () => {
    const { app } = await server({ demo: true });
    const c = new Client(app);
    const wrong = await c.login('alex@acme.dev', 'not-the-password');
    const unknown = await c.login('nobody@acme.dev', 'not-the-password');
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    expect(wrong.body).toEqual(unknown.body);

    expect((await c.login('ALEX@acme.dev')).status).toBe(200);
    expect((await c.call('GET', '/api/auth/me')).status).toBe(200);
    await c.call('POST', '/api/auth/logout');
    expect((await c.call('GET', '/api/auth/me')).status).toBe(401);

    const attacker = new Client(app);
    let last = 0;
    for (let i = 0; i < 10; i++) last = (await attacker.login('priya@acme.dev', `guess-${i}-xxxxxxxx`)).status;
    expect(last).toBe(429);
    // even the right password is refused while throttled
    expect((await attacker.login('priya@acme.dev')).status).toBe(429);
  });

  it('changes passwords and signs out other sessions', async () => {
    const { app } = await server({ demo: true });
    const a = new Client(app);
    const b = new Client(app);
    await a.login('sam@acme.dev');
    await b.login('sam@acme.dev');
    expect((await a.call('POST', '/api/auth/password', { current: 'wrong', next: 'a-brand-new-pass' })).status).toBe(403);
    expect((await a.call('POST', '/api/auth/password', { current: DEMO_PASSWORD, next: 'short' })).status).toBe(400);
    expect((await a.call('POST', '/api/auth/password', { current: DEMO_PASSWORD, next: 'a-brand-new-pass' })).status).toBe(200);
    expect((await a.call('GET', '/api/auth/me')).status).toBe(200); // this session stays
    expect((await b.call('GET', '/api/auth/me')).status).toBe(401); // the other is signed out
    expect((await new Client(app).login('sam@acme.dev')).status).toBe(401); // old password is dead
    expect((await new Client(app).login('sam@acme.dev', 'a-brand-new-pass')).status).toBe(200);
  });
});

describe('request protection', () => {
  it('requires the custom header, a session, and a known method', async () => {
    const { app } = await server({ demo: true });
    const noHeader = await app.inject({ method: 'POST', url: '/api/auth/login', payload: { email: 'alex@acme.dev', password: DEMO_PASSWORD } });
    expect(noHeader.statusCode).toBe(403);

    const anon = new Client(app);
    expect((await anon.rpc('listOrganizations')).status).toBe(401);
    await anon.login('alex@acme.dev');
    expect((await anon.rpc('listOrganizations')).status).toBe(200);
    for (const bad of ['nope', 'constructor', '__proto__', 'snapshot', 'save']) expect((await anon.rpc(bad)).status).toBe(404);

    const health = await app.inject({ method: 'GET', url: '/api/health' });
    expect(health.headers['x-content-type-options']).toBe('nosniff');
    expect(health.headers['x-frame-options']).toBe('DENY');
  });

  it('cannot be tricked into acting as someone else', async () => {
    const { app } = await server({ demo: true });
    const maya = new Client(app); // guest in Northwind
    await maya.login('maya@northwind.io');
    const orgs = (await maya.rpc('listOrganizations')).body.result;
    expect(orgs.map((o: { slug: string }) => o.slug)).toEqual(['northwind']);

    const nw = (await maya.rpc('loadOrg', 'org_nw')).body.result;
    const issue = nw.issues[0];
    // extra argument = an attempt to pass an actor id: rejected outright
    const spoof = await maya.rpc('updateIssue', issue.id, { title: 'hacked' }, 'u_jordan');
    expect(spoof.status).toBe(400);
    // the actor is always the signed-in user: a guest may not edit
    const edit = await maya.rpc('updateIssue', issue.id, { title: 'hacked' });
    expect(edit.status).toBe(403);
    // and a body field named like an actor is simply ignored
    const spoof2 = await maya.call('POST', '/api/rpc/updateIssue', { args: [issue.id, { title: 'x' }], actorId: 'u_jordan', userId: 'u_jordan' });
    expect(spoof2.status).toBe(403);
  });
});

describe('tenant isolation', () => {
  it('never lets one organization read or change another’s data', async () => {
    const { app } = await server({ demo: true });
    const maya = new Client(app);
    await maya.login('maya@northwind.io');
    expect((await maya.rpc('loadOrg', 'org_acme')).status).toBe(403);

    const jordan = new Client(app);
    await jordan.login('jordan@northwind.io');
    const acme = new Client(app);
    await acme.login('alex@acme.dev');
    const acmeData = (await acme.rpc('loadOrg', 'org_acme')).body.result;
    const acmeIssue = acmeData.issues.find((i: { key: string }) => i.key === 'PLT-3');

    // guessing ids from another organization is refused for every kind of write
    expect((await jordan.rpc('updateIssue', acmeIssue.id, { title: 'x' })).status).toBe(403);
    expect((await jordan.rpc('deleteIssue', acmeIssue.id)).status).toBe(403);
    expect((await jordan.rpc('addComment', acmeIssue.id, 'hi')).status).toBe(403);
    expect((await jordan.rpc('createIssue', 'org_acme', { projectId: acmeIssue.projectId, typeId: 'task', title: 'x' })).status).toBe(403);
    expect((await jordan.rpc('startSprint', 'sp_9')).status).toBe(403);
    expect((await jordan.rpc('createRule', acmeIssue.projectId, { name: 'x', trigger: { type: 'issue_created' }, conditions: [], actions: [{ type: 'add_label', value: 'x' }] })).status).toBe(403);
    expect((await jordan.rpc('markNotificationRead', 'n1')).status).toBe(404);

    // creating in your own org but pointing at a foreign project / parent / blocker is refused too
    const own = (await jordan.rpc('loadOrg', 'org_nw')).body.result;
    const ownProject = own.projects[0];
    const foreignProject = await jordan.rpc('createIssue', 'org_nw', { projectId: acmeIssue.projectId, typeId: 'task', title: 'x' });
    expect(foreignProject.status).toBe(404);
    const foreignParent = await jordan.rpc('createIssue', 'org_nw', { projectId: ownProject.id, typeId: 'task', title: 'x', parentId: acmeIssue.id });
    expect(foreignParent.status).toBe(404);
    const foreignBlocker = await jordan.rpc('createIssue', 'org_nw', { projectId: ownProject.id, typeId: 'task', title: 'x', blockedBy: [acmeIssue.id] });
    expect(foreignBlocker.status).toBe(404);

    // Acme data is untouched
    const after = (await acme.rpc('loadOrg', 'org_acme')).body.result.issues.find((i: { key: string }) => i.key === 'PLT-3');
    expect(after.title).toBe(acmeIssue.title);
  });

  it('keeps per-user data private inside an organization', async () => {
    const { app } = await server({ demo: true });
    const priya = new Client(app);
    const sam = new Client(app);
    await priya.login('priya@acme.dev');
    await sam.login('sam@acme.dev');
    const p = (await priya.rpc('loadOrg', 'org_acme')).body.result;
    const s = (await sam.rpc('loadOrg', 'org_acme')).body.result;
    expect(p.notifications.every((n: { userId: string }) => n.userId === 'u_priya')).toBe(true);
    expect(s.notifications.every((n: { userId: string }) => n.userId === 'u_sam')).toBe(true);
    // Alex's private saved filter is invisible to Sam, the shared one is visible
    expect(s.filters.map((f: { name: string }) => f.name)).not.toContain('My overdue work');
    expect(s.filters.map((f: { name: string }) => f.name)).toContain('Critical bugs');
    expect((await sam.rpc('markNotificationRead', p.notifications[0]?.id ?? 'x')).status).toBeGreaterThanOrEqual(400);
  });
});

describe('persistence', () => {
  it('writes changes to the database and survives a restart', async () => {
    const { app, db } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const org = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    const created = await alex.rpc('createIssue', 'org_acme', { projectId: org.projects[0].id, typeId: 'task', title: 'Persist me', priority: 'high' });
    expect(created.status).toBe(200);
    await alex.rpc('addComment', created.body.result.id, 'a comment');
    await alex.rpc('deleteIssue', org.issues.find((i: { key: string }) => i.key === 'PLT-10').id);

    // a brand new server process reading the same database sees everything
    const store2 = await PostgresSnapshotStore.open(db);
    const repo2 = new LocalRepository(store2);
    await store2.ensureOrg('org_acme'); // organization data is loaded on demand
    const reloaded = await repo2.loadOrg('org_acme', 'u_alex');
    expect(reloaded.issues.some((i) => i.title === 'Persist me')).toBe(true);
    expect(reloaded.comments.some((c) => c.body === 'a comment')).toBe(true);
    expect(reloaded.issues.some((i) => i.key === 'PLT-10')).toBe(false);
    // sessions and passwords were stored too
    expect((await new Client(app).login('alex@acme.dev')).status).toBe(200);
  });

  it('rolls memory back when the database write fails, so memory never runs ahead', async () => {
    const ctx = await server({ demo: true });
    const alex = new Client(ctx.app);
    await alex.login('alex@acme.dev');
    const org = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    ctx.breakWrites(true);
    const failed = await alex.rpc('createIssue', 'org_acme', { projectId: org.projects[0].id, typeId: 'task', title: 'Ghost issue' });
    expect(failed.status).toBe(500);
    expect(failed.body.error).not.toMatch(/disk full/); // internals are not leaked
    ctx.breakWrites(false);
    const after = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    expect(after.issues.some((i: { title: string }) => i.title === 'Ghost issue')).toBe(false);
    // and the next write works
    expect((await alex.rpc('createIssue', 'org_acme', { projectId: org.projects[0].id, typeId: 'task', title: 'Real issue' })).status).toBe(200);
  });
});

describe('loading organizations on demand', () => {
  it('starts with nothing loaded and loads only the organization being used', async () => {
    const first = await server({ demo: true });
    expect(first.store.loadedOrgCount).toBe(2);

    const { app, store } = await restart(first, { max: 10, idleMs: 60_000 });
    expect(store.loadedOrgCount).toBe(0);
    expect(store.load().issues).toHaveLength(0); // no business data in memory yet
    expect(store.load().users.length).toBeGreaterThan(0); // only the small shared tables

    const alex = new Client(app);
    expect((await alex.login('alex@acme.dev')).status).toBe(200); // sessions & passwords come from the database
    const acme = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    expect(acme.issues.length).toBeGreaterThan(30);
    expect(store.loadedOrgCount).toBe(1);
    expect(store.load().issues.every((i) => i.orgId === 'org_acme')).toBe(true); // Northwind's data is not in memory
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json().loadedOrganizations).toBe(1);

    const nw = (await alex.rpc('loadOrg', 'org_nw')).body.result;
    expect(nw.issues.length).toBeGreaterThan(5);
    expect(store.loadedOrgCount).toBe(2);
  });

  it('drops least-recently-used organizations without losing any changes', async () => {
    const first = await server({ demo: true });
    const { app, store } = await restart(first, { max: 1, idleMs: 60 * 60_000 });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');

    const acme = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    const issue = acme.issues.find((i: { key: string }) => i.key === 'PLT-3');
    await alex.rpc('updateIssue', issue.id, { title: 'Edited before eviction' });
    await alex.rpc('addComment', issue.id, 'comment before eviction');
    const doomed = acme.issues.find((i: { key: string }) => i.key === 'PLT-10');
    await alex.rpc('deleteIssue', doomed.id);

    await alex.rpc('loadOrg', 'org_nw'); // cap is 1: Acme must go
    expect(store.isLoaded('org_acme')).toBe(false);
    expect(store.isLoaded('org_nw')).toBe(true);
    expect(store.load().issues.every((i) => i.orgId === 'org_nw')).toBe(true);

    const back = (await alex.rpc('loadOrg', 'org_acme')).body.result; // loaded again from PostgreSQL
    expect(back.issues.find((i: { id: string }) => i.id === issue.id).title).toBe('Edited before eviction');
    expect(back.comments.some((c: { body: string }) => c.body === 'comment before eviction')).toBe(true);
    expect(back.issues.some((i: { id: string }) => i.id === doomed.id)).toBe(false); // the deletion was kept too
    expect(store.loadedOrgCount).toBe(1);
  });

  it('also drops organizations that have been idle', async () => {
    const first = await server({ demo: true });
    const { app, store } = await restart(first, { max: 10, idleMs: 0 });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    await alex.rpc('loadOrg', 'org_acme');
    await new Promise((r) => setTimeout(r, 5));
    await alex.rpc('loadOrg', 'org_nw');
    expect(store.isLoaded('org_acme')).toBe(false); // idle, and not the one in use
    expect(store.isLoaded('org_nw')).toBe(true);
  });

  it('still refuses foreign record ids when their organization was not in memory', async () => {
    const first = await server({ demo: true });
    const acmeIssue = (await new Client(first.app).login('alex@acme.dev')) && first.store.load().issues.find((i) => i.key === 'PLT-3')!;
    const { app, store } = await restart(first, { max: 1, idleMs: 60_000 });
    const jordan = new Client(app);
    await jordan.login('jordan@northwind.io');
    expect(store.loadedOrgCount).toBe(0);
    expect((await jordan.rpc('updateIssue', acmeIssue.id, { title: 'nope' })).status).toBe(403);
    expect((await jordan.rpc('deleteIssue', acmeIssue.id)).status).toBe(403);
    expect((await jordan.rpc('updateIssue', 'no-such-issue', { title: 'x' })).status).toBe(404);
    // nothing changed
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const after = (await alex.rpc('loadOrg', 'org_acme')).body.result.issues.find((i: { id: string }) => i.id === acmeIssue.id);
    expect(after.title).toBe(acmeIssue.title);
  });

  it('keeps memory bounded as the number of organizations grows', async () => {
    const first = await server();
    const { app, store } = await restart(first, { max: 3, idleMs: 60 * 60_000 });
    const people: { client: Client; orgId: string; project: string }[] = [];
    for (let i = 0; i < 10; i++) { // sign-up is limited to 10 per hour per address
      const c = new Client(app);
      const r = await c.call('POST', '/api/auth/register', { name: `Owner ${i}`, email: `owner${i}@co${i}.test`, password: 'a-long-passphrase', orgName: `Company ${i}` });
      expect(r.status).toBe(200);
      const orgId = r.body.orgs[0].id;
      const p = await c.rpc('createProject', orgId, { name: `Project ${i}`, key: `P${i}X`, description: '', color: '#0f766e', workStyle: 'flow' });
      expect(p.status).toBe(200);
      await c.rpc('createIssue', orgId, { projectId: p.body.result.id, typeId: 'task', title: `Secret of company ${i}` });
      people.push({ client: c, orgId, project: p.body.result.id });
      expect(store.loadedOrgCount).toBeLessThanOrEqual(3);
    }
    // everyone still sees exactly their own data, even though most organizations were evicted along the way
    for (const [i, p] of people.entries()) {
      const data = (await p.client.rpc('loadOrg', p.orgId)).body.result;
      expect(data.issues.map((x: { title: string }) => x.title)).toEqual([`Secret of company ${i}`]);
      expect(store.loadedOrgCount).toBeLessThanOrEqual(3);
    }
  });
});

describe('invitations and members', () => {
  it('invites a new person, who joins with the invited role; links are single use', async () => {
    const { app } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const inv = await alex.call('POST', '/api/orgs/org_acme/invites', { email: 'New.Person@Example.com', role: 'member' });
    expect(inv.status).toBe(200);
    const token = inv.body.link.split('/invite/')[1];

    const anon = new Client(app);
    const view = await anon.call('GET', `/api/invites/${token}`);
    expect(view.body).toMatchObject({ orgName: 'Acme Software', email: 'new.person@example.com', role: 'member', existingAccount: false });
    expect((await anon.call('GET', '/api/invites/not-a-token')).status).toBe(404);

    expect((await anon.call('POST', `/api/invites/${token}/accept`, { name: 'Newt', password: 'short' })).status).toBe(400);
    const accepted = await anon.call('POST', `/api/invites/${token}/accept`, { name: 'Newt Person', password: 'a-long-passphrase' });
    expect(accepted.status).toBe(200);
    expect(accepted.body.orgSlug).toBe('acme');
    const org = (await anon.rpc('loadOrg', 'org_acme')).body.result;
    expect(org.members.find((m: { email: string }) => m.email === 'new.person@example.com').role).toBe('member');

    expect((await new Client(app).call('GET', `/api/invites/${token}`)).status).toBe(404); // used up
    expect((await alex.call('GET', '/api/orgs/org_acme/invites')).body.invites).toHaveLength(0);
  });

  it('enforces who may invite, and handles existing accounts', async () => {
    const { app } = await server({ demo: true });
    const sam = new Client(app); // member
    const priya = new Client(app); // admin
    const alex = new Client(app); // owner
    await sam.login('sam@acme.dev');
    await priya.login('priya@acme.dev');
    await alex.login('alex@acme.dev');
    expect((await sam.call('POST', '/api/orgs/org_acme/invites', { email: 'a@b.co', role: 'member' })).status).toBe(403);
    expect((await priya.call('POST', '/api/orgs/org_acme/invites', { email: 'a@b.co', role: 'owner' })).status).toBe(403);
    expect((await priya.call('POST', '/api/orgs/org_acme/invites', { email: 'a@b.co', role: 'admin' })).status).toBe(200);
    expect((await alex.call('POST', '/api/orgs/org_acme/invites', { email: 'sam@acme.dev', role: 'member' })).status).toBe(409); // already in
    expect((await new Client(app).call('POST', '/api/orgs/org_acme/invites', { email: 'a@b.co', role: 'member' })).status).toBe(401);
    expect((await new Client(app).call('GET', '/api/orgs/org_acme/invites')).status).toBe(401);

    // Maya already has an account: she must be signed in as herself to accept
    const inv = await alex.call('POST', '/api/orgs/org_acme/invites', { email: 'maya@northwind.io', role: 'guest' });
    const token = inv.body.link.split('/invite/')[1];
    const stranger = new Client(app);
    expect((await stranger.call('POST', `/api/invites/${token}/accept`, {})).status).toBe(409);
    const maya = new Client(app);
    await maya.login('maya@northwind.io');
    expect((await maya.call('POST', `/api/invites/${token}/accept`, {})).status).toBe(200);
    expect((await maya.rpc('listOrganizations')).body.result.map((o: { slug: string }) => o.slug).sort()).toEqual(['acme', 'northwind']);
  });

  it('protects owners and the last owner', async () => {
    const { app } = await server({ demo: true });
    const alex = new Client(app);
    const priya = new Client(app);
    await alex.login('alex@acme.dev');
    await priya.login('priya@acme.dev');
    expect((await priya.rpc('updateMemberRole', 'org_acme', 'u_alex', 'member')).status).toBe(403); // admin can't touch the owner
    expect((await priya.rpc('removeMember', 'org_acme', 'u_alex')).status).toBe(403);
    expect((await alex.rpc('updateMemberRole', 'org_acme', 'u_alex', 'admin')).status).toBe(400); // last owner
    expect((await alex.rpc('removeMember', 'org_acme', 'u_alex')).status).toBe(400);
    expect((await alex.rpc('updateMemberRole', 'org_acme', 'u_sam', 'admin')).status).toBe(200);
    expect((await alex.rpc('updateMemberRole', 'org_acme', 'u_sam', 'superuser')).status).toBe(400);

    // removing a member unassigns their work
    expect((await alex.rpc('removeMember', 'org_acme', 'u_sam')).status).toBe(200);
    const org = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    expect(org.members.some((m: { id: string }) => m.id === 'u_sam')).toBe(false);
    expect(org.issues.every((i: { assigneeId?: string }) => i.assigneeId !== 'u_sam')).toBe(true);
    const sam = new Client(app);
    await sam.login('sam@acme.dev');
    expect((await sam.rpc('loadOrg', 'org_acme')).status).toBe(403); // access is gone immediately
  });
});

const emailsTo = (m: Mailer, to: string) => (m as ConsoleMailer).outbox.filter((x) => x.to === to);
const linkIn = (text: string) => /https?:\/\/\S+/.exec(text)![0];

describe('password reset by email', () => {
  it('emails a one-time link, sets a new password, and signs everything else out', async () => {
    const { app, mailer } = await server({ demo: true });
    const anon = new Client(app);
    const known = await anon.call('POST', '/api/auth/forgot', { email: 'Sam@acme.dev' });
    const unknown = await anon.call('POST', '/api/auth/forgot', { email: 'nobody@acme.dev' });
    expect(known.status).toBe(200);
    expect(unknown.body).toEqual(known.body); // no way to tell who has an account
    await new Promise((r) => setTimeout(r, 20));
    expect(emailsTo(mailer, 'nobody@acme.dev')).toHaveLength(0);
    const mail = emailsTo(mailer, 'sam@acme.dev');
    expect(mail).toHaveLength(1);
    const token = linkIn(mail[0].text).split('/reset/')[1];

    const stillSignedIn = new Client(app);
    await stillSignedIn.login('sam@acme.dev');

    expect((await anon.call('POST', `/api/auth/reset/${token}`, { password: 'short' })).status).toBe(400);
    expect((await anon.call('POST', '/api/auth/reset/not-a-token', { password: 'a-brand-new-pass' })).status).toBe(404);
    expect((await anon.call('POST', `/api/auth/reset/${token}`, { password: 'a-brand-new-pass' })).status).toBe(200);
    // single use
    expect((await anon.call('POST', `/api/auth/reset/${token}`, { password: 'yet-another-pass1' })).status).toBe(404);

    expect((await new Client(app).login('sam@acme.dev')).status).toBe(401); // old password dead
    expect((await new Client(app).login('sam@acme.dev', 'a-brand-new-pass')).status).toBe(200);
    expect((await stillSignedIn.call('GET', '/api/auth/me')).status).toBe(401); // old sessions ended
  });

  it('expires links, replaces older ones, and limits how often it emails', async () => {
    const { app, db, mailer } = await server({ demo: true });
    const anon = new Client(app);
    await anon.call('POST', '/api/auth/forgot', { email: 'priya@acme.dev' });
    await anon.call('POST', '/api/auth/forgot', { email: 'priya@acme.dev' });
    await new Promise((r) => setTimeout(r, 20));
    const mails = emailsTo(mailer, 'priya@acme.dev');
    expect(mails).toHaveLength(2);
    const [newest, older] = mails.map((m) => linkIn(m.text).split('/reset/')[1]);
    expect((await anon.call('POST', `/api/auth/reset/${older}`, { password: 'a-brand-new-pass' })).status).toBe(404); // replaced

    await db.query(`update password_resets set expires_at = now() - interval '1 minute'`);
    expect((await anon.call('POST', `/api/auth/reset/${newest}`, { password: 'a-brand-new-pass' })).status).toBe(404); // expired

    // third and fourth requests for the same address: the answer is identical, but only 3 emails go out per hour
    await anon.call('POST', '/api/auth/forgot', { email: 'priya@acme.dev' });
    expect((await anon.call('POST', '/api/auth/forgot', { email: 'priya@acme.dev' })).status).toBe(200);
    await new Promise((r) => setTimeout(r, 20));
    expect(emailsTo(mailer, 'priya@acme.dev')).toHaveLength(3);
  });

  it('keeps working when the mail server is down', async () => {
    const failing: Mailer = { kind: 'smtp', send: () => Promise.reject(new Error('smtp unreachable')) };
    const ctx = await server({ demo: true, mailer: failing });
    const anon = new Client(ctx.app);
    expect((await anon.call('POST', '/api/auth/forgot', { email: 'sam@acme.dev' })).status).toBe(200);
    const alex = new Client(ctx.app);
    await alex.login('alex@acme.dev');
    const inv = await alex.call('POST', '/api/orgs/org_acme/invites', { email: 'x@y.co', role: 'member' });
    expect(inv.status).toBe(200);
    expect(inv.body.link).toContain('/invite/'); // the link is still returned for manual sharing
    await new Promise((r) => setTimeout(r, 20));
    expect(ctx.mailErrors.length).toBeGreaterThan(0); // and the failure was reported, not swallowed silently
  });

  it('emails invitations when email is available', async () => {
    const { app, mailer } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    await alex.call('POST', '/api/orgs/org_acme/invites', { email: 'new@y.co', role: 'guest' });
    await new Promise((r) => setTimeout(r, 20));
    const [mail] = emailsTo(mailer, 'new@y.co');
    expect(mail.subject).toMatch(/Alex Rivera invited you to Acme Software/);
    expect(mail.text).toContain('/invite/');
  });
});

describe('mail logging', () => {
  it('never writes reset or invitation links to the log in production mode', async () => {
    const lines: string[] = [];
    const quiet = new ConsoleMailer((l) => lines.push(l), false);
    await quiet.send({ to: 'a@b.co', subject: 'Reset', text: 'link: https://x/reset/SECRET-TOKEN' });
    expect(lines.join('\n')).not.toMatch(/SECRET-TOKEN|a@b\.co/);
    expect(quiet.outbox).toHaveLength(0);

    const dev = new ConsoleMailer((l) => lines.push(l), true);
    await dev.send({ to: 'a@b.co', subject: 'Reset', text: 'link: https://x/reset/DEV-TOKEN' });
    expect(lines.join('\n')).toContain('DEV-TOKEN'); // developers can still see it locally
  });
});

describe('closed sign-up', () => {
  it('lets only invited people in when new workspaces are disabled', async () => {
    const { app } = await server({ demo: true, allowSignup: false });
    const c = new Client(app);
    expect((await c.call('GET', '/api/config')).body.allowSignup).toBe(false);
    const reg = await c.call('POST', '/api/auth/register', { name: 'Eve', email: 'eve@x.com', password: 'a-long-passphrase', orgName: 'Evil Inc' });
    expect(reg.status).toBe(403);
    // invitations still work
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const inv = await alex.call('POST', '/api/orgs/org_acme/invites', { email: 'eve@x.com', role: 'member' });
    const token = inv.body.link.split('/invite/')[1];
    expect((await c.call('POST', `/api/invites/${token}/accept`, { name: 'Eve', password: 'a-long-passphrase' })).status).toBe(200);
  });
});

describe('serving the web app', () => {
  const site = () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'abg-site-'));
    mkdirSync(path.join(dir, 'assets'));
    writeFileSync(path.join(dir, 'index.html'), '<!doctype html><title>ABG</title><div id="root"></div>');
    writeFileSync(path.join(dir, 'assets', 'app-abc123.js'), 'console.log(1)');
    return dir;
  };

  it('serves the app, falls back to it for deep links, and keeps the API separate', async () => {
    const { app } = await server({ staticDir: site(), production: true });
    const root = await app.inject({ method: 'GET', url: '/', headers: { accept: 'text/html' } });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain('<div id="root">');
    expect(root.headers['cache-control']).toBe('no-cache');

    const asset = await app.inject({ method: 'GET', url: '/assets/app-abc123.js' });
    expect(asset.statusCode).toBe(200);
    expect(asset.headers['cache-control']).toContain('immutable');

    const deep = await app.inject({ method: 'GET', url: '/acme/p/PLT/board', headers: { accept: 'text/html,application/xhtml+xml' } });
    expect(deep.statusCode).toBe(200);
    expect(deep.body).toContain('<div id="root">');
    expect(String(deep.headers['content-security-policy'])).toContain("default-src 'self'");
    expect(String(deep.headers['content-security-policy'])).toContain("frame-ancestors 'none'");
    expect(String(deep.headers['strict-transport-security'])).toContain('max-age');

    expect((await app.inject({ method: 'GET', url: '/api/unknown', headers: { accept: 'text/html' } })).statusCode).toBe(404); // not the app
    expect((await app.inject({ method: 'GET', url: '/missing.png' })).statusCode).toBe(404);
    expect((await app.inject({ method: 'GET', url: '/api/health' })).json()).toMatchObject({ ok: true });
    // no dev tools in production
    expect((await app.inject({ method: 'GET', url: '/api/dev/outbox' })).statusCode).toBe(404);
  });
});

describe('configuration checks', () => {
  const good = { NODE_ENV: 'production', PUBLIC_URL: 'https://tracker.example.com', DATABASE_URL: 'postgres://u:p@db/abg' };
  it('accepts a complete production setup', () => {
    const c = loadConfig(good);
    expect(c).toMatchObject({ production: true, allowSignup: true, trustProxy: false, host: '0.0.0.0', publicUrl: 'https://tracker.example.com' });
  });
  it('refuses unsafe production settings, naming every problem', () => {
    expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/PUBLIC_URL is required/);
    expect(() => loadConfig({ ...good, PUBLIC_URL: 'http://tracker.example.com' })).toThrow(/https/);
    expect(() => loadConfig({ ...good, SEED_DEMO: '1' })).toThrow(/SEED_DEMO/);
    expect(() => loadConfig({ ...good, SMTP_URL: 'not a url' })).toThrow(/SMTP_URL/);
    expect(() => loadConfig({ ...good, PORT: '99999' })).toThrow(/PORT/);
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://x.io' })).not.toThrow();
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://x.io', REQUIRE_POSTGRES: '1' })).toThrow(/DATABASE_URL is required/);
    expect(() => loadConfig({ NODE_ENV: 'production', PUBLIC_URL: 'https://x.io', ALLOW_EMBEDDED_DB: '0' })).toThrow(/DATABASE_URL is required/);
  });
  it('is relaxed in development', () => {
    expect(loadConfig({})).toMatchObject({ production: false, host: '127.0.0.1', port: 4000 });
  });
});

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('fake-but-valid-looking-png-body')]);
const filesOnDisk = (dir: string): string[] => {
  const out: string[] = [];
  const walk = (d: string) => {
    for (const e of readdirSync(d, { withFileTypes: true })) (e.isDirectory() ? walk(path.join(d, e.name)) : out.push(path.join(d, e.name)));
  };
  walk(dir);
  return out;
};
const issueId = async (c: Client, org: string, key: string) => ((await c.rpc('loadOrg', org)).body.result.issues.find((i: { key: string }) => i.key === key) as { id: string }).id;

describe('file attachments', () => {
  it('uploads, lists, downloads and previews a file', async () => {
    const { app, filesDir } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');

    const up = await alex.upload(id, 'Design mock.png', PNG);
    expect(up.status).toBe(200);
    const att = up.body.attachment;
    expect(att).toMatchObject({ name: 'Design mock.png', size: PNG.length, mime: 'image/png', uploaderId: 'u_alex', issueId: id });
    expect(att.storageKey).toBeUndefined(); // where it's stored is never sent to a browser
    expect(att.sha256).toMatch(/^[a-f0-9]{64}$/);
    expect(filesOnDisk(filesDir)).toHaveLength(1);

    const listed = (await alex.rpc('loadOrg', 'org_acme')).body.result.attachments;
    expect(listed).toHaveLength(1);
    expect(JSON.stringify(listed)).not.toContain('storageKey');

    const dl = await alex.download(att.id);
    expect(dl.statusCode).toBe(200);
    expect(Buffer.compare(dl.rawPayload, PNG)).toBe(0);
    expect(dl.headers['content-disposition']).toContain('attachment');
    expect(dl.headers['content-type']).toBe('application/octet-stream');
    expect(dl.headers['x-content-type-options']).toBe('nosniff');
    expect(String(dl.headers['content-security-policy'])).toContain('sandbox');

    const preview = await alex.download(att.id, '?inline=1');
    expect(preview.headers['content-type']).toBe('image/png');
    expect(String(preview.headers['content-disposition'])).toContain('inline');
    // the upload shows in the item's history
    const activity = (await alex.rpc('loadOrg', 'org_acme')).body.result.activity;
    expect(activity.some((a: { issueId: string; field?: string; to?: string }) => a.issueId === id && a.field === 'attachment' && a.to === 'Design mock.png')).toBe(true);
  });

  it('never shows anything but a verified raster image inline, whatever it is called', async () => {
    const { app } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    const tricks: [string, string][] = [
      ['page.html', '<script>alert(1)</script>'],
      ['logo.svg', '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>'],
      ['photo.png', 'this is plain text pretending to be a PNG'],
      ['note.txt', 'hello'],
    ];
    for (const [name, body] of tricks) {
      const up = await alex.upload(id, name, body);
      expect(up.status, name).toBe(200);
      expect(up.body.attachment.mime, name).toBe('application/octet-stream'); // decided by the bytes, not the name
      const r = await alex.download(up.body.attachment.id, '?inline=1');
      expect(r.headers['content-type'], name).toBe('application/octet-stream');
      expect(String(r.headers['content-disposition']), name).toContain('attachment');
    }
  });

  it('checks who may upload, download and delete', async () => {
    const { app, filesDir } = await server({ demo: true });
    const alex = new Client(app); // owner of Acme
    const sam = new Client(app); // member
    const priya = new Client(app); // admin
    const maya = new Client(app); // Northwind guest
    const jordan = new Client(app); // Northwind owner
    for (const [c, e] of [[alex, 'alex@acme.dev'], [sam, 'sam@acme.dev'], [priya, 'priya@acme.dev'], [maya, 'maya@northwind.io'], [jordan, 'jordan@northwind.io']] as const) await c.login(e);
    const acmeIssue = await issueId(alex, 'org_acme', 'PLT-3');
    const nwIssue = await issueId(jordan, 'org_nw', 'LCH-3');

    // anonymous upload is refused (before the body is read), as is a guest, and a stranger from another organization
    expect((await new Client(app).upload(acmeIssue, 'a.txt', 'x')).status).toBe(401);
    expect((await maya.upload(nwIssue, 'a.txt', 'x')).status).toBe(403);
    expect((await jordan.upload(acmeIssue, 'a.txt', 'x')).status).toBe(403);
    expect((await alex.upload('no-such-issue', 'a.txt', 'x')).status).toBe(404);
    expect(filesOnDisk(filesDir)).toHaveLength(0); // nothing was written for any refused upload

    const mine = (await alex.upload(acmeIssue, 'plan.txt', 'the plan')).body.attachment;
    // a stranger can't tell the file exists
    expect((await jordan.download(mine.id)).statusCode).toBe(404);
    expect((await new Client(app).download(mine.id)).statusCode).toBe(401);
    expect((await jordan.download('att_unknown')).statusCode).toBe(404);
    // a colleague can read it (members, and even guests, can view), but not delete someone else's file
    expect((await sam.download(mine.id)).statusCode).toBe(200);
    expect((await sam.rpc('deleteAttachment', mine.id)).status).toBe(403);
    expect((await jordan.rpc('deleteAttachment', mine.id)).status).toBe(403);
    expect(filesOnDisk(filesDir)).toHaveLength(1);
    // an admin can; so can the uploader
    expect((await priya.rpc('deleteAttachment', mine.id)).status).toBe(200);
    expect(filesOnDisk(filesDir)).toHaveLength(0);
    const samFile = (await sam.upload(acmeIssue, 'sam.txt', 'sam')).body.attachment;
    expect((await sam.rpc('deleteAttachment', samFile.id)).status).toBe(200);
    expect(filesOnDisk(filesDir)).toHaveLength(0);
    expect((await sam.download(samFile.id)).statusCode).toBe(404); // gone for everyone, immediately
    expect(String((await alex.download((await alex.upload(acmeIssue, 'again.txt', 'x')).body.attachment.id)).headers['cache-control'])).toContain('no-cache'); // so a later removal can't be served from a cache
    expect((await sam.rpc('deleteAttachment', samFile.id)).status).toBe(404);
  });

  it('enforces size, type and count limits', async () => {
    const { app, filesDir } = await server({ demo: true, limits: { maxFileBytes: 1000, maxFilesPerIssue: 2, orgQuotaBytes: 1500 } });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    const other = await issueId(alex, 'org_acme', 'PLT-7');

    expect((await alex.upload(id, 'big.bin', Buffer.alloc(1001))).status).toBe(413);
    expect((await alex.upload(id, 'empty.txt', Buffer.alloc(0))).status).toBe(400);
    for (const bad of ['setup.exe', 'run.BAT', 'x.js', 'mac.dmg']) {
      const r = await alex.upload(id, bad, 'x');
      expect(r.status, bad).toBe(400);
      expect(r.body.error).toMatch(/can't be attached/);
    }
    expect(filesOnDisk(filesDir)).toHaveLength(0);

    expect((await alex.upload(id, 'one.txt', Buffer.alloc(600))).status).toBe(200);
    expect((await alex.upload(id, 'two.txt', Buffer.alloc(600))).status).toBe(200);
    const third = await alex.upload(id, 'three.txt', 'x');
    expect(third.status).toBe(400);
    expect(third.body.error).toMatch(/up to 2 files/);
    // organization quota (1500 bytes): 1200 used, so another 600 doesn't fit anywhere in the organization
    const over = await alex.upload(other, 'quota.txt', Buffer.alloc(600));
    expect(over.status).toBe(400);
    expect(over.body.error).toMatch(/storage .* is full/);
    expect(filesOnDisk(filesDir)).toHaveLength(2); // refused uploads leave no bytes behind
    expect((await alex.upload(other, 'small.txt', Buffer.alloc(200))).status).toBe(200);
  });

  it('cleans file names so they can never be paths or disguises', async () => {
    const { app, filesDir } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    const names: [string, string][] = [
      ['../../etc/passwd', 'passwd'],
      ['C:\\Users\\boss\\secret.docx', 'secret.docx'],
      ['report\u0000.pdf', 'report.pdf'],
      ['invoice\u202Efdp.exe', 'invoicefdp.exe'],
      ['.hidden', 'hidden'],
      ['   ', 'file'],
    ];
    for (const [raw, expected] of names) {
      const r = await alex.upload(id, raw, 'data');
      // blocked extensions are still blocked after cleaning
      if (expected.endsWith('.exe')) expect(r.status).toBe(400);
      else expect(r.body.attachment?.name, raw).toBe(expected);
    }
    const long = await alex.upload(id, 'x'.repeat(300) + '.pdf', 'data');
    expect(long.body.attachment.name.length).toBeLessThanOrEqual(120);
    expect(long.body.attachment.name.endsWith('.pdf')).toBe(true);
    // on disk the bytes live under random keys inside the organization folder, never under the given name
    for (const f of filesOnDisk(filesDir)) {
      expect(path.relative(filesDir, f).split(path.sep)[0]).toBe('org_acme');
      expect(path.basename(f)).toMatch(/^[a-f0-9]{32}$/);
    }
    // non-ASCII names download with a correct, encoded file name
    const uni = await alex.upload(id, 'Böckchen – Übersicht.pdf', 'data');
    const dl = await alex.download(uni.body.attachment.id);
    expect(String(dl.headers['content-disposition'])).toContain("filename*=UTF-8''B%C3%B6ckchen");
  });

  it('removes the stored bytes when an item is deleted, and keeps them when a save fails', async () => {
    const ctx = await server({ demo: true });
    const alex = new Client(ctx.app);
    await alex.login('alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    const keep = await issueId(alex, 'org_acme', 'PLT-7');
    await alex.upload(id, 'a.txt', 'aaa');
    await alex.upload(id, 'b.txt', 'bbb');
    await alex.upload(keep, 'c.txt', 'ccc');
    expect(filesOnDisk(ctx.filesDir!)).toHaveLength(3);

    // a failed save must neither lose files nor keep half an upload
    ctx.breakWrites(true);
    expect((await alex.upload(keep, 'ghost.txt', 'ghost')).status).toBe(500);
    expect((await alex.rpc('deleteIssue', id)).status).toBe(500);
    ctx.breakWrites(false);
    expect(filesOnDisk(ctx.filesDir!)).toHaveLength(3); // ghost.txt removed again, the doomed item's files still there
    expect((await alex.rpc('loadOrg', 'org_acme')).body.result.attachments).toHaveLength(3);

    expect((await alex.rpc('deleteIssue', id)).status).toBe(200);
    expect(filesOnDisk(ctx.filesDir!)).toHaveLength(1);
    const left = (await alex.rpc('loadOrg', 'org_acme')).body.result.attachments;
    expect(left.map((a: { name: string }) => a.name)).toEqual(['c.txt']);
  });

  it('survives a restart', async () => {
    const first = await server({ demo: true });
    const alex = new Client(first.app);
    await alex.login('alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    const att = (await alex.upload(id, 'keep.txt', 'still here')).body.attachment;

    const { app } = await restart(first, { max: 10, idleMs: 60_000 });
    const again = new Client(app);
    await again.login('alex@acme.dev');
    expect((await again.rpc('loadOrg', 'org_acme')).body.result.attachments.map((a: { id: string }) => a.id)).toEqual([att.id]);
    expect((await again.download(att.id)).payload).toBe('still here');
  });

  it('can be switched off', async () => {
    const real = await openDb({});
    await migrate(real);
    const store = await PostgresSnapshotStore.open(real);
    const repo = new LocalRepository(store);
    const app = await buildApp({ db: real, store, repo, accounts: new Accounts(real, store, repo.snapshot), config: { secureCookies: false, publicUrl: 'http://x', logger: false } });
    open.push({ app, db: real, store, breakWrites: () => undefined });
    expect((await new Client(app).call('GET', '/api/config')).body.attachments).toEqual({ enabled: false });
    expect((await new Client(app).upload('x', 'a.txt', 'a')).status).toBe(404);
  });
});

describe('file store', () => {
  it('stores under random keys and rejects anything that could escape its folder', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'abg-fs-'));
    tempDirs.push(dir);
    const fs = new FileStore(dir);
    const w = await fs.write('org_1', Buffer.from('hello'));
    expect(w.size).toBe(5);
    expect(w.sha256).toBe('2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824');
    expect(await fs.exists('org_1', w.key)).toBe(true);
    expect(await fs.exists('org_2', w.key)).toBe(false); // keys are per organization
    expect(() => fs.read('../../etc', w.key)).toThrow(/Invalid/);
    expect(() => fs.read('org_1', '../../../passwd')).toThrow(/Invalid/);
    expect(() => fs.read('org_1', 'ABCDEF')).toThrow(/Invalid/);
    await fs.remove('org_1', w.key);
    await fs.remove('org_1', w.key); // removing twice is fine
    expect(await fs.exists('org_1', w.key)).toBe(false);
  });
});

describe('public forms over the API', () => {
  it('accepts submissions without signing in, and exposes nothing else', async () => {
    const { app } = await server({ demo: true });
    const visitor = new Client(app);
    const form = await visitor.rpc('getPublicForm', 'acme', 'report-a-bug');
    expect(form.status).toBe(200);
    expect(JSON.stringify(form.body)).not.toMatch(/u_priya|createdBy|memberships|org_acme/);
    const sent = await visitor.rpc('submitForm', 'acme', 'report-a-bug', { q_title: 'Bug from outside', q_steps: 'steps' }, { name: 'Visitor', email: 'v@example.com' }, '');
    expect(sent.status).toBe(200);
    expect(sent.body.result.key).toMatch(/^PLT-/);
    expect((await visitor.rpc('getPublicForm', 'acme', 'missing')).status).toBe(404);
    expect((await visitor.rpc('loadOrg', 'org_acme')).status).toBe(401); // still locked out of everything else
  });
});

describe('thumbnails, comment files and request-form files', () => {
  const rawPost = (app: FastifyInstance, url: string, name: string, bytes: Buffer | string, cookie = '') =>
    app.inject({
      method: 'POST',
      url,
      payload: typeof bytes === 'string' ? Buffer.from(bytes) : bytes,
      headers: { 'content-type': 'application/octet-stream', 'x-file-name': encodeURIComponent(name), [CSRF_HEADER]: CSRF_VALUE, ...(cookie ? { cookie } : {}) },
    });

  const realJpeg = async (w = 800, h = 600) => {
    const sharp = (await import('sharp')).default;
    return sharp({ create: { width: w, height: h, channels: 3, background: '#f28c28' } })
      .jpeg()
      .withMetadata({ exif: { IFD0: { Copyright: 'secret-location-data' } } })
      .toBuffer();
  };

  it('makes small previews, strips hidden photo data, and refuses what it cannot safely open', async () => {
    const { app } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    const big = await realJpeg();
    expect(!!(await (await import('sharp')).default(big).metadata()).exif).toBe(true); // the original does carry hidden data
    const up = await alex.upload(id, 'photo.jpg', big);
    expect(up.body.attachment.mime).toBe('image/jpeg');

    const t = await alex.download(up.body.attachment.id, '?thumb=1');
    expect(t.statusCode).toBe(200);
    expect(t.headers['content-type']).toBe('image/webp');
    expect(t.rawPayload.length).toBeLessThan(big.length);
    const sharp = (await import('sharp')).default;
    const meta = await sharp(t.rawPayload).metadata();
    expect(Math.max(meta.width ?? 0, meta.height ?? 0)).toBeLessThanOrEqual(360);
    expect(meta.exif).toBeUndefined();
    expect((await alex.download(up.body.attachment.id, '?thumb=1')).statusCode).toBe(200); // second time comes from the cache

    // not a picture, or looks like one but is not
    const txt = await alex.upload(id, 'a.txt', 'hello');
    expect((await alex.download(txt.body.attachment.id, '?thumb=1')).statusCode).toBe(415);
    const fake = await alex.upload(id, 'fake.png', PNG);
    expect((await alex.download(fake.body.attachment.id, '?thumb=1')).statusCode).toBe(415);

    // other organizations cannot see it
    const other = new Client(app);
    await other.call('POST', '/api/auth/register', { name: 'Nora', email: 'nora@elsewhere.test', password: 'a-long-passphrase', orgName: 'Elsewhere Co' });
    expect((await other.download(up.body.attachment.id, '?thumb=1')).statusCode).toBe(404);
    expect((await new Client(app).download(up.body.attachment.id, '?thumb=1')).statusCode).toBe(401);
  });

  it('attaches files to a comment, only for its own author, and deletes them with the item', async () => {
    const { app, filesDir } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    const comment = (await alex.rpc('addComment', id, 'See screenshot')).body.result;

    const ok = await rawPost(app, `/api/issues/${id}/attachments?comment=${comment.id}`, 'shot.png', PNG, alex.cookie);
    expect(ok.statusCode).toBe(200);
    expect(ok.json().attachment.commentId).toBe(comment.id);

    // a different comment author cannot hang files on someone else's comment
    const priya = new Client(app);
    await priya.login('priya@acme.dev');
    const bad = await rawPost(app, `/api/issues/${id}/attachments?comment=${comment.id}`, 'x.png', PNG, priya.cookie);
    expect(bad.statusCode).toBeGreaterThanOrEqual(400);
    // a comment id from another item is refused
    const other = await issueId(alex, 'org_acme', 'PLT-4');
    expect((await rawPost(app, `/api/issues/${other}/attachments?comment=${comment.id}`, 'x.png', PNG, alex.cookie)).statusCode).toBeGreaterThanOrEqual(400);
    expect(filesOnDisk(filesDir)).toHaveLength(1);

    await alex.rpc('deleteIssue', id);
    expect(filesOnDisk(filesDir)).toHaveLength(0);
  });

  describe('request-form uploads', () => {
    const withFileQuestion = async (app: FastifyInstance) => {
      const alex = new Client(app);
      await alex.login('alex@acme.dev');
      const form = (await alex.rpc('loadOrg', 'org_acme')).body.result.forms.find((f: { slug: string }) => f.slug === 'report-a-bug');
      const fields = [...form.fields, { id: 'q_file', label: 'Screenshot', kind: 'file', required: false, target: 'description' }];
      const r = await alex.rpc('updateForm', form.id, { fields });
      expect(r.status, JSON.stringify(r.body)).toBe(200);
      return alex;
    };
    const answers = { q_title: 'Crash on export', q_steps: 'click export' };
    const who = { name: 'Vera Visitor', email: 'vera@example.com' };

    it('only issues an upload ticket for forms that ask for files', async () => {
      const { app } = await server({ demo: true });
      const visitor = new Client(app);
      expect((await visitor.rpc('submitForm', 'acme', 'report-a-bug', answers, who, '')).body.result.upload).toBeUndefined();
      await withFileQuestion(app);
      const sent = await visitor.rpc('submitForm', 'acme', 'report-a-bug', answers, who, '');
      expect(sent.body.result.upload).toMatchObject({ maxFiles: 3 });
      expect(sent.body.result.upload.token.length).toBeGreaterThan(20);
    });

    it('accepts files with the ticket, shows who sent them, and enforces the limits', async () => {
      const { app, filesDir } = await server({ demo: true });
      const alex = await withFileQuestion(app);
      const visitor = new Client(app);
      const sent = (await visitor.rpc('submitForm', 'acme', 'report-a-bug', answers, who, '')).body.result;
      const url = `/api/public/uploads/${sent.upload.token}`;

      const first = await rawPost(app, url, 'crash.png', PNG);
      expect(first.statusCode).toBe(200);
      expect(first.json().attachment.mime).toBe('image/png');
      expect((await rawPost(app, url, 'virus.exe', 'MZ')).statusCode).toBe(400); // blocked type; ticket use is still spent
      expect((await rawPost(app, url, 'b.txt', 'ok')).statusCode).toBe(200);
      expect((await rawPost(app, url, 'c.txt', 'too many')).statusCode).toBe(403); // 3 tries per ticket
      expect(filesOnDisk(filesDir)).toHaveLength(2);

      const org = (await alex.rpc('loadOrg', 'org_acme')).body.result;
      const issue = org.issues.find((i: { key: string }) => i.key === sent.key);
      const atts = org.attachments.filter((a: { issueId: string }) => a.issueId === issue.id);
      expect(atts).toHaveLength(2);
      expect(atts[0].externalName).toBe('Vera Visitor');
      expect(org.activity.some((a: { issueId: string; actorId: string }) => a.issueId === issue.id && a.actorId === 'intake')).toBe(true);
    });

    it('rejects made-up tickets, oversized files, and a ticket cannot be pointed at another item', async () => {
      const { app, filesDir } = await server({ demo: true });
      await withFileQuestion(app);
      expect((await rawPost(app, '/api/public/uploads/not-a-real-ticket', 'a.txt', 'x')).statusCode).toBe(403);
      const visitor = new Client(app);
      const sent = (await visitor.rpc('submitForm', 'acme', 'report-a-bug', answers, who, '')).body.result;
      const huge = Buffer.alloc(11 * 1024 * 1024, 1);
      expect((await rawPost(app, `/api/public/uploads/${sent.upload.token}`, 'huge.bin', huge)).statusCode).toBeGreaterThanOrEqual(400);
      expect(filesOnDisk(filesDir)).toHaveLength(0);
    });
  });
});

describe('email notifications', () => {
  const soon = (min = 3) => new Date(Date.now() + min * 60_000);
  const setup = async (opts: { mailer?: Mailer; digestHour?: number } = {}) => {
    const ctx = await server({ demo: true });
    await ctx.db.query(`insert into notification_emails (notification_id, outcome) select id, 'skipped' from notifications`); // sample data from the demo is not what is being tested
    const mailer = opts.mailer ?? new ConsoleMailer(() => undefined);
    const emailer = new NotificationEmailer({ db: ctx.db, store: ctx.store, mailer, baseUrl: 'https://tracker.example.com', digestHour: opts.digestHour ?? 0, log: () => undefined });
    const alex = new Client(ctx.app);
    await alex.login('alex@acme.dev');
    const priya = new Client(ctx.app);
    await priya.login('priya@acme.dev');
    return { ...ctx, mailer: mailer as ConsoleMailer, emailer, alex, priya };
  };
  const assignToPriya = async (alex: Client, key: string) => {
    const id = await issueId(alex, 'org_acme', key);
    expect((await alex.rpc('updateIssue', id, { assigneeId: 'u_priya' })).status).toBe(200);
    return id;
  };

  it('emails an assignment once, with a link, after a short grace period', async () => {
    const { alex, emailer, mailer } = await setup();
    await assignToPriya(alex, 'PLT-3');
    expect(await emailer.runOnce(new Date())).toBe(0); // too fresh: give people time to see it in the app first
    expect(await emailer.runOnce(soon())).toBe(1);
    expect(mailer.outbox).toHaveLength(1);
    const m = mailer.outbox[0];
    expect(m.to).toBe('priya@acme.dev');
    expect(m.subject).toMatch(/assigned you PLT-3/);
    expect(m.text).toContain('https://tracker.example.com/acme/p/PLT/board?issue=PLT-3');
    expect(await emailer.runOnce(soon(10))).toBe(0); // never twice
    expect(mailer.outbox).toHaveLength(1);
  });

  it('groups several updates into one email and skips what was already read', async () => {
    const { alex, priya, emailer, mailer } = await setup();
    const free = ((await alex.rpc('loadOrg', 'org_acme')).body.result.issues as { key: string; assigneeId?: string }[]).filter((i) => i.key.startsWith('PLT-') && i.assigneeId !== 'u_priya').map((i) => i.key);
    expect(free.length).toBeGreaterThanOrEqual(3);
    await assignToPriya(alex, free[0]);
    await assignToPriya(alex, free[1]);
    const read = await assignToPriya(alex, free[2]);
    const inbox = (await priya.rpc('loadOrg', 'org_acme')).body.result.notifications as { id: string; issueId: string }[];
    await priya.rpc('markNotificationRead', inbox.find((n) => n.issueId === read)!.id);
    expect(await emailer.runOnce(soon())).toBe(1);
    expect(mailer.outbox).toHaveLength(1);
    expect(mailer.outbox[0].subject).toMatch(/2 updates/);
    expect(mailer.outbox[0].text).toContain(free[0] + ' ');
    expect(mailer.outbox[0].text).toContain(free[1] + ' ');
    expect(mailer.outbox[0].text).not.toContain(free[2] + ' ');
  });

  it('follows each person’s choices, and keeps them private and validated', async () => {
    const { alex, priya, emailer, mailer } = await setup();
    const id = await assignToPriya(alex, 'PLT-3');
    await alex.rpc('addComment', id, 'Just a note'); // a "comment" item: nice to know, not urgent

    // default = only what needs me
    expect(await emailer.runOnce(soon())).toBe(1);
    expect(mailer.outbox[0].text).toContain('assigned you');
    expect(mailer.outbox[0].text).not.toContain('commented');

    // new comment, but email switched off
    expect((await priya.rpc('setNotifyPrefs', { email: 'off', scope: 'all' })).status).toBe(200);
    await alex.rpc('addComment', id, 'Another note');
    expect(await emailer.runOnce(soon(10))).toBe(0);
    // turning it back on never sends what happened while it was off
    await priya.rpc('setNotifyPrefs', { email: 'instant', scope: 'all' });
    expect(await emailer.runOnce(soon(20))).toBe(0);
    await alex.rpc('addComment', id, 'Third note');
    expect(await emailer.runOnce(soon(30))).toBe(1);
    expect(mailer.outbox[0].text).toContain('commented on PLT-3');

    // choices must be real options; and are nobody else's business
    expect((await priya.rpc('setNotifyPrefs', { email: 'sometimes', scope: 'all' })).status).toBe(400);
    expect((await priya.rpc('setNotifyPrefs', null)).status).toBe(400);
    const members = (await alex.rpc('loadOrg', 'org_acme')).body.result.members;
    expect(JSON.stringify(members)).not.toContain('notify');
    expect((await priya.call('GET', '/api/auth/me')).body.user.notify).toEqual({ email: 'instant', scope: 'all', mutedProjects: [] });
  });

  it('sends one summary a day, at the chosen hour', async () => {
    const early = await setup({ digestHour: 24 }); // an hour that never arrives
    await early.priya.rpc('setNotifyPrefs', { email: 'daily', scope: 'important' });
    await assignToPriya(early.alex, 'PLT-3');
    expect(await early.emailer.runOnce(soon(10))).toBe(0);
    expect(early.mailer.outbox).toHaveLength(0);

    const { alex, priya, emailer, mailer } = await setup({ digestHour: 0 });
    await priya.rpc('setNotifyPrefs', { email: 'daily', scope: 'important' });
    await assignToPriya(alex, 'PLT-3');
    await assignToPriya(alex, 'PLT-4');
    expect(await emailer.runOnce(soon(0))).toBe(1); // no grace wait for a summary
    expect(mailer.outbox[0].subject).toMatch(/daily summary: 2 updates/);
    await assignToPriya(alex, 'PLT-5');
    expect(await emailer.runOnce(soon(60))).toBe(0); // already had today's
  });

  it('retries after a mail failure, and never sends a person someone else’s items or broken subjects', async () => {
    let failing = true;
    const sent: { to: string; subject: string; text: string }[] = [];
    const flaky: Mailer = { kind: 'smtp', send: async (m) => (failing ? Promise.reject(new Error('smtp down')) : void sent.push(m)) };
    const { alex, emailer } = await setup({ mailer: flaky });
    const id = await assignToPriya(alex, 'PLT-3');
    await alex.rpc('updateIssue', id, { title: 'Line one\r\nBcc: attacker@evil.test' });
    expect(await emailer.runOnce(soon())).toBe(0); // failed, not lost
    expect(await emailer.runOnce(soon(5))).toBe(0); // backing off
    failing = false;
    expect(await emailer.runOnce(soon(20))).toBe(1);
    expect(sent).toHaveLength(1);
    expect(sent[0].to).toBe('priya@acme.dev');
    expect(sent[0].subject).not.toMatch(/[\r\n]/);
    expect(sent.every((m) => m.to === 'priya@acme.dev')).toBe(true);
  });
});

describe('quiet projects and due-date reminders', () => {
  const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toISOString().slice(0, 10);
  const setup = async () => {
    const ctx = await server({ demo: true });
    await ctx.db.query(`insert into notification_emails (notification_id, outcome) select id, 'skipped' from notifications`);
    const mailer = new ConsoleMailer(() => undefined);
    const emailer = new NotificationEmailer({ db: ctx.db, store: ctx.store, mailer, baseUrl: 'https://tracker.example.com', digestHour: 0, log: () => undefined });
    const alex = new Client(ctx.app);
    await alex.login('alex@acme.dev');
    const priya = new Client(ctx.app);
    await priya.login('priya@acme.dev');
    const dueFor = async (issue: string) => ((await priya.rpc('loadOrg', 'org_acme')).body.result.notifications as { issueId: string; kind: string; detail: string }[]).filter((n) => n.kind === 'due' && n.issueId === issue);
    return { ...ctx, mailer, emailer, alex, priya, dueFor };
  };
  const prep = async (alex: Client, due: string | null, key = 'PLT-3') => {
    const id = await issueId(alex, 'org_acme', key);
    expect((await alex.rpc('updateIssue', id, { assigneeId: 'u_priya', dueDate: due })).status).toBe(200);
    return id;
  };

  it('keeps email about a quiet project out, while the Inbox still shows it', async () => {
    const { alex, priya, emailer, mailer } = await setup();
    expect((await priya.rpc('setNotifyPrefs', { email: 'instant', scope: 'important', mutedProjects: ['p_plt'] })).status).toBe(200);
    const id = await prep(alex, null);
    const soon = new Date(Date.now() + 3 * 60_000);
    expect(await emailer.runOnce(soon)).toBe(0);
    expect(mailer.outbox).toHaveLength(0);
    const inbox = (await priya.rpc('loadOrg', 'org_acme')).body.result.notifications as { issueId: string }[];
    expect(inbox.some((n) => n.issueId === id)).toBe(true);
    // un-muting does not send what was missed
    await priya.rpc('setNotifyPrefs', { email: 'instant', scope: 'important', mutedProjects: [] });
    expect(await emailer.runOnce(new Date(Date.now() + 10 * 60_000))).toBe(0);
  });

  it('reminds the assignee once per stage, and again when the date moves', async () => {
    const { app, alex, dueFor } = await setup();
    const id = await prep(alex, day(1));
    expect(await app.remindDue()).toBeGreaterThanOrEqual(1);
    let mine = await dueFor(id);
    expect(mine).toHaveLength(1);
    expect(mine[0].detail).toBe(`Due tomorrow (${day(1)})`);
    await app.remindDue();
    expect(await dueFor(id)).toHaveLength(1); // not again

    // a day later it is "due today", then "overdue"
    await app.remindDue(new Date(Date.now() + 86_400_000));
    await app.remindDue(new Date(Date.now() + 2 * 86_400_000));
    mine = await dueFor(id);
    expect(mine.map((n) => n.detail)).toEqual(expect.arrayContaining([`Due today (${day(1)})`, `Overdue since ${day(1)}`]));
    expect(mine).toHaveLength(3);

    // moving the date starts over
    await prep(alex, day(0));
    await app.remindDue();
    expect((await dueFor(id)).some((n) => n.detail === `Due today (${day(0)})`)).toBe(true);
  });

  it('skips finished, unassigned and far-away items, and long-overdue history', async () => {
    const { app, alex, dueFor } = await setup();
    const far = await prep(alex, day(10), 'PLT-3');
    const old = await prep(alex, day(-30), 'PLT-4');
    const none = await issueId(alex, 'org_acme', 'PLT-5');
    await alex.rpc('updateIssue', none, { assigneeId: null, dueDate: day(0) });
    await app.remindDue();
    expect(await dueFor(far)).toHaveLength(0);
    expect(await dueFor(old)).toHaveLength(0);
    expect(await dueFor(none)).toHaveLength(0);

    const org = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    const project = org.projects.find((p: { key: string }) => p.key === 'PLT');
    const doneStatus = project.statuses.find((s: { category: string }) => s.category === 'done').id;
    const finished = await prep(alex, day(0), 'PLT-6');
    expect((await alex.rpc('updateIssue', finished, { statusId: doneStatus })).status).toBe(200);
    await app.remindDue();
    expect(await dueFor(finished)).toHaveLength(0);
  });

  it('emails a reminder in plain words', async () => {
    const { app, alex, emailer, mailer } = await setup();
    await prep(alex, day(1));
    await ctxClear(emailer, mailer, alex); // the assignment itself is not what is checked here
    await app.remindDue();
    expect(await emailer.runOnce(new Date(Date.now() + 3 * 60_000))).toBeGreaterThanOrEqual(1);
    const m = mailer.outbox.find((x) => x.to === 'priya@acme.dev' && /Reminder about/.test(x.subject))!; // the demo data has other people's due dates too
    expect(m.to).toBe('priya@acme.dev');
    expect(m.text).toContain(`Due tomorrow (${day(1)})`);
  });
});

async function ctxClear(emailer: NotificationEmailer, mailer: ConsoleMailer, _alex: Client) {
  await emailer.runOnce(new Date(Date.now() + 3 * 60_000));
  mailer.outbox.length = 0;
}

describe('time zones in emails and reminders', () => {
  const ZONES = ['Pacific/Pago_Pago', 'America/Los_Angeles', 'Europe/London', 'UTC', 'Asia/Kolkata', 'Asia/Tokyo', 'Pacific/Kiritimati'];
  const setup = async (digestHour: number) => {
    const ctx = await server({ demo: true });
    await ctx.db.query(`insert into notification_emails (notification_id, outcome) select id, 'skipped' from notifications`);
    const mailer = new ConsoleMailer(() => undefined);
    const emailer = new NotificationEmailer({ db: ctx.db, store: ctx.store, mailer, baseUrl: 'https://tracker.example.com', digestHour, log: () => undefined });
    const alex = new Client(ctx.app);
    await alex.login('alex@acme.dev');
    const priya = new Client(ctx.app);
    await priya.login('priya@acme.dev');
    return { ...ctx, mailer, emailer, alex, priya };
  };

  it('sends the daily summary in the morning of the person’s own day', async () => {
    const at = new Date(Date.now() + 3 * 60_000);
    const evening = ZONES.find((z) => localHour(at, z) < 12)!; // before the chosen hour there
    const afternoon = ZONES.find((z) => localHour(at, z) >= 12)!;
    expect(evening && afternoon).toBeTruthy();

    for (const [zone, expected] of [[evening, 0], [afternoon, 1]] as const) {
      const { alex, priya, emailer, mailer } = await setup(12);
      expect((await priya.rpc('setNotifyPrefs', { email: 'daily', scope: 'important', timeZone: zone })).status).toBe(200);
      const id = await issueId(alex, 'org_acme', 'PLT-3');
      await alex.rpc('updateIssue', id, { assigneeId: 'u_priya' });
      await emailer.runOnce(at);
      expect(mailer.outbox.filter((m) => m.to === 'priya@acme.dev'), zone).toHaveLength(expected);
    }
  });

  it('decides "due today" by the assignee’s own calendar', async () => {
    const now = new Date();
    for (const zone of ['Pacific/Kiritimati', 'Pacific/Pago_Pago']) {
      const { app, alex, priya } = await setup(8);
      await priya.rpc('setNotifyPrefs', { email: 'instant', scope: 'important', timeZone: zone });
      const id = await issueId(alex, 'org_acme', 'PLT-3');
      const theirToday = localDate(now, zone);
      expect((await alex.rpc('updateIssue', id, { assigneeId: 'u_priya', dueDate: theirToday })).status).toBe(200);
      await app.remindDue(now);
      const inbox = (await priya.rpc('loadOrg', 'org_acme')).body.result.notifications as { issueId: string; kind: string; detail: string }[];
      expect(inbox.filter((n) => n.kind === 'due' && n.issueId === id).map((n) => n.detail), zone).toEqual([`Due today (${theirToday})`]);
    }
  });
});

describe('unsubscribe link, test email and file cleanup', () => {
  const soon = () => new Date(Date.now() + 3 * 60_000);
  const tokenFrom = (text: string) => /\/unsubscribe\/([^\s]+)/.exec(text)![1];
  const oneClick = (app: FastifyInstance, token: string) =>
    app.inject({ method: 'POST', url: `/api/unsubscribe/${token}`, headers: { 'content-type': 'application/x-www-form-urlencoded' }, payload: 'List-Unsubscribe=One-Click' }); // no session, no custom header: as a mail app sends it

  const withMail = async () => {
    const ctx = await server({ demo: true });
    await ctx.db.query(`insert into notification_emails (notification_id, outcome) select id, 'skipped' from notifications`);
    const sent: { to: string; subject: string; text: string; headers?: Record<string, string> }[] = [];
    const mailer: Mailer = { kind: 'smtp', send: async (m) => void sent.push(m) };
    const emailer = new NotificationEmailer({ db: ctx.db, store: ctx.store, mailer, baseUrl: 'https://tracker.example.com', log: () => undefined });
    const alex = new Client(ctx.app);
    await alex.login('alex@acme.dev');
    const priya = new Client(ctx.app);
    await priya.login('priya@acme.dev');
    const assign = async (key: string) => alex.rpc('updateIssue', await issueId(alex, 'org_acme', key), { assigneeId: 'u_priya' });
    return { ...ctx, emailer, sent, alex, priya, assign };
  };

  it('puts a stop-these-emails link and header in every email, and the link really stops them', async () => {
    const { app, emailer, sent, assign, priya } = await withMail();
    await assign('PLT-3');
    await emailer.runOnce(soon());
    expect(sent).toHaveLength(1);
    const token = tokenFrom(sent[0].text);
    expect(sent[0].headers?.['List-Unsubscribe']).toBe(`<https://tracker.example.com/unsubscribe/${token}>`);
    expect(sent[0].headers?.['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');

    // opening the link only asks; it reveals a name, never an address, and changes nothing
    const info = await app.inject({ method: 'GET', url: `/api/unsubscribe/${token}` });
    expect(info.statusCode).toBe(200);
    expect(Object.keys(info.json())).toEqual(['name']);
    expect(info.body).not.toContain('@');
    expect((await priya.call('GET', '/api/auth/me')).body.user.notify?.email).not.toBe('off');

    const res = await oneClick(app, token);
    expect(res.statusCode).toBe(200);
    const me = (await priya.call('GET', '/api/auth/me')).body.user;
    expect(me.notify.email).toBe('off');
    expect(me.notify.scope).toBe('important'); // everything else about their settings is left alone

    await assign('PLT-4');
    expect(await emailer.runOnce(new Date(Date.now() + 10 * 60_000))).toBe(0);
    expect(sent).toHaveLength(1);
  });

  it('refuses forged, damaged and borrowed links', async () => {
    const { app, db, emailer, sent, assign } = await withMail();
    await assign('PLT-3');
    await emailer.runOnce(soon());
    const token = tokenFrom(sent[0].text);
    const [id, sig] = [token.slice(0, token.lastIndexOf('.')), token.slice(token.lastIndexOf('.') + 1)];
    const bad = [`${id}.${'0'.repeat(sig.length)}`, `${id}.${sig.slice(0, -2)}`, `u_alex.${sig}`, id, '.', 'x', `${id}.${sig}${sig}`, '..%2f..'];
    for (const t of bad) {
      expect((await app.inject({ method: 'GET', url: `/api/unsubscribe/${t}` })).statusCode, t).toBe(404);
      expect((await oneClick(app, t)).statusCode, t).toBe(404);
    }
    // nobody else was switched off
    const users = (await db.query(`select data from users`)).map((r) => (typeof r.data === 'string' ? JSON.parse(r.data) : r.data));
    expect(users.filter((u: { notify?: { email: string } }) => u.notify?.email === 'off')).toHaveLength(0);

    // a link made yesterday still works after a restart: the signing secret lives in the database
    const again = new Unsubscribe(db);
    expect(await again.verify(token)).toBe(id);
    // ...and a database with another secret does not honour it
    await db.query(`update app_secrets set value = 'something-else' where name = 'unsubscribe'`);
    expect(await new Unsubscribe(db).verify(token)).toBeNull();
  });

  it('sends a person a test email at their own address only, and says plainly when it cannot', async () => {
    const sent: { to: string; subject: string }[] = [];
    const ok = await server({ demo: true, mailer: { kind: 'smtp', send: async (m) => void sent.push(m) } });
    const priya = new Client(ok.app);
    await priya.login('priya@acme.dev');
    const r = await priya.call('POST', '/api/me/test-email', { to: 'someone-else@evil.test' }); // any address in the request is ignored
    expect(r.body).toEqual({ sent: true });
    expect(sent).toEqual([expect.objectContaining({ to: 'priya@acme.dev', subject: 'ABG Tracker test email' })]);
    await priya.call('POST', '/api/me/test-email');
    await priya.call('POST', '/api/me/test-email');
    expect((await priya.call('POST', '/api/me/test-email')).status).toBe(429); // 3 an hour
    expect((await new Client(ok.app).call('POST', '/api/me/test-email')).status).toBe(401);

    const none = await server({ demo: true }); // no SMTP configured
    const p2 = new Client(none.app);
    await p2.login('priya@acme.dev');
    const r2 = (await p2.call('POST', '/api/me/test-email')).body;
    expect(r2.sent).toBe(false);
    expect(r2.reason).toMatch(/SMTP_URL/);

    const down = await server({ demo: true, mailer: { kind: 'smtp', send: async () => Promise.reject(new Error('connect ECONNREFUSED smtp.secret-host.internal:465')) } });
    const p3 = new Client(down.app);
    await p3.login('priya@acme.dev');
    const r3 = (await p3.call('POST', '/api/me/test-email')).body;
    expect(r3.sent).toBe(false);
    expect(JSON.stringify(r3)).not.toMatch(/secret-host|ECONNREFUSED/); // server details stay in the log
  });

  it('removes stored files nothing refers to, but only old ones and only its own', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'abg-sweep-'));
    tempDirs.push(dir);
    const fs = new FileStore(dir);
    const kept = await fs.write('org_1', Buffer.from('kept'));
    const orphan = await fs.write('org_1', Buffer.from('orphan'));
    const young = await fs.write('org_1', Buffer.from('young'));
    await fs.writeThumb('org_1', orphan.key, Buffer.from('thumb'));
    const shard = (k: string) => path.join(dir, 'org_1', k.slice(0, 2));
    const leftover = path.join(shard(orphan.key), `${orphan.key.slice(0, 2)}${'a'.repeat(30)}.part`);
    writeFileSync(leftover, 'half-written');
    const stranger = path.join(shard(orphan.key), 'notes.txt');
    writeFileSync(stranger, 'not ours');

    const dayAgo = new Date(Date.now() - 48 * 3600_000);
    const { utimesSync, existsSync } = await import('node:fs');
    for (const p of [path.join(shard(kept.key), kept.key), path.join(shard(orphan.key), orphan.key), path.join(shard(orphan.key), `${orphan.key}.thumb`), leftover, stranger]) utimesSync(p, dayAgo, dayAgo);

    const removed = await fs.sweep((org, key) => org === 'org_1' && key === kept.key, 24 * 3600_000);
    expect(removed).toBe(3); // orphan, its preview, and the half-written leftover
    expect(await fs.exists('org_1', kept.key)).toBe(true);
    expect(await fs.exists('org_1', orphan.key)).toBe(false);
    expect(await fs.exists('org_1', young.key)).toBe(true); // too new: may still be being saved
    expect(existsSync(stranger)).toBe(true); // never touches names it did not make
    expect(await new FileStore(path.join(dir, 'nowhere')).sweep(() => false, 0)).toBe(0); // nothing stored yet is fine
  });
});

describe('account security: two-factor, devices, profile', () => {
  const codeNow = (secretB32: string, shift = 0) => hotp(base32Decode(secretB32), stepOf(Date.now()) + shift);
  const withMail = async () => {
    const sent: { to: string; subject: string; text: string }[] = [];
    const ctx = await server({ demo: true, mailer: { kind: 'smtp', send: async (m) => void sent.push(m) } });
    return { ...ctx, sent };
  };
  const signIn = (app: FastifyInstance, extra: Record<string, unknown> = {}, ua = 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36') => {
    const c = new Client(app);
    return c.call('POST', '/api/auth/login', { email: 'priya@acme.dev', password: DEMO_PASSWORD, ...extra }, { 'user-agent': ua }).then((r) => ({ c, r }));
  };
  const turnOn = async (app: FastifyInstance) => {
    const { c } = await signIn(app);
    const begun = (await c.call('POST', '/api/me/2fa/begin')).body;
    const done = await c.call('POST', '/api/me/2fa/confirm', { code: codeNow(begun.secret) });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    return { c, secret: begun.secret as string, recovery: done.body.recoveryCodes as string[] };
  };

  it('generates the standard authenticator codes', () => {
    const rfc = Buffer.from('12345678901234567890'); // the test key published with the standard
    expect(hotp(rfc, 0)).toBe('755224');
    expect(hotp(rfc, 1)).toBe('287082');
    expect(matchStep(rfc, '287082', 59_000)).toBe(1);
    expect(matchStep(rfc, '287082', 120_000)).toBeNull(); // too old
    expect(matchStep(rfc, '28708', 59_000)).toBeNull();
    expect(base32Decode(base32Encode(rfc)).equals(rfc)).toBe(true);
    expect(base32Encode(Buffer.from('foobar'))).toBe('MZXW6YTBOI');
  });

  it('sets up two-factor, then needs the code at sign-in; each code works once', async () => {
    const { app, sent, db } = await withMail();
    const { c, secret, recovery } = await turnOn(app);
    expect(recovery).toHaveLength(8);
    expect((await c.call('GET', '/api/me/2fa')).body).toEqual({ enabled: true, recoveryLeft: 8 });
    expect(sent.some((m) => /Security notice/.test(m.subject) && /turned ON/.test(m.text))).toBe(true);
    // the secret is never stored readable
    const stored = JSON.stringify(await db.query(`select * from two_factor`));
    expect(stored).not.toContain(secret);

    // password alone: no session
    const first = await signIn(app);
    expect(first.r.body).toEqual({ twoFactorRequired: true });
    expect((await first.c.call('GET', '/api/auth/me')).status).toBe(401);
    // wrong password never reveals anything about the second step
    expect((await signIn(app, { password: 'wrong-password-1' })).r.status).toBe(401);
    // wrong, malformed and right codes
    expect((await signIn(app, { code: '000000' })).r.status).toBe(401);
    expect((await signIn(app, { code: '12' })).r.status).toBe(401);
    const good = codeNow(secret, 1);
    const ok = await signIn(app, { code: good });
    expect(ok.r.status).toBe(200);
    expect((await ok.c.call('GET', '/api/auth/me')).status).toBe(200);
    expect((await signIn(app, { code: good })).r.status).toBe(401); // the same code a second time

    // a recovery code works once, written any way
    const rc = recovery[0];
    expect((await signIn(app, { code: rc.toUpperCase().replace('-', ' ') })).r.status).toBe(200);
    expect((await signIn(app, { code: rc })).r.status).toBe(401);
    expect((await c.call('GET', '/api/me/2fa')).body.recoveryLeft).toBe(7);
  });

  it('turns off only with the password, and sign-in goes back to normal', async () => {
    const { app, sent } = await withMail();
    const { c } = await turnOn(app);
    expect((await c.call('POST', '/api/me/2fa/disable', { password: 'wrong-password-1' })).status).toBe(403);
    expect((await c.call('GET', '/api/me/2fa')).body.enabled).toBe(true);
    expect((await c.call('POST', '/api/me/2fa/disable', { password: DEMO_PASSWORD })).status).toBe(200);
    expect(sent.some((m) => /turned OFF/.test(m.text))).toBe(true);
    expect((await signIn(app)).r.status).toBe(200);
    expect((await signIn(app)).r.body.user).toBeDefined();
  });

  it('refuses a wrong first code, a second set-up while on, and anonymous use; limits guessing', async () => {
    const { app } = await withMail();
    expect((await new Client(app).call('POST', '/api/me/2fa/begin')).status).toBe(401);
    const { c } = await signIn(app);
    await c.call('POST', '/api/me/2fa/begin');
    expect((await c.call('POST', '/api/me/2fa/confirm', { code: '000000' })).status).toBe(400);
    expect((await c.call('GET', '/api/me/2fa')).body.enabled).toBe(false); // still off: nothing changed without a right code

    const on = await turnOn(app);
    expect((await on.c.call('POST', '/api/me/2fa/begin')).status).toBe(409);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await signIn(app, { code: String(100000 + i) })).r.status;
    expect(last).toBe(429); // guesses at one account's code are capped, from anywhere
  });

  it('lists devices, signs out one or all others, and never touches the current or other people’s', async () => {
    const { app } = await withMail();
    const here = await signIn(app, {}, 'Mozilla/5.0 (Windows NT 10.0) Chrome/120.0 Safari/537.36');
    const phone = await signIn(app, {}, 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1');
    const list = (await here.c.call('GET', '/api/me/sessions')).body.sessions as { id: string; device: string; current: boolean }[];
    expect(list.map((d) => d.device).sort()).toEqual(['Chrome on Windows', 'Safari on iOS']);
    expect(list.filter((d) => d.current)).toHaveLength(1);
    expect(JSON.stringify(list)).not.toMatch(/[a-f0-9]{40}/); // never anything that could be used as the cookie

    const mine = list.find((d) => d.current)!;
    const other = list.find((d) => !d.current)!;
    expect((await here.c.call('DELETE', `/api/me/sessions/${mine.id}`)).status).toBe(404); // that is "sign out", not this
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    expect((await alex.call('DELETE', `/api/me/sessions/${other.id}`)).status).toBe(404); // someone else's device
    expect((await phone.c.call('GET', '/api/auth/me')).status).toBe(200);
    expect((await here.c.call('DELETE', `/api/me/sessions/${other.id}`)).status).toBe(200);
    expect((await phone.c.call('GET', '/api/auth/me')).status).toBe(401);

    const third = await signIn(app);
    expect((await here.c.call('POST', '/api/me/sessions/sign-out-others')).status).toBe(200);
    expect((await third.c.call('GET', '/api/auth/me')).status).toBe(401);
    expect((await here.c.call('GET', '/api/auth/me')).status).toBe(200);
    expect((await new Client(app).call('GET', '/api/me/sessions')).status).toBe(401);
  });

  it('changes your own name, and nothing else', async () => {
    const { app } = await withMail();
    const { c } = await signIn(app);
    const r = await c.call('POST', '/api/me/profile', { name: '  Priya   N. ', email: 'hacker@evil.test', id: 'u_alex' });
    expect(r.status).toBe(200);
    expect(r.body.user).toMatchObject({ id: 'u_priya', name: 'Priya N.', email: 'priya@acme.dev' });
    const members = (await c.rpc('loadOrg', 'org_acme')).body.result.members as { id: string; name: string }[];
    expect(members.find((m) => m.id === 'u_priya')!.name).toBe('Priya N.');
    expect((await c.call('POST', '/api/me/profile', { name: '   ' })).status).toBe(400);
    expect((await c.call('POST', '/api/me/profile', { name: 'x'.repeat(200) })).status).toBe(400);
    expect((await new Client(app).call('POST', '/api/me/profile', { name: 'Z' })).status).toBe(401);
  });
});

describe('data ownership: export, audit log, deleting', () => {
  const login = async (app: FastifyInstance, email: string) => {
    const c = new Client(app);
    expect((await c.login(email)).status).toBe(200);
    return c;
  };
  const get = (app: FastifyInstance, c: Client, url: string) => app.inject({ method: 'GET', url, headers: { cookie: c.cookie } });

  it('lets only an owner export, without secrets, as JSON and as a safe spreadsheet', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const json = await get(app, alex, '/api/orgs/org_acme/export');
    expect(json.statusCode).toBe(200);
    expect(String(json.headers['content-disposition'])).toContain('attachment');
    const out = JSON.parse(json.body);
    expect(out.format).toBe('abg-tracker-export-v1');
    expect(out.issues.length).toBeGreaterThan(0);
    expect(out.members.some((m: { email: string }) => m.email === 'priya@acme.dev')).toBe(true);
    expect(json.body.match(/storageKey|password_hash|"notify":|u_jordan|org_nw/g)).toBeNull(); // nothing hidden, nothing from another company
    expect(out.notifications).toBeUndefined();

    // everyone else is refused
    for (const who of ['priya@acme.dev', 'sam@acme.dev']) expect((await get(app, await login(app, who), '/api/orgs/org_acme/export')).statusCode, who).toBe(403);
    expect((await get(app, await login(app, 'jordan@northwind.io'), '/api/orgs/org_acme/export')).statusCode).toBe(403);
    expect((await app.inject({ method: 'GET', url: '/api/orgs/org_acme/export' })).statusCode).toBe(401);

    // spreadsheet cells can never run as formulas
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    await alex.rpc('updateIssue', id, { title: '=HYPERLINK("http://evil.test","click")' });
    await alex.rpc('updateIssue', id, { description: 'line one\nline "two", three' });
    const csv = await get(app, alex, '/api/orgs/org_acme/export.csv');
    expect(csv.statusCode).toBe(200);
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.body.startsWith('\uFEFFKey,Project')).toBe(true);
    expect(csv.body).toContain(`"'=HYPERLINK(""http://evil.test"",""click"")"`);
    expect(csv.body).toContain('"line one\nline ""two"", three"');
    expect(csv.body).not.toMatch(/(^|,)=HYPERLINK/m);
  });

  it('records who changed access, for owners and admins only', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    await alex.rpc('updateMemberRole', 'org_acme', 'u_sam', 'admin');
    await alex.call('POST', '/api/orgs/org_acme/invites', { email: 'new@x.com', role: 'member' });
    await alex.call('GET', '/api/orgs/org_acme/export');
    const events = (await alex.call('GET', '/api/orgs/org_acme/audit')).body.events as { actor: string; action: string; detail: string }[];
    expect(events.map((e) => e.action)).toEqual(expect.arrayContaining(['member.role', 'invite.create', 'org.export']));
    expect(events.find((e) => e.action === 'member.role')).toMatchObject({ actor: expect.any(String), detail: expect.stringMatching(/is now admin/) });
    expect((await (await login(app, 'priya@acme.dev')).call('GET', '/api/orgs/org_acme/audit')).status).toBe(200); // admin
    expect((await (await login(app, 'jordan@northwind.io')).call('GET', '/api/orgs/org_acme/audit')).status).toBe(403);
    await alex.rpc('updateMemberRole', 'org_acme', 'u_sam', 'member');
    expect((await (await login(app, 'sam@acme.dev')).call('GET', '/api/orgs/org_acme/audit')).status).toBe(403); // plain member
  });

  it('deletes an organization completely, only for its owner who proves who they are', async () => {
    const { app, db, filesDir } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    await alex.upload(id, 'a.txt', 'hello');
    expect(filesOnDisk(filesDir)).toHaveLength(1);
    const count = async (t: string, org: string) => Number((await db.query(`select count(*) as n from ${t} where org_id = $1`, [org]))[0].n);
    const northwindIssues = await count('issues', 'org_nw');

    const url = '/api/orgs/org_acme/delete';
    const orgName = (await alex.call('GET', '/api/auth/me')).body.orgs.find((o: { id: string }) => o.id === 'org_acme').name;
    expect((await (await login(app, 'priya@acme.dev')).call('POST', url, { password: DEMO_PASSWORD, confirmName: orgName })).status).toBe(403); // admin, not owner
    expect((await alex.call('POST', url, { password: DEMO_PASSWORD, confirmName: 'acme' })).status).toBe(400); // name must match exactly
    expect((await alex.call('POST', url, { password: 'wrong-password-1', confirmName: orgName })).status).toBe(403);
    expect(await count('issues', 'org_acme')).toBeGreaterThan(0); // nothing happened yet

    const done = await alex.call('POST', url, { password: DEMO_PASSWORD, confirmName: orgName });
    expect(done.status, JSON.stringify(done.body)).toBe(200);
    for (const t of ['issues', 'projects', 'comments', 'activity', 'attachments', 'forms', 'rules']) expect(await count(t, 'org_acme'), t).toBe(0);
    expect(Number((await db.query(`select count(*) as n from organizations where id = 'org_acme'`))[0].n)).toBe(0);
    expect(Number((await db.query(`select count(*) as n from memberships where org_id = 'org_acme'`))[0].n)).toBe(0);
    expect(filesOnDisk(filesDir)).toHaveLength(0);
    expect(await count('issues', 'org_nw')).toBe(northwindIssues); // other companies untouched
    expect((await alex.call('GET', '/api/auth/me')).body.orgs.map((o: { id: string }) => o.id)).not.toContain('org_acme');
    expect((await (await login(app, 'priya@acme.dev')).rpc('loadOrg', 'org_acme')).status).toBeGreaterThanOrEqual(400);
  });

  it('asks for the two-factor code too, when it is on', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const begun = (await alex.call('POST', '/api/me/2fa/begin')).body;
    await alex.call('POST', '/api/me/2fa/confirm', { code: hotp(base32Decode(begun.secret), stepOf(Date.now())) });
    const orgName = (await alex.call('GET', '/api/auth/me')).body.orgs[0].name;
    const r = await alex.call('POST', '/api/orgs/org_acme/delete', { password: DEMO_PASSWORD, confirmName: orgName });
    expect(r.status).toBe(403);
    expect(r.body.error).toMatch(/code/);
    expect((await alex.rpc('loadOrg', 'org_acme')).status).toBe(200);
  });

  it('erases an account: login gone, history readable, work unassigned, email reusable', async () => {
    const { app, db } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const sam = await login(app, 'sam@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    await alex.rpc('updateIssue', id, { assigneeId: 'u_sam' });
    await sam.rpc('addComment', id, 'my words');

    // the only owner cannot walk away from their organization
    const blocked = await alex.call('POST', '/api/me/delete', { password: DEMO_PASSWORD });
    expect(blocked.status).toBe(409);
    expect(blocked.body.error).toMatch(/only owner/);

    expect((await sam.call('POST', '/api/me/delete', { password: 'wrong-password-1' })).status).toBe(403);
    expect((await sam.call('GET', '/api/auth/me')).status).toBe(200); // still there
    expect((await new Client(app).call('POST', '/api/me/delete', { password: DEMO_PASSWORD })).status).toBe(401);
    expect((await sam.call('POST', '/api/me/delete', { password: DEMO_PASSWORD })).status).toBe(200);

    expect((await sam.call('GET', '/api/auth/me')).status).toBe(401); // signed out
    expect((await new Client(app).login('sam@acme.dev')).status).toBe(401); // and cannot sign back in
    const org = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    expect(org.members.some((m: { id: string }) => m.id === 'u_sam')).toBe(false);
    expect(org.issues.find((i: { id: string }) => i.id === id).assigneeId).toBeUndefined();
    expect(org.comments.some((c: { authorId: string; body: string }) => c.authorId === 'u_sam' && c.body === 'my words')).toBe(true); // others' records stay readable
    const row = (await db.query(`select data from users where id = 'u_sam'`))[0];
    const stored = typeof row.data === 'string' ? JSON.parse(row.data as string) : row.data;
    expect(stored.name).toBe('Deleted user');
    expect(JSON.stringify(stored)).not.toContain('sam@acme.dev');
    expect(Number((await db.query(`select count(*) as n from credentials where user_id = 'u_sam'`))[0].n)).toBe(0);

    // the address can be used again for a fresh account
    const again = await new Client(app).call('POST', '/api/auth/register', { name: 'Sam Again', email: 'sam@acme.dev', password: 'a-long-passphrase', orgName: 'Sam Co' });
    expect(again.status).toBe(200);
  });
});

describe('spreadsheet import', () => {
  const post = (app: FastifyInstance, c: Client, project: string, csv: string) =>
    app.inject({ method: 'POST', url: `/api/projects/${project}/import`, payload: csv, headers: { 'content-type': 'text/csv', [CSRF_HEADER]: CSRF_VALUE, cookie: c.cookie } });

  it('creates items from a CSV, matching people and skipping bad rows with reasons', async () => {
    const { app } = await server({ demo: true });
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const before = ((await alex.rpc('loadOrg', 'org_acme')).body.result.issues as unknown[]).length;
    const csv = [
      'Title,Description,Priority,Assignee,Labels,Estimate,Due',
      'Fix login,"Steps:\n1. open, then click",HIGH,priya@acme.dev,"a; b",3,2026-12-31',
      ',no title,low,,,,',
      'Bad date,x,low,,,,31/12/2026',
      'Bad number,x,low,,,abc,',
      'Plain one,,,,,,',
      '=cmd|\' /C calc\'!A0,,,,,,',
    ].join('\r\n');
    const res = await post(app, alex, 'p_plt', csv);
    expect(res.statusCode, res.body).toBe(200);
    const out = res.json();
    expect(out.created).toBe(3);
    expect(out.skipped).toEqual([
      { row: 3, reason: 'No title.' },
      { row: 4, reason: 'Dates must look like 2026-12-31.' },
      { row: 5, reason: 'Estimate must be a number.' },
    ]);
    const issues = (await alex.rpc('loadOrg', 'org_acme')).body.result.issues as { title: string; description: string; priority: string; assigneeId?: string; labels: string[]; estimate?: number; dueDate?: string; reporterId: string }[];
    expect(issues.length).toBe(before + 3);
    const fix = issues.find((i) => i.title === 'Fix login')!;
    expect(fix).toMatchObject({ priority: 'high', assigneeId: 'u_priya', labels: ['a', 'b'], estimate: 3, dueDate: '2026-12-31', reporterId: 'u_alex' });
    expect(fix.description).toBe('Steps:\n1. open, then click');
    expect(issues.find((i) => i.title === 'Plain one')!.priority).toBe('medium');
  });

  it('is limited to people allowed to create items, and to a sensible size', async () => {
    const { app } = await server({ demo: true });
    const maya = new Client(app); // a guest in Northwind
    await maya.login('maya@northwind.io');
    const jordan = new Client(app);
    await jordan.login('jordan@northwind.io');
    const northwindProject = ((await jordan.rpc('loadOrg', 'org_nw')).body.result.projects as { id: string }[])[0].id;
    expect((await post(app, maya, northwindProject, 'Title\nHi')).statusCode).toBe(403); // guests may not create items
    const alex = new Client(app);
    await alex.login('alex@acme.dev');
    const outsider = new Client(app);
    await outsider.call('POST', '/api/auth/register', { name: 'Out Sider', email: 'out@sider.test', password: 'a-long-passphrase', orgName: 'Outside Co' });
    expect((await post(app, outsider, northwindProject, 'Title\nHi')).statusCode).toBe(404); // another company's project does not exist for them
    expect((await app.inject({ method: 'POST', url: '/api/projects/p_plt/import', payload: 'Title\nHi', headers: { 'content-type': 'text/csv', [CSRF_HEADER]: CSRF_VALUE } })).statusCode).toBe(401);
    expect((await post(app, alex, 'p_plt', 'Description\nonly')).statusCode).toBe(400); // no Title column
    expect((await post(app, alex, 'p_plt', 'Title')).statusCode).toBe(400); // no rows
    const many = ['Title', ...Array.from({ length: 501 }, (_, i) => `Item ${i}`)].join('\n');
    const tooMany = await post(app, alex, 'p_plt', many);
    expect(tooMany.statusCode).toBe(400);
    expect(tooMany.json().error).toMatch(/500/);
  });
});

describe('integrations: tokens, public API, webhooks, calendar', () => {
  const login = async (app: FastifyInstance, email: string) => {
    const c = new Client(app);
    expect((await c.login(email)).status).toBe(200);
    return c;
  };
  const makeToken = async (c: Client, scope: 'read' | 'write' | 'calendar', name = 'Script') => (await c.call('POST', '/api/me/tokens', { name, scope })).body as { token: string; view: { id: string; hint: string } };
  const api = (app: FastifyInstance, token: string | null, method: 'GET' | 'POST' | 'PATCH', url: string, body?: unknown) =>
    app.inject({ method, url, payload: body === undefined ? undefined : (body as object), headers: token ? { authorization: `Bearer ${token}` } : {} });
  const publicIp = async () => ['93.184.216.34'];

  it('creates tokens that are shown once, and are accepted only by the public API', async () => {
    const { app, db } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const t = await makeToken(alex, 'read');
    expect(t.token).toMatch(/^abg_/);
    const list = (await alex.call('GET', '/api/me/tokens')).body.tokens;
    expect(JSON.stringify(list)).not.toContain(t.token);
    expect(list[0]).toMatchObject({ name: 'Script', scope: 'read', hint: t.token.slice(0, 8) });
    expect(JSON.stringify(await db.query(`select * from api_tokens`))).not.toContain(t.token); // only a hash is stored

    expect((await api(app, t.token, 'GET', '/api/v1/me')).json()).toMatchObject({ email: 'alex@acme.dev', tokenScope: 'read' });
    expect((await api(app, null, 'GET', '/api/v1/me')).statusCode).toBe(401);
    expect((await api(app, 'abg_not-a-real-token-at-all-12345', 'GET', '/api/v1/me')).statusCode).toBe(401);
    // the browser cookie does not work on the API, and the token does not work anywhere else
    expect((await app.inject({ method: 'GET', url: '/api/v1/me', headers: { cookie: alex.cookie } })).statusCode).toBe(401);
    for (const url of ['/api/auth/me', '/api/me/tokens', '/api/me/sessions']) expect((await api(app, t.token, 'GET', url)).statusCode, url).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/api/rpc/loadOrg', payload: { args: ['org_acme'] }, headers: { authorization: `Bearer ${t.token}`, [CSRF_HEADER]: CSRF_VALUE } })).statusCode).toBe(401);
    const cal = await makeToken(alex, 'calendar');
    expect((await api(app, cal.token, 'GET', '/api/v1/me')).statusCode).toBe(401); // a calendar link is not an API key

    expect((await alex.call('POST', '/api/me/tokens', { name: '', scope: 'read' })).status).toBe(400);
    expect((await alex.call('POST', '/api/me/tokens', { name: 'x', scope: 'admin' })).status).toBe(400);
    const sam = await login(app, 'sam@acme.dev');
    expect((await sam.call('DELETE', `/api/me/tokens/${t.view.id}`)).status).toBe(404); // not yours
    expect((await alex.call('DELETE', `/api/me/tokens/${t.view.id}`)).status).toBe(200);
    expect((await api(app, t.token, 'GET', '/api/v1/me')).statusCode).toBe(401); // revoked at once
    expect((await new Client(app).call('POST', '/api/me/tokens', { name: 'x', scope: 'read' })).status).toBe(401);
  });

  it('reads and writes work items as the token owner, with their permissions', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const read = (await makeToken(alex, 'read')).token;
    const write = (await makeToken(alex, 'write')).token;

    expect((await api(app, read, 'GET', '/api/v1/orgs')).json().orgs.map((o: { slug: string }) => o.slug).sort()).toEqual(['acme', 'northwind']);
    const projects = (await api(app, read, 'GET', '/api/v1/orgs/acme/projects')).json().projects;
    expect(projects.find((p: { key: string }) => p.key === 'PLT')).toMatchObject({ statuses: expect.any(Array), types: expect.any(Array) });
    const list = (await api(app, read, 'GET', '/api/v1/orgs/acme/projects/PLT/issues?limit=2')).json();
    expect(list.total).toBeGreaterThan(2);
    expect(list.issues).toHaveLength(2);
    expect(list.issues[0]).toMatchObject({ key: expect.stringMatching(/^PLT-/), status: expect.any(String), url: expect.stringContaining('/acme/p/PLT/board?issue=PLT-') });
    const one = (await api(app, read, 'GET', `/api/v1/orgs/acme/issues/${list.issues[0].key}`)).json();
    expect(one.issue.key).toBe(list.issues[0].key);
    expect(Array.isArray(one.comments)).toBe(true);
    expect((await api(app, read, 'GET', '/api/v1/orgs/acme/issues/PLT-99999')).statusCode).toBe(404);
    expect((await api(app, read, 'GET', '/api/v1/orgs/nowhere/projects')).statusCode).toBe(404);

    // a read token cannot write; a write token can, and what it creates is by its owner
    expect((await api(app, read, 'POST', '/api/v1/orgs/acme/projects/PLT/issues', { title: 'x' })).statusCode).toBe(403);
    const made = await api(app, write, 'POST', '/api/v1/orgs/acme/projects/PLT/issues', { title: 'From a script', priority: 'high', assignee: 'priya@acme.dev', due: '2026-12-31', labels: ['api'], description: 'hello' });
    expect(made.statusCode, made.body).toBe(201);
    const key = made.json().issue.key as string;
    expect(made.json().issue).toMatchObject({ title: 'From a script', priority: 'high', assignee: { email: 'priya@acme.dev' }, due: '2026-12-31', labels: ['api'], reporter: { email: 'alex@acme.dev' } });
    for (const bad of [{}, { title: '   ' }, { title: 'x', priority: 'urgent' }, { title: 'x', status: 'Nope' }, { title: 'x', assignee: 'ghost@x.com' }, { title: 'x', due: '31/12/2026' }, { title: 'x'.repeat(400) }]) {
      expect((await api(app, write, 'POST', '/api/v1/orgs/acme/projects/PLT/issues', bad)).statusCode, JSON.stringify(bad).slice(0, 40)).toBe(400);
    }
    const status = projects.find((p: { key: string }) => p.key === 'PLT').statuses[1].name;
    const patched = await api(app, write, 'PATCH', `/api/v1/orgs/acme/issues/${key}`, { status, priority: 'low', assignee: null });
    expect(patched.statusCode, patched.body).toBe(200);
    expect(patched.json().issue).toMatchObject({ status, priority: 'low', assignee: null });
    expect((await api(app, write, 'PATCH', `/api/v1/orgs/acme/issues/${key}`, {})).statusCode).toBe(400);
    const c = await api(app, write, 'POST', `/api/v1/orgs/acme/issues/${key}/comments`, { body: 'Hello from the API' });
    expect(c.statusCode).toBe(201);
    expect((await api(app, read, 'GET', `/api/v1/orgs/acme/issues/${key}`)).json().comments.map((x: { body: string }) => x.body)).toContain('Hello from the API');

    // a guest's token can never do what a guest cannot do; and a token never reaches a company its owner is not in
    const maya = await login(app, 'maya@northwind.io');
    const mayaWrite = (await makeToken(maya, 'write')).token;
    const nwProject = ((await (await login(app, 'jordan@northwind.io')).rpc('loadOrg', 'org_nw')).body.result.projects as { key: string }[])[0].key;
    expect((await api(app, mayaWrite, 'POST', `/api/v1/orgs/northwind/projects/${nwProject}/issues`, { title: 'guest' })).statusCode).toBe(403);
    expect((await api(app, mayaWrite, 'GET', '/api/v1/orgs/acme/projects')).statusCode).toBe(403);
  });

  it('refuses web addresses that point inside the network', async () => {
    for (const a of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '172.31.255.255', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1', '::ffff:10.0.0.1', 'not-an-address']) expect(isPrivateAddress(a), a).toBe(true);
    for (const a of ['93.184.216.34', '8.8.8.8', '172.32.0.1', '2606:4700::1111']) expect(isPrivateAddress(a), a).toBe(false);
    const ok = { resolve: publicIp };
    await expect(assertSafeUrl('https://hooks.example.com/x', ok)).resolves.toBeInstanceOf(URL);
    for (const bad of ['http://hooks.example.com/x', 'ftp://x.com', 'https://localhost/x', 'https://a.localhost/x', 'https://127.0.0.1/x', 'https://[::1]/x', 'https://169.254.169.254/latest/meta-data', 'https://user:pw@hooks.example.com/x', 'https://db.internal/x', 'nonsense', 'https://x.com/' + 'a'.repeat(600)]) {
      await expect(assertSafeUrl(bad, ok), bad).rejects.toThrow();
    }
    await expect(assertSafeUrl('https://evil.example.com/x', { resolve: async () => ['10.0.0.5'] })).rejects.toThrow(/private/); // a name that points inside
    await expect(assertSafeUrl('https://evil.example.com/x', { resolve: async () => ['93.184.216.34', '127.0.0.1'] })).rejects.toThrow(/private/);
    await expect(assertSafeUrl('http://hooks.example.com/x', { ...ok, allowInsecure: true })).resolves.toBeInstanceOf(URL);
  });

  it('sends signed webhooks, only for chosen events, retries, and never follows redirects', async () => {
    const calls: { url: string; init: RequestInit & { headers: Record<string, string>; body: string } }[] = [];
    let status = 200;
    const fakeFetch = (async (url: string | URL, init: RequestInit & { headers: Record<string, string>; body: string }) => {
      calls.push({ url: String(url), init });
      return { ok: status < 300, status } as Response;
    }) as unknown as typeof fetch;
    let hooks!: Webhooks;
    const { app } = await server({ demo: true, webhooks: (db) => (hooks = new Webhooks({ db, fetchImpl: fakeFetch, resolve: publicIp, retryDelays: [0, 0] })) });
    const alex = await login(app, 'alex@acme.dev');
    const base = '/api/orgs/org_acme/webhooks';

    // who may manage them, and what is accepted
    expect((await (await login(app, 'sam@acme.dev')).call('GET', base)).status).toBe(403);
    expect((await alex.call('POST', base, { url: 'https://127.0.0.1/x', events: ['issue.created'] })).status).toBe(400);
    expect((await alex.call('POST', base, { url: 'https://hooks.example.com/a', events: [] })).status).toBe(400);
    const json = (await alex.call('POST', base, { url: 'https://hooks.example.com/json', events: ['issue.created', 'comment.created'], format: 'json' })).body;
    const slack = (await alex.call('POST', base, { url: 'https://hooks.example.com/slack', events: ['issue.updated', 'issue.deleted'], format: 'slack' })).body;
    expect(json.secret).toMatch(/^whsec_/);
    expect(JSON.stringify((await alex.call('GET', base)).body)).not.toContain(json.secret); // the secret is shown once

    // creating an item: only the hook that asked for it is called, signed so the receiver can check it
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    await alex.rpc('createIssue', 'org_acme', { projectId: 'p_plt', typeId: (await alex.rpc('loadOrg', 'org_acme')).body.result.projects.find((p: { id: string }) => p.id === 'p_plt').issueTypes[0].id, title: 'Webhook me' });
    await hooks.idle();
    expect(calls.map((c) => c.url)).toEqual(['https://hooks.example.com/json']);
    const c = calls[0];
    expect(c.init.redirect).toBe('manual');
    const body = JSON.parse(c.init.body);
    expect(body).toMatchObject({ event: 'issue.created', organization: 'acme', data: { title: 'Webhook me', key: expect.stringMatching(/^PLT-/) } });
    expect(c.init.headers['x-abg-event']).toBe('issue.created');
    expect(c.init.headers['x-abg-signature']).toBe(signPayload(json.secret, c.init.headers['x-abg-timestamp'], c.init.body));
    expect(c.init.headers['x-abg-signature']).not.toBe(signPayload('whsec_wrong', c.init.headers['x-abg-timestamp'], c.init.body));

    // updates and deletes go to the chat-style hook as one readable line
    calls.length = 0;
    await alex.rpc('updateIssue', id, { priority: 'critical' });
    await alex.rpc('addComment', id, 'ignored by the slack hook');
    await hooks.idle();
    expect(calls.map((x) => `${x.url} ${JSON.parse(x.init.body).event ?? 'text'}`)).toEqual(['https://hooks.example.com/slack text', 'https://hooks.example.com/json comment.created']);
    expect(JSON.parse(calls[0].init.body).text).toMatch(/^PLT-3 updated: .+\(http/);
    calls.length = 0;
    await alex.rpc('deleteIssue', id);
    await hooks.idle();
    expect(JSON.parse(calls[0].init.body).text).toMatch(/^PLT-3 deleted:/);

    // a failing receiver is retried, a refusing one is not, and the outcome is visible
    calls.length = 0;
    status = 500;
    await alex.rpc('createIssue', 'org_acme', { projectId: 'p_plt', typeId: (await alex.rpc('loadOrg', 'org_acme')).body.result.projects.find((p: { id: string }) => p.id === 'p_plt').issueTypes[0].id, title: 'Retry me' });
    await hooks.idle();
    expect(calls).toHaveLength(3);
    status = 403;
    calls.length = 0;
    await alex.rpc('createIssue', 'org_acme', { projectId: 'p_plt', typeId: (await alex.rpc('loadOrg', 'org_acme')).body.result.projects.find((p: { id: string }) => p.id === 'p_plt').issueTypes[0].id, title: 'Refused' });
    await hooks.idle();
    expect(calls).toHaveLength(1);
    const listed = (await alex.call('GET', base)).body.hooks as { id: string; lastStatus: string }[];
    expect(listed.find((h) => h.id === json.hook.id)!.lastStatus).toBe('Failed (403)');

    // switching off, testing, and removing
    status = 200;
    await alex.call('POST', `${base}/${json.hook.id}/active`, { active: false });
    calls.length = 0;
    await alex.rpc('createIssue', 'org_acme', { projectId: 'p_plt', typeId: (await alex.rpc('loadOrg', 'org_acme')).body.result.projects.find((p: { id: string }) => p.id === 'p_plt').issueTypes[0].id, title: 'Quiet' });
    await hooks.idle();
    expect(calls).toHaveLength(0);
    expect((await alex.call('POST', `${base}/${slack.hook.id}/test`)).body.result).toBe('OK (200)');
    expect((await alex.call('DELETE', `${base}/${slack.hook.id}`)).status).toBe(200);
    expect((await alex.call('DELETE', `${base}/${slack.hook.id}`)).status).toBe(404);
    expect((await (await login(app, 'priya@acme.dev')).call('DELETE', `${base}/${json.hook.id}`)).status).toBe(200); // admins may too
  });

  it('serves a private calendar of my due dates', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const priya = await login(app, 'priya@acme.dev');
    const cal = (await makeToken(priya, 'calendar')).token;
    const a = await issueId(alex, 'org_acme', 'PLT-3');
    const b = await issueId(alex, 'org_acme', 'PLT-4');
    const done = await issueId(alex, 'org_acme', 'PLT-6');
    const doneStatus = ((await alex.rpc('loadOrg', 'org_acme')).body.result.projects[0].statuses as { id: string; category: string }[]).find((s) => s.category === 'done')!.id;
    const upd = await alex.rpc('updateIssue', a, { assigneeId: 'u_priya', dueDate: '2030-05-06', title: 'Plan, review; "ship"\nBcc: x@evil.test' });
    expect(upd.status, JSON.stringify(upd.body)).toBe(200);
    await alex.rpc('updateIssue', b, { assigneeId: 'u_sam', dueDate: '2030-05-07' }); // someone else's
    await alex.rpc('updateIssue', done, { assigneeId: 'u_priya', dueDate: '2030-05-08' });
    await alex.rpc('updateIssue', done, { statusId: doneStatus });

    const res = await app.inject({ method: 'GET', url: `/api/cal/${cal}.ics` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    const ics = res.body;
    expect(ics.startsWith('BEGIN:VCALENDAR\r\n')).toBe(true);
    expect(ics).toContain('DTSTART;VALUE=DATE:20300506');
    expect(ics).toContain('DTEND;VALUE=DATE:20300507');
    expect(ics).not.toContain('20300507\r\nSUMMARY:PLT-4'); // not Sam's
    expect(ics).not.toContain('PLT-6'); // finished work is not a deadline
    expect(ics.replace(/\r\n /g, '')).toContain('SUMMARY:PLT-3 Plan\\, review\\; "ship"'); // commas and semicolons are escaped
    expect(ics.replace(/\r\n /g, '')).not.toMatch(/\r\nBcc:/);
    expect(ics.split('\r\n').every((l) => Buffer.byteLength(l) <= 75)).toBe(true);

    for (const bad of [`${cal}x.ics`, 'abg_nothing-here-at-all-1234567.ics', `${cal}.txt`]) expect((await app.inject({ method: 'GET', url: `/api/cal/${bad}` })).statusCode, bad).toBe(404);
    const read = (await makeToken(priya, 'read')).token;
    expect((await app.inject({ method: 'GET', url: `/api/cal/${read}.ics` })).statusCode).toBe(404); // an API key is not a calendar link
    await priya.call('DELETE', `/api/me/tokens/${(await priya.call('GET', '/api/me/tokens')).body.tokens.find((t: { scope: string }) => t.scope === 'calendar').id}`);
    expect((await app.inject({ method: 'GET', url: `/api/cal/${cal}.ics` })).statusCode).toBe(404); // revoked
  });
});
describe('calendar text safety', () => {
  it('can never let an item title add lines or fields to the calendar file', () => {
    const issue = { id: 'i1', key: 'X-1', title: 'a\r\nEND:VEVENT\r\nBEGIN:VEVENT\r\nATTENDEE:evil', dueDate: '2030-01-02', statusId: 's1' } as never;
    const project = { name: 'P', statuses: [{ id: 's1', category: 'todo' }] } as never;
    const ics = dueDatesIcs([{ issue, project, orgName: 'O;rg', url: 'https://x/y' }]);
    const unfolded = ics.replace(/\r\n /g, '');
    expect(unfolded.split('\r\n').filter((l) => l.startsWith('BEGIN:VEVENT'))).toHaveLength(1);
    expect(unfolded.split('\r\n').filter((l) => l.startsWith('ATTENDEE'))).toHaveLength(0);
    expect(unfolded).toMatch(/SUMMARY:X-1 a\s*\\nEND:VEVENT\s*\\nBEGIN:VEVENT\s*\\nATTENDEE:evil/); // it stays inside one escaped text field
  });
});

describe('live updates, watchers, reactions, reminder lead time', () => {
  const login = async (app: FastifyInstance, email: string) => {
    const c = new Client(app);
    expect((await c.login(email)).status).toBe(200);
    return c;
  };

  /** Opens the live stream for real (it never "finishes", so a test server on a free port is needed). */
  const listen = async (app: FastifyInstance) => {
    await app.listen({ port: 0, host: '127.0.0.1' });
    return (app.server.address() as { port: number }).port;
  };
  const openStream = (port: number, cookie: string) =>
    new Promise<{ events: string[]; status: number; closed: () => boolean; close: () => void }>((resolve) => {
      const events: string[] = [];
      let closed = false;
      const req = httpGet({ host: '127.0.0.1', port, path: '/api/events', headers: { cookie } }, (res) => {
        res.setEncoding('utf8');
        res.on('data', (d: string) => events.push(...d.split('\n\n').filter((x) => x.startsWith('event:'))));
        res.on('close', () => (closed = true));
        resolve({ events, status: res.statusCode ?? 0, closed: () => closed, close: () => req.destroy() });
      });
      req.on('error', () => undefined);
    });
  const settle = (ms = 150) => new Promise((r) => setTimeout(r, ms));

  it('tells connected members when their organization changes, and nobody else', async () => {
    const { app } = await server({ demo: true });
    const port = await listen(app);
    const alex = await login(app, 'alex@acme.dev');
    const maya = await login(app, 'maya@northwind.io'); // a guest in Northwind only
    const a = await openStream(port, alex.cookie);
    const m = await openStream(port, maya.cookie);
    expect(a.status).toBe(200);
    expect((await openStream(port, '')).status).toBe(401); // no sign-in, no stream

    const id = await issueId(alex, 'org_acme', 'PLT-3');
    await alex.rpc('updateIssue', id, { priority: 'low' });
    await settle();
    expect(a.events.some((e) => e.includes('event: changed') && e.includes('"orgId":"org_acme"'))).toBe(true);
    expect(JSON.stringify(a.events)).not.toMatch(/PLT-3|low|title/); // it only says that something changed, never what
    expect(m.events).toEqual([]); // another company hears nothing
    const before = a.events.length;
    await alex.rpc('loadOrg', 'org_acme'); // reading is not a change
    await settle();
    expect(a.events.length).toBe(before);
    a.close();
    m.close();
  });

  it('keeps at most five streams per person (many tabs), closing the oldest', async () => {
    const { app } = await server({ demo: true });
    const port = await listen(app);
    const alex = await login(app, 'alex@acme.dev');
    const streams = [];
    for (let i = 0; i < 6; i++) streams.push(await openStream(port, alex.cookie));
    await settle();
    expect(streams[0].closed()).toBe(true);
    expect(streams.slice(1).every((s) => !s.closed())).toBe(true);
    streams.forEach((s) => s.close());
  });

  it('follows items: watchers hear about comments and status changes, and commenting follows for you', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const sam = await login(app, 'sam@acme.dev');
    const priya = await login(app, 'priya@acme.dev');
    const inboxOf = async (c: Client, issue: string) => ((await c.rpc('loadOrg', 'org_acme')).body.result.notifications as { issueId: string; kind: string }[]).filter((n) => n.issueId === issue);
    const typeId = (await alex.rpc('loadOrg', 'org_acme')).body.result.projects.find((p: { id: string }) => p.id === 'p_plt').issueTypes[0].id;
    const free = (await alex.rpc('createIssue', 'org_acme', { projectId: 'p_plt', typeId, title: 'Followed item' })).body.result as { id: string }; // nobody but Alex is tied to it

    expect((await sam.rpc('setWatching', free.id, true)).status).toBe(200);
    expect((await sam.rpc('setWatching', free.id, true)).status).toBe(200); // idempotent
    expect(((await sam.rpc('loadOrg', 'org_acme')).body.result.issues.find((i: { id: string }) => i.id === free.id).watcherIds as string[]).filter((x) => x === 'u_sam')).toHaveLength(1);
    await priya.rpc('addComment', free.id, 'Looking at this');
    expect((await inboxOf(sam, free.id)).some((n) => n.kind === 'comment')).toBe(true);

    // priya commented, so she follows now; a status change reaches both watchers but not the person who made it
    const project = (await alex.rpc('loadOrg', 'org_acme')).body.result.projects.find((p: { id: string }) => p.id === 'p_plt');
    const issue = (await alex.rpc('loadOrg', 'org_acme')).body.result.issues.find((i: { id: string }) => i.id === free.id);
    expect(issue.watcherIds).toEqual(expect.arrayContaining(['u_sam', 'u_priya']));
    const other = project.statuses.find((s: { id: string }) => s.id !== issue.statusId);
    await alex.rpc('updateIssue', free.id, { statusId: other.id });
    const statusFor = async (c: Client) => (await inboxOf(c, free.id)).some((n) => n.kind === 'status');
    expect(await statusFor(sam)).toBe(true);
    expect(await statusFor(priya)).toBe(true);
    expect(await statusFor(alex)).toBe(false);

    // stop following: no more
    await sam.rpc('setWatching', free.id, false);
    const had = (await inboxOf(sam, free.id)).length;
    await alex.rpc('addComment', free.id, 'Another one');
    expect((await inboxOf(sam, free.id)).length).toBe(had);

    // outsiders cannot follow other companies' items
    const out = new Client(app);
    await out.call('POST', '/api/auth/register', { name: 'Out', email: 'out@sider.test', password: 'a-long-passphrase', orgName: 'Outside Co' });
    expect((await out.rpc('setWatching', free.id, true)).status).toBeGreaterThanOrEqual(400);
    expect((await new Client(app).rpc('setWatching', free.id, true)).status).toBe(401);
  });

  it('adds and removes reactions on comments, with a fixed set of emoji', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const sam = await login(app, 'sam@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    const comment = (await alex.rpc('addComment', id, 'Ship it')).body.result;
    const reactions = async () => ((await alex.rpc('loadOrg', 'org_acme')).body.result.comments.find((c: { id: string }) => c.id === comment.id).reactions ?? {}) as Record<string, string[]>;

    expect((await sam.rpc('toggleReaction', comment.id, '👍')).status).toBe(200);
    expect((await alex.rpc('toggleReaction', comment.id, '👍')).status).toBe(200);
    expect((await reactions())['👍'].sort()).toEqual(['u_alex', 'u_sam']);
    await sam.rpc('toggleReaction', comment.id, '👍'); // takes it back
    expect((await reactions())['👍']).toEqual(['u_alex']);
    await alex.rpc('toggleReaction', comment.id, '👍');
    expect(await reactions()).toEqual({}); // an emoji nobody uses disappears

    for (const bad of ['<script>', '💣', '', '👍👍', 'x'.repeat(50)]) expect((await alex.rpc('toggleReaction', comment.id, bad)).status, bad).toBe(400);
    expect((await alex.rpc('toggleReaction', 'c_missing', '👍')).status).toBeGreaterThanOrEqual(400);
    const out = new Client(app);
    await out.call('POST', '/api/auth/register', { name: 'Out', email: 'out2@sider.test', password: 'a-long-passphrase', orgName: 'Outside Two' });
    expect((await out.rpc('toggleReaction', comment.id, '👍')).status).toBeGreaterThanOrEqual(400);
    expect(await reactions()).toEqual({});
  });

  it('lets people choose how many days ahead to be reminded, and tells the reporter when work slips', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    const priya = await login(app, 'priya@acme.dev');
    const day = (n: number) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
    const due = async (key: string, offset: number, watcher?: Client) => {
      const id = await issueId(alex, 'org_acme', key);
      expect((await alex.rpc('updateIssue', id, { assigneeId: 'u_priya', dueDate: day(offset) })).status).toBe(200);
      if (watcher) await watcher.rpc('setWatching', id, true);
      return id;
    };
    const mine = async (c: Client, id: string) => ((await c.rpc('loadOrg', 'org_acme')).body.result.notifications as { issueId: string; kind: string; detail: string }[]).filter((n) => n.kind === 'due' && n.issueId === id).map((n) => n.detail);

    const org0 = (await alex.rpc('loadOrg', 'org_acme')).body.result;
    const doneIds = new Set(org0.projects.find((p: { id: string }) => p.id === 'p_plt').statuses.filter((s: { category: string }) => s.category === 'done').map((s: { id: string }) => s.id));
    const open = (org0.issues as { key: string; projectId: string; statusId: string }[]).filter((i) => i.projectId === 'p_plt' && !doneIds.has(i.statusId)).map((i) => i.key);
    expect(open.length).toBeGreaterThanOrEqual(3);
    expect((await priya.rpc('setNotifyPrefs', { email: 'instant', scope: 'important', dueLeadDays: 3 })).status).toBe(200);
    const three = await due(open[0], 3);
    const four = await due(open[1], 4);
    await app.remindDue();
    expect(await mine(priya, three)).toEqual([`Due soon (${day(3)})`]);
    expect(await mine(priya, four)).toEqual([]);
    await app.remindDue(new Date(Date.now() + 86_400_000)); // a day later: now two days ahead, and the day-four item comes into range
    expect(await mine(priya, three)).toEqual([`Due soon (${day(3)})`]); // still just once
    expect(await mine(priya, four)).toEqual([`Due soon (${day(4)})`]);

    for (const bad of [0, 8, 2.5, '3', null as unknown as number]) {
      const r = await priya.rpc('setNotifyPrefs', { email: 'instant', scope: 'important', dueLeadDays: bad });
      if (bad === null) expect(r.status).toBe(200);
      else expect(r.status, String(bad)).toBe(400);
    }

    // overdue: the person who asked for it, and anyone watching, hear too (once)
    const sam = await login(app, 'sam@acme.dev');
    const late = await due(open[2], -1, sam);
    await app.remindDue();
    await app.remindDue();
    expect(await mine(priya, late)).toEqual([`Overdue since ${day(-1)}`]);
    expect(await mine(sam, late)).toEqual([`Overdue since ${day(-1)}`]);
    const reporter = ((await alex.rpc('loadOrg', 'org_acme')).body.result.issues.find((i: { id: string }) => i.id === late) as { reporterId: string }).reporterId;
    if (reporter !== 'u_priya' && reporter !== 'u_sam') {
      const who = await login(app, reporter === 'u_alex' ? 'alex@acme.dev' : 'priya@acme.dev');
      expect(await mine(who, late)).toEqual([`Overdue since ${day(-1)}`]);
    }
  });
});

describe('mock services: plans and billing, single sign-on, AI summaries', () => {
  const login = async (app: FastifyInstance, email: string) => {
    const c = new Client(app);
    expect((await c.login(email)).status).toBe(200);
    return c;
  };
  const org = async (c: Client, id: string) => ((await c.call('GET', '/api/auth/me')).body.orgs as { id: string; plan: string }[]).find((o) => o.id === id)!;

  it('only allows pretend services where that is safe, and says so plainly', () => {
    const prod = { NODE_ENV: 'production', PUBLIC_URL: 'https://t.example.com', DATABASE_URL: 'postgres://x' };
    expect(loadConfig({ ...prod }).services).toEqual({ billing: 'none', sso: 'none', ai: 'none' }); // production: nothing pretends unless asked
    expect(loadConfig({ ...prod, ALLOW_MOCK_SERVICES: '1' }).services).toEqual({ billing: 'mock', sso: 'mock', ai: 'mock' });
    expect(loadConfig({ NODE_ENV: 'development' }).services.sso).toBe('mock');
    expect(() => loadConfig({ ...prod, SSO_PROVIDER: 'mock' })).toThrow(/SSO_PROVIDER=mock.*refused in production/);
    expect(() => loadConfig({ NODE_ENV: 'development', BILLING_PROVIDER: 'stripe' })).toThrow(/BILLING_PROVIDER=stripe is not available yet/);
    expect(loadConfig({ NODE_ENV: 'development', AI_PROVIDER: 'none' }).services.ai).toBe('none');
  });

  it('enforces plan limits for people and projects, whatever the payment provider is', async () => {
    const { app } = await server({ services: { billing: 'mock' } });
    const owner = new Client(app);
    const reg = await owner.call('POST', '/api/auth/register', { name: 'Olive Owner', email: 'olive@plan.test', password: 'a-long-passphrase', orgName: 'Plan Co' });
    const orgId = reg.body.orgs[0].id as string;
    expect(reg.body.orgs[0].plan).toBe('free');

    // free: 10 people including the owner and anyone invited
    let allowed = 0;
    let last = 0;
    for (let i = 0; i < 12; i++) {
      const r = await owner.call('POST', `/api/orgs/${orgId}/invites`, { email: `p${i}@plan.test`, role: 'member' });
      last = r.status;
      if (r.status === 200) allowed++;
      else break;
    }
    expect(allowed).toBe(PLANS.free.people - 1);
    expect(last).toBe(402);
    const blocked = await owner.call('POST', `/api/orgs/${orgId}/invites`, { email: 'one-more@plan.test', role: 'member' });
    expect(blocked.body.error).toMatch(/Free plan includes 10 people/);

    // projects: 5 on free
    for (let i = 0; i < PLANS.free.projects; i++) expect((await owner.rpc('createProject', orgId, { name: `P${i}`, key: `PX${i}`, description: '', color: '#0f766e', workStyle: 'agile' })).status).toBe(200);
    const sixth = await owner.rpc('createProject', orgId, { name: 'P6', key: 'PX9', description: '', color: '#0f766e', workStyle: 'agile' });
    expect(sixth.status).toBe(402);

    // upgrading lifts both
    expect((await owner.call('POST', `/api/orgs/${orgId}/billing/plan`, { plan: 'team' })).status).toBe(200);
    expect((await owner.call('POST', `/api/orgs/${orgId}/invites`, { email: 'one-more@plan.test', role: 'member' })).status).toBe(200);
    expect((await owner.rpc('createProject', orgId, { name: 'P6', key: 'PX9', description: '', color: '#0f766e', workStyle: 'agile' })).status).toBe(200);
  });

  it('lets only an owner change the plan, never strands work on a smaller plan, and records it', async () => {
    const { app } = await server({ demo: true, services: { billing: 'mock' } });
    const alex = await login(app, 'alex@acme.dev'); // owner of Acme (business)
    const priya = await login(app, 'priya@acme.dev'); // admin
    const sam = await login(app, 'sam@acme.dev');

    const view = (await alex.call('GET', '/api/orgs/org_acme/billing')).body;
    expect(view).toMatchObject({ mode: 'mock', plan: 'business', canChange: true, usage: { people: 3 } });
    expect((await priya.call('GET', '/api/orgs/org_acme/billing')).body.canChange).toBe(false); // may look, not change
    expect((await sam.call('GET', '/api/orgs/org_acme/billing')).status).toBe(403);
    expect((await priya.call('POST', '/api/orgs/org_acme/billing/plan', { plan: 'team' })).status).toBe(403);
    expect((await alex.call('POST', '/api/orgs/org_acme/billing/plan', { plan: 'gold' })).status).toBe(400);
    expect((await alex.call('POST', '/api/orgs/org_acme/billing/plan', { plan: 'business' })).status).toBe(409);

    // down to Free is refused while Acme has more projects than Free includes
    let projects = ((await alex.rpc('loadOrg', 'org_acme')).body.result.projects as unknown[]).length;
    for (let i = 0; projects <= PLANS.free.projects; i++, projects++) await alex.rpc('createProject', 'org_acme', { name: `Extra ${i}`, key: `EX${i}`, description: '', color: '#0f766e', workStyle: 'agile' });
    const down = await alex.call('POST', '/api/orgs/org_acme/billing/plan', { plan: 'free' });
    expect(down.status).toBe(409);
    expect(down.body.error).toMatch(/Free plan includes 10 people and 5 projects/);
    expect((await org(alex, 'org_acme')).plan).toBe('business'); // nothing changed
    expect((await alex.call('POST', '/api/orgs/org_acme/billing/plan', { plan: 'team' })).status).toBe(200);
    expect((await org(alex, 'org_acme')).plan).toBe('team');
    const after = (await alex.call('GET', '/api/orgs/org_acme/billing')).body;
    expect(after.invoices[0]).toMatchObject({ plan: 'team', amountUsd: 49, mock: true });
    const events = (await alex.call('GET', '/api/orgs/org_acme/audit')).body.events as { action: string; detail: string }[];
    expect(events.find((e) => e.action === 'billing.plan')!.detail).toMatch(/Business → Team.*no real charge/);
    // people in another company cannot touch it
    expect((await (await login(app, 'jordan@northwind.io')).call('POST', '/api/orgs/org_acme/billing/plan', { plan: 'free' })).status).toBe(403);
  });

  it('with no billing provider, shows the plan but refuses to change it', async () => {
    const { app } = await server({ demo: true });
    const alex = await login(app, 'alex@acme.dev');
    expect((await alex.call('GET', '/api/orgs/org_acme/billing')).body).toMatchObject({ mode: 'none', canChange: false, invoices: [] });
    const r = await alex.call('POST', '/api/orgs/org_acme/billing/plan', { plan: 'team' });
    expect(r.status).toBe(400);
    expect((await org(alex, 'org_acme')).plan).toBe('business');
    expect((await new Client(app).call('GET', '/api/config')).body.sso).toBeNull();
  });

  it('signs people in through the (mock) identity provider with the checks a real one needs', async () => {
    const { app, db } = await server({ demo: true, services: { sso: 'mock' } });
    const cfg = (await new Client(app).call('GET', '/api/config')).body;
    expect(cfg.sso).toMatchObject({ id: 'mock', mock: true });

    const attempt = async (email: string, name: string, extra = '&verified=1') => {
      const start = await app.inject({ method: 'GET', url: '/api/auth/sso/start' });
      expect(start.statusCode).toBe(302);
      const state = /state=([^&]+)/.exec(String(start.headers.location))![1];
      const stateCookie = start.cookies.find((c) => c.name === 'abg_sso_state')!;
      expect(stateCookie.httpOnly).toBe(true);
      const approve = await app.inject({ method: 'GET', url: `/api/sso/mock/approve?state=${state}&email=${encodeURIComponent(email)}&name=${encodeURIComponent(name)}${extra}` });
      const back = String(approve.headers.location).replace('http://localhost:3001', '');
      return { back, state, cookie: `abg_sso_state=${stateCookie.value}`, callback: (cookie: string, url = back) => app.inject({ method: 'GET', url, headers: { cookie } }) };
    };
    const sessionOf = (res: Awaited<ReturnType<FastifyInstance['inject']>>) => res.cookies.find((c) => c.name === 'abg_session');

    // an existing person
    const a = await attempt('priya@acme.dev', 'Priya N');
    const ok = await a.callback(a.cookie);
    expect(ok.statusCode).toBe(302);
    expect(ok.headers.location).toBe('/');
    const cookie = `abg_session=${sessionOf(ok)!.value}`;
    expect(JSON.parse((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie } })).body).user.email).toBe('priya@acme.dev');

    // a new person gets their own passwordless account and workspace
    const n = await attempt('new.person@company.test', 'Nia Newcomer');
    const made = await n.callback(n.cookie);
    expect(made.headers.location).toBe('/');
    const me = JSON.parse((await app.inject({ method: 'GET', url: '/api/auth/me', headers: { cookie: `abg_session=${sessionOf(made)!.value}` } })).body);
    expect(me.user.email).toBe('new.person@company.test');
    expect(me.orgs[0].name).toBe("Nia Newcomer's workspace");
    expect(Number((await db.query(`select count(*) as n from credentials where user_id = $1`, [me.user.id]))[0].n)).toBe(0); // no password exists to guess
    expect((await new Client(app).login('new.person@company.test', '')).status).toBe(401);

    // refused: unverified address, another browser's attempt, a tampered code, no state, a wrong return address
    const u = await attempt('someone@x.test', 'S', '');
    const unverified = await u.callback(u.cookie);
    expect(unverified.headers.location).toBe('/?sso_error=unverified');
    expect(sessionOf(unverified)).toBeUndefined();
    const s = await attempt('priya@acme.dev', 'P');
    expect((await s.callback('abg_sso_state=someone-elses-state')).headers.location).toBe('/?sso_error=state');
    expect((await s.callback('')).headers.location).toBe('/?sso_error=state');
    const tampered = s.back.replace(/code=([^.]+)\./, 'code=$1x.');
    expect((await s.callback(s.cookie, tampered)).headers.location).toBe('/?sso_error=verify');
    expect(sessionOf(await s.callback(s.cookie, tampered))).toBeUndefined();
    expect((await app.inject({ method: 'GET', url: '/api/sso/mock/authorize?state=x&redirect_uri=https://evil.test/cb' })).statusCode).toBe(400);
    const page = await app.inject({ method: 'GET', url: `/api/sso/mock/authorize?state=${encodeURIComponent('"><script>x</script>')}&redirect_uri=${encodeURIComponent('http://localhost:3001/api/auth/sso/callback')}` });
    expect(page.body).not.toContain('<script>x');
  });

  it('is closed to strangers when sign-up is closed, and absent when not configured', async () => {
    const closed = await server({ demo: true, allowSignup: false, services: { sso: 'mock' } });
    const start = await closed.app.inject({ method: 'GET', url: '/api/auth/sso/start' });
    const state = /state=([^&]+)/.exec(String(start.headers.location))![1];
    const approve = await closed.app.inject({ method: 'GET', url: `/api/sso/mock/approve?state=${state}&email=stranger@x.test&name=Stranger&verified=1` });
    const res = await closed.app.inject({ method: 'GET', url: String(approve.headers.location).replace('http://localhost:3001', ''), headers: { cookie: `abg_sso_state=${start.cookies[0].value}` } });
    expect(res.headers.location).toBe('/?sso_error=closed');

    const none = await server({ demo: true });
    expect((await none.app.inject({ method: 'GET', url: '/api/auth/sso/start' })).statusCode).toBe(404);
    expect((await none.app.inject({ method: 'GET', url: '/api/sso/mock/authorize?state=x&redirect_uri=y' })).statusCode).toBe(404);
  });

  it('summarizes an item with the (mock) AI, using only its own text, for members only', async () => {
    const { app } = await server({ demo: true, services: { ai: 'mock' } });
    const alex = await login(app, 'alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    await alex.rpc('addComment', id, 'First thought from Alex');
    await (await login(app, 'priya@acme.dev')).rpc('addComment', id, 'Priya agrees, ship Friday');
    const r = await alex.call('POST', '/api/orgs/acme/issues/PLT-3/summary');
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ mock: true, provider: expect.stringMatching(/Mock AI/) });
    expect(r.body.summary).toMatch(/\d+ comments? from .*(Alex|Priya)/s);
    expect(r.body.summary).toContain('Priya agrees, ship Friday');
    expect(r.body.summary).not.toMatch(/@|u_alex|org_acme/); // no addresses or internal ids reach the assistant
    expect((await alex.call('POST', '/api/orgs/acme/issues/PLT-99999/summary')).status).toBe(404);
    expect((await (await login(app, 'jordan@northwind.io')).call('POST', '/api/orgs/acme/issues/PLT-3/summary')).status).toBeGreaterThanOrEqual(403);
    expect((await new Client(app).call('POST', '/api/orgs/acme/issues/PLT-3/summary')).status).toBe(401);
    let last = 0;
    for (let i = 0; i < 25; i++) last = (await alex.call('POST', '/api/orgs/acme/issues/PLT-3/summary')).status;
    expect(last).toBe(429);

    const off = await server({ demo: true });
    expect((await (await login(off.app, 'alex@acme.dev')).call('POST', '/api/orgs/acme/issues/PLT-3/summary')).status).toBe(404);
  });
});

describe('dashboard layout over the API', () => {
  it('is saved per person, validated, private, kept across a restart, and resettable', async () => {
    const ctx = await server({ demo: true });
    const priya = new Client(ctx.app);
    await priya.login('priya@acme.dev');
    const alex = new Client(ctx.app);
    await alex.login('alex@acme.dev');
    const layout = { widgets: [{ id: 'activity', visible: true, size: 'full' }, { id: 'mine', visible: false, size: 'half' }, { id: 'kpis', visible: true, size: 'half' }] };

    expect((await priya.rpc('setDashboardLayout', layout)).status).toBe(200);
    const mine = (await priya.call('GET', '/api/auth/me')).body.user.dashboard.widgets as { id: string }[];
    expect(mine[0].id).toBe('activity');
    expect(mine.length).toBeGreaterThan(3); // the widgets she did not mention are kept, not lost
    expect((await alex.call('GET', '/api/auth/me')).body.user.dashboard).toBeUndefined(); // another person's layout is untouched
    expect(JSON.stringify((await alex.rpc('loadOrg', 'org_acme')).body.result.members)).not.toContain('"dashboard"'); // and invisible to colleagues

    for (const bad of [{ widgets: [{ id: 'evil', visible: true, size: 'half' }] }, { widgets: [] }, { widgets: 'x' }, 'nope', 5]) expect((await priya.rpc('setDashboardLayout', bad)).status, JSON.stringify(bad)).toBe(400);
    expect((await priya.call('GET', '/api/auth/me')).body.user.dashboard.widgets[0].id).toBe('activity'); // a bad save changes nothing
    expect((await new Client(ctx.app).rpc('setDashboardLayout', layout)).status).toBe(401);

    const again = await restart(ctx);
    const priya2 = new Client(again.app);
    await priya2.login('priya@acme.dev');
    expect((await priya2.call('GET', '/api/auth/me')).body.user.dashboard.widgets[0].id).toBe('activity');
    expect((await priya2.rpc('setDashboardLayout', null)).status).toBe(200);
    expect((await priya2.call('GET', '/api/auth/me')).body.user.dashboard).toBeUndefined();
  });
});

describe('AI daily briefing', () => {
  const login = async (app: FastifyInstance, email: string) => {
    const c = new Client(app);
    expect((await c.login(email)).status).toBe(200);
    return c;
  };
  const input = (over: Partial<BriefInput> = {}): BriefInput => ({
    firstName: 'Sam',
    counts: { open: 4, overdue: 1, blocked: 1, dueThisWeek: 2, awaitingMyApproval: 1, doneThisWeek: 0 },
    items: [
      { key: 'A-1', title: 'Later', status: 'To do', priority: 'low', dueInDays: 20, blocked: false },
      { key: 'A-2', title: 'Late', status: 'To do', priority: 'medium', dueInDays: -3, blocked: false },
      { key: 'A-3', title: 'Today', status: 'To do', priority: 'high', dueInDays: 0, blocked: false },
      { key: 'A-4', title: 'Stuck but urgent', status: 'To do', priority: 'critical', dueInDays: 1, blocked: true },
    ],
    approvals: [{ key: 'A-9', title: 'Sign me' }],
    ...over,
  });

  it('(mock) puts late and due-today work first, ranks blocked work lower, and says what to watch', async () => {
    const out = await new MockAiProvider().brief(input());
    expect(out.summary).toBe('Hi Sam. You have 4 open items, 1 of them overdue, and 2 due in the next 7 days.');
    expect(out.focus).toEqual([
      { key: 'A-2', why: '3 days overdue' },
      { key: 'A-3', why: 'Due today, high priority' },
      { key: 'A-4', why: 'Due in 1 day, critical priority' },
    ]);
    expect(out.watchouts).toEqual(['1 item is waiting for your approval, starting with A-9.', 'A-4 is blocked by other work.', '1 critical item is still open.', 'Nothing has been finished this week yet.']);
  });

  it('(mock) handles an empty day and a calm one', async () => {
    const none = await new MockAiProvider().brief(input({ counts: { open: 0, overdue: 0, blocked: 0, dueThisWeek: 0, awaitingMyApproval: 0, doneThisWeek: 3 }, items: [], approvals: [] }));
    expect(none.summary).toMatch(/nothing open/);
    expect(none.focus).toEqual([]);
    expect(none.watchouts).toEqual([]);
    const calm = await new MockAiProvider().brief(input({ counts: { open: 1, overdue: 0, blocked: 0, dueThisWeek: 0, awaitingMyApproval: 0, doneThisWeek: 1 }, items: [{ key: 'A-1', title: 'x', status: 's', priority: 'low', dueInDays: null, blocked: false }], approvals: [] }));
    expect(calm.summary).toBe('Hi Sam. You have 1 open item. Nothing is pressing.');
    expect(calm.focus).toEqual([{ key: 'A-1', why: 'Next in line' }]);
  });

  it('briefs a person about their own work, in their words, from what only the server knows', async () => {
    let seen: BriefInput | null = null;
    const spy: AiProvider = { kind: 'mock', label: 'Spy', summarize: async () => '', brief: async (i) => ((seen = i), new MockAiProvider().brief(i)) };
    const { app } = await server({ demo: true, services: { ai: 'mock' }, aiProvider: spy });
    const alex = await login(app, 'alex@acme.dev');
    const id = await issueId(alex, 'org_acme', 'PLT-3');
    await alex.rpc('updateIssue', id, { assigneeId: 'u_alex', dueDate: '2000-01-01', title: 'Ancient deadline' });

    const r = await alex.call('POST', '/api/orgs/acme/briefing');
    expect(r.status, JSON.stringify(r.body)).toBe(200);
    expect(r.body).toMatchObject({ mock: true, provider: 'Spy', summary: expect.stringMatching(/^Hi Alex\./) });
    expect(r.body.focus[0]).toMatchObject({ key: 'PLT-3', title: 'Ancient deadline' });
    expect(r.body.focus[0].why).toMatch(/days overdue/);
    expect(typeof r.body.at).toBe('string');

    // what the assistant was handed: counts and a short list of the person's own items, nothing else
    const s = seen as unknown as BriefInput;
    expect(s.firstName).toBe('Alex');
    expect(s.items.length).toBeLessThanOrEqual(15);
    expect(s.items.every((i) => Object.keys(i).sort().join() === 'blocked,dueInDays,key,priority,status,title')).toBe(true);
    expect(JSON.stringify(s)).not.toMatch(/@|u_alex|u_priya|org_acme|p_plt|storage|password/);
    const org = (await alex.rpc('loadOrg', 'org_acme')).body.result as { issues: { key: string; assigneeId?: string; projectId: string; statusId: string }[]; projects: { id: string; statuses: { id: string; category: string }[] }[] };
    const open = org.issues.filter((i) => i.assigneeId === 'u_alex' && org.projects.find((p) => p.id === i.projectId)!.statuses.find((x) => x.id === i.statusId)!.category !== 'done').map((i) => i.key);
    expect(s.items.every((i) => open.includes(i.key))).toBe(true); // only his own unfinished work
    expect(s.counts.open).toBe(open.length);
  });
  it('only lets the assistant point at items it was given, and limits what comes back', async () => {
    const hostile: AiProvider = {
      kind: 'live',
      label: 'Hostile',
      summarize: async () => '',
      brief: async (i) =>
        ({
          summary: 'x'.repeat(5000),
          focus: [{ key: 'EVIL-1', why: 'made up' }, { key: i.items[0]?.key ?? 'none', why: 'y'.repeat(900) }, { key: i.items[0]?.key ?? 'none', why: 'repeat' }, null, { key: 7, why: 'bad' }],
          watchouts: Array.from({ length: 20 }, () => 'w'.repeat(900)),
        }) as never,
    };
    const { app } = await server({ demo: true, services: { ai: 'mock' }, aiProvider: hostile });
    const alex = await login(app, 'alex@acme.dev');
    const r = (await alex.call('POST', '/api/orgs/acme/briefing')).body;
    expect(r.summary).toHaveLength(600);
    expect(r.focus.map((f: { key: string }) => f.key)).not.toContain('EVIL-1');
    expect(new Set(r.focus.map((f: { key: string }) => f.key)).size).toBe(r.focus.length); // no repeats
    expect(r.focus.every((f: { why: string }) => f.why.length <= 120)).toBe(true);
    expect(r.watchouts).toHaveLength(4);
    expect(r.watchouts.every((w: string) => w.length <= 200)).toBe(true);
    expect(r.mock).toBe(false);

    const broken: AiProvider = { kind: 'live', label: 'Broken', summarize: async () => '', brief: async () => Promise.reject(new Error('api key sk-secret rejected')) };
    const b = await server({ demo: true, services: { ai: 'mock' }, aiProvider: broken });
    const res = await (await login(b.app, 'alex@acme.dev')).call('POST', '/api/orgs/acme/briefing');
    expect(res.status).toBe(502);
    expect(JSON.stringify(res.body)).not.toContain('sk-secret'); // provider errors never reach the screen
  });

  it('is for members of that organization only, off when no assistant is connected, and rate limited', async () => {
    const { app } = await server({ demo: true, services: { ai: 'mock' } });
    const alex = await login(app, 'alex@acme.dev');
    expect((await new Client(app).call('POST', '/api/orgs/acme/briefing')).status).toBe(401);
    expect((await alex.call('POST', '/api/orgs/nowhere/briefing')).status).toBe(404);
    const outsider = new Client(app);
    await outsider.call('POST', '/api/auth/register', { name: 'Out', email: 'out3@sider.test', password: 'a-long-passphrase', orgName: 'Outside Three' });
    expect((await outsider.call('POST', '/api/orgs/acme/briefing')).status).toBeGreaterThanOrEqual(403);
    let last = 0;
    for (let i = 0; i < 12; i++) last = (await alex.call('POST', '/api/orgs/acme/briefing')).status;
    expect(last).toBe(429);

    const off = await server({ demo: true });
    expect((await (await login(off.app, 'alex@acme.dev')).call('POST', '/api/orgs/acme/briefing')).status).toBe(404);
  });
});