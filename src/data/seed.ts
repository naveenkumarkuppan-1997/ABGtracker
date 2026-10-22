import { defaultCustomFields, TEMPLATES } from '@/domain/templates';
import { defaultWorkflow } from '@/domain/workflow';
import type {
  Activity,
  Approval,
  Attachment,
  AutomationRule,
  AutomationRun,
  Comment,
  IntakeForm,
  FieldValue,
  Issue,
  Membership,
  Notification,
  Organization,
  Priority,
  Project,
  SavedFilter,
  Sprint,
  User,
  WorkStyle,
} from '@/domain/types';

export interface Database {
  organizations: Organization[];
  users: User[];
  memberships: Membership[];
  projects: Project[];
  sprints: Sprint[];
  issues: Issue[];
  comments: Comment[];
  activity: Activity[];
  notifications: Notification[];
  filters: SavedFilter[];
  forms: IntakeForm[];
  attachments: Attachment[];
  rules: AutomationRule[];
  runs: AutomationRun[];
  sessionUserId: string;
}

const daysFromNow = (n: number) => new Date(Date.now() + n * 86400000).toISOString().slice(0, 10);
const ago = (n: number) => new Date(Date.now() - n * 3600000).toISOString();

export function buildSeed(): Database {
  const users: User[] = [
    { id: 'u_alex', name: 'Alex Rivera', email: 'alex@acme.dev', color: '#0f766e' },
    { id: 'u_priya', name: 'Priya Nair', email: 'priya@acme.dev', color: '#7c5cd6' },
    { id: 'u_sam', name: 'Sam Chen', email: 'sam@acme.dev', color: '#2f9e6b' },
    { id: 'u_jordan', name: 'Jordan Lee', email: 'jordan@northwind.io', color: '#e8833a' },
    { id: 'u_maya', name: 'Maya Patel', email: 'maya@northwind.io', color: '#dc4b4b' },
  ];

  const organizations: Organization[] = [
    { id: 'org_acme', name: 'Acme Software', slug: 'acme', plan: 'business', createdAt: ago(5000) },
    { id: 'org_nw', name: 'Northwind Ops', slug: 'northwind', plan: 'team', createdAt: ago(3000) },
  ];

  const memberships: Membership[] = [
    { id: 'm1', orgId: 'org_acme', userId: 'u_alex', role: 'owner' },
    { id: 'm2', orgId: 'org_acme', userId: 'u_priya', role: 'admin' },
    { id: 'm3', orgId: 'org_acme', userId: 'u_sam', role: 'member' },
    { id: 'm4', orgId: 'org_nw', userId: 'u_alex', role: 'member' },
    { id: 'm5', orgId: 'org_nw', userId: 'u_jordan', role: 'owner' },
    { id: 'm6', orgId: 'org_nw', userId: 'u_maya', role: 'guest' },
  ];

  const mkProject = (
    id: string,
    orgId: string,
    key: string,
    name: string,
    description: string,
    color: string,
    workStyle: WorkStyle,
    leadId: string
  ): Project => ({
    id,
    orgId,
    key,
    name,
    description,
    color,
    workStyle,
    statuses: TEMPLATES[workStyle].statuses,
    issueTypes: TEMPLATES[workStyle].issueTypes,
    workflow: defaultWorkflow(workStyle, TEMPLATES[workStyle].statuses),
    customFields: defaultCustomFields(workStyle),
    leadId,
    nextNumber: 1,
    createdAt: ago(2000),
  });

  const projects: Project[] = [
    mkProject('p_plt', 'org_acme', 'PLT', 'Platform', 'Core services and APIs.', '#0f766e', 'agile', 'u_priya'),
    mkProject('p_mob', 'org_acme', 'MOB', 'Mobile App', 'iOS and Android release train.', '#3b82f6', 'flow', 'u_sam'),
    mkProject('p_lch', 'org_nw', 'LCH', 'Q4 Launch Campaign', 'Cross-team launch plan.', '#f28c28', 'business', 'u_jordan'),
  ];

  const sprints: Sprint[] = [
    {
      id: 'sp_7', orgId: 'org_acme', projectId: 'p_plt', name: 'Sprint 7', goal: 'Stabilise CI and logging.',
      startDate: daysFromNow(-28), endDate: daysFromNow(-15), state: 'completed',
      committedPoints: 14, completedPoints: 11, startedAt: ago(28 * 24), completedAt: ago(15 * 24), createdAt: ago(32 * 24),
    },
    {
      id: 'sp_8', orgId: 'org_acme', projectId: 'p_plt', name: 'Sprint 8', goal: 'Ship rate limiting and OAuth for API v2.',
      startDate: daysFromNow(-7), endDate: daysFromNow(7), state: 'active', committedPoints: 22, startedAt: ago(7 * 24), createdAt: ago(20 * 24),
    },
    {
      id: 'sp_9', orgId: 'org_acme', projectId: 'p_plt', name: 'Sprint 9', goal: 'Webhooks and observability foundations.',
      startDate: daysFromNow(8), endDate: daysFromNow(21), state: 'planned', createdAt: ago(5 * 24),
    },
  ];

  const issues: Issue[] = [];
  const comments: Comment[] = [];
  const activity: Activity[] = [];
  let rankCounter = 1000;

  const add = (
    projectId: string,
    type: string,
    title: string,
    status: string,
    o: {
      assignee?: string;
      priority?: Priority;
      parent?: string;
      est?: number;
      start?: number;
      due?: number;
      labels?: string[];
      desc?: string;
      reporter?: string;
      cf?: Record<string, FieldValue>;
      sprint?: string;
      blockedBy?: string[];
      approval?: Approval;
      /** Finished this many days ago (history for reports and forecasts). */
      resolvedAgo?: number;
      leadDays?: number;
    } = {}
  ): string => {
    const p = projects.find((x) => x.id === projectId)!;
    const number = p.nextNumber++;
    const id = `i_${p.key.toLowerCase()}_${number}`;
    const status_ = p.statuses.find((x) => x.id === status)!;
    const resolvedAt = o.resolvedAgo !== undefined ? ago(o.resolvedAgo * 24) : undefined;
    const created = o.resolvedAgo !== undefined ? ago((o.resolvedAgo + (o.leadDays ?? 3)) * 24) : ago(500 - issues.length * 7);
    issues.push({
      id,
      orgId: p.orgId,
      projectId,
      key: `${p.key}-${number}`,
      number,
      typeId: type,
      title,
      description: o.desc ?? '',
      statusId: status,
      priority: o.priority ?? 'medium',
      assigneeId: o.assignee,
      reporterId: o.reporter ?? p.leadId,
      parentId: o.parent,
      labels: o.labels ?? [],
      estimate: o.est,
      startDate: o.start !== undefined ? daysFromNow(o.start) : undefined,
      dueDate: o.due !== undefined ? daysFromNow(o.due) : undefined,
      customFields: o.cf ?? {},
      sprintId: o.sprint,
      blockedBy: o.blockedBy ?? [],
      approval: o.approval,
      rank: (rankCounter += 1000),
      createdAt: created,
      updatedAt: status_.category === 'done' ? created : o.resolvedAgo !== undefined ? created : ago(3 + ((issues.length * 37) % 90)),
      resolvedAt: status_.category === 'done' ? resolvedAt ?? created : undefined,
    });
    activity.push({
      id: `a_${id}`,
      orgId: p.orgId,
      projectId,
      issueId: id,
      actorId: o.reporter ?? p.leadId,
      kind: 'created',
      createdAt: created,
    });
    return id;
  };

  // Platform (agile)
  const e1 = add('p_plt', 'epic', 'Public API v2', 'in_progress', { assignee: 'u_priya', priority: 'high', start: -20, due: 30 });
  const e2 = add('p_plt', 'epic', 'Observability & alerting', 'backlog', { assignee: 'u_alex', start: 20, due: 60 });
  const s1 = add('p_plt', 'story', 'Rate limiting per API key', 'in_progress', {
    assignee: 'u_sam', parent: e1, est: 5, priority: 'high', start: -6, due: 6, labels: ['api', 'security'], sprint: 'sp_8',
    desc: 'Introduce per-key rate limits with sensible defaults and a 429 response with Retry-After.',
  });
  add('p_plt', 'subtask', 'Token bucket implementation', 'done', { assignee: 'u_sam', parent: s1, est: 2, sprint: 'sp_8', start: -6, due: -2 });
  add('p_plt', 'subtask', 'Expose limits in dashboard', 'selected', { assignee: 'u_priya', parent: s1, est: 2, sprint: 'sp_8', start: -1, due: 5 });
  add('p_plt', 'story', 'OAuth2 client credentials flow', 'in_review', { assignee: 'u_priya', parent: e1, est: 8, labels: ['api'], sprint: 'sp_8', start: -5, due: 4 });
  const pagination = add('p_plt', 'story', 'Cursor-based pagination', 'selected', {
    assignee: 'u_sam', parent: e1, est: 3, start: 3, due: 12, sprint: 'sp_8', blockedBy: [s1],
  });
  const webhooks = add('p_plt', 'story', 'Webhook delivery retries', 'backlog', { parent: e1, est: 5, start: 13, due: 22, sprint: 'sp_9' });
  const bug1 = add('p_plt', 'bug', 'Duplicate events on retry', 'in_progress', {
    assignee: 'u_alex', priority: 'critical', start: -3, due: 1, labels: ['prod'], cf: { cf_env: 'Production', cf_customer: 'Globex' }, sprint: 'sp_8', est: 3,
    desc: 'Retried webhooks are delivered twice when the first attempt times out.\n\n**Steps**\n- Configure a slow endpoint\n- Trigger an event\n\nSee also `delivery_attempts` table.',
  });
  issues.find((i) => i.id === webhooks)!.blockedBy = [bug1];
  add('p_plt', 'bug', 'Timezone off by one in reports', 'backlog', { assignee: 'u_sam', priority: 'low', est: 2 });
  add('p_plt', 'task', 'Upgrade Node runtime to LTS', 'done', { assignee: 'u_alex', est: 2, sprint: 'sp_8', start: -7, due: -5 });
  const logging = add('p_plt', 'story', 'Structured logging', 'backlog', { parent: e2, est: 3, start: 20, due: 30 });
  add('p_plt', 'story', 'SLO dashboards', 'backlog', { parent: e2, est: 5, assignee: 'u_alex', start: 31, due: 45, sprint: 'sp_9', blockedBy: [logging] });
  add('p_plt', 'task', 'Document error codes', 'selected', { assignee: 'u_priya', est: 1, priority: 'low', due: 9, sprint: 'sp_8' });
  add('p_plt', 'task', 'Migrate CI to GitHub Actions', 'done', { assignee: 'u_alex', est: 5, sprint: 'sp_7' });
  add('p_plt', 'task', 'Add request IDs to logs', 'done', { assignee: 'u_sam', est: 3, sprint: 'sp_7' });
  add('p_plt', 'task', 'Fix flaky auth tests', 'done', { assignee: 'u_priya', est: 3, sprint: 'sp_7' });
  add('p_plt', 'story', 'Audit log export', 'backlog', { est: 8, priority: 'low' });
  void pagination;

  // Mobile (flow)
  add('p_mob', 'task', 'Fix crash on cold start (Android 13)', 'doing', { assignee: 'u_sam', priority: 'critical', due: 2 });
  add('p_mob', 'task', 'Dark mode for settings screen', 'todo', { assignee: 'u_priya', priority: 'low' });
  add('p_mob', 'bug', 'Push notification badge not clearing', 'blocked', { assignee: 'u_alex', priority: 'high', labels: ['ios'] });
  add('p_mob', 'task', 'Update app store screenshots', 'todo', { due: 10 });
  add('p_mob', 'task', 'Migrate to new analytics SDK', 'done', { assignee: 'u_sam' });
  add('p_mob', 'task', 'Biometric login', 'doing', { assignee: 'u_priya', priority: 'high' });

  // Launch campaign (business)
  const m1 = add('p_lch', 'milestone', 'Launch day', 'not_started', { assignee: 'u_jordan', priority: 'high', due: 45 });
  const m2 = add('p_lch', 'milestone', 'Messaging locked', 'in_progress', { assignee: 'u_jordan', priority: 'high', due: 14 });
  const t1 = add('p_lch', 'task', 'Finalize messaging & positioning', 'in_progress', { assignee: 'u_jordan', priority: 'high', start: -10, due: 7, parent: m2 });
  add('p_lch', 'subtask', 'Competitor review', 'done', { assignee: 'u_alex', parent: t1 });
  add('p_lch', 'subtask', 'Draft one-pager', 'in_progress', { assignee: 'u_jordan', parent: t1 });
  const legal = add('p_lch', 'approval', 'Legal sign-off on claims', 'in_review', {
    assignee: 'u_maya', priority: 'high', start: 2, due: 14, labels: ['legal'], parent: m2,
    approval: { approverIds: ['u_maya', 'u_jordan'], decisions: { u_jordan: { decision: 'approved', comment: 'Claims match the product sheet.', at: ago(10) } } },
  });
  add('p_lch', 'task', 'Book launch webinar platform', 'not_started', {
    assignee: 'u_alex', start: 8, due: 20, cf: { cf_budget: 4500, cf_channel: ['Events', 'Email'] }, parent: m1, blockedBy: [legal],
  });
  add('p_lch', 'task', 'Press kit', 'not_started', { assignee: 'u_jordan', parent: m1, start: 22, due: 30, blockedBy: [t1] });
  add('p_lch', 'approval', 'Budget approval', 'done', {
    assignee: 'u_maya', priority: 'medium', start: -14, due: -7,
    approval: { approverIds: ['u_maya', 'u_jordan'], decisions: { u_maya: { decision: 'approved', at: ago(200) }, u_jordan: { decision: 'approved', at: ago(190) } } },
  });

  // History: finished work from past weeks, so reports and the forecast have real data.
  const history = (projectId: string, perWeek: number[], titles: string[], points: number[], type: string, assignees: string[]) => {
    let n = 0;
    perWeek.forEach((count, w) => {
      for (let k = 0; k < count; k++, n++) {
        add(projectId, type, `${titles[n % titles.length]} (#${n + 1})`, 'done', {
          assignee: assignees[n % assignees.length],
          est: points[n % points.length],
          resolvedAgo: (w + 1) * 7 - 1 - ((k * 2) % 6),
          leadDays: 2 + (n % 5),
        });
      }
    });
  };
  history('p_plt', [3, 4, 2, 5, 3, 4, 3, 2, 4, 3], ['Refactor module', 'Add API tests', 'Tune database query', 'Update dependency', 'Improve error message', 'Fix lint warnings'], [1, 2, 3, 5, 2], 'task', ['u_alex', 'u_priya', 'u_sam']);
  history('p_mob', [2, 3, 2, 3, 2, 3, 2, 2], ['Polish screen', 'Fix layout bug', 'Update copy', 'Add analytics event'], [], 'task', ['u_sam', 'u_priya', 'u_alex']);
  history('p_lch', [1, 2, 1, 2, 1, 1], ['Review asset', 'Confirm vendor', 'Schedule post'], [], 'task', ['u_jordan', 'u_alex']);

  comments.push(
    { id: 'c1', orgId: 'org_acme', issueId: s1, authorId: 'u_priya', body: 'Let\'s default to **600 req/min** and make it configurable per plan. @Sam Chen can you confirm?', mentions: ['u_sam'], createdAt: ago(30) },
    { id: 'c2', orgId: 'org_acme', issueId: s1, authorId: 'u_sam', body: 'Agreed. Token bucket is merged, working on the dashboard exposure next.', mentions: [], createdAt: ago(6) },
    { id: 'c3', orgId: 'org_acme', issueId: bug1, authorId: 'u_priya', body: '@Alex Rivera this is hitting Globex in production, please prioritise.', mentions: ['u_alex'], createdAt: ago(3) }
  );

  const notifications: Notification[] = [
    { id: 'n1', orgId: 'org_acme', userId: 'u_alex', actorId: 'u_priya', issueId: bug1, projectId: 'p_plt', kind: 'mention', detail: 'this is hitting Globex in production, please prioritise.', read: false, createdAt: ago(3) },
    { id: 'n2', orgId: 'org_acme', userId: 'u_alex', actorId: 'u_priya', issueId: 'i_plt_13', projectId: 'p_plt', kind: 'assigned', read: false, createdAt: ago(20) },
    { id: 'n3', orgId: 'org_nw', userId: 'u_maya', actorId: 'u_jordan', issueId: legal, projectId: 'p_lch', kind: 'approval', detail: 'Your approval is requested', read: false, createdAt: ago(12) },
  ];

  const filters: SavedFilter[] = [
    { id: 'f1', orgId: 'org_acme', ownerId: 'u_priya', name: 'Critical bugs', query: 'type = Bug AND priority >= high AND statusCategory != done', shared: true, createdAt: ago(100) },
    { id: 'f2', orgId: 'org_acme', ownerId: 'u_alex', name: 'My overdue work', query: 'assignee = me AND due < today AND statusCategory != done ORDER BY due', shared: false, createdAt: ago(90) },
    { id: 'f3', orgId: 'org_nw', ownerId: 'u_jordan', name: 'Needs sign-off', query: 'type = Approval AND approval = pending', shared: true, createdAt: ago(60) },
    { id: 'f4', orgId: 'org_acme', ownerId: 'u_alex', name: 'In the active sprint', query: 'sprint = active AND statusCategory != done ORDER BY priority DESC', shared: true, createdAt: ago(50) },
  ];

  const rules: AutomationRule[] = [
    {
      id: 'r1', orgId: 'org_acme', projectId: 'p_plt', name: 'Triage new bugs', enabled: true,
      trigger: { type: 'issue_created' },
      conditions: [{ field: 'type', op: 'is', value: 'bug' }, { field: 'assignee', op: 'is_empty' }],
      actions: [{ type: 'set_assignee', value: 'u_alex' }, { type: 'add_label', value: 'needs-triage' }],
      createdBy: 'u_priya', createdAt: ago(300), runCount: 0,
    },
    {
      id: 'r2', orgId: 'org_acme', projectId: 'p_plt', name: 'Announce ready for review', enabled: true,
      trigger: { type: 'status_changed', statusId: 'in_review' },
      conditions: [],
      actions: [{ type: 'add_comment', value: 'Ready for review. Please leave feedback here.' }, { type: 'notify', value: 'reporter' }],
      createdBy: 'u_priya', createdAt: ago(290), runCount: 0,
    },
    {
      id: 'r3', orgId: 'org_acme', projectId: 'p_plt', name: 'Escalate overdue work', enabled: true,
      trigger: { type: 'due_date_passed' },
      conditions: [{ field: 'priority', op: 'is_not', value: 'critical' }],
      actions: [{ type: 'set_priority', value: 'high' }, { type: 'add_label', value: 'overdue' }],
      createdBy: 'u_priya', createdAt: ago(280), runCount: 0,
    },
    {
      id: 'r4', orgId: 'org_nw', projectId: 'p_lch', name: 'Nudge owner when work starts', enabled: true,
      trigger: { type: 'status_changed', statusId: 'in_progress' },
      conditions: [{ field: 'assignee', op: 'is_empty' }],
      actions: [{ type: 'set_assignee', value: 'u_jordan' }, { type: 'add_comment', value: 'Assigned to the campaign owner because nobody was assigned.' }],
      createdBy: 'u_jordan', createdAt: ago(200), runCount: 0,
    },
  ];
  const runs: AutomationRun[] = [];

  const forms: IntakeForm[] = [
    {
      id: 'form_bug', orgId: 'org_acme', projectId: 'p_plt', slug: 'report-a-bug', name: 'Report a bug',
      description: 'Found something broken? Tell us what happened and we will look into it.',
      enabled: true, issueTypeId: 'bug', defaultPriority: 'medium', createdBy: 'u_priya', createdAt: ago(240), submissionCount: 0,
      fields: [
        { id: 'q_title', label: 'What went wrong?', kind: 'short', required: true, target: 'title' },
        { id: 'q_steps', label: 'Steps to reproduce', kind: 'long', required: true, target: 'description' },
        { id: 'q_env', label: 'Where did it happen?', kind: 'select', required: false, options: ['Dev', 'Staging', 'Production'], target: 'cf:cf_env' },
        { id: 'q_pri', label: 'How urgent is it?', kind: 'select', required: false, options: ['Critical', 'High', 'Medium', 'Low'], target: 'priority' },
      ],
    },
    {
      id: 'form_creative', orgId: 'org_nw', projectId: 'p_lch', slug: 'creative-request', name: 'Request creative work',
      description: 'Need a banner, one-pager or social post for the launch? Ask here.',
      enabled: true, issueTypeId: 'task', defaultPriority: 'medium', defaultAssigneeId: 'u_jordan', createdBy: 'u_jordan', createdAt: ago(100), submissionCount: 0,
      fields: [
        { id: 'q_what', label: 'What do you need?', kind: 'short', required: true, target: 'title' },
        { id: 'q_brief', label: 'Brief', kind: 'long', required: false, target: 'description' },
        { id: 'q_due', label: 'Needed by', kind: 'date', required: false, target: 'dueDate' },
        { id: 'q_budget', label: 'Budget (USD)', kind: 'number', required: false, target: 'cf:cf_budget' },
      ],
    },
  ];

  return {
    organizations,
    users,
    memberships,
    projects,
    sprints,
    issues,
    comments,
    activity,
    notifications,
    filters,
    forms,
    attachments: [],
    rules,
    runs,
    sessionUserId: 'u_alex',
  };
}
