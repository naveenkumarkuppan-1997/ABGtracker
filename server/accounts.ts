import { can } from '../src/domain/permissions';
import { slugify } from '../src/domain/forms';
import type { Organization, Role, User } from '../src/domain/types';
import { buildSeed, type Database } from '../src/data/seed';
import {
  createSession,
  deleteUserSessions,
  getDummyHash,
  hashPassword,
  hashToken,
  newId,
  newToken,
  passwordProblem,
  verifyPassword,
  type SessionMeta,
} from './auth';
import QRCode from 'qrcode';
import type { Db } from './db';
import { otpauthUri, TwoFactor } from './twofactor';
import { ConsoleMailer, type MailMessage, type Mailer } from './mailer';
import { HttpError } from './errors';
import type { PostgresSnapshotStore } from './store';
import type { MongoSnapshotStore } from './mongoStore';

const COLORS = ['#0d3133', '#7c5cd6', '#2f9e6b', '#e8833a', '#dc4b4b', '#3b82f6', '#0f8b8d'];
const RESERVED_SLUGS = new Set(['forms', 'invite', 'api', 'login', 'register', 'signup', 'assets', 'admin', 'static', 'health']);
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const INVITE_DAYS = 7;

export const DEMO_PASSWORD = 'demo-password-1';

export const normEmail = (e: unknown): string => {
  if (typeof e !== 'string') throw new HttpError(400, 'Email is required.');
  const v = e.trim().toLowerCase();
  if (!EMAIL_RE.test(v) || v.length > 200) throw new HttpError(400, 'Enter a valid email address.');
  return v;
};

const cleanName = (n: unknown, label: string, min = 1, max = 100): string => {
  if (typeof n !== 'string' || n.trim().length < min || n.trim().length > max) throw new HttpError(400, `${label} must be ${min}-${max} characters.`);
  return n.trim().replace(/\s+/g, ' ');
};

export interface InviteView {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
  invitedBy: string;
}

/** Accounts, organizations membership and invitations. Operates on the shared in-memory data and flushes. */
export class Accounts {
  constructor(
    private db: Db,
    private store: PostgresSnapshotStore | MongoSnapshotStore,
    private data: Database,
    private mailer: Mailer = new ConsoleMailer(),
    private onMailError: (e: unknown) => void = () => undefined
  ) {
    this.twoFactor = new TwoFactor(db);
  }

  /** Email is a courtesy: a failure to send never fails the request (the invite link is also shown in the app). */
  private sendMail(msg: MailMessage): void {
    void this.mailer.send(msg).catch(this.onMailError);
  }

  get mailKind() {
    return this.mailer.kind;
  }

  // ---- password reset -----------------------------------------------------------

  /** Always behaves the same whether or not the email has an account. */
  async requestPasswordReset(emailRaw: unknown, baseUrl: string): Promise<void> {
    const email = typeof emailRaw === 'string' ? emailRaw.trim().toLowerCase() : '';
    const user = this.findUserByEmail(email);
    if (!user) return;
    const token = newToken();
    await this.db.query(`delete from password_resets where user_id = $1`, [user.id]);
    await this.db.query(`insert into password_resets (token_hash, user_id, expires_at) values ($1, $2, now() + interval '1 hour')`, [hashToken(token), user.id]);
    this.sendMail({
      to: user.email,
      subject: 'Reset your ABG Tracker password',
      text: `Hi ${user.name},\n\nUse this link within one hour to choose a new password:\n${baseUrl}/reset/${token}\n\nIf you did not ask for this, you can ignore this email. Your password stays the same.\n`,
    });
  }

  async resetPassword(token: string, password: unknown): Promise<void> {
    const problem = passwordProblem(password);
    if (problem) throw new HttpError(400, problem);
    const rows = await this.db.query(`select user_id from password_resets where token_hash = $1 and expires_at > now()`, [hashToken(token)]);
    if (!rows.length) throw new HttpError(404, 'This reset link is not valid any more. Request a new one.');
    const userId = String(rows[0].user_id);
    await this.db.query(`insert into credentials (user_id, password_hash) values ($1, $2)
                         on conflict (user_id) do update set password_hash = excluded.password_hash, updated_at = now()`, [userId, await hashPassword(password as string)]);
    await this.db.query(`delete from password_resets where user_id = $1`, [userId]);
    await deleteUserSessions(this.db, userId); // anyone holding an old session is signed out
  }

  sendInviteEmail(invite: { email: string; role: Role }, orgName: string, inviterName: string, link: string): void {
    this.sendMail({
      to: invite.email,
      subject: `${inviterName} invited you to ${orgName} on ABG Tracker`,
      text: `${inviterName} invited you to join ${orgName} as ${invite.role}.\n\nAccept the invitation (valid for ${INVITE_DAYS} days):\n${link}\n`,
    });
  }

  orgName(orgId: string): string {
    return this.data.organizations.find((o) => o.id === orgId)?.name ?? 'your organization';
  }

  userName(userId: string): string {
    return this.data.users.find((u) => u.id === userId)?.name ?? 'Someone';
  }

  findUserByEmail(email: string): User | undefined {
    return this.data.users.find((u) => u.email.toLowerCase() === email);
  }

  private uniqueSlug(base: string): string {
    let s = slugify(base) || 'workspace';
    if (s.length < 2) s = `${s}-team`;
    if (RESERVED_SLUGS.has(s)) s = `${s}-team`;
    let candidate = s;
    for (let n = 2; this.data.organizations.some((o) => o.slug === candidate); n++) candidate = `${s}-${n}`;
    return candidate;
  }

  private newUser(name: string, email: string): User {
    return { id: newId('u'), name, email, color: COLORS[Math.floor(Math.random() * COLORS.length)] };
  }

  async register(input: { name?: unknown; email?: unknown; password?: unknown; orgName?: unknown }, meta?: SessionMeta): Promise<{ user: User; token: string }> {
    const name = cleanName(input.name, 'Your name');
    const email = normEmail(input.email);
    const orgName = cleanName(input.orgName, 'Organization name', 2, 80);
    const problem = passwordProblem(input.password);
    if (problem) throw new HttpError(400, problem);
    if (this.findUserByEmail(email)) throw new HttpError(409, 'An account with this email already exists.');

    const user = this.newUser(name, email);
    const org: Organization = { id: newId('org'), name: orgName, slug: this.uniqueSlug(orgName), plan: 'free', createdAt: new Date().toISOString() };
    const hash = await hashPassword(input.password as string);

    await this.db.query(`insert into credentials (user_id, password_hash) values ($1, $2)`, [user.id, hash]);
    this.data.users.push(user);
    this.data.organizations.push(org);
    this.data.memberships.push({ id: newId('m'), orgId: org.id, userId: user.id, role: 'owner' });
    try {
      await this.store.flush();
    } catch (e) {
      await this.db.query(`delete from credentials where user_id = $1`, [user.id]);
      await this.store.reload();
      throw e;
    }
    return { user, token: await createSession(this.db, user.id, meta) };
  }

  readonly twoFactor: TwoFactor;

  /**
   * Returns the user, or null for any failure (same answer for unknown email and wrong password).
   * When the account has two-factor sign-in, a correct password alone is not enough: the answer is
   * `needsCode` until a valid code (or recovery code) comes with it. `codeGate` lets the caller throttle code guesses per account.
   */
  async login(
    emailRaw: unknown,
    password: unknown,
    code?: unknown,
    meta?: SessionMeta,
    codeGate: (userId: string) => boolean = () => true
  ): Promise<{ user: User; token: string } | { needsCode: true } | null> {
    if (typeof emailRaw !== 'string' || typeof password !== 'string' || password.length > 200) return null;
    const email = emailRaw.trim().toLowerCase();
    const user = this.findUserByEmail(email);
    const rows = user ? await this.db.query(`select password_hash from credentials where user_id = $1`, [user.id]) : [];
    const ok = await verifyPassword(password, rows.length ? String(rows[0].password_hash) : await getDummyHash());
    if (!user || !rows.length || !ok) return null;
    if (await this.twoFactor.isEnabled(user.id)) {
      if (code === undefined || code === null || code === '') return { needsCode: true };
      if (!codeGate(user.id)) throw new HttpError(429, 'Too many code attempts. Please wait a few minutes.');
      if (!(await this.twoFactor.check(user.id, code))) throw new HttpError(401, 'That code is not right. Try the newest code, or use a recovery code.');
    }
    return { user, token: await createSession(this.db, user.id, meta) };
  }

  /** Signing in through a company identity provider (it has proven who the person is, so there is no password step). */
  async loginSso(user: User, meta?: SessionMeta): Promise<{ user: User; token: string }> {
    return { user, token: await createSession(this.db, user.id, meta) };
  }

  /** First sign-in through the identity provider: the person gets an account with no password and a workspace of their own. */
  async registerSso(nameRaw: unknown, email: string, meta?: SessionMeta): Promise<{ user: User; token: string }> {
    const name = cleanName(nameRaw, 'Your name');
    if (this.findUserByEmail(email)) throw new HttpError(409, 'An account with this email already exists.');
    const user = this.newUser(name, email);
    const org: Organization = { id: newId('org'), name: `${name}'s workspace`.slice(0, 80), slug: this.uniqueSlug(`${name} workspace`), plan: 'free', createdAt: new Date().toISOString() };
    this.data.users.push(user);
    this.data.organizations.push(org);
    this.data.memberships.push({ id: newId('m'), orgId: org.id, userId: user.id, role: 'owner' });
    try {
      await this.store.flush();
    } catch (e) {
      await this.store.reload();
      throw e;
    }
    return { user, token: await createSession(this.db, user.id, meta) };
  }

  // ---- profile and two-factor ---------------------------------------------------------

  async updateName(userId: string, nameRaw: unknown): Promise<User> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new HttpError(404, 'Account not found.');
    user.name = cleanName(nameRaw, 'Your name');
    await this.store.flush();
    return user;
  }

  private securityNotice(user: User, what: string): void {
    this.sendMail({ to: user.email, subject: 'Security notice for your ABG Tracker account', text: `Hi ${user.name},\n\n${what}\n\nIf this was not you, sign in and change your password now, then turn two-factor sign-in back on.\n` });
  }

  async twoFactorStatus(userId: string): Promise<{ enabled: boolean; recoveryLeft: number }> {
    const enabled = await this.twoFactor.isEnabled(userId);
    return { enabled, recoveryLeft: enabled ? await this.twoFactor.recoveryLeft(userId) : 0 };
  }

  /** Step 1: a new secret, as a text key and a ready-to-scan picture. Nothing changes for sign-in yet. */
  async twoFactorBegin(userId: string): Promise<{ secret: string; uri: string; qr: string }> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new HttpError(404, 'Account not found.');
    let secret: string;
    try {
      secret = await this.twoFactor.begin(userId);
    } catch (e) {
      throw new HttpError(409, (e as Error).message);
    }
    const uri = otpauthUri(secret, user.email);
    return { secret, uri, qr: await QRCode.toString(uri, { type: 'svg', margin: 1, width: 200 }) };
  }

  /** Step 2: the first code from the phone turns it on; the recovery codes come back once. */
  async twoFactorConfirm(userId: string, code: unknown): Promise<string[]> {
    const user = this.data.users.find((u) => u.id === userId);
    const codes = user && typeof code === 'string' ? await this.twoFactor.confirm(userId, code.replace(/\s/g, '')) : null;
    if (!user || !codes) throw new HttpError(400, 'That code is not right. Check the newest code in your app and try again.');
    this.securityNotice(user, 'Two-factor sign-in was turned ON for your account.');
    return codes;
  }

  /** Turning it off asks for the password again, so someone at an unlocked screen cannot quietly remove it. */
  async twoFactorDisable(userId: string, password: unknown): Promise<void> {
    const user = this.data.users.find((u) => u.id === userId);
    const rows = await this.db.query(`select password_hash from credentials where user_id = $1`, [userId]);
    if (!user || !rows.length || typeof password !== 'string' || !(await verifyPassword(password, String(rows[0].password_hash)))) throw new HttpError(403, 'Your password is not correct.');
    await this.twoFactor.disable(userId);
    this.securityNotice(user, 'Two-factor sign-in was turned OFF for your account.');
  }

  async changePassword(userId: string, current: unknown, next: unknown, keepToken?: string): Promise<void> {
    const problem = passwordProblem(next);
    if (problem) throw new HttpError(400, problem);
    const rows = await this.db.query(`select password_hash from credentials where user_id = $1`, [userId]);
    if (!rows.length || typeof current !== 'string' || !(await verifyPassword(current, String(rows[0].password_hash)))) {
      throw new HttpError(403, 'Your current password is not correct.');
    }
    await this.db.query(`update credentials set password_hash = $2, updated_at = now() where user_id = $1`, [userId, await hashPassword(next as string)]);
    await deleteUserSessions(this.db, userId, keepToken); // sign out everywhere else
  }

  me(userId: string): { user: User; orgs: Organization[] } | null {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) return null;
    const orgIds = new Set(this.data.memberships.filter((m) => m.userId === userId).map((m) => m.orgId));
    return { user, orgs: this.data.organizations.filter((o) => orgIds.has(o.id)) };
  }

  // ---- invitations ----------------------------------------------------------------

  private requireManager(orgId: string, actorId: string) {
    const m = this.data.memberships.find((x) => x.orgId === orgId && x.userId === actorId);
    if (!m) throw new HttpError(403, 'You are not a member of this organization.');
    if (!can(m.role, 'member.manage')) throw new HttpError(403, `Your role (${m.role}) is not allowed to do this.`);
    return m;
  }

  async createInvite(orgId: string, emailRaw: unknown, roleRaw: unknown, actorId: string): Promise<{ token: string; invite: InviteView }> {
    const actor = this.requireManager(orgId, actorId);
    const email = normEmail(emailRaw);
    const role = roleRaw as Role;
    if (!['owner', 'admin', 'member', 'guest'].includes(role)) throw new HttpError(400, 'Choose a role.');
    if (role === 'owner' && actor.role !== 'owner') throw new HttpError(403, 'Only an owner can invite another owner.');
    const existing = this.findUserByEmail(email);
    if (existing && this.data.memberships.some((m) => m.orgId === orgId && m.userId === existing.id)) {
      throw new HttpError(409, 'That person is already in this organization.');
    }
    await this.db.query(`delete from invites where org_id = $1 and lower(email) = $2 and accepted_at is null`, [orgId, email]);
    const token = newToken();
    const id = newId('inv');
    await this.db.query(
      `insert into invites (id, org_id, email, role, token_hash, invited_by, expires_at) values ($1,$2,$3,$4,$5,$6, now() + ($7 || ' days')::interval)`,
      [id, orgId, email, role, hashToken(token), actorId, String(INVITE_DAYS)]
    );
    const rows = await this.db.query(`select expires_at from invites where id = $1`, [id]);
    return { token, invite: { id, email, role, invitedBy: actorId, expiresAt: new Date(String(rows[0].expires_at)).toISOString() } };
  }

  async listInvites(orgId: string, actorId: string): Promise<InviteView[]> {
    this.requireManager(orgId, actorId);
    const rows = await this.db.query(`select id, email, role, invited_by, expires_at from invites where org_id = $1 and accepted_at is null and expires_at > now() order by created_at desc`, [orgId]);
    return rows.map((r) => ({ id: String(r.id), email: String(r.email), role: r.role as Role, invitedBy: String(r.invited_by), expiresAt: new Date(String(r.expires_at)).toISOString() }));
  }

  async revokeInvite(orgId: string, inviteId: string, actorId: string): Promise<void> {
    this.requireManager(orgId, actorId);
    await this.db.query(`delete from invites where id = $1 and org_id = $2 and accepted_at is null`, [inviteId, orgId]);
  }

  private async findInvite(token: string) {
    const rows = await this.db.query(`select * from invites where token_hash = $1 and accepted_at is null and expires_at > now()`, [hashToken(token)]);
    return rows[0];
  }

  async getInvite(token: string): Promise<{ orgName: string; email: string; role: Role; existingAccount: boolean }> {
    const inv = await this.findInvite(token);
    const org = inv && this.data.organizations.find((o) => o.id === inv.org_id);
    if (!inv || !org) throw new HttpError(404, 'This invitation is not valid any more.');
    return { orgName: org.name, email: String(inv.email), role: inv.role as Role, existingAccount: !!this.findUserByEmail(String(inv.email)) };
  }

  async acceptInvite(token: string, input: { name?: unknown; password?: unknown }, signedInUserId: string | null): Promise<{ user: User; token?: string; orgSlug: string }> {
    const inv = await this.findInvite(token);
    const org = inv && this.data.organizations.find((o) => o.id === inv.org_id);
    if (!inv || !org) throw new HttpError(404, 'This invitation is not valid any more.');
    const email = String(inv.email);

    let user = this.findUserByEmail(email);
    let sessionToken: string | undefined;
    if (user) {
      if (signedInUserId !== user.id) throw new HttpError(409, `An account for ${email} already exists. Sign in with it, then open this link again.`);
    } else {
      const name = cleanName(input.name, 'Your name');
      const problem = passwordProblem(input.password);
      if (problem) throw new HttpError(400, problem);
      user = this.newUser(name, email);
      await this.db.query(`insert into credentials (user_id, password_hash) values ($1, $2)`, [user.id, await hashPassword(input.password as string)]);
      this.data.users.push(user);
      sessionToken = await createSession(this.db, user.id);
    }
    if (!this.data.memberships.some((m) => m.orgId === org.id && m.userId === user!.id)) {
      this.data.memberships.push({ id: newId('m'), orgId: org.id, userId: user.id, role: inv.role as Role });
    }
    await this.store.flush();
    await this.db.query(`update invites set accepted_at = now() where id = $1`, [inv.id]);
    return { user, token: sessionToken, orgSlug: org.slug };
  }

  // ---- demo data --------------------------------------------------------------------

  /** Loads the sample organizations (only into an empty database). Every demo user gets DEMO_PASSWORD. */
  async seedDemo(): Promise<boolean> {
    if (this.data.users.length > 0) return false;
    const seed = buildSeed();
    Object.assign(this.data, { ...seed, sessionUserId: '' });
    this.store.markAllLoaded(); // the sample organizations are now in memory
    await this.store.flush();
    const hash = await hashPassword(DEMO_PASSWORD);
    for (const u of seed.users) await this.db.query(`insert into credentials (user_id, password_hash) values ($1, $2) on conflict (user_id) do nothing`, [u.id, hash]);
    return true;
  }
}
