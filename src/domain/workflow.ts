import type { Issue, Project, RequiredField, Status, Workflow, WorkStyle } from './types';

export const REQUIRED_FIELD_LABEL: Record<RequiredField, string> = {
  assigneeId: 'Assignee',
  estimate: 'Estimate',
  dueDate: 'Due date',
  description: 'Description',
};

const isEmpty = (v: unknown) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

/** Statuses an issue may move to from `fromId` (always includes the current one). */
export function allowedTargets(project: Pick<Project, 'statuses' | 'workflow'>, fromId: string): Status[] {
  const { workflow, statuses } = project;
  if (!workflow.restrict) return statuses;
  const allowed = new Set([fromId, ...(workflow.transitions[fromId] ?? [])]);
  return statuses.filter((s) => allowed.has(s.id));
}

/**
 * Validates a status change. Returns a human-readable reason when it is not
 * allowed, otherwise null. `patch` carries fields changed in the same update.
 */
export function checkTransition(
  project: Pick<Project, 'statuses' | 'workflow'>,
  issue: Pick<Issue, 'statusId' | 'assigneeId' | 'estimate' | 'dueDate' | 'description'>,
  toStatusId: string,
  patch: Partial<Pick<Issue, 'assigneeId' | 'estimate' | 'dueDate' | 'description'>> = {}
): string | null {
  if (toStatusId === issue.statusId) return null;
  const name = (id: string) => project.statuses.find((s) => s.id === id)?.name ?? id;

  if (!allowedTargets(project, issue.statusId).some((s) => s.id === toStatusId)) {
    const allowed = allowedTargets(project, issue.statusId)
      .filter((s) => s.id !== issue.statusId)
      .map((s) => s.name);
    return `"${name(issue.statusId)}" can't move directly to "${name(toStatusId)}". Allowed: ${allowed.join(', ') || 'none'}.`;
  }
  return checkRequired(project, { ...issue, ...patch }, toStatusId);
}

/** Checks the "required fields" rules attached to entering a status. */
export function checkRequired(
  project: Pick<Project, 'statuses' | 'workflow'>,
  issue: Pick<Issue, 'assigneeId' | 'estimate' | 'dueDate' | 'description'>,
  statusId: string
): string | null {
  const rule = project.workflow.rules.find((r) => r.toStatusId === statusId);
  if (!rule) return null;
  const missing = rule.require.filter((f) => isEmpty(issue[f]));
  if (!missing.length) return null;
  const to = project.statuses.find((s) => s.id === statusId)?.name ?? statusId;
  return `Moving to "${to}" requires: ${missing.map((f) => REQUIRED_FIELD_LABEL[f]).join(', ')}.`;
}

/** Removes references to statuses that no longer exist. */
export function sanitizeWorkflow(workflow: Workflow, statuses: Status[]): Workflow {
  const ids = new Set(statuses.map((s) => s.id));
  const transitions: Workflow['transitions'] = {};
  for (const [from, targets] of Object.entries(workflow.transitions)) {
    if (ids.has(from)) transitions[from] = targets.filter((t) => ids.has(t) && t !== from);
  }
  return {
    restrict: workflow.restrict,
    transitions,
    rules: workflow.rules.filter((r) => ids.has(r.toStatusId) && r.require.length > 0),
  };
}

export function defaultWorkflow(style: WorkStyle, statuses: Status[]): Workflow {
  const order = statuses.map((s) => s.id);
  if (style === 'agile') {
    // Linear flow with one step back, reopen from Done, and quality gates.
    const transitions: Workflow['transitions'] = {};
    order.forEach((id, i) => {
      const t: string[] = [];
      if (order[i + 1]) t.push(order[i + 1]);
      if (order[i - 1]) t.push(order[i - 1]);
      transitions[id] = t;
    });
    return {
      restrict: true,
      transitions,
      rules: [
        { toStatusId: 'in_progress', require: ['assigneeId'] },
        { toStatusId: 'done', require: ['assigneeId'] },
      ],
    };
  }
  if (style === 'business') {
    return { restrict: false, transitions: {}, rules: [{ toStatusId: 'in_review', require: ['assigneeId', 'dueDate'] }] };
  }
  return { restrict: false, transitions: {}, rules: [] };
}
