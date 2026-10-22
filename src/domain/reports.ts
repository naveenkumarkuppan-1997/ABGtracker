import { isDone, typeOf } from './selectors';
import { fromDay, toDay } from './timeline';
import type { Issue, Member, Project, Sprint } from './types';

const level1 = (p: Project, i: Issue) => typeOf(p, i.typeId)?.level === 1;
const dayOf = (iso: string) => toDay(iso.slice(0, 10));
const todayOf = (now: Date) => toDay(`${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`);

export interface WeekBucket {
  /** Monday of the week, as a day number. */
  start: number;
  label: string;
}

/** The last `weeks` weeks (oldest first), the last bucket being the current week. */
export function weekBuckets(now: Date, weeks: number): WeekBucket[] {
  const today = todayOf(now);
  const dow = (today + 4) % 7; // 0 = Sunday
  const monday = today - ((dow + 6) % 7);
  return Array.from({ length: weeks }, (_, i) => {
    const start = monday - (weeks - 1 - i) * 7;
    const d = new Date(start * 86400000);
    return { start, label: `${d.getUTCMonth() + 1}/${d.getUTCDate()}` };
  });
}

const bucketIndex = (buckets: WeekBucket[], day: number) => {
  for (let i = buckets.length - 1; i >= 0; i--) if (day >= buckets[i].start) return day < buckets[i].start + 7 ? i : -1;
  return -1;
};

export type Measure = 'count' | 'points';

/** Work items resolved per week. */
export function weeklyResolved(project: Project, issues: Issue[], now: Date, weeks: number, measure: Measure = 'count'): number[] {
  const buckets = weekBuckets(now, weeks);
  const out = new Array<number>(weeks).fill(0);
  for (const i of issues) {
    if (i.projectId !== project.id || !level1(project, i) || !i.resolvedAt) continue;
    const idx = bucketIndex(buckets, dayOf(i.resolvedAt));
    if (idx >= 0) out[idx] += measure === 'points' ? i.estimate ?? 0 : 1;
  }
  return out;
}

export function weeklyCreated(project: Project, issues: Issue[], now: Date, weeks: number): number[] {
  const buckets = weekBuckets(now, weeks);
  const out = new Array<number>(weeks).fill(0);
  for (const i of issues) {
    if (i.projectId !== project.id || !level1(project, i)) continue;
    const idx = bucketIndex(buckets, dayOf(i.createdAt));
    if (idx >= 0) out[idx] += 1;
  }
  return out;
}

export interface CycleStats {
  count: number;
  median: number;
  p85: number;
}

/** Days from created to resolved for finished work items. */
export function cycleTime(project: Project, issues: Issue[]): CycleStats {
  const days = issues
    .filter((i) => i.projectId === project.id && level1(project, i) && i.resolvedAt)
    .map((i) => Math.max(0, dayOf(i.resolvedAt!) - dayOf(i.createdAt)))
    .sort((a, b) => a - b);
  if (!days.length) return { count: 0, median: 0, p85: 0 };
  const at = (p: number) => days[Math.min(days.length - 1, Math.ceil(p * days.length) - 1)];
  return { count: days.length, median: at(0.5), p85: at(0.85) };
}

export interface BurndownPoint {
  date: string;
  ideal: number;
  /** null for days in the future */
  actual: number | null;
}

export function burndown(project: Project, sprint: Sprint, issues: Issue[], now: Date = new Date()): { total: number; points: BurndownPoint[] } {
  if (!sprint.startDate || !sprint.endDate) return { total: 0, points: [] };
  const items = issues.filter((i) => i.sprintId === sprint.id && level1(project, i));
  const total = items.reduce((s, i) => s + (i.estimate ?? 0), 0);
  const start = toDay(sprint.startDate);
  const end = toDay(sprint.endDate);
  const today = todayOf(now);
  const n = Math.max(1, end - start);
  const points: BurndownPoint[] = [];
  for (let d = start; d <= end; d++) {
    const burned = items.reduce((s, i) => (i.resolvedAt && dayOf(i.resolvedAt) <= d ? s + (i.estimate ?? 0) : s), 0);
    points.push({ date: fromDay(d), ideal: Math.round(total * (1 - (d - start) / n) * 10) / 10, actual: d <= today ? total - burned : null });
  }
  return { total, points };
}

export interface WorkloadRow {
  userId: string | undefined;
  name: string;
  openIssues: number;
  openPoints: number;
  overdue: number;
}

export function workload(project: Project, issues: Issue[], members: Pick<Member, 'id' | 'name'>[], now: Date = new Date()): WorkloadRow[] {
  const today = fromDay(todayOf(now));
  const open = issues.filter((i) => i.projectId === project.id && level1(project, i) && !isDone(project, i));
  const row = (userId: string | undefined, name: string): WorkloadRow => {
    const mine = open.filter((i) => i.assigneeId === userId);
    return {
      userId,
      name,
      openIssues: mine.length,
      openPoints: mine.reduce((s, i) => s + (i.estimate ?? 0), 0),
      overdue: mine.filter((i) => i.dueDate && i.dueDate < today).length,
    };
  };
  const rows = members.map((m) => row(m.id, m.name)).filter((r) => r.openIssues > 0);
  const unassigned = row(undefined, 'Unassigned');
  if (unassigned.openIssues) rows.push(unassigned);
  return rows.sort((a, b) => b.openPoints - a.openPoints || b.openIssues - a.openIssues);
}

export function statusBreakdown(project: Project, issues: Issue[]): { name: string; category: string; count: number }[] {
  const items = issues.filter((i) => i.projectId === project.id && level1(project, i));
  return project.statuses.map((s) => ({ name: s.name, category: s.category, count: items.filter((i) => i.statusId === s.id).length }));
}
