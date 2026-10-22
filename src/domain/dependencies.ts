import { isDone } from './selectors';
import type { ID, Issue, Project } from './types';

/**
 * `X.blockedBy = [B]` means B must finish before X. Returns true when setting
 * `blockedBy` on `issueId` would create a cycle (B transitively depends on X).
 */
export function wouldCreateCycle(issues: Pick<Issue, 'id' | 'blockedBy'>[], issueId: ID, blockedBy: ID[]): boolean {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const seen = new Set<ID>();
  const stack = [...blockedBy];
  while (stack.length) {
    const id = stack.pop()!;
    if (id === issueId) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    for (const next of byId.get(id)?.blockedBy ?? []) stack.push(next);
  }
  return false;
}

/** Blockers that are not finished yet. */
export function openBlockers(project: Project, issues: Issue[], issue: Issue): Issue[] {
  return issue.blockedBy
    .map((id) => issues.find((i) => i.id === id))
    .filter((b): b is Issue => !!b && !isDone(project, b));
}

export interface ScheduleConflict {
  issueId: ID;
  blockerId: ID;
}

/** Issues scheduled to start before a blocker is due. */
export function scheduleConflicts(issues: Issue[]): ScheduleConflict[] {
  const byId = new Map(issues.map((i) => [i.id, i]));
  const out: ScheduleConflict[] = [];
  for (const i of issues) {
    const start = i.startDate ?? i.dueDate;
    if (!start) continue;
    for (const bId of i.blockedBy) {
      const b = byId.get(bId);
      if (b?.dueDate && start < b.dueDate) out.push({ issueId: i.id, blockerId: bId });
    }
  }
  return out;
}
