import { describe, expect, it } from 'vitest';
import { buildSeed } from '@/data/seed';
import { describeRule, planActions, ruleMatches, simulateRule, validateRule } from './automation';
import { confidenceOf, forecast, mulberry32, simulateDays } from './forecast';
import { burndown, cycleTime, weekBuckets, weeklyResolved, workload } from './reports';
import { containerForecasts, sprintForecast } from './insights';
import { respond, type CopilotContext } from './copilot';
import type { AutomationRule } from './types';

const db = buildSeed();
const plt = db.projects.find((p) => p.key === 'PLT')!;
const acmeIssues = db.issues.filter((i) => i.orgId === 'org_acme');
const members = db.memberships
  .filter((m) => m.orgId === 'org_acme')
  .map((m) => ({ ...db.users.find((u) => u.id === m.userId)!, role: m.role, membershipId: m.id }));
const now = new Date();

describe('forecast', () => {
  it('is deterministic for the same inputs', () => {
    const a = forecast([3, 4, 2, 5, 3, 4], 20);
    const b = forecast([3, 4, 2, 5, 3, 4], 20);
    expect(a.p85Days).toBe(b.p85Days);
  });
  it('orders percentiles and answers probabilities sensibly', () => {
    const f = forecast([3, 4, 2, 5, 3, 4], 20);
    expect(f.p50Days!).toBeLessThanOrEqual(f.p85Days!);
    expect(f.p85Days!).toBeLessThanOrEqual(f.p95Days!);
    expect(f.within(0)).toBe(0);
    expect(f.within(400)).toBe(1);
    expect(f.within(f.p85Days!)).toBeGreaterThanOrEqual(0.85);
  });
  it('handles no history and nothing remaining', () => {
    const none = forecast([0, 0, 0, 0], 10);
    expect(none.enoughHistory).toBe(false);
    expect(none.p50Days).toBeNull();
    expect(confidenceOf(none, 30).level).toBe('unknown');
    expect(confidenceOf(forecast([2, 2, 2], 0), 0).level).toBe('high');
  });
  it('uses partial weeks and never returns infinity for deliverable work', () => {
    const days = simulateDays([5, 5, 5], 5, 50, mulberry32(1));
    expect(days.every((d) => d === 7)).toBe(true);
    expect(simulateDays([5], 2, 5, mulberry32(1)).every((d) => d < 7)).toBe(true);
  });
});

describe('reports', () => {
  it('buckets resolved work per week from the seed history', () => {
    const weekly = weeklyResolved(plt, acmeIssues, now, 8);
    expect(weekly).toHaveLength(8);
    expect(weekly.reduce((a, b) => a + b, 0)).toBeGreaterThan(15);
    expect(weekBuckets(now, 3)).toHaveLength(3);
  });
  it('computes cycle time stats', () => {
    const c = cycleTime(plt, acmeIssues);
    expect(c.count).toBeGreaterThan(10);
    expect(c.p85).toBeGreaterThanOrEqual(c.median);
  });
  it('builds a burndown for the active sprint', () => {
    const sprint = db.sprints.find((s) => s.state === 'active')!;
    const b = burndown(plt, sprint, acmeIssues, now);
    expect(b.total).toBeGreaterThan(0);
    expect(b.points[0].ideal).toBe(b.total);
    expect(b.points[b.points.length - 1].ideal).toBe(0);
    expect(b.points.some((p) => p.actual === null)).toBe(true); // future days
  });
  it('summarises workload and counts unassigned work', () => {
    const rows = workload(plt, acmeIssues, members, now);
    expect(rows.some((r) => r.name === 'Unassigned')).toBe(true);
    expect(rows[0].openPoints).toBeGreaterThanOrEqual(rows[rows.length - 1].openPoints - 100);
  });
});

describe('insights', () => {
  it('forecasts the active sprint and epics', () => {
    const sprint = db.sprints.find((s) => s.state === 'active')!;
    const f = sprintForecast(plt, sprint, acmeIssues, now);
    expect(f.kind).toBe('sprint');
    expect(f.remaining).toBeGreaterThan(0);
    const rows = containerForecasts(plt, acmeIssues, now);
    expect(rows.length).toBeGreaterThan(0);
  });
});

describe('automation rules', () => {
  const rule = (o: Partial<AutomationRule>): AutomationRule => ({
    id: 'r', orgId: 'org_acme', projectId: plt.id, name: 'x', enabled: true,
    trigger: { type: 'issue_created' }, conditions: [], actions: [{ type: 'add_label', value: 'x' }],
    createdBy: 'u_alex', createdAt: '', runCount: 0, ...o,
  });
  const bug = acmeIssues.find((i) => i.key === 'PLT-9')!;

  it('matches triggers and conditions', () => {
    const created = { type: 'issue_created' as const, issue: bug };
    expect(ruleMatches(rule({ conditions: [{ field: 'type', op: 'is', value: 'Bug' }] }), created, plt)).toBe(true);
    expect(ruleMatches(rule({ conditions: [{ field: 'type', op: 'is', value: 'Story' }] }), created, plt)).toBe(false);
    expect(ruleMatches(rule({ conditions: [{ field: 'assignee', op: 'is_empty' }] }), created, plt)).toBe(false);
    expect(ruleMatches(rule({ enabled: false }), created, plt)).toBe(false);

    const moved = { type: 'status_changed' as const, issue: { ...bug, statusId: 'in_review' }, before: bug };
    expect(ruleMatches(rule({ trigger: { type: 'status_changed', statusId: 'in_review' } }), moved, plt)).toBe(true);
    expect(ruleMatches(rule({ trigger: { type: 'status_changed', statusId: 'done' } }), moved, plt)).toBe(false);
    expect(ruleMatches(rule({ trigger: { type: 'assignee_changed' } }), moved, plt)).toBe(false);
  });

  it('plans actions without applying them', () => {
    const plan = planActions(rule({ actions: [{ type: 'set_priority', value: 'high' }, { type: 'add_label', value: 'urgent' }, { type: 'set_assignee', value: 'nobody' }] }), bug, plt, members);
    expect(plan.patch.priority).toBe('high');
    expect(plan.patch.labels).toContain('urgent');
    expect(plan.errors).toHaveLength(1);
    expect(bug.labels).not.toContain('urgent'); // input untouched
  });

  it('validates rules, including self-triggering loops', () => {
    expect(validateRule({ name: '', trigger: { type: 'issue_created' }, actions: [{ type: 'add_label', value: 'a' }] }, plt)).toMatch(/name/);
    expect(validateRule({ name: 'a', trigger: { type: 'issue_created' }, actions: [] }, plt)).toMatch(/action/);
    expect(validateRule({ name: 'a', trigger: { type: 'status_changed', statusId: 'done' }, actions: [{ type: 'move_to_status', value: 'done' }] }, plt)).toMatch(/cannot move/);
    expect(validateRule({ name: 'a', trigger: { type: 'issue_created' }, actions: [{ type: 'add_label', value: 'a' }] }, plt)).toBeNull();
  });

  it('describes a rule in words and simulates it over history', () => {
    const r = db.rules.find((x) => x.id === 'r2')!;
    expect(describeRule(r, plt, members)).toMatch(/moves to “In Review”/);
    const fires = simulateRule({ trigger: { type: 'issue_created' }, conditions: [] }, plt, acmeIssues, db.activity, now, 3650);
    expect(fires.length).toBeGreaterThan(10);
    const overdue = simulateRule({ trigger: { type: 'due_date_passed' }, conditions: [] }, plt, acmeIssues, db.activity, new Date(Date.now() + 40 * 86400000));
    expect(overdue.length).toBeGreaterThan(0);
  });
});

describe('copilot', () => {
  const ctx: CopilotContext = { userId: 'u_alex', members, projects: db.projects.filter((p) => p.orgId === 'org_acme'), project: plt, issues: acmeIssues, sprints: db.sprints, activity: db.activity, now };

  it('writes a status update from real data', () => {
    const r = respond('write a status update', ctx);
    expect(r.text).toMatch(/Status update/);
    expect(r.text).toMatch(/Sprint 8/);
    expect(r.actions).toHaveLength(0);
  });
  it('proposes (never applies) a status change and an assignment', () => {
    const move = respond('move PLT-14 to in progress', ctx);
    expect(move.actions[0]).toMatchObject({ type: 'update_issue', patch: { statusId: 'in_progress' } });
    const assign = respond('assign PLT-8 to Priya', ctx);
    expect(assign.actions[0]).toMatchObject({ type: 'update_issue', patch: { assigneeId: 'u_priya' } });
    const prio = respond('set priority of PLT-10 to critical', ctx);
    expect(prio.actions[0]).toMatchObject({ patch: { priority: 'critical' } });
    expect(respond('comment on PLT-3: ready for QA', ctx).actions[0]).toMatchObject({ type: 'comment', body: 'ready for QA' });
  });
  it('parses a natural-language create request', () => {
    const r = respond('create a bug: login fails on Safari, priority high, due tomorrow, assign to Sam', ctx);
    const a = r.actions[0];
    expect(a.type).toBe('create_issue');
    if (a.type === 'create_issue') {
      expect(a.input).toMatchObject({ projectId: plt.id, typeId: 'bug', title: 'Login fails on Safari', priority: 'high', assigneeId: 'u_sam' });
      expect(a.input.dueDate).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    }
  });
  it('proposes a breakdown and does not split sub-tasks', () => {
    expect(respond('break down PLT-3', ctx).actions.length).toBeGreaterThan(2);
    expect(respond('break down PLT-4', ctx).actions).toHaveLength(0);
  });
  it('reports risks, blockers and workload with suggestions', () => {
    const risk = respond("what's at risk?", ctx);
    expect(risk.text).toMatch(/Risk radar/);
    expect(respond("what's blocked?", ctx).text).toMatch(/PLT-7/);
    expect(respond('who is overloaded?', ctx).text).toMatch(/Workload/);
  });
  it('asks when it needs more, and shows help otherwise', () => {
    expect(respond('assign PLT-3 to nobody', ctx).text).toMatch(/Who should I assign/);
    expect(respond('blah blah', ctx).text).toMatch(/didn't understand/);
    expect(respond('help', ctx).text).toMatch(/No external AI model/);
    const orgWide = respond('create a task: fix typo', { ...ctx, project: undefined });
    expect(orgWide.actions).toHaveLength(0);
  });
});
