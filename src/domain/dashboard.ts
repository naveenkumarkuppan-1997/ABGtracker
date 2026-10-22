import { openBlockers } from './dependencies';
import { weekBuckets, weeklyCreated, weeklyResolved } from './reports';
import { isDone, typeOf } from './selectors';
import type { Activity, DashboardLayout, DashboardWidget, Issue, OrgData, Priority, Project, Role, WidgetId, WidgetSize } from './types';

export interface WidgetDef {
  id: WidgetId;
  title: string;
  hint: string;
  /** How wide it starts out. */
  size: WidgetSize;
}

/** Everything a dashboard can show. The order here is the default order. */
export const WIDGETS: readonly WidgetDef[] = [
  { id: 'kpis', title: 'At a glance', hint: 'Open, overdue and blocked work, finished this week, and your own load.', size: 'full' },
  { id: 'briefing', title: 'Your day, in brief (AI)', hint: 'A short read on your day and a suggested order to tackle it. Appears only when an AI assistant is connected.', size: 'full' },
  { id: 'mine', title: 'My open work', hint: 'Everything assigned to you that is not finished, soonest due first.', size: 'half' },
  { id: 'dueSoon', title: 'Due soon & overdue (mine)', hint: 'Your work due in the next 7 days, plus anything that slipped.', size: 'half' },
  { id: 'approvals', title: 'Waiting for my approval', hint: 'Items that need your sign-off.', size: 'half' },
  { id: 'watching', title: 'Following', hint: 'Unfinished items you watch.', size: 'half' },
  { id: 'projects', title: 'Projects', hint: 'Every project with its progress.', size: 'full' },
  { id: 'health', title: 'Project health', hint: 'On track / needs attention / at risk, with the reasons. Takes a moment to calculate.', size: 'full' },
  { id: 'workload', title: 'Team workload', hint: 'Open work per person, with what is overdue.', size: 'half' },
  { id: 'trend', title: 'Created vs finished', hint: 'The last 6 weeks.', size: 'half' },
  { id: 'status', title: 'Work by stage', hint: 'How much is not started, in progress, and done.', size: 'half' },
  { id: 'priority', title: 'Open work by priority', hint: 'Where the urgent items are.', size: 'half' },
  { id: 'upcoming', title: 'Coming up (everyone)', hint: 'Anything due in the next 14 days.', size: 'half' },
  { id: 'activity', title: 'Recent activity', hint: 'The latest changes across the organization.', size: 'full' },
];

const KNOWN = new Map(WIDGETS.map((w) => [w.id, w]));
const SIZES: WidgetSize[] = ['half', 'full'];
export const MAX_WIDGETS = 30;

/** Shown to a person who has not customized anything. Guests only get what is about them. */
export function defaultLayout(role?: Role): DashboardLayout {
  const guest: WidgetId[] = ['mine', 'dueSoon', 'approvals', 'activity'];
  const hiddenByDefault: WidgetId[] = ['health', 'watching', 'priority'];
  return {
    widgets: WIDGETS.map((w) => ({
      id: w.id,
      size: w.size,
      visible: role === 'guest' ? guest.includes(w.id) : !hiddenByDefault.includes(w.id),
    })),
  };
}

/**
 * Makes any stored layout safe to use: unknown widgets are dropped, repeats removed, bad sizes repaired, and widgets added to the
 * product after it was saved appear at the end (visible or not as the default says), so an old layout never hides new features.
 */
export function normalizeLayout(raw: unknown, role?: Role): DashboardLayout {
  const base = defaultLayout(role);
  const list = Array.isArray((raw as DashboardLayout | undefined)?.widgets) ? (raw as DashboardLayout).widgets : null;
  if (!list) return base;
  const seen = new Set<WidgetId>();
  const out: DashboardWidget[] = [];
  for (const w of list.slice(0, MAX_WIDGETS)) {
    const def = w && KNOWN.get(w.id);
    if (!def || seen.has(w.id)) continue;
    seen.add(w.id);
    out.push({ id: w.id, visible: w.visible !== false, size: SIZES.includes(w.size) ? w.size : def.size });
  }
  for (const d of base.widgets) if (!seen.has(d.id)) out.push(d);
  return { widgets: out };
}

/** For saving: anything that is not a well-formed layout is an error (never silently repaired). */
export function validateLayout(raw: unknown): DashboardLayout {
  const list = (raw as DashboardLayout | null)?.widgets;
  if (!Array.isArray(list) || list.length === 0 || list.length > MAX_WIDGETS) throw new Error('That dashboard layout is not valid.');
  const seen = new Set<string>();
  for (const w of list) {
    if (!w || typeof w !== 'object' || !KNOWN.has(w.id) || typeof w.visible !== 'boolean' || !SIZES.includes(w.size) || seen.has(w.id)) throw new Error('That dashboard layout is not valid.');
    seen.add(w.id);
  }
  return normalizeLayout({ widgets: list.map((w) => ({ id: w.id, visible: w.visible, size: w.size })) });
}

// ---- the numbers ------------------------------------------------------------------------------------------------

const localDay = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const addDays = (day: string, n: number) => new Date(Date.parse(`${day}T00:00:00Z`) + n * 86_400_000).toISOString().slice(0, 10);

export interface Row {
  issue: Issue;
  project: Project;
}

export type TileId = 'open' | 'overdue' | 'blocked' | 'doneThisWeek' | 'myOpen' | 'myOverdue';

export interface DashboardData {
  today: string;
  /** The items counted by each "at a glance" tile. */
  tiles: Record<TileId, Row[]>;
  kpis: { open: number; overdue: number; blocked: number; doneThisWeek: number; myOpen: number; myOverdue: number };
  mine: Row[];
  dueSoon: Row[];
  approvals: Row[];
  watching: Row[];
  upcoming: Row[];
  priority: Record<Priority, number>;
  stage: { todo: number; in_progress: number; done: number };
  workload: { userId?: string; name: string; open: number; overdue: number }[];
  trend: { labels: string[]; created: number[]; finished: number[] };
  activity: Activity[];
}

/**
 * Everything the dashboard shows, worked out from what is already loaded (nothing extra is fetched).
 * `projectId` narrows every number to one project. "Work" means real work items, not epics or sub-tasks, like the reports.
 */
export function computeDashboard(data: OrgData, userId: string, now: Date = new Date(), projectId?: string): DashboardData {
  const today = localDay(now);
  const projects = projectId ? data.projects.filter((p) => p.id === projectId) : data.projects;
  const projectOf = new Map(projects.map((p) => [p.id, p]));
  const issues = data.issues.filter((i) => projectOf.has(i.projectId));
  const perProject = new Map(projects.map((p) => [p.id, issues.filter((i) => i.projectId === p.id)]));
  const row = (issue: Issue): Row => ({ issue, project: projectOf.get(issue.projectId)! });
  const late = (r: Row) => !!r.issue.dueDate && r.issue.dueDate < today && !isDone(r.project, r.issue);
  const byDue = (a: Row, b: Row) => (a.issue.dueDate ?? '9999').localeCompare(b.issue.dueDate ?? '9999') || a.issue.number - b.issue.number;

  const work = issues.filter((i) => typeOf(projectOf.get(i.projectId)!, i.typeId)?.level === 1).map(row);
  const open = work.filter((r) => !isDone(r.project, r.issue));
  const weekAgo = new Date(now.getTime() - 7 * 86_400_000).toISOString();

  const mine = issues.filter((i) => i.assigneeId === userId).map(row).filter((r) => !isDone(r.project, r.issue)).sort(byDue);
  const horizon = addDays(today, 7);
  const upto = addDays(today, 14);

  const priority: Record<Priority, number> = { critical: 0, high: 0, medium: 0, low: 0 };
  for (const r of open) priority[r.issue.priority]++;
  const stage = { todo: 0, in_progress: 0, done: 0 };
  for (const r of work) stage[r.project.statuses.find((s) => s.id === r.issue.statusId)?.category ?? 'todo']++;

  const people = new Map<string, { userId?: string; name: string; open: number; overdue: number }>();
  for (const r of open) {
    const key = r.issue.assigneeId ?? '';
    const cur = people.get(key) ?? { userId: r.issue.assigneeId, name: data.members.find((m) => m.id === r.issue.assigneeId)?.name ?? 'Unassigned', open: 0, overdue: 0 };
    cur.open++;
    if (late(r)) cur.overdue++;
    people.set(key, cur);
  }

  const labels = weekBuckets(now, 6).map((b) => b.label);
  const created = new Array<number>(6).fill(0);
  const finished = new Array<number>(6).fill(0);
  for (const p of projects) {
    weeklyCreated(p, data.issues, now, 6).forEach((n, i) => (created[i] += n));
    weeklyResolved(p, data.issues, now, 6).forEach((n, i) => (finished[i] += n));
  }

  // The lists behind the "at a glance" tiles. The numbers are their lengths, so a tile and the list it opens can never disagree.
  const tiles: Record<TileId, Row[]> = {
    open: [...open].sort(byDue),
    overdue: open.filter(late).sort(byDue),
    blocked: open.filter((r) => openBlockers(r.project, perProject.get(r.project.id)!, r.issue).length > 0).sort(byDue),
    doneThisWeek: work.filter((r) => r.issue.resolvedAt && r.issue.resolvedAt >= weekAgo && isDone(r.project, r.issue)).sort((a, b) => (b.issue.resolvedAt ?? '').localeCompare(a.issue.resolvedAt ?? '')),
    myOpen: mine,
    myOverdue: mine.filter(late),
  };

  return {
    today,
    tiles,
    kpis: {
      open: tiles.open.length,
      overdue: tiles.overdue.length,
      blocked: tiles.blocked.length,
      doneThisWeek: tiles.doneThisWeek.length,
      myOpen: tiles.myOpen.length,
      myOverdue: tiles.myOverdue.length,
    },
    mine,
    dueSoon: mine.filter((r) => r.issue.dueDate && r.issue.dueDate <= horizon),
    approvals: issues.filter((i) => i.approval?.approverIds.includes(userId) && !i.approval.decisions[userId]).map(row),
    watching: issues.filter((i) => (i.watcherIds ?? []).includes(userId)).map(row).filter((r) => !isDone(r.project, r.issue)).sort(byDue).slice(0, 10),
    upcoming: open.filter((r) => r.issue.dueDate && r.issue.dueDate >= today && r.issue.dueDate <= upto).sort(byDue).slice(0, 12),
    priority,
    stage,
    workload: [...people.values()].sort((a, b) => b.open - a.open).slice(0, 8),
    trend: { labels, created, finished },
    activity: data.activity.filter((a) => projectOf.has(a.projectId)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 12),
  };
}
