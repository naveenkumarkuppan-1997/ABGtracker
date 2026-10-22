import { NOTIFY_VERB, resolvePrefs, wantsEmail } from '../src/domain/notifyPrefs';
import { localHour } from '../src/domain/timeZone';
import type { Notification, NotifyPrefs } from '../src/domain/types';
import type { Db } from './db';
import type { Mailer } from './mailer';
import type { PostgresSnapshotStore } from './store';
import type { MongoSnapshotStore } from './mongoStore';
import { Unsubscribe } from './unsubscribe';

export interface NotifierOptions {
  db: Db;
  store: PostgresSnapshotStore | MongoSnapshotStore;
  mailer: Mailer;
  /** Address of the web app, for the links in the emails. */
  baseUrl: string;
  /** "As it happens" waits this long first, so quick follow-ups travel in one email and anything you already read is skipped. */
  graceMs?: number;
  /** Items older than this are never emailed (so switching email on doesn't send last month's history). */
  windowMs?: number;
  /** The daily summary goes out at the first run at or after this hour of the person's own day (their time zone; UTC if unknown). */
  digestHour?: number;
  log?: (line: string) => void;
  /** Makes the "stop these emails" links. Created from the database when not given. */
  unsubscribe?: Unsubscribe;
}

const MAX_LISTED = 25;
const RETRY_AFTER_MS = 15 * 60_000;
const DIGEST_GAP_MS = 20 * 60 * 60_000;

/** One line, no control or direction-trick characters, bounded: safe inside a subject or a list. */
const oneLine = (s: unknown, max = 140) =>
  String(s ?? '')
    // eslint-disable-next-line no-control-regex
    .replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, max);

type Rec = Record<string, unknown>;
const parse = (v: unknown): Rec => (typeof v === 'string' ? JSON.parse(v) : v) as Rec;

/**
 * Turns Inbox items into email, according to each person's own choices. Works from the database
 * (not from what happens to be in memory), remembers what it has handled in its own table so an
 * item is never emailed twice, and never emails something the person already read.
 */
export class NotificationEmailer {
  private retryAt = new Map<string, number>();
  private opts: Required<Omit<NotifierOptions, 'db' | 'store' | 'mailer' | 'unsubscribe'>> & Pick<NotifierOptions, 'db' | 'store' | 'mailer'> & { unsubscribe: Unsubscribe };

  constructor(opts: NotifierOptions) {
    this.opts = { graceMs: 2 * 60_000, windowMs: 2 * 24 * 60 * 60_000, digestHour: 8, log: (l) => console.log(l), ...opts, unsubscribe: opts.unsubscribe ?? new Unsubscribe(opts.db) };
  }

  /** One pass. Returns how many emails were sent. */
  async runOnce(at: Date = new Date()): Promise<number> {
    const { db, store, windowMs, graceMs, digestHour } = this.opts;
    const since = new Date(at.getTime() - windowMs).toISOString();
    const rows = await db.query(
      `select n.id, n.data from notifications n
         left join notification_emails e on e.notification_id = n.id
        where e.notification_id is null and n.data->>'createdAt' > $1
        order by n.data->>'createdAt' limit 2000`,
      [since]
    );
    if (rows.length === 0) return this.cleanup(at);

    const data = store.load();
    const byUser = new Map<string, Notification[]>();
    const skip: string[] = [];
    for (const r of rows) {
      const n = parse(r.data) as unknown as Notification;
      const user = data.users.find((u) => u.id === n.userId);
      const prefs = resolvePrefs(user);
      const member = data.memberships.some((m) => m.orgId === n.orgId && m.userId === n.userId);
      if (!user || !member || n.read || !wantsEmail(prefs, n.kind, n.projectId)) skip.push(n.id);
      else byUser.set(n.userId, [...(byUser.get(n.userId) ?? []), n]);
    }
    await this.mark(skip, 'skipped');

    let sent = 0;
    for (const [userId, items] of byUser) {
      const user = data.users.find((u) => u.id === userId)!;
      const prefs: NotifyPrefs = resolvePrefs(user);
      if ((this.retryAt.get(userId) ?? 0) > at.getTime()) continue;

      let due: Notification[];
      if (prefs.email === 'daily') {
        if (localHour(at, prefs.timeZone) < digestHour) continue; // the hour it is for *them*
        const last = await db.query(`select last_sent from digest_state where user_id = $1`, [userId]);
        if (last.length && at.getTime() - new Date(String(last[0].last_sent)).getTime() < DIGEST_GAP_MS) continue;
        due = items;
      } else {
        due = items.filter((n) => at.getTime() - new Date(n.createdAt).getTime() >= graceMs);
      }
      if (due.length === 0) continue;

      // Claim first: only items this process really claimed are sent, so a second process or a retry can't duplicate them.
      const claimed = await this.claim(due.map((n) => n.id));
      const mine = due.filter((n) => claimed.has(n.id));
      if (mine.length === 0) continue;
      try {
        await this.opts.mailer.send(await this.compose(user.name, user.email, mine, prefs.email === 'daily'));
        if (prefs.email === 'daily') {
          await db.query(`insert into digest_state (user_id, last_sent) values ($1, $2) on conflict (user_id) do update set last_sent = excluded.last_sent`, [userId, at.toISOString()]);
        }
        sent++;
      } catch (e) {
        for (const n of mine) await db.query(`delete from notification_emails where notification_id = $1`, [n.id]); // give it another chance later
        this.retryAt.set(userId, at.getTime() + RETRY_AFTER_MS);
        this.opts.log(`Could not email a notification summary: ${e instanceof Error ? e.message : e}`);
      }
    }
    await this.cleanup(at);
    return sent;
  }

  private async mark(ids: string[], outcome: string) {
    for (const id of ids) await this.opts.db.query(`insert into notification_emails (notification_id, outcome) values ($1, $2) on conflict do nothing`, [id, outcome]);
  }

  private async claim(ids: string[]): Promise<Set<string>> {
    const got = new Set<string>();
    for (const id of ids) {
      const r = await this.opts.db.query(`insert into notification_emails (notification_id, outcome) values ($1, 'sent') on conflict do nothing returning notification_id`, [id]);
      if (r.length) got.add(id);
    }
    return got;
  }

  /** Forgets old bookkeeping (and old retry timers). */
  private async cleanup(at: Date): Promise<number> {
    await this.opts.db.query(`delete from notification_emails where handled_at < $1`, [new Date(at.getTime() - 30 * 24 * 60 * 60_000).toISOString()]);
    for (const [k, t] of this.retryAt) if (t < at.getTime()) this.retryAt.delete(k);
    return 0;
  }

  private async lookup(table: 'issues' | 'projects', ids: string[]): Promise<Map<string, Rec>> {
    const out = new Map<string, Rec>();
    if (ids.length === 0) return out;
    const marks = ids.map((_, i) => `$${i + 1}`).join(',');
    for (const r of await this.opts.db.query(`select id, data from ${table} where id in (${marks})`, ids)) out.set(String(r.id), parse(r.data));
    return out;
  }

  private async compose(name: string, to: string, items: Notification[], daily: boolean) {
    const { store, baseUrl } = this.opts;
    const data = store.load();
    const unsubscribeUrl = `${baseUrl}/unsubscribe/${await this.opts.unsubscribe.token(items[0].userId)}`;
    const issues = await this.lookup('issues', [...new Set(items.map((n) => n.issueId))]);
    const projects = await this.lookup('projects', [...new Set(items.map((n) => n.projectId))]);

    const line = (n: Notification) => {
      const actor = data.users.find((u) => u.id === n.actorId)?.name ?? (n.actorId === 'automation' ? 'An automation' : n.actorId === 'intake' ? 'A request form' : n.actorId === 'reminder' ? 'Reminder' : 'Someone');
      const issue = issues.get(n.issueId);
      const project = projects.get(n.projectId);
      const org = data.organizations.find((o) => o.id === n.orgId);
      const what = issue ? `${oneLine(issue.key, 30)} ${oneLine(issue.title)}` : 'an item that was deleted';
      const link = issue && project && org ? `${baseUrl}/${encodeURIComponent(org.slug)}/p/${encodeURIComponent(String(project.key))}/board?issue=${encodeURIComponent(String(issue.key))}` : '';
      return { text: `${oneLine(actor, 60)} ${NOTIFY_VERB[n.kind]} ${what}`, detail: n.detail ? oneLine(n.detail, 200) : '', link, org: org?.name ?? '' };
    };
    const lines = items.map(line);

    const subject = daily
      ? `Your daily summary: ${items.length} update${items.length === 1 ? '' : 's'}`
      : items.length === 1
        ? lines[0].text.slice(0, 150)
        : `${items.length} updates on your work`;

    const shown = lines.slice(0, MAX_LISTED).map((l) => `• ${l.text}${l.org && data.organizations.length > 1 ? ` (${oneLine(l.org, 60)})` : ''}${l.detail ? `\n    “${l.detail}”` : ''}${l.link ? `\n    ${l.link}` : ''}`);
    const more = lines.length > MAX_LISTED ? `\n…and ${lines.length - MAX_LISTED} more in your Inbox.` : '';
    const text = [
      `Hi ${oneLine(name, 60) || 'there'},`,
      '',
      daily ? 'Here is what happened on your work:' : items.length === 1 ? 'Something needs your attention:' : 'Here is what is new on your work:',
      '',
      shown.join('\n\n') + more,
      '',
      `Open your Inbox: ${baseUrl}/`,
      `Want fewer of these? In the app open Inbox → Email settings.`,
      `Stop all of these emails: ${unsubscribeUrl}`,
    ].join('\n');
    // The header lets mail apps offer their own "Unsubscribe" button (RFC 8058 one-click).
    return { to, subject: oneLine(subject, 150), text, headers: { 'List-Unsubscribe': `<${unsubscribeUrl}>`, 'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click' } };
  }
}
