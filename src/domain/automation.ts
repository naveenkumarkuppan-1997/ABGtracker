import { isDone } from './selectors';
import type {
  Activity,
  AutomationCondition,
  AutomationRule,
  ID,
  Issue,
  IssuePatch,
  Member,
  NewRule,
  Priority,
  Project,
  TriggerType,
} from './types';

export const TRIGGER_LABEL: Record<TriggerType, string> = {
  issue_created: 'An issue is created',
  status_changed: 'An issue changes status',
  assignee_changed: 'The assignee changes',
  priority_changed: 'The priority changes',
  due_date_passed: 'An issue becomes overdue',
};

export interface IssueEvent {
  type: TriggerType;
  issue: Issue;
  /** Issue before the change (status/assignee/priority triggers). */
  before?: Issue;
}

const low = (s: string | undefined) => (s ?? '').toLowerCase();

export function conditionMatches(c: AutomationCondition, issue: Issue, project: Project): boolean {
  let values: string[];
  switch (c.field) {
    case 'type': {
      const t = project.issueTypes.find((x) => x.id === issue.typeId);
      values = t ? [t.id, t.name] : [issue.typeId];
      break;
    }
    case 'status': {
      const s = project.statuses.find((x) => x.id === issue.statusId);
      values = s ? [s.id, s.name] : [issue.statusId];
      break;
    }
    case 'priority':
      values = [issue.priority];
      break;
    case 'label':
      values = issue.labels;
      break;
    case 'assignee':
      values = issue.assigneeId ? [issue.assigneeId] : [];
      break;
  }
  switch (c.op) {
    case 'is':
      return values.some((v) => low(v) === low(c.value));
    case 'is_not':
      return !values.some((v) => low(v) === low(c.value));
    case 'is_empty':
      return values.length === 0;
    case 'is_not_empty':
      return values.length > 0;
  }
}

export function triggerMatches(rule: AutomationRule, ev: IssueEvent): boolean {
  if (rule.trigger.type !== ev.type) return false;
  switch (ev.type) {
    case 'issue_created':
    case 'due_date_passed':
      return true;
    case 'status_changed':
      return !!ev.before && ev.before.statusId !== ev.issue.statusId && (!rule.trigger.statusId || rule.trigger.statusId === ev.issue.statusId);
    case 'assignee_changed':
      return !!ev.before && ev.before.assigneeId !== ev.issue.assigneeId;
    case 'priority_changed':
      return !!ev.before && ev.before.priority !== ev.issue.priority;
  }
}

export function ruleMatches(rule: AutomationRule, ev: IssueEvent, project: Project): boolean {
  return rule.enabled && triggerMatches(rule, ev) && rule.conditions.every((c) => conditionMatches(c, ev.issue, project));
}

export interface ActionPlan {
  patch: IssuePatch;
  comments: string[];
  notify: ID[];
  errors: string[];
}

/** Turns a rule's actions into concrete changes for one issue (pure; nothing is applied here). */
export function planActions(rule: Pick<AutomationRule, 'actions'>, issue: Issue, project: Project, members: Pick<Member, 'id'>[]): ActionPlan {
  const plan: ActionPlan = { patch: {}, comments: [], notify: [], errors: [] };
  const labels = [...issue.labels];
  const isMember = (id: string) => members.some((m) => m.id === id);

  for (const a of rule.actions) {
    switch (a.type) {
      case 'set_assignee':
        if (a.value && isMember(a.value)) plan.patch.assigneeId = a.value;
        else plan.errors.push('Assignee is not in this organization.');
        break;
      case 'set_priority':
        if (['critical', 'high', 'medium', 'low'].includes(a.value ?? '')) plan.patch.priority = a.value as Priority;
        else plan.errors.push('Unknown priority.');
        break;
      case 'move_to_status':
        if (project.statuses.some((s) => s.id === a.value)) plan.patch.statusId = a.value;
        else plan.errors.push('Target status no longer exists.');
        break;
      case 'add_label':
        if (a.value?.trim() && !labels.includes(a.value.trim())) {
          labels.push(a.value.trim());
          plan.patch.labels = labels;
        }
        break;
      case 'add_comment':
        if (a.value?.trim()) plan.comments.push(a.value.trim());
        break;
      case 'notify': {
        const id = a.value === 'assignee' ? issue.assigneeId : a.value === 'reporter' ? issue.reporterId : a.value;
        if (id && isMember(id)) plan.notify.push(id);
        break;
      }
    }
  }
  return plan;
}

export function validateRule(input: Pick<NewRule, 'name' | 'trigger' | 'actions'>, project: Project): string | null {
  if (!input.name.trim()) return 'Give the rule a name.';
  if (input.actions.length === 0) return 'A rule needs at least one action.';
  if (input.trigger.statusId && !project.statuses.some((s) => s.id === input.trigger.statusId)) return 'The trigger status no longer exists.';
  for (const a of input.actions) {
    if (a.type !== 'add_comment' && a.type !== 'notify' && !a.value) return 'Fill in every action.';
    if (a.type === 'add_comment' && !a.value?.trim()) return 'The comment action needs text.';
    if (a.type === 'add_label' && !a.value?.trim()) return 'The label action needs a label.';
  }
  // A rule that moves issues into the very status that triggers it would loop forever.
  if (input.trigger.type === 'status_changed' && input.trigger.statusId && input.actions.some((a) => a.type === 'move_to_status' && a.value === input.trigger.statusId)) {
    return 'A rule cannot move issues into the status that triggers it.';
  }
  return null;
}

export function describeRule(rule: Pick<AutomationRule, 'trigger' | 'conditions' | 'actions'>, project: Project, members: Pick<Member, 'id' | 'name'>[]): string {
  const status = (id?: string) => project.statuses.find((s) => s.id === id)?.name ?? id ?? '';
  const person = (id?: string) => members.find((m) => m.id === id)?.name ?? id ?? '';
  const t = rule.trigger;
  const when = t.type === 'status_changed' && t.statusId ? `an issue moves to “${status(t.statusId)}”` : TRIGGER_LABEL[t.type].replace(/^An? /, (m) => m.toLowerCase());
  const cond = rule.conditions.map((c) => {
    const v = c.field === 'assignee' ? person(c.value) : c.field === 'status' ? status(c.value) : c.value;
    const op = { is: 'is', is_not: 'is not', is_empty: 'is empty', is_not_empty: 'is set' }[c.op];
    return `${c.field} ${op}${c.op === 'is' || c.op === 'is_not' ? ` ${v}` : ''}`;
  });
  const acts = rule.actions.map((a) => {
    switch (a.type) {
      case 'set_assignee':
        return `assign to ${person(a.value)}`;
      case 'set_priority':
        return `set priority to ${a.value}`;
      case 'move_to_status':
        return `move to “${status(a.value)}”`;
      case 'add_label':
        return `add label “${a.value}”`;
      case 'add_comment':
        return 'post a comment';
      case 'notify':
        return `notify ${a.value === 'assignee' || a.value === 'reporter' ? `the ${a.value}` : person(a.value)}`;
    }
  });
  return `When ${when}${cond.length ? `, and ${cond.join(' and ')}` : ''} → ${acts.join(', ')}.`;
}

export interface SimulatedFire {
  issueId: ID;
  issueKey: string;
  title: string;
  at: string;
  detail: string;
}

/**
 * "What would this rule have done?" Replays the project's activity history for the
 * last `days` days. Conditions are checked against each issue's *current* state, so this
 * is an estimate, which the UI says explicitly.
 */
export function simulateRule(
  rule: Pick<AutomationRule, 'trigger' | 'conditions'>,
  project: Project,
  issues: Issue[],
  activity: Activity[],
  now: Date = new Date(),
  days = 30
): SimulatedFire[] {
  const since = now.getTime() - days * 86400000;
  const byId = new Map(issues.map((i) => [i.id, i]));
  const fires: SimulatedFire[] = [];
  const ok = (i: Issue) => rule.conditions.every((c) => conditionMatches(c, i, project));
  const push = (i: Issue, at: string, detail: string) => fires.push({ issueId: i.id, issueKey: i.key, title: i.title, at, detail });

  if (rule.trigger.type === 'due_date_passed') {
    const today = now.toISOString().slice(0, 10);
    for (const i of issues) if (i.projectId === project.id && i.dueDate && i.dueDate < today && !isDone(project, i) && ok(i)) push(i, i.dueDate, `due ${i.dueDate}`);
    return fires.sort((a, b) => b.at.localeCompare(a.at));
  }

  const statusName = rule.trigger.statusId ? project.statuses.find((s) => s.id === rule.trigger.statusId)?.name : undefined;
  for (const a of activity) {
    if (a.projectId !== project.id || new Date(a.createdAt).getTime() < since) continue;
    const i = byId.get(a.issueId);
    if (!i || !ok(i)) continue;
    if (rule.trigger.type === 'issue_created' && a.kind === 'created') push(i, a.createdAt, 'created');
    else if (a.kind === 'updated') {
      if (rule.trigger.type === 'status_changed' && a.field === 'status' && (!statusName || a.to === statusName)) push(i, a.createdAt, `${a.from || '—'} → ${a.to}`);
      if (rule.trigger.type === 'assignee_changed' && a.field === 'assignee') push(i, a.createdAt, `${a.from || '—'} → ${a.to || '—'}`);
      if (rule.trigger.type === 'priority_changed' && a.field === 'priority') push(i, a.createdAt, `${a.from || '—'} → ${a.to}`);
    }
  }
  return fires.sort((a, b) => b.at.localeCompare(a.at));
}
