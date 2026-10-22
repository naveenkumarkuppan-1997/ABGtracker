import { isDone, typeOf } from './selectors';
import type { Issue, Project, Sprint } from './types';

/** Only standard work items carry points (epics and sub-tasks would double count). */
const counted = (project: Project, i: Issue) => typeOf(project, i.typeId)?.level === 1;

export interface SprintStats {
  count: number;
  doneCount: number;
  points: number;
  donePoints: number;
}

export function sprintStats(project: Project, issues: Issue[], sprintId: string | undefined): SprintStats {
  const items = issues.filter((i) => i.sprintId === sprintId && counted(project, i));
  const done = items.filter((i) => isDone(project, i));
  const sum = (l: Issue[]) => l.reduce((s, i) => s + (i.estimate ?? 0), 0);
  return { count: items.length, doneCount: done.length, points: sum(items), donePoints: sum(done) };
}

export function validateSprintDates(start?: string, end?: string): string | null {
  if (start && end && end < start) return 'The end date must be on or after the start date.';
  return null;
}

/** Returns a reason the sprint can't start, or null. */
export function checkStart(sprint: Sprint, siblings: Sprint[]): string | null {
  if (sprint.state !== 'planned') return 'Only a planned sprint can be started.';
  if (!sprint.startDate || !sprint.endDate) return 'Set start and end dates before starting the sprint.';
  const dateErr = validateSprintDates(sprint.startDate, sprint.endDate);
  if (dateErr) return dateErr;
  const active = siblings.find((s) => s.state === 'active' && s.id !== sprint.id);
  if (active) return `“${active.name}” is still active. Complete it first.`;
  return null;
}

export function sprintDaysLeft(sprint: Sprint, today = new Date()): number | null {
  if (!sprint.endDate) return null;
  const end = new Date(sprint.endDate + 'T23:59:59');
  return Math.ceil((end.getTime() - today.getTime()) / 86400000);
}

/** Average completed points of the most recent completed sprints. */
export function velocity(sprints: Sprint[], last = 3): { average: number; sprints: Sprint[] } {
  const done = sprints
    .filter((s) => s.state === 'completed')
    .sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''))
    .slice(0, last);
  const average = done.length ? done.reduce((s, x) => s + (x.completedPoints ?? 0), 0) / done.length : 0;
  return { average: Math.round(average * 10) / 10, sprints: done };
}
