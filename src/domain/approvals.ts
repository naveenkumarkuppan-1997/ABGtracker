import { DomainError } from './errors';
import type { Approval, ApprovalDecision, ID, Issue, Project } from './types';

export type ApprovalState = 'pending' | 'approved' | 'rejected';

/** Any rejection rejects; otherwise approved once every approver approved. */
export function approvalState(a: Approval): ApprovalState {
  const decisions = a.approverIds.map((id) => a.decisions[id]);
  if (decisions.some((d) => d?.decision === 'rejected')) return 'rejected';
  if (a.approverIds.length > 0 && decisions.every((d) => d?.decision === 'approved')) return 'approved';
  return 'pending';
}

/** Items with an approval can't be finished until every approver has approved. */
export function checkApprovalGate(
  project: Pick<Project, 'statuses'>,
  issue: Pick<Issue, 'approval'>,
  toStatusId: string
): string | null {
  const toDone = project.statuses.find((s) => s.id === toStatusId)?.category === 'done';
  if (toDone && issue.approval && approvalState(issue.approval) !== 'approved') {
    return 'This item needs approval from all approvers before it can be marked done.';
  }
  return null;
}

export function pendingApprovers(a: Approval): ID[] {
  return a.approverIds.filter((id) => !a.decisions[id]);
}

export function applyDecision(a: Approval, userId: ID, decision: ApprovalDecision, comment: string | undefined, at: string): Approval {
  if (!a.approverIds.includes(userId)) throw new DomainError('You are not an approver for this item.');
  return {
    approverIds: a.approverIds,
    decisions: { ...a.decisions, [userId]: { decision, comment: comment?.trim() || undefined, at } },
  };
}

/** Replace the approver list, keeping decisions of people who remain approvers. */
export function setApprovers(a: Approval | undefined, approverIds: ID[]): Approval {
  const unique = [...new Set(approverIds)];
  const decisions: Approval['decisions'] = {};
  for (const id of unique) if (a?.decisions[id]) decisions[id] = a.decisions[id];
  return { approverIds: unique, decisions };
}

/** Ask for a fresh round of sign-off (e.g. after a rejection and rework). */
export function resetDecisions(a: Approval): Approval {
  return { approverIds: a.approverIds, decisions: {} };
}
