import { confidenceOf, forecast, type Confidence } from './forecast';
import { weeklyResolved } from './reports';
import { isDone, typeOf } from './selectors';
import { fromDay, todayDay, toDay } from './timeline';
import type { Issue, Project, Sprint } from './types';

export interface ForecastRow {
  id: string;
  key?: string;
  title: string;
  kind: 'sprint' | 'container' | 'project';
  remaining: number;
  unit: 'pts' | 'items';
  dueDate?: string;
  daysAvailable: number | null;
  probability: number | null;
  level: Confidence;
  p50Date?: string;
  p85Date?: string;
  note?: string;
}

const WEEKS = 8;

const level1 = (p: Project, i: Issue) => typeOf(p, i.typeId)?.level === 1;

function build(
  base: Pick<ForecastRow, 'id' | 'key' | 'title' | 'kind' | 'unit' | 'dueDate'>,
  weekly: number[],
  remaining: number,
  today: number
): ForecastRow {
  const f = forecast(weekly, remaining);
  const daysAvailable = base.dueDate ? toDay(base.dueDate) - today : null;
  const conf = daysAvailable === null ? { level: (f.enoughHistory ? 'medium' : 'unknown') as Confidence, probability: null } : confidenceOf(f, daysAvailable);
  return {
    ...base,
    remaining,
    daysAvailable,
    probability: conf.probability,
    level: remaining <= 0 ? 'high' : conf.level,
    p50Date: f.p50Days !== null ? fromDay(today + f.p50Days) : undefined,
    p85Date: f.p85Days !== null ? fromDay(today + f.p85Days) : undefined,
    note: !f.enoughHistory && remaining > 0 ? 'Not enough finished work in the last 8 weeks to forecast reliably.' : undefined,
  };
}

/** Chance the active sprint finishes all of its points by its end date. */
export function sprintForecast(project: Project, sprint: Sprint, issues: Issue[], now: Date = new Date()): ForecastRow {
  const today = todayDay();
  const items = issues.filter((i) => i.sprintId === sprint.id && level1(project, i));
  const usePoints = items.some((i) => (i.estimate ?? 0) > 0);
  const remaining = items.filter((i) => !isDone(project, i)).reduce((s, i) => s + (usePoints ? i.estimate ?? 0 : 1), 0);
  const weekly = weeklyResolved(project, issues, now, WEEKS, usePoints ? 'points' : 'count');
  return build({ id: sprint.id, title: sprint.name, kind: 'sprint', unit: usePoints ? 'pts' : 'items', dueDate: sprint.endDate }, weekly, remaining, today);
}

/** One row per epic/milestone that still has open work, using its due date as the target. */
export function containerForecasts(project: Project, issues: Issue[], now: Date = new Date()): ForecastRow[] {
  const today = todayDay();
  const weekly = weeklyResolved(project, issues, now, WEEKS, 'count');
  const rows: ForecastRow[] = [];
  for (const c of issues.filter((i) => i.projectId === project.id && typeOf(project, i.typeId)?.level === 0)) {
    const open = issues.filter((i) => i.parentId === c.id && level1(project, i) && !isDone(project, i)).length;
    if (isDone(project, c) || open === 0) continue;
    rows.push(build({ id: c.id, key: c.key, title: c.title, kind: 'container', unit: 'items', dueDate: c.dueDate }, weekly, open, today));
  }
  return rows.sort((a, b) => (a.probability ?? 2) - (b.probability ?? 2));
}

/** When the whole backlog of open work would be finished at the current pace. */
export function projectForecast(project: Project, issues: Issue[], now: Date = new Date()): ForecastRow {
  const today = todayDay();
  const weekly = weeklyResolved(project, issues, now, WEEKS, 'count');
  const open = issues.filter((i) => i.projectId === project.id && level1(project, i) && !isDone(project, i)).length;
  return build({ id: project.id, title: 'All open work', kind: 'project', unit: 'items' }, weekly, open, today);
}

export const CONFIDENCE_STYLE: Record<Confidence, { label: string; color: string }> = {
  high: { label: 'On track', color: '#2f9e6b' },
  medium: { label: 'Uncertain', color: '#d9a21b' },
  low: { label: 'At risk', color: '#dc4b4b' },
  unknown: { label: 'No forecast', color: '#7b8794' },
};
