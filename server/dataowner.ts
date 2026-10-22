import type { Database } from '../src/data/seed';
import type { OrgData } from '../src/domain/types';
import { verifyPassword } from './auth';
import type { Db } from './db';
import { HttpError } from './errors';
import { SCOPED, type PostgresSnapshotStore } from './store';
import type { MongoSnapshotStore } from './mongoStore';
import type { TwoFactor } from './twofactor';

/**
 * A cell that a spreadsheet will treat as plain text. Spreadsheets run anything that starts with = + - @ as a
 * formula, so a work item titled "=HYPERLINK(...)" could attack whoever opens the export. A leading apostrophe makes it text.
 */
export const csvCell = (v: unknown): string => {
  let s = v === undefined || v === null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};

export function issuesCsv(data: Omit<OrgData, 'notifications'>): string {
  const name = (id?: string) => data.members.find((m) => m.id === id)?.email ?? '';
  const rows: unknown[][] = [['Key', 'Project', 'Type', 'Status', 'Priority', 'Title', 'Assignee', 'Reporter', 'Labels', 'Estimate', 'Start', 'Due', 'Created', 'Description']];
  for (const i of data.issues) {
    const p = data.projects.find((x) => x.id === i.projectId);
    rows.push([i.key, p?.name, p?.issueTypes.find((t) => t.id === i.typeId)?.name, p?.statuses.find((s) => s.id === i.statusId)?.name, i.priority, i.title, name(i.assigneeId), name(i.reporterId), i.labels.join('; '), i.estimate, i.startDate, i.dueDate, i.createdAt, i.description]);
  }
  return '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n'; // BOM so Excel reads accents correctly
}

export interface AuditRow {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

/** Export, delete and audit: what a customer needs to feel they own their data. */
export class DataOwner {
  constructor(
    private db: Db,
    private store: PostgresSnapshotStore | MongoSnapshotStore,
    private data: Database,
    private twoFactor: TwoFactor
  ) {}

  private role(orgId: string, userId: string) {
    return this.data.memberships.find((m) => m.orgId === orgId && m.userId === userId)?.role;
  }

  requireOwner(orgId: string, userId: string) {
    const r = this.role(orgId, userId);
    if (!r) throw new HttpError(403, 'You are not a member of this organization.');
    if (r !== 'owner') throw new HttpError(403, 'Only an owner can do this.');
  }

  private async confirmIdentity(userId: string, password: unknown, code?: unknown) {
    const rows = await this.db.query(`select password_hash from credentials where user_id = $1`, [userId]);
    if (!rows.length || typeof password !== 'string' || !(await verifyPassword(password, String(rows[0].password_hash)))) throw new HttpError(403, 'Your password is not correct.');
    if (await this.twoFactor.isEnabled(userId)) {
      if (!(await this.twoFactor.check(userId, code))) throw new HttpError(403, 'Enter a valid 6-digit code from your authenticator app.');
    }
  }

  // ---- audit log ----------------------------------------------------------------------------

  async audit(orgId: string, actorId: string, action: string, detail = ''): Promise<void> {
    await this.db.query(`insert into audit_log (id, org_id, actor_id, action, detail) values ($1, $2, $3, $4, $5)`, [
      `au_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`,
      orgId,
      actorId,
      action.slice(0, 60),
      detail.slice(0, 300),
    ]);
  }

  async listAudit(orgId: string, userId: string): Promise<AuditRow[]> {
    const role = this.role(orgId, userId);
    if (!role) throw new HttpError(403, 'You are not a member of this organization.');
    if (role !== 'owner' && role !== 'admin') throw new HttpError(403, 'Only owners and admins can see the audit log.');
    const rows = await this.db.query(`select id, actor_id, action, detail, at from audit_log where org_id = $1 order by at desc, id desc limit 200`, [orgId]);
    return rows.map((r) => ({
      id: String(r.id),
      at: new Date(String(r.at)).toISOString(),
      actor: this.data.users.find((u) => u.id === r.actor_id)?.name ?? 'Someone',
      action: String(r.action),
      detail: String(r.detail ?? ''),
    }));
  }

  // ---- delete an organization -------------------------------------------------------------

  /** Owner only; needs the password (and the code, if two-factor is on) and the organization's exact name. Everything in it goes. */
  async deleteOrganization(orgId: string, userId: string, password: unknown, confirmName: unknown, code?: unknown): Promise<void> {
    this.requireOwner(orgId, userId);
    const org = this.data.organizations.find((o) => o.id === orgId)!;
    if (typeof confirmName !== 'string' || confirmName.trim() !== org.name) throw new HttpError(400, `Type the organization's name exactly (${org.name}) to confirm.`);
    await this.confirmIdentity(userId, password, code);

    this.data.organizations = this.data.organizations.filter((o) => o.id !== orgId);
    this.data.memberships = this.data.memberships.filter((m) => m.orgId !== orgId);
    for (const c of SCOPED) (this.data as unknown as Record<string, { orgId?: string }[]>)[c] = (this.data as unknown as Record<string, { orgId?: string }[]>)[c].filter((r) => r.orgId !== orgId);
    await this.store.flush();
    await this.db.query(`delete from invites where org_id = $1`, [orgId]);
    await this.db.query(`delete from audit_log where org_id = $1`, [orgId]);
  }

  // ---- delete an account ------------------------------------------------------------------

  /** Orgs this person is the only owner of: they must hand over or delete those first. */
  soleOwnerOf(userId: string): string[] {
    return this.data.memberships
      .filter((m) => m.userId === userId && m.role === 'owner' && !this.data.memberships.some((o) => o.orgId === m.orgId && o.role === 'owner' && o.userId !== userId))
      .map((m) => this.data.organizations.find((o) => o.id === m.orgId)?.name ?? m.orgId);
  }

  /**
   * Erases the person. Their login, devices, two-factor and settings are deleted; their name and address on
   * old comments and history become "Deleted user" (so other people's records stay readable); their open work is unassigned.
   * The caller must have loaded every organization the person belongs to.
   */
  async deleteAccount(userId: string, password: unknown, code?: unknown): Promise<void> {
    const user = this.data.users.find((u) => u.id === userId);
    if (!user) throw new HttpError(404, 'Account not found.');
    const sole = this.soleOwnerOf(userId);
    if (sole.length) throw new HttpError(409, `You are the only owner of ${sole.join(', ')}. Make someone else an owner, or delete the organization, before deleting your account.`);
    await this.confirmIdentity(userId, password, code);

    const email = user.email;
    for (const i of this.data.issues) if (i.assigneeId === userId) i.assigneeId = undefined;
    this.data.notifications = this.data.notifications.filter((n) => n.userId !== userId);
    this.data.filters = this.data.filters.filter((f) => f.ownerId !== userId);
    this.data.memberships = this.data.memberships.filter((m) => m.userId !== userId);
    user.name = 'Deleted user';
    user.email = `deleted+${user.id}@deleted.invalid`;
    user.color = '#9ca3af';
    delete user.notify;
    await this.store.flush();
    for (const t of ['credentials', 'sessions', 'two_factor', 'recovery_codes', 'digest_state', 'password_resets']) await this.db.query(`delete from ${t} where user_id = $1`, [userId]);
    await this.db.query(`delete from invites where lower(email) = $1`, [email.toLowerCase()]);
  }
}
