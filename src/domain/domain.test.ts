import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/data/seed';
import { compileQuery, resolveDate, type QueryContext } from './query';
import { checkRequired, checkTransition, allowedTargets } from './workflow';
import { extractMentions, splitMentions } from './mentions';
import { validateCustomFields } from './customFields';
import { rankBetween } from './rank';

const db = buildSeed();
const acme = db.projects.filter((p) => p.orgId === 'org_acme');
const issues = db.issues.filter((i) => i.orgId === 'org_acme');
const members = db.users.filter((u) => ['u_alex', 'u_priya', 'u_sam'].includes(u.id));
const ctx: QueryContext = { userId: 'u_alex', members, projects: acme, issues, now: new Date('2025-06-15T12:00:00') };

const run = (q: string) => {
  const c = compileQuery(q, ctx);
  if (!c.ok) throw new Error(c.error);
  const out = issues.filter(c.match);
  return c.compare ? out.sort(c.compare) : out;
};

describe('query language', () => {
  it('matches empty query to everything', () => {
    expect(run('')).toHaveLength(issues.length);
  });
  it('filters by status name and assignee=me', () => {
    const r = run('status = "In Progress" AND assignee = me');
    expect(r.length).toBeGreaterThan(0);
    expect(r.every((i) => i.statusId === 'in_progress' && i.assigneeId === 'u_alex')).toBe(true);
  });
  it('supports priority ordering comparisons', () => {
    const r = run('priority >= high');
    expect(r.every((i) => i.priority === 'high' || i.priority === 'critical')).toBe(true);
    expect(r.some((i) => i.priority === 'critical')).toBe(true);
  });
  it('supports OR with parentheses and NOT', () => {
    const r = run('(type = Bug OR type = Epic) AND NOT assignee = me');
    expect(r.every((i) => ['bug', 'epic'].includes(i.typeId) && i.assigneeId !== 'u_alex')).toBe(true);
  });
  it('supports IN and IS EMPTY', () => {
    expect(run('type in (Bug, Epic)').every((i) => ['bug', 'epic'].includes(i.typeId))).toBe(true);
    expect(run('assignee is empty').every((i) => !i.assigneeId)).toBe(true);
    expect(run('assignee is not empty').every((i) => !!i.assigneeId)).toBe(true);
  });
  it('searches free text and labels', () => {
    expect(run('rate limiting').map((i) => i.key)).toContain('PLT-3');
    expect(run('label = api').length).toBeGreaterThan(0);
  });
  it('compares relative dates', () => {
    expect(resolveDate('7d', ctx.now!)).toBe('2025-06-22');
    expect(resolveDate('-1w', ctx.now!)).toBe('2025-06-08');
    expect(run('due < today').every((i) => (i.dueDate ?? '9') < '2025-06-15')).toBe(true);
  });
  it('supports custom fields by name', () => {
    expect(run('Environment = Production').map((i) => i.key)).toEqual(['PLT-9']);
  });
  it('sorts with ORDER BY', () => {
    const r = run('estimate > 0 ORDER BY estimate DESC');
    const est = r.map((i) => i.estimate!);
    expect([...est].sort((a, b) => b - a)).toEqual(est);
  });
  it('reports friendly errors', () => {
    for (const q of ['foo = bar', 'priority = urgent', 'status = ', '(status = Done', 'due < someday', 'title > 3', 'ORDER BY nonsense']) {
      const c = compileQuery(q, ctx);
      expect(c.ok, q).toBe(false);
    }
  });
});

describe('workflow', () => {
  const plt = acme.find((p) => p.key === 'PLT')!;
  const base = { statusId: 'backlog', assigneeId: undefined, estimate: undefined, dueDate: undefined, description: '' };

  it('blocks transitions that are not allowed', () => {
    expect(checkTransition(plt, base, 'done')).toMatch(/can't move directly/);
    expect(checkTransition(plt, base, 'selected')).toBeNull();
  });
  it('lists allowed targets including current', () => {
    expect(allowedTargets(plt, 'selected').map((s) => s.id).sort()).toEqual(['backlog', 'in_progress', 'selected']);
  });
  it('enforces required fields, considering same-update patch', () => {
    const sel = { ...base, statusId: 'selected' };
    expect(checkTransition(plt, sel, 'in_progress')).toMatch(/Assignee/);
    expect(checkTransition(plt, sel, 'in_progress', { assigneeId: 'u_sam' })).toBeNull();
    expect(checkRequired(plt, base, 'done')).toMatch(/Assignee/);
  });
  it('is permissive when the workflow is not restricted', () => {
    const mob = acme.find((p) => p.key === 'MOB')!;
    expect(checkTransition(mob, { ...base, statusId: 'todo' }, 'done')).toBeNull();
  });
});

describe('mentions', () => {
  it('extracts and splits @Full Name mentions', () => {
    const body = 'Hey @Sam Chen and @alex rivera, thanks! Not @Sam Chenxx';
    expect(extractMentions(body, members).sort()).toEqual(['u_alex', 'u_sam']);
    const seg = splitMentions('hi @Priya Nair!', members);
    expect(seg.map((s) => s.mention)).toEqual([false, true, false]);
  });
});

describe('custom fields', () => {
  const plt = acme.find((p) => p.key === 'PLT')!;
  it('validates types and options', () => {
    expect(validateCustomFields(plt, 'bug', { cf_env: 'Mars' }, { enforceRequired: false })).toMatch(/not an option/);
    expect(validateCustomFields(plt, 'bug', { cf_env: 'Dev' }, { enforceRequired: false })).toBeNull();
  });
  it('ignores fields scoped to other types', () => {
    expect(validateCustomFields(plt, 'story', { cf_env: 'Mars' }, { enforceRequired: false })).toBeNull();
  });
});

describe('rank', () => {
  it('returns values between neighbours', () => {
    expect(rankBetween(1000, 2000)).toBe(1500);
    expect(rankBetween(undefined, 1000)).toBeLessThan(1000);
    expect(rankBetween(1000, undefined)).toBeGreaterThan(1000);
  });
});
