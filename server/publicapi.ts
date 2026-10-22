import type { FastifyInstance, FastifyRequest } from 'fastify';
import type { LocalRepository } from '../src/data/localRepository';
import { isDone } from '../src/domain/selectors';
import type { Comment, Issue, IssuePatch, NewIssue, Priority, Project } from '../src/domain/types';
import type { TokenScope } from './apitokens';
import { RateLimiter } from './auth';
import { HttpError } from './errors';
import type { PostgresSnapshotStore } from './store';
import type { WebhookEvent, Webhooks } from './webhooks';

type User = { id: string; name: string; email: string };

/** How an item looks to other programs: names instead of internal ids, and a link back. */
export function issueView(issue: Issue, project: Project, users: User[], baseUrl: string, slug: string) {
  const person = (id?: string) => {
    const u = users.find((x) => x.id === id);
    return u ? { name: u.name, email: u.email } : null;
  };
  const status = project.statuses.find((s) => s.id === issue.statusId);
  return {
    key: issue.key,
    title: issue.title,
    description: issue.description,
    type: project.issueTypes.find((t) => t.id === issue.typeId)?.name ?? null,
    status: status?.name ?? null,
    statusCategory: status?.category ?? null,
    priority: issue.priority,
    assignee: person(issue.assigneeId),
    reporter: person(issue.reporterId),
    labels: issue.labels,
    estimate: issue.estimate ?? null,
    start: issue.startDate ?? null,
    due: issue.dueDate ?? null,
    created: issue.createdAt,
    updated: issue.updatedAt,
    url: `${baseUrl}/${encodeURIComponent(slug)}/p/${encodeURIComponent(project.key)}/board?issue=${encodeURIComponent(issue.key)}`,
  };
}

const isDate = (s: unknown): s is string => typeof s === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));
const text = (v: unknown, max: number, what: string): string => {
  if (typeof v !== 'string') throw new HttpError(400, `${what} must be text.`);
  if (v.length > max) throw new HttpError(400, `${what} is too long (up to ${max} characters).`);
  return v;
};

/** Reads names the way a person writes them ("In Progress", an email) and turns them into ids; unknown names are errors, never guesses. */
function mapFields(body: Record<string, unknown>, project: Project, users: User[]) {
  const out: Partial<Pick<Issue, 'title' | 'description' | 'priority' | 'statusId' | 'typeId' | 'dueDate' | 'startDate' | 'labels' | 'estimate'>> & { assigneeId?: string | null } = {};
  if (body.title !== undefined) {
    out.title = text(body.title, 300, 'title').trim();
    if (!out.title) throw new HttpError(400, 'title is required.');
  }
  if (body.description !== undefined) out.description = text(body.description, 20000, 'description');
  if (body.priority !== undefined) {
    if (!['critical', 'high', 'medium', 'low'].includes(String(body.priority))) throw new HttpError(400, 'priority must be critical, high, medium or low.');
    out.priority = body.priority as Priority;
  }
  if (body.status !== undefined) {
    const s = project.statuses.find((x) => x.name.toLowerCase() === String(body.status).toLowerCase());
    if (!s) throw new HttpError(400, `Unknown status. Use one of: ${project.statuses.map((x) => x.name).join(', ')}.`);
    out.statusId = s.id;
  }
  if (body.type !== undefined) {
    const t = project.issueTypes.find((x) => x.name.toLowerCase() === String(body.type).toLowerCase());
    if (!t) throw new HttpError(400, `Unknown type. Use one of: ${project.issueTypes.map((x) => x.name).join(', ')}.`);
    out.typeId = t.id;
  }
  if (body.assignee !== undefined) {
    if (body.assignee === null || body.assignee === '') out.assigneeId = null;
    else {
      const u = users.find((x) => x.email.toLowerCase() === String(body.assignee).toLowerCase());
      if (!u) throw new HttpError(400, 'assignee must be the email of someone in this organization.');
      out.assigneeId = u.id;
    }
  }
  for (const [k, field] of [['due', 'dueDate'], ['start', 'startDate']] as const) {
    if (body[k] === undefined) continue;
    if (body[k] === null || body[k] === '') (out as Record<string, unknown>)[field] = undefined;
    else if (isDate(body[k])) (out as Record<string, unknown>)[field] = body[k];
    else throw new HttpError(400, `${k} must look like 2026-12-31.`);
  }
  if (body.labels !== undefined) {
    if (!Array.isArray(body.labels) || body.labels.length > 20 || body.labels.some((l) => typeof l !== 'string' || l.length > 40)) throw new HttpError(400, 'labels must be a list of up to 20 short texts.');
    out.labels = body.labels as string[];
  }
  if (body.estimate !== undefined) {
    if (body.estimate === null) out.estimate = undefined;
    else if (typeof body.estimate === 'number' && Number.isFinite(body.estimate) && body.estimate >= 0) out.estimate = body.estimate;
    else throw new HttpError(400, 'estimate must be a number.');
  }
  return out;
}

export interface PublicApiDeps {
  app: FastifyInstance;
  store: PostgresSnapshotStore;
  repo: LocalRepository;
  webhooks: Webhooks;
  baseUrl: string;
  transact: <T>(mutates: boolean, fn: () => Promise<T>, orgs?: () => Promise<string[]>) => Promise<T>;
}

/** Tells webhooks about a change to an item or comment. Never throws: telling others must not break the action itself. */
export function makeEmitter(d: Pick<PublicApiDeps, 'store' | 'repo' | 'webhooks' | 'baseUrl'>) {
  const view = (issue: Issue) => {
    const org = d.store.load().organizations.find((o) => o.id === issue.orgId);
    const project = d.repo.snapshot.projects.find((p) => p.id === issue.projectId);
    return org && project ? { org, data: issueView(issue, project, d.store.load().users, d.baseUrl, org.slug) } : null;
  };
  return {
    issue(event: Extract<WebhookEvent, `issue.${string}`>, issue: Issue) {
      try {
        const v = view(issue);
        if (v) d.webhooks.emit(issue.orgId, v.org.slug, event, v.data);
      } catch {
        /* never breaks the action */
      }
    },
    comment(issue: Issue, comment: Comment) {
      try {
        const v = view(issue);
        if (v) d.webhooks.emit(issue.orgId, v.org.slug, 'comment.created', { ...v.data, comment: { body: comment.body.slice(0, 1000), author: d.store.load().users.find((u) => u.id === comment.authorId)?.name ?? null } });
      } catch {
        /* never breaks the action */
      }
    },
  };
}

declare module 'fastify' {
  interface FastifyRequest {
    tokenScope?: TokenScope;
    tokenId?: string;
  }
}

/** The public REST API (/api/v1). Every call acts as the token's owner, so it can never do more than that person could. */
export function registerPublicApi(d: PublicApiDeps) {
  const { app, store, repo, transact } = d;
  const limiter = new RateLimiter(120, 60_000);
  const emitter = makeEmitter(d);
  const user = (req: FastifyRequest) => {
    if (!req.userId || !req.tokenId) throw new HttpError(401, 'Send your token as "Authorization: Bearer abg_…".');
    if (!limiter.allow(req.tokenId)) throw new HttpError(429, 'Too many requests. Slow down (120 a minute).');
    return req.userId;
  };
  const needWrite = (req: FastifyRequest) => {
    if (req.tokenScope !== 'write') throw new HttpError(403, 'This token is read-only. Create a token that can write.');
  };
  const orgBySlug = (slug: string) => {
    const org = store.load().organizations.find((o) => o.slug === slug);
    if (!org) throw new HttpError(404, 'Organization not found.');
    return org;
  };
  /** Loads the organization for this person (membership is checked by the repository) and finds the project by key. */
  const withProject = async (slug: string, key: string, userId: string) => {
    const org = orgBySlug(slug);
    const data = await repo.loadOrg(org.id, userId);
    const project = data.projects.find((p) => p.key.toLowerCase() === key.toLowerCase());
    if (!project) throw new HttpError(404, 'Project not found.');
    return { org, data, project };
  };
  const findIssue = async (slug: string, key: string, userId: string) => {
    const org = orgBySlug(slug);
    const data = await repo.loadOrg(org.id, userId);
    const issue = data.issues.find((i) => i.key.toLowerCase() === key.toLowerCase());
    const project = issue && data.projects.find((p) => p.id === issue.projectId);
    if (!issue || !project) throw new HttpError(404, 'Item not found.');
    return { org, data, issue, project };
  };
  const scope = (slug: string) => async () => {
    const o = store.load().organizations.find((x) => x.slug === slug);
    return o ? [o.id] : [];
  };
  const v = (issue: Issue, project: Project, members: User[], slug: string) => issueView(issue, project, members, d.baseUrl, slug);

  app.get('/api/v1/me', async (req) => {
    const u = store.load().users.find((x) => x.id === user(req));
    return { name: u?.name, email: u?.email, tokenScope: req.tokenScope };
  });

  app.get('/api/v1/orgs', async (req) => {
    const id = user(req);
    const ids = new Set(store.load().memberships.filter((m) => m.userId === id).map((m) => m.orgId));
    return { orgs: store.load().organizations.filter((o) => ids.has(o.id)).map((o) => ({ slug: o.slug, name: o.name })) };
  });

  app.get<{ Params: { slug: string } }>('/api/v1/orgs/:slug/projects', async (req) => {
    const id = user(req);
    return transact(false, async () => {
      const org = orgBySlug(req.params.slug);
      const data = await repo.loadOrg(org.id, id);
      return { projects: data.projects.map((p) => ({ key: p.key, name: p.name, statuses: p.statuses.map((s) => ({ name: s.name, category: s.category })), types: p.issueTypes.map((t) => t.name) })) };
    }, scope(req.params.slug));
  });

  app.get<{ Params: { slug: string; key: string }; Querystring: { status?: string; assignee?: string; q?: string; limit?: string; offset?: string } }>('/api/v1/orgs/:slug/projects/:key/issues', async (req) => {
    const id = user(req);
    const limit = Math.min(Math.max(Number(req.query.limit ?? 50) || 50, 1), 200);
    const offset = Math.max(Number(req.query.offset ?? 0) || 0, 0);
    return transact(false, async () => {
      const { data, project } = await withProject(req.params.slug, req.params.key, id);
      const q = (req.query.q ?? '').toLowerCase();
      let list = data.issues.filter((i) => i.projectId === project.id);
      if (req.query.status) list = list.filter((i) => project.statuses.find((s) => s.id === i.statusId)?.name.toLowerCase() === req.query.status!.toLowerCase());
      if (req.query.assignee) list = list.filter((i) => data.members.find((m) => m.id === i.assigneeId)?.email.toLowerCase() === req.query.assignee!.toLowerCase());
      if (q) list = list.filter((i) => i.title.toLowerCase().includes(q));
      list.sort((a, b) => a.number - b.number);
      return { total: list.length, issues: list.slice(offset, offset + limit).map((i) => v(i, project, data.members, req.params.slug)) };
    }, scope(req.params.slug));
  });

  app.get<{ Params: { slug: string; key: string } }>('/api/v1/orgs/:slug/issues/:key', async (req) => {
    const id = user(req);
    return transact(false, async () => {
      const { data, issue, project } = await findIssue(req.params.slug, req.params.key, id);
      const comments = data.comments.filter((c) => c.issueId === issue.id).map((c) => ({ author: data.members.find((m) => m.id === c.authorId)?.name ?? null, body: c.body, created: c.createdAt }));
      return { issue: v(issue, project, data.members, req.params.slug), comments };
    }, scope(req.params.slug));
  });

  app.post<{ Params: { slug: string; key: string } }>('/api/v1/orgs/:slug/projects/:key/issues', async (req, reply) => {
    const id = user(req);
    needWrite(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const created = await transact(true, async () => {
      const { org, data, project } = await withProject(req.params.slug, req.params.key, id);
      if (typeof body.title !== 'string' || !body.title.trim()) throw new HttpError(400, 'title is required.');
      const f = mapFields(body, project, data.members);
      const typeId = f.typeId ?? (project.issueTypes.find((t) => t.level === 1) ?? project.issueTypes[0]).id;
      const input = { ...f, projectId: project.id, typeId, title: f.title!, assigneeId: f.assigneeId ?? undefined } as NewIssue;
      const issue = await repo.createIssue(org.id, input, id);
      return { issue, project, members: data.members };
    }, scope(req.params.slug));
    emitter.issue('issue.created', created.issue);
    return reply.code(201).send({ issue: v(created.issue, created.project, created.members, req.params.slug) });
  });

  app.patch<{ Params: { slug: string; key: string } }>('/api/v1/orgs/:slug/issues/:key', async (req) => {
    const id = user(req);
    needWrite(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const out = await transact(true, async () => {
      const { data, issue, project } = await findIssue(req.params.slug, req.params.key, id);
      const f = mapFields(body, project, data.members);
      if (!Object.keys(f).length) throw new HttpError(400, 'Nothing to change. Send any of: title, description, status, priority, assignee, due, start, labels, estimate.');
      const { assigneeId, ...rest } = f;
      const patch = { ...rest, ...(assigneeId !== undefined ? { assigneeId: assigneeId ?? undefined } : {}) } as IssuePatch;
      return { issue: await repo.updateIssue(issue.id, patch, id), project, members: data.members };
    }, scope(req.params.slug));
    emitter.issue('issue.updated', out.issue);
    return { issue: v(out.issue, out.project, out.members, req.params.slug) };
  });

  app.post<{ Params: { slug: string; key: string } }>('/api/v1/orgs/:slug/issues/:key/comments', async (req, reply) => {
    const id = user(req);
    needWrite(req);
    const body = (req.body ?? {}) as Record<string, unknown>;
    const text5 = text(body.body, 10000, 'body').trim();
    if (!text5) throw new HttpError(400, 'body is required.');
    const out = await transact(true, async () => {
      const { issue } = await findIssue(req.params.slug, req.params.key, id);
      return { issue, comment: await repo.addComment(issue.id, text5, id) };
    }, scope(req.params.slug));
    emitter.comment(out.issue, out.comment);
    return reply.code(201).send({ comment: { body: out.comment.body, created: out.comment.createdAt } });
  });
}

// ---- calendar feed -----------------------------------------------------------------------------------------

const icsText = (s: string) => s.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, ' ').replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
/** Lines over 75 bytes are folded (a CRLF and a space), as calendar programs expect. */
const fold = (line: string) => {
  const out: string[] = [];
  let cur = '';
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch) > 74) {
      out.push(cur);
      cur = ' ' + ch;
    } else cur += ch;
  }
  out.push(cur);
  return out.join('\r\n');
};
const compact = (d: string) => d.replace(/-/g, '');
const dayAfter = (d: string) => compact(new Date(Date.parse(`${d}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10));

/** Due dates of the unfinished work assigned to a person, as an iCalendar file any calendar app can subscribe to. */
export function dueDatesIcs(items: { issue: Issue; project: Project; orgName: string; url: string }[]): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const lines = ['BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//ABG Tracker//Due dates//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH', 'X-WR-CALNAME:ABG Tracker: my due dates'];
  for (const { issue, project, orgName, url } of items) {
    if (!issue.dueDate || isDone(project, issue)) continue;
    lines.push(
      'BEGIN:VEVENT',
      `UID:${issue.id}@abg-tracker`,
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${compact(issue.dueDate)}`,
      `DTEND;VALUE=DATE:${dayAfter(issue.dueDate)}`,
      `SUMMARY:${icsText(`${issue.key} ${issue.title}`)}`,
      `DESCRIPTION:${icsText(`${orgName} · ${project.name}`)}`,
      `URL:${url}`,
      'END:VEVENT'
    );
  }
  lines.push('END:VCALENDAR');
  return lines.map(fold).join('\r\n') + '\r\n';
}
