import { openBlockers } from './dependencies';
import { isMilestoneType } from './issueTypes';
import { containerForecasts, projectForecast, sprintForecast, type ForecastRow } from './insights';
import { weeklyResolved } from './reports';
import { isDone, isOverdue, typeOf } from './selectors';
import { fromDay, toDay, todayDay } from './timeline';
import type { Issue, Member, Project, Sprint } from './types';

export type Health = 'green' | 'amber' | 'red' | 'grey';

export const HEALTH_STYLE: Record<Health, { label: string; color: string }> = {
  green: { label: 'On track', color: '#2f9e6b' },
  amber: { label: 'Needs attention', color: '#d9a21b' },
  red: { label: 'At risk', color: '#dc4b4b' },
  grey: { label: 'No data', color: '#7b8794' },
};

export interface ProjectHealth {
  project: Project;
  health: Health;
  reasons: string[];
  total: number;
  done: number;
  open: number;
  overdue: number;
  blocked: number;
  progress: number;
  weekly: number[];
  forecast: ForecastRow;
  sprint?: Sprint;
  sprintForecast?: ForecastRow;
  atRisk: ForecastRow[];
  nextMilestone?: { issue: Issue; daysLeft: number };
}

export function projectHealth(project: Project, allIssues: Issue[], sprints: Sprint[], now: Date = new Date()): ProjectHealth {
  const issues = allIssues.filter((i) => i.projectId === project.id);
  const work = issues.filter((i) => typeOf(project, i.typeId)?.level === 1);
  const open = work.filter((i) => !isDone(project, i));
  const overdue = open.filter((i) => isOverdue(project, i)).length;
  const blocked = open.filter((i) => openBlockers(project, issues, i).length > 0).length;

  const sprint = project.workStyle === 'agile' ? sprints.find((s) => s.projectId === project.id && s.state === 'active') : undefined;
  const sf = sprint ? sprintForecast(project, sprint, issues, now) : undefined;
  const containers = containerForecasts(project, issues, now);
  const risky = containers.filter((c) => c.level === 'low' || c.level === 'medium');

  const reasons: string[] = [];
  let health: Health = 'green';
  const bump = (to: Health) => {
    const rank: Record<Health, number> = { grey: 0, green: 1, amber: 2, red: 3 };
    if (rank[to] > rank[health]) health = to;
  };

  if (overdue >= 3) {
    bump('red');
    reasons.push(`${overdue} overdue items`);
  } else if (overdue > 0) {
    bump('amber');
    reasons.push(`${overdue} overdue item${overdue > 1 ? 's' : ''}`);
  }
  if (blocked > 0) {
    bump('amber');
    reasons.push(`${blocked} blocked`);
  }
  if (overdue > 0 && blocked > 0) bump('red');
  if (sf && sf.level === 'low') {
    bump('red');
    reasons.push(`${sprint!.name} at risk (${Math.round((sf.probability ?? 0) * 100)}%)`);
  } else if (sf && sf.level === 'medium') {
    bump('amber');
    reasons.push(`${sprint!.name} uncertain`);
  }
  for (const c of risky) {
    bump(c.level === 'low' ? 'red' : 'amber');
    reasons.push(`${c.key} ${c.level === 'low' ? 'unlikely' : 'uncertain'} by ${c.dueDate ? fromDay(toDay(c.dueDate)) : 'its date'}`);
  }
  if (work.length === 0) {
    health = 'grey';
    reasons.length = 0;
    reasons.push('No work items yet');
  }

  const today = todayDay();
  const upcoming = issues
    .filter((i) => isMilestoneType(typeOf(project, i.typeId)) && i.dueDate && !isDone(project, i))
    .map((i) => ({ issue: i, daysLeft: toDay(i.dueDate!) - today }))
    .sort((a, b) => a.daysLeft - b.daysLeft)[0];

  return {
    project,
    health,
    reasons,
    total: work.length,
    done: work.length - open.length,
    open: open.length,
    overdue,
    blocked,
    progress: work.length ? (work.length - open.length) / work.length : 0,
    weekly: weeklyResolved(project, issues, now, 8),
    forecast: projectForecast(project, issues, now),
    sprint,
    sprintForecast: sf,
    atRisk: risky,
    nextMilestone: upcoming,
  };
}

export interface PortfolioPerson {
  userId: string;
  name: string;
  openIssues: number;
  openPoints: number;
  overdue: number;
  projects: string[];
}

/** Open work per person across every project in the organization. */
export function orgWorkload(projects: Project[], issues: Issue[], members: Pick<Member, 'id' | 'name'>[], now: Date = new Date()): PortfolioPerson[] {
  const today = fromDay(todayDay());
  void now;
  return members
    .map((m) => {
      const mine = issues.filter((i) => i.assigneeId === m.id).filter((i) => {
        const p = projects.find((x) => x.id === i.projectId);
        return !!p && typeOf(p, i.typeId)?.level === 1 && !isDone(p, i);
      });
      return {
        userId: m.id,
        name: m.name,
        openIssues: mine.length,
        openPoints: mine.reduce((s, i) => s + (i.estimate ?? 0), 0),
        overdue: mine.filter((i) => i.dueDate && i.dueDate < today).length,
        projects: [...new Set(mine.map((i) => projects.find((p) => p.id === i.projectId)?.key ?? ''))],
      };
    })
    .filter((p) => p.openIssues > 0)
    .sort((a, b) => b.openPoints - a.openPoints || b.openIssues - a.openIssues);
}
