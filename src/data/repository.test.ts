import { beforeEach, describe, expect, it } from 'vitest';
import { LocalRepository } from './localRepository';
import { approvalState } from '@/domain/approvals';
import { wouldCreateCycle, scheduleConflicts } from '@/domain/dependencies';
import { sprintStats, velocity, checkStart } from '@/domain/sprints';
import { orgWorkload, projectHealth } from '@/domain/portfolio';
import { applyDrag, spanOf, toDay, fromDay } from '@/domain/timeline';

class MemoryStorage {
  private m = new Map<string, string>();
  getItem(k: string) {
    return this.m.get(k) ?? null;
  }
  setItem(k: string, v: string) {
    this.m.set(k, v);
  }
  removeItem(k: string) {
    this.m.delete(k);
  }
}

let repo: LocalRepository;
beforeEach(() => {
  (globalThis as unknown as { localStorage: MemoryStorage }).localStorage = new MemoryStorage();
  repo = new LocalRepository();
});

const load = (org = 'org_acme', user = 'u_alex') => repo.loadOrg(org, user);

describe('sprints', () => {
  it('starts only one sprint at a time and records committed points', async () => {
    const d = await load();
    const planned = d.sprints.find((s) => s.state === 'planned')!;
    await expect(repo.startSprint(planned.id, 'u_alex')).rejects.toThrow(/still active/);

    const active = d.sprints.find((s) => s.state === 'active')!;
    const done = await repo.completeSprint(active.id, planned.id, 'u_alex');
    expect(done.state).toBe('completed');
    const project = d.projects.find((p) => p.id === active.projectId)!;
    const after = await load();
    const stats = sprintStats(project, after.issues, active.id);
    expect(done.completedPoints).toBe(stats.donePoints);
    // unfinished work moved to the next sprint, finished work stayed
    const moved = after.issues.filter((i) => i.sprintId === planned.id);
    expect(moved.length).toBeGreaterThan(2);

    const started = await repo.startSprint(planned.id, 'u_alex');
    expect(started.state).toBe('active');
    expect(started.committedPoints).toBeGreaterThan(0);
  });

  it('refuses to start without dates and to add work to a completed sprint', async () => {
    const d = await load();
    const s = await repo.createSprint(d.projects[0].id, { name: 'No dates' }, 'u_alex');
    expect(checkStart(s, [])).toMatch(/dates/);
    const completed = d.sprints.find((x) => x.state === 'completed')!;
    const issue = d.issues.find((i) => i.projectId === completed.projectId && !i.sprintId)!;
    await expect(repo.updateIssue(issue.id, { sprintId: completed.id }, 'u_alex')).rejects.toThrow(/completed/);
  });

  it('sub-tasks follow their parent into a sprint, and members cannot be bypassed by guests', async () => {
    const d = await load();
    const parent = d.issues.find((i) => i.key === 'PLT-3')!;
    const planned = d.sprints.find((s) => s.state === 'planned')!;
    await repo.updateIssue(parent.id, { sprintId: planned.id }, 'u_alex');
    const after = await load();
    expect(after.issues.filter((i) => i.parentId === parent.id).every((i) => i.sprintId === planned.id)).toBe(true);

    await expect(repo.createSprint(d.projects[0].id, { name: 'x' }, 'u_maya')).rejects.toThrow(/not a member/);
  });

  it('computes velocity from completed sprints', async () => {
    const d = await load();
    expect(velocity(d.sprints).average).toBe(11);
  });

  it('deleting a planned sprint returns its issues to the backlog', async () => {
    const d = await load();
    const planned = d.sprints.find((s) => s.state === 'planned')!;
    await repo.deleteSprint(planned.id, 'u_alex');
    const after = await load();
    expect(after.issues.some((i) => i.sprintId === planned.id)).toBe(false);
    await expect(repo.deleteSprint(d.sprints.find((s) => s.state === 'active')!.id, 'u_alex')).rejects.toThrow(/planned/);
  });
});

describe('approvals', () => {
  it('requires every approver; guests can decide; rejection needs a reason', async () => {
    const d = await load('org_nw', 'u_maya');
    const legal = d.issues.find((i) => i.key === 'LCH-6')!;
    expect(approvalState(legal.approval!)).toBe('pending');

    // cannot be marked done before it is approved
    const doneId = d.projects[0].statuses.find((s) => s.category === 'done')!.id;
    await expect(repo.updateIssue(legal.id, { statusId: doneId }, 'u_jordan')).rejects.toThrow(/needs approval/);

    await expect(repo.decideApproval(legal.id, 'rejected', '', 'u_maya')).rejects.toThrow(/explain/);
    const approved = await repo.decideApproval(legal.id, 'approved', undefined, 'u_maya'); // guest approver
    expect(approvalState(approved.approval!)).toBe('approved');
    expect(approved.statusId).toBe(doneId);
  });

  it('rejects non-approvers and moves rejected items back to a to-do status', async () => {
    const d = await load('org_nw', 'u_jordan');
    const legal = d.issues.find((i) => i.key === 'LCH-6')!;
    await expect(repo.decideApproval(legal.id, 'approved', undefined, 'u_alex')).rejects.toThrow(/not an approver/);
    const rejected = await repo.decideApproval(legal.id, 'rejected', 'Claim 3 is unsupported', 'u_maya');
    expect(approvalState(rejected.approval!)).toBe('rejected');
    expect(d.projects[0].statuses.find((s) => s.id === rejected.statusId)!.category).toBe('todo');
    const reset = await repo.resetApproval(legal.id, 'u_jordan');
    expect(approvalState(reset.approval!)).toBe('pending');
  });

  it('notifies approvers when they are added', async () => {
    const d = await load('org_nw', 'u_jordan');
    const task = d.issues.find((i) => i.key === 'LCH-7')!; // a regular task
    await repo.updateIssue(task.id, { approverIds: ['u_maya'] }, 'u_jordan');
    const maya = await load('org_nw', 'u_maya');
    expect(maya.notifications.some((n) => n.issueId === task.id && n.kind === 'approval')).toBe(true);
  });
});

describe('dependencies', () => {
  it('detects cycles and rejects them', async () => {
    const d = await load();
    const byKey = (k: string) => d.issues.find((i) => i.key === k)!;
    const pagination = byKey('PLT-7'); // blocked by PLT-3
    const rate = byKey('PLT-3');
    expect(wouldCreateCycle(d.issues, rate.id, [pagination.id])).toBe(true);
    await expect(repo.updateIssue(rate.id, { blockedBy: [pagination.id] }, 'u_alex')).rejects.toThrow(/loop/);
    await expect(repo.updateIssue(rate.id, { blockedBy: [rate.id] }, 'u_alex')).rejects.toThrow(/block itself/);
  });

  it('flags issues scheduled before their blocker finishes', async () => {
    const d = await load();
    const conflicts = scheduleConflicts(d.issues);
    expect(conflicts.some((c) => d.issues.find((i) => i.id === c.issueId)?.key === 'PLT-7')).toBe(true);
  });

  it('removes a deleted issue from other issues blockedBy', async () => {
    const d = await load();
    const rate = d.issues.find((i) => i.key === 'PLT-3')!;
    await repo.deleteIssue(rate.id, 'u_alex');
    const after = await load();
    expect(after.issues.find((i) => i.key === 'PLT-7')!.blockedBy).toEqual([]);
  });
});

describe('automation engine', () => {
  const plt = async () => (await load()).projects.find((p) => p.key === 'PLT')!;

  it('fires on create: triage rule assigns, labels and logs a run', async () => {
    const p = await plt();
    const bug = await repo.createIssue('org_acme', { projectId: p.id, typeId: 'bug', title: 'Crash on login' }, 'u_sam');
    expect(bug.assigneeId).toBe('u_alex');
    expect(bug.labels).toContain('needs-triage');
    const d = await load();
    const run = d.runs.find((r) => r.issueId === bug.id && r.ruleId === 'r1');
    expect(run?.result).toBe('success');
    expect(d.rules.find((r) => r.id === 'r1')!.runCount).toBe(1);
    // Alex got an "assigned" notification from the automation
    expect(d.notifications.some((n) => n.issueId === bug.id && n.kind === 'assigned')).toBe(true);
    // a story is not a bug, so the rule must not touch it
    const story = await repo.createIssue('org_acme', { projectId: p.id, typeId: 'story', title: 'Something else' }, 'u_sam');
    expect(story.assigneeId).toBeUndefined();
  });

  it('fires on status change: comment + notify', async () => {
    const d = await load();
    const issue = d.issues.find((i) => i.key === 'PLT-9')!; // in progress, reporter Priya
    await repo.updateIssue(issue.id, { statusId: 'in_review' }, 'u_alex');
    const after = await load();
    expect(after.comments.some((c) => c.issueId === issue.id && c.authorId === 'automation')).toBe(true);
    const priya = await load('org_acme', 'u_priya');
    expect(priya.notifications.some((n) => n.issueId === issue.id && n.kind === 'automation')).toBe(true);
  });

  it('runs time-based rules once per issue', async () => {
    const d = await load();
    const issue = d.issues.find((i) => i.key === 'PLT-14')!;
    await repo.updateIssue(issue.id, { dueDate: '2020-01-01' }, 'u_alex');
    expect(await repo.runScheduledAutomations('org_acme', 'u_alex')).toBe(1);
    const after = (await load()).issues.find((i) => i.id === issue.id)!;
    expect(after.priority).toBe('high');
    expect(after.labels).toContain('overdue');
    expect(await repo.runScheduledAutomations('org_acme', 'u_alex')).toBe(0);
  });

  it('cannot push work past a required-field gate', async () => {
    const p = await plt();
    await repo.createRule(p.id, { name: 'Auto start', trigger: { type: 'issue_created' }, conditions: [{ field: 'type', op: 'is', value: 'story' }], actions: [{ type: 'move_to_status', value: 'in_progress' }] }, 'u_alex');
    const s = await repo.createIssue('org_acme', { projectId: p.id, typeId: 'story', title: 'Needs an owner first' }, 'u_alex');
    expect(s.statusId).toBe('backlog'); // In Progress requires an assignee
    const run = (await load()).runs.find((r) => r.issueId === s.id && r.ruleName === 'Auto start');
    expect(run?.message).toMatch(/requires: Assignee/);
  });

  it('stops rules that ping-pong between statuses', async () => {
    const p = await plt();
    await repo.createRule(p.id, { name: 'A', trigger: { type: 'status_changed', statusId: 'selected' }, conditions: [], actions: [{ type: 'move_to_status', value: 'backlog' }] }, 'u_alex');
    await repo.createRule(p.id, { name: 'B', trigger: { type: 'status_changed', statusId: 'backlog' }, conditions: [], actions: [{ type: 'move_to_status', value: 'selected' }] }, 'u_alex');
    const d = await load();
    const issue = d.issues.find((i) => i.key === 'PLT-14')!; // selected
    await repo.updateIssue(issue.id, { statusId: 'backlog' }, 'u_alex'); // terminates instead of looping
    const runs = (await load()).runs.filter((r) => r.issueId === issue.id && ['A', 'B'].includes(r.ruleName));
    expect(runs.length).toBeGreaterThan(0);
    expect(runs.length).toBeLessThanOrEqual(4);
  });

  it('only admins manage rules; disabled rules do nothing', async () => {
    const p = await plt();
    await expect(repo.createRule(p.id, { name: 'x', trigger: { type: 'issue_created' }, conditions: [], actions: [{ type: 'add_label', value: 'x' }] }, 'u_sam')).rejects.toThrow(/not allowed/);
    await repo.updateRule('r1', { enabled: false }, 'u_priya');
    const bug = await repo.createIssue('org_acme', { projectId: p.id, typeId: 'bug', title: 'Quiet bug' }, 'u_sam');
    expect(bug.assigneeId).toBeUndefined();
    await repo.deleteRule('r1', 'u_priya');
    expect((await load()).rules.some((r) => r.id === 'r1')).toBe(false);
  });
});

describe('intake forms', () => {
  const visitor = { name: 'Dana Visitor', email: 'dana@example.com' };

  it('lets anyone see and submit an enabled form, creating a mapped issue', async () => {
    const pub = await repo.getPublicForm('acme', 'report-a-bug');
    expect(pub.orgName).toBe('Acme Software');
    expect(JSON.stringify(pub)).not.toMatch(/u_priya|createdBy|memberships/); // nothing internal leaks

    const { key } = await repo.submitForm('acme', 'report-a-bug', { q_title: 'Export button crashes', q_steps: '1. Click export\n2. Boom', q_env: 'Production', q_pri: 'High' }, visitor);
    const d = await load();
    const issue = d.issues.find((i) => i.key === key)!;
    expect(issue.typeId).toBe('bug');
    expect(issue.title).toBe('Export button crashes');
    expect(issue.priority).toBe('high');
    expect(issue.customFields.cf_env).toBe('Production');
    expect(issue.description).toContain('Steps to reproduce');
    expect(issue.description).toContain('dana@example.com');
    expect(issue.source).toMatchObject({ formId: 'form_bug', submitterName: 'Dana Visitor' });
    expect(issue.labels).toContain('intake');
    expect(d.forms.find((f) => f.id === 'form_bug')!.submissionCount).toBe(1);
    // the triage automation also ran, because the issue was created like any other
    expect(issue.assigneeId).toBe('u_alex');
    // the form owner / project lead is told
    const priya = await load('org_acme', 'u_priya');
    expect(priya.notifications.some((n) => n.issueId === issue.id && n.kind === 'intake')).toBe(true);
  });

  it('validates answers and rejects bad input', async () => {
    await expect(repo.submitForm('acme', 'report-a-bug', { q_steps: 'x' }, visitor)).rejects.toThrow(/required/);
    await expect(repo.submitForm('acme', 'report-a-bug', { q_title: 'a', q_steps: 'b', q_env: 'Mars' }, visitor)).rejects.toThrow(/choose one/);
    await expect(repo.submitForm('acme', 'report-a-bug', { q_title: 'a', q_steps: 'b' }, { name: 'X', email: 'nope' })).rejects.toThrow(/email/);
    await expect(repo.submitForm('acme', 'report-a-bug', { q_title: 'a'.repeat(6000), q_steps: 'b' }, visitor)).rejects.toThrow(/too long/);
  });

  it('ignores bots (honeypot), hides disabled forms, and rate-limits', async () => {
    const before = (await load()).issues.length;
    const fake = await repo.submitForm('acme', 'report-a-bug', { q_title: 'spam', q_steps: 'spam' }, visitor, 'http://spam.example');
    expect(fake.key).toMatch(/-0$/);
    expect((await load()).issues.length).toBe(before);

    await expect(repo.getPublicForm('acme', 'nope')).rejects.toThrow(/not available/);
    await expect(repo.getPublicForm('northwind', 'report-a-bug')).rejects.toThrow(/not available/); // other org's slug space

    for (let i = 0; i < 20; i++) await repo.submitForm('acme', 'report-a-bug', { q_title: `Bug ${i}`, q_steps: 'steps' }, visitor);
    await expect(repo.submitForm('acme', 'report-a-bug', { q_title: 'one more', q_steps: 'steps' }, visitor)).rejects.toThrow(/Too many/);

    await repo.updateForm('form_bug', { enabled: false }, 'u_priya');
    await expect(repo.getPublicForm('acme', 'report-a-bug')).rejects.toThrow(/not available/);
  });

  it('only admins manage forms, and definitions are validated', async () => {
    const d = await load();
    const p = d.projects.find((x) => x.key === 'PLT')!;
    const good = { name: 'Feature idea', description: '', issueTypeId: 'story', defaultPriority: 'low' as const, fields: [{ id: 'a', label: 'Idea', kind: 'short' as const, required: true, target: 'title' as const }] };
    await expect(repo.createForm(p.id, good, 'u_sam')).rejects.toThrow(/not allowed/);
    const f = await repo.createForm(p.id, good, 'u_priya');
    expect(f.slug).toBe('feature-idea');
    await expect(repo.createForm(p.id, good, 'u_priya')).rejects.toThrow(/already used/);
    await expect(repo.createForm(p.id, { ...good, name: 'No title', fields: [{ ...good.fields[0], target: 'description' }] }, 'u_priya')).rejects.toThrow(/title/);
    await expect(repo.createForm(p.id, { ...good, name: 'Bad type', issueTypeId: 'subtask' }, 'u_priya')).rejects.toThrow(/issue type/);
    await repo.deleteForm(f.id, 'u_priya');
    await expect(repo.getPublicForm('acme', 'feature-idea')).rejects.toThrow(/not available/);
  });
});

describe('portfolio', () => {
  it('rates project health and rolls up workload across projects', async () => {
    const d = await load();
    const rows = d.projects.map((p) => projectHealth(p, d.issues, d.sprints));
    expect(rows).toHaveLength(2);
    const plt = rows.find((r) => r.project.key === 'PLT')!;
    expect(['amber', 'red']).toContain(plt.health); // Sprint 8 is behind in the seed
    expect(plt.reasons.length).toBeGreaterThan(0);
    expect(plt.progress).toBeGreaterThan(0.3);
    const load2 = orgWorkload(d.projects, d.issues, d.members);
    expect(load2.length).toBeGreaterThan(0);
    expect(load2.some((p) => p.projects.length >= 1)).toBe(true);
  });
});

describe('custom columns', () => {
  it('lets a team start a project with its own columns', async () => {
    const p = await repo.createProject('org_acme', {
      name: 'Support', key: 'SUP', description: '', color: '#0f766e', workStyle: 'flow',
      statuses: [
        { name: 'Inbox', category: 'todo' },
        { name: 'Waiting on customer', category: 'in_progress' },
        { name: 'Fixing', category: 'in_progress' },
        { name: 'Resolved', category: 'done' },
      ],
    }, 'u_alex');
    expect(p.statuses.map((s) => s.name)).toEqual(['Inbox', 'Waiting on customer', 'Fixing', 'Resolved']);
    expect(p.workflow.restrict).toBe(false); // work moves freely between the team's own columns
    expect(new Set(p.statuses.map((s) => s.id)).size).toBe(4);
    // and they work: create a card in a custom column, then finish it
    const issue = await repo.createIssue('org_acme', { projectId: p.id, typeId: 'task', title: 'Customer cannot log in', statusId: p.statuses[1].id }, 'u_alex');
    const done = await repo.updateIssue(issue.id, { statusId: p.statuses[3].id }, 'u_alex');
    expect(done.resolvedAt).toBeTruthy();
  });

  it('keeps the standard setup when the columns were not changed, and rejects bad sets', async () => {
    const std = await repo.createProject('org_acme', {
      name: 'Std', key: 'STD', description: '', color: '#0f766e', workStyle: 'agile',
      statuses: [{ name: 'Backlog', category: 'todo' }, { name: 'Selected', category: 'todo' }, { name: 'In Progress', category: 'in_progress' }, { name: 'In Review', category: 'in_progress' }, { name: 'Done', category: 'done' }],
    }, 'u_alex');
    expect(std.workflow.restrict).toBe(true); // template workflow kept
    const bad = (statuses: { name: string; category: 'todo' | 'in_progress' | 'done' }[]) => repo.createProject('org_acme', { name: 'Bad', key: 'BAD', description: '', color: '#000', workStyle: 'flow', statuses }, 'u_alex');
    await expect(bad([{ name: 'Only', category: 'done' }])).rejects.toThrow(/at least two/);
    await expect(bad([{ name: 'A', category: 'todo' }, { name: 'a', category: 'done' }])).rejects.toThrow(/already a column/);
    await expect(bad([{ name: 'A', category: 'todo' }, { name: 'B', category: 'in_progress' }])).rejects.toThrow(/Finished/);
    await expect(bad([{ name: '', category: 'todo' }, { name: 'B', category: 'done' }])).rejects.toThrow(/name/);
  });

  it('moves the cards to a chosen column when a column is deleted', async () => {
    const d = await load();
    const plt = d.projects.find((p) => p.key === 'PLT')!;
    const inReview = d.issues.filter((i) => i.projectId === plt.id && i.statusId === 'in_review');
    expect(inReview.length).toBeGreaterThan(0);

    await expect(repo.deleteStatus(plt.id, 'in_review', null, 'u_alex')).rejects.toThrow(/Choose where/);
    await expect(repo.deleteStatus(plt.id, 'in_review', 'in_review', 'u_alex')).rejects.toThrow(/Choose where/);
    await expect(repo.deleteStatus(plt.id, 'in_review', 'in_progress', 'u_sam')).rejects.toThrow(/not allowed/); // members can't restructure

    const after = await repo.deleteStatus(plt.id, 'in_review', 'in_progress', 'u_alex');
    expect(after.statuses.some((s) => s.id === 'in_review')).toBe(false);
    expect(after.workflow.transitions['in_progress']).not.toContain('in_review'); // no dangling workflow references
    const now2 = await load();
    for (const c of inReview) {
      const moved = now2.issues.find((i) => i.id === c.id)!;
      expect(moved.statusId).toBe('in_progress');
      expect(now2.activity.some((a) => a.issueId === c.id && a.field === 'status' && a.to === 'In Progress')).toBe(true);
    }
  });

  it('never leaves a project without a Finished column or below two columns', async () => {
    const d = await load();
    const mob = d.projects.find((p) => p.key === 'MOB')!;
    await repo.deleteStatus(mob.id, 'blocked', 'todo', 'u_alex');
    await repo.deleteStatus(mob.id, 'doing', 'todo', 'u_alex');
    await expect(repo.deleteStatus(mob.id, 'done', 'todo', 'u_alex')).rejects.toThrow(/at least two/);
    await expect(repo.deleteStatus(mob.id, 'nope', null, 'u_alex')).rejects.toThrow(/not found/);
  });
});

describe('custom issue types', () => {
  const plt = async () => (await load()).projects.find((p) => p.key === 'PLT')!;
  const withNew = (p: { issueTypes: import('@/domain/types').IssueType[] }) => [
    ...p.issueTypes.slice(0, -1),
    { id: 'customer_request', name: 'Customer request', icon: 'phone', color: '#0f766e', level: 1 as const },
    p.issueTypes[p.issueTypes.length - 1],
  ];

  it('lets admins add a type that behaves like any other', async () => {
    const p = await plt();
    const updated = await repo.updateProject(p.id, { issueTypes: withNew(p) }, 'u_priya');
    expect(updated.issueTypes.map((t) => t.name)).toContain('Customer request');
    const issue = await repo.createIssue('org_acme', { projectId: p.id, typeId: 'customer_request', title: 'Customer cannot export' }, 'u_sam');
    expect(issue.typeId).toBe('customer_request');
    // a rename keeps the type id, so existing items follow
    const renamed = await repo.updateProject(p.id, { issueTypes: updated.issueTypes.map((t) => (t.id === 'customer_request' ? { ...t, name: 'Support request' } : t)) }, 'u_priya');
    expect(renamed.issueTypes.find((t) => t.id === 'customer_request')!.name).toBe('Support request');
    expect((await load()).issues.find((i) => i.id === issue.id)!.typeId).toBe('customer_request');
  });

  it('only admins may change types, and bad sets are refused', async () => {
    const p = await plt();
    await expect(repo.updateProject(p.id, { issueTypes: withNew(p) }, 'u_sam')).rejects.toThrow(/not allowed/);
    await expect(repo.updateProject(p.id, { issueTypes: p.issueTypes.filter((t) => t.level !== 1) }, 'u_priya')).rejects.toThrow(/work-item/);
    await expect(repo.updateProject(p.id, { issueTypes: [...p.issueTypes, { id: 'dup', name: 'bug', icon: 'bug', color: '#000000', level: 1 }] }, 'u_priya')).rejects.toThrow(/already a type/);
    await expect(repo.updateProject(p.id, { issueTypes: [...p.issueTypes, { id: 'z', name: 'Z', icon: 'nope', color: '#000000', level: 1 }] }, 'u_priya')).rejects.toThrow(/icon/);
    await expect(repo.updateProject(p.id, { issueTypes: [...p.issueTypes, { id: "x'; drop", name: 'Evil', icon: 'bug', color: '#000000', level: 1 }] }, 'u_priya')).rejects.toThrow(/may only contain/);
  });

  it('protects types that have items: no silent drop, no change of kind', async () => {
    const p = await plt();
    await expect(repo.updateProject(p.id, { issueTypes: p.issueTypes.filter((t) => t.id !== 'bug') }, 'u_priya')).rejects.toThrow(/still in use/);
    await expect(repo.updateProject(p.id, { issueTypes: p.issueTypes.map((t) => (t.id === 'bug' ? { ...t, level: 0 as const } : t)) }, 'u_priya')).rejects.toThrow(/can't change what kind/);
    // an unused type can change kind freely
    const next = await repo.updateProject(p.id, { issueTypes: withNew(p) }, 'u_priya');
    const changed = await repo.updateProject(p.id, { issueTypes: next.issueTypes.map((t) => (t.id === 'customer_request' ? { ...t, level: 0 as const } : t)) }, 'u_priya');
    expect(changed.issueTypes.find((t) => t.id === 'customer_request')!.level).toBe(0);
  });

  it('moves items to another type when a type is removed', async () => {
    const d = await load();
    const p = d.projects.find((x) => x.key === 'PLT')!;
    const bugs = d.issues.filter((i) => i.projectId === p.id && i.typeId === 'bug');
    expect(bugs.length).toBeGreaterThan(0);

    await expect(repo.deleteIssueType(p.id, 'bug', null, 'u_priya')).rejects.toThrow(/Choose another type/);
    await expect(repo.deleteIssueType(p.id, 'bug', 'epic', 'u_priya')).rejects.toThrow(/Choose another type/); // wrong kind of item
    await expect(repo.deleteIssueType(p.id, 'bug', 'task', 'u_sam')).rejects.toThrow(/not allowed/);

    const after = await repo.deleteIssueType(p.id, 'bug', 'task', 'u_priya');
    expect(after.issueTypes.some((t) => t.id === 'bug')).toBe(false);
    const now2 = await load();
    for (const b of bugs) {
      expect(now2.issues.find((i) => i.id === b.id)!.typeId).toBe('task');
      expect(now2.activity.some((a) => a.issueId === b.id && a.field === 'type' && a.to === 'Task')).toBe(true);
    }
    // the request form that created bugs now creates tasks, and rules naming "bug" follow
    expect(now2.forms.find((f) => f.id === 'form_bug')!.issueTypeId).toBe('task');
    expect(now2.rules.find((r) => r.id === 'r1')!.conditions.find((c) => c.field === 'type')!.value).toBe('task');
  });

  it('never removes the last work-item type', async () => {
    const d = await load();
    const mob = d.projects.find((p) => p.key === 'MOB')!; // task, bug, subtask
    await repo.deleteIssueType(mob.id, 'bug', 'task', 'u_alex');
    await expect(repo.deleteIssueType(mob.id, 'task', null, 'u_alex')).rejects.toThrow(/work-item/);
    await repo.deleteIssueType(mob.id, 'subtask', null, 'u_alex'); // an unused sub-task type can simply go
    expect((await load()).projects.find((p) => p.id === mob.id)!.issueTypes.map((t) => t.id)).toEqual(['task']);
  });

  it('lets a custom type act as a milestone or an approval', async () => {
    const d = await load('org_nw', 'u_jordan');
    const p = d.projects.find((x) => x.key === 'LCH')!;
    const next = await repo.updateProject(p.id, {
      issueTypes: [...p.issueTypes.slice(0, -1), { id: 'sign_off', name: 'Sign-off', icon: 'shield', color: '#0f8b8d', level: 1, kind: 'approval' }, p.issueTypes[p.issueTypes.length - 1]],
    }, 'u_jordan');
    expect(next.issueTypes.find((t) => t.id === 'sign_off')!.kind).toBe('approval');
    const issue = await repo.createIssue('org_nw', { projectId: p.id, typeId: 'sign_off', title: 'Brand approval', approverIds: ['u_maya'] }, 'u_jordan');
    expect(issue.approval?.approverIds).toEqual(['u_maya']);
  });
});

describe('timeline math', () => {
  it('converts days without timezone drift', () => {
    expect(fromDay(toDay('2025-03-30'))).toBe('2025-03-30');
    expect(toDay('2025-03-31') - toDay('2025-03-30')).toBe(1);
  });
  it('builds spans, including single-date issues', () => {
    expect(spanOf({})).toBeNull();
    expect(spanOf({ dueDate: '2025-01-10' })).toEqual({ start: toDay('2025-01-10'), end: toDay('2025-01-10') });
  });
  it('drags without letting end precede start', () => {
    const span = { start: toDay('2025-01-10'), end: toDay('2025-01-12') };
    expect(applyDrag(span, 3, 'move')).toEqual({ startDate: '2025-01-13', dueDate: '2025-01-15' });
    expect(applyDrag(span, 5, 'start')).toEqual({ startDate: '2025-01-12', dueDate: '2025-01-12' });
    expect(applyDrag(span, -9, 'end')).toEqual({ startDate: '2025-01-10', dueDate: '2025-01-10' });
  });
});
