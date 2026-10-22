// Local co-pilot: understands a set of project-management requests and answers from the
// project's real data. It never changes anything itself: it proposes actions, and the user
// applies them (through the normal, permission-checked path).
//
// This is deliberately a provider-shaped function so a real language model can replace or
// extend it later (see CopilotProvider in the store/UI layer): same input, same output.

import { scheduleConflicts, openBlockers } from './dependencies';
import { CONFIDENCE_STYLE, containerForecasts, sprintForecast } from './insights';
import { workload } from './reports';
import { childrenOf, formatDate, isDone, isOverdue, typeOf } from './selectors';
import { sprintDaysLeft, sprintStats } from './sprints';
import { fromDay, todayDay } from './timeline';
import type { Activity, ID, Issue, IssuePatch, Member, NewIssue, Priority, Project, Sprint } from './types';

export interface CopilotContext {
  userId: ID;
  members: Member[];
  projects: Project[];
  /** The project the user is looking at, if any. */
  project?: Project;
  issues: Issue[];
  sprints: Sprint[];
  activity: Activity[];
  now: Date;
}

export type ProposedAction =
  | { id: string; type: 'create_issue'; label: string; input: NewIssue }
  | { id: string; type: 'update_issue'; label: string; issueId: ID; patch: IssuePatch }
  | { id: string; type: 'comment'; label: string; issueId: ID; body: string };

export interface CopilotReply {
  text: string;
  actions: ProposedAction[];
}

export interface CopilotProvider {
  respond(text: string, ctx: CopilotContext): Promise<CopilotReply>;
}

/** The built-in provider. Swap for a model-backed one when a backend is available. */
export const localCopilot: CopilotProvider = {
  respond: async (text, ctx) => respond(text, ctx),
};

export const SUGGESTIONS = ['Write a status update', "What's at risk?", 'Who is overloaded?', "What's blocked?", 'Help'];

const KEY_RE = /\b([A-Za-z][A-Za-z0-9]{1,9}-\d+)\b/;
const low = (s: string) => s.toLowerCase();
let seq = 0;
const aid = () => `act_${Date.now().toString(36)}_${seq++}`;

function findIssue(text: string, ctx: CopilotContext): Issue | undefined {
  const m = KEY_RE.exec(text);
  return m ? ctx.issues.find((i) => low(i.key) === low(m[1])) : undefined;
}

function projectOf(ctx: CopilotContext, issue?: Issue): Project | undefined {
  return issue ? ctx.projects.find((p) => p.id === issue.projectId) : ctx.project;
}

function findMember(text: string, ctx: CopilotContext): Member | undefined {
  const t = low(text);
  if (/\b(me|myself)\b/.test(t)) return ctx.members.find((m) => m.id === ctx.userId);
  return (
    ctx.members.find((m) => t.includes(low(m.name))) ??
    ctx.members.find((m) => t.split(/\W+/).includes(low(m.name.split(' ')[0])))
  );
}

function findStatus(project: Project, text: string) {
  const t = low(text);
  const aliases: Record<string, string[]> = { done: ['done', 'complete', 'completed', 'finished'], in_progress: ['in progress', 'started', 'doing'], todo: ['to do', 'todo', 'backlog'] };
  const byName = [...project.statuses].sort((a, b) => b.name.length - a.name.length).find((s) => t.includes(low(s.name)));
  if (byName) return byName;
  const cat = Object.entries(aliases).find(([, words]) => words.some((w) => t.includes(w)))?.[0];
  if (cat === 'done') return project.statuses.find((s) => s.category === 'done');
  if (cat === 'in_progress') return project.statuses.find((s) => s.category === 'in_progress');
  if (cat === 'todo') return project.statuses.find((s) => s.category === 'todo');
  return undefined;
}

function findPriority(text: string): Priority | undefined {
  const m = /\b(critical|urgent|high|medium|low)\b/i.exec(text);
  if (!m) return undefined;
  const w = low(m[1]);
  return (w === 'urgent' ? 'critical' : w) as Priority;
}

const WEEKDAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];

export function parseDue(text: string, now: Date): string | undefined {
  const t = low(text);
  const today = todayDay();
  const iso = /\b(\d{4}-\d{2}-\d{2})\b/.exec(t);
  if (iso) return iso[1];
  if (/\btoday\b/.test(t)) return fromDay(today);
  if (/\btomorrow\b/.test(t)) return fromDay(today + 1);
  const inN = /\bin (\d+) (day|days|week|weeks)\b/.exec(t);
  if (inN) return fromDay(today + Number(inN[1]) * (inN[2].startsWith('week') ? 7 : 1));
  if (/\bnext week\b/.test(t)) return fromDay(today + 7);
  const wd = WEEKDAYS.findIndex((d) => new RegExp(`\\b${d}\\b`).test(t));
  if (wd >= 0) {
    const cur = (today + 4) % 7;
    return fromDay(today + (((wd - cur + 7) % 7) || 7));
  }
  void now;
  return undefined;
}

// ---- intents ------------------------------------------------------------------

export function respond(input: string, ctx: CopilotContext): CopilotReply {
  const text = input.trim();
  const t = low(text);
  if (!text) return { text: helpText(), actions: [] };

  const issue = findIssue(text, ctx);

  if (/^(help|\?|what can you do|how do you work)/.test(t)) return { text: helpText(), actions: [] };

  // --- actions on a specific issue (checked before reports so "mark PLT-3 done" isn't a summary)
  let m: RegExpExecArray | null;

  if ((m = /\bbreak ?down\b|\bsplit\b|\bdecompose\b|\bplan out\b/.exec(t)) && issue) return breakdown(issue, ctx);

  if (/\bcomment\b/.test(t) && issue) {
    const body = text.replace(/^.*?\bcomment(?:\s+on)?\s+[A-Za-z0-9]+-\d+\s*[:\-]?\s*/i, '').trim();
    if (!body) return { text: `What should the comment on **${issue.key}** say? Try: “comment on ${issue.key}: ready for QA”.`, actions: [] };
    return {
      text: `I can post this comment on **${issue.key}** (${issue.title}):\n\n> ${body}`,
      actions: [{ id: aid(), type: 'comment', label: `Comment on ${issue.key}`, issueId: issue.id, body }],
    };
  }

  if (issue && /\bassign\b/.test(t)) {
    const who = findMember(text.replace(KEY_RE, ''), ctx);
    if (!who) return { text: `Who should I assign **${issue.key}** to? I know: ${ctx.members.map((x) => x.name).join(', ')}.`, actions: [] };
    return {
      text: `Assign **${issue.key}** (${issue.title}) to **${who.name}**?`,
      actions: [{ id: aid(), type: 'update_issue', label: `Assign ${issue.key} to ${who.name}`, issueId: issue.id, patch: { assigneeId: who.id } }],
    };
  }

  if (issue && /\bpriority\b|\bmake\b|\bescalate\b|\bbump\b/.test(t)) {
    const p = findPriority(text.replace(KEY_RE, '')) ?? (/\bescalate|bump\b/.test(t) ? 'high' : undefined);
    if (p) {
      return {
        text: `Change the priority of **${issue.key}** from ${issue.priority} to **${p}**?`,
        actions: [{ id: aid(), type: 'update_issue', label: `Set ${issue.key} priority to ${p}`, issueId: issue.id, patch: { priority: p } }],
      };
    }
  }

  if (issue && /\b(move|set|mark|transition|close|finish|start|reopen)\b/.test(t)) {
    const project = projectOf(ctx, issue)!;
    const target = /\bclose|finish\b/.test(t) ? project.statuses.find((s) => s.category === 'done') : /\bstart\b/.test(t) ? project.statuses.find((s) => s.category === 'in_progress') : findStatus(project, text.replace(KEY_RE, ''));
    if (target) {
      return {
        text: `Move **${issue.key}** (${issue.title}) to **${target.name}**? Workflow rules still apply and I'll tell you if something blocks it.`,
        actions: [{ id: aid(), type: 'update_issue', label: `Move ${issue.key} to ${target.name}`, issueId: issue.id, patch: { statusId: target.id } }],
      };
    }
  }

  if ((m = /^(?:please\s+)?(?:create|add|new|file|log|open)\s+(?:an?\s+)?(?:(bug|story|task|epic|milestone|approval)\b[:\s-]*)?(?:issue\b[:\s-]*)?(?:called\s+|titled\s+|to\s+|for\s+)?[:\-]?\s*(.+)$/i.exec(text))) {
    return createIssue(m[1], m[2], ctx);
  }

  if (issue && !/\b(status|summary|risk)\b/.test(t)) return describeIssue(issue, ctx);

  // --- reports
  if (/\b(blocked|blockers?|blocking)\b/.test(t)) return blocked(ctx);
  if (/\b(workload|overload|overloaded|capacity|busy|bandwidth|who has|who is free|who's free)\b/.test(t)) return workloadReply(ctx);
  if (/\b(risk|at risk|behind|off track|on track|ship on time|will we|forecast|late|delay)\b/.test(t)) return riskRadar(ctx);
  if (/\b(status|stand-?up|summary|summari[sz]e|progress|update|report|recap)\b/.test(t)) return statusUpdate(ctx);

  return {
    text: `I didn't understand that. ${helpText()}`,
    actions: [],
  };
}

function helpText(): string {
  return [
    'I can answer from your project data and propose changes for you to approve:',
    '- **Write a status update** · “status update for this project”',
    "- **What's at risk?** · overdue work, blockers, sprint and milestone forecasts",
    '- **Who is overloaded?** · workload with a rebalancing suggestion',
    "- **What's blocked?**",
    '- **Create:** “create a bug: login fails on Safari, priority high, due friday, assign to Sam”',
    '- **Change:** “move PLT-3 to in review”, “assign PLT-7 to Priya”, “set priority of PLT-9 to critical”, “comment on PLT-3: ready for QA”',
    '- **Plan:** “break down PLT-1”',
    '',
    '_This assistant works from your data on this device. No external AI model is connected yet._',
  ].join('\n');
}

// ---- reports ----------------------------------------------------------------------

function scope(ctx: CopilotContext): { projects: Project[]; label: string } {
  return ctx.project ? { projects: [ctx.project], label: ctx.project.name } : { projects: ctx.projects, label: 'all projects' };
}

const person = (ctx: CopilotContext, id?: ID) => ctx.members.find((m) => m.id === id)?.name ?? 'Unassigned';
const line = (i: Issue, extra = '') => `- **${i.key}** ${i.title}${extra}`;

function statusUpdate(ctx: CopilotContext): CopilotReply {
  const { projects, label } = scope(ctx);
  const weekAgo = ctx.now.getTime() - 7 * 86400000;
  const out: string[] = [`## Status update · ${label} · ${formatDate(ctx.now.toISOString())}`];

  for (const p of projects) {
    const issues = ctx.issues.filter((i) => i.projectId === p.id);
    const work = issues.filter((i) => typeOf(p, i.typeId)?.level === 1);
    const doneWeek = work.filter((i) => i.resolvedAt && new Date(i.resolvedAt).getTime() >= weekAgo);
    const inProgress = work.filter((i) => p.statuses.find((s) => s.id === i.statusId)?.category === 'in_progress');
    const overdue = work.filter((i) => isOverdue(p, i));
    const blockedNow = work.filter((i) => !isDone(p, i) && openBlockers(p, issues, i).length > 0);
    if (projects.length > 1) out.push(`\n### ${p.name}`);

    const sprint = ctx.sprints.find((s) => s.projectId === p.id && s.state === 'active');
    if (sprint) {
      const st = sprintStats(p, issues, sprint.id);
      const f = sprintForecast(p, sprint, issues, ctx.now);
      const left = sprintDaysLeft(sprint, ctx.now);
      out.push(`**${sprint.name}**: ${st.donePoints}/${st.points} points done${left !== null ? `, ${left} days left` : ''}. Forecast: **${CONFIDENCE_STYLE[f.level].label}**${f.probability !== null ? ` (${Math.round(f.probability * 100)}% chance to finish by ${formatDate(sprint.endDate)})` : ''}.`);
    }
    out.push(`\n**Done in the last 7 days (${doneWeek.length})**`);
    out.push(doneWeek.length ? doneWeek.slice(0, 6).map((i) => line(i, ` — ${person(ctx, i.assigneeId)}`)).join('\n') : '- Nothing finished this week.');
    out.push(`\n**In progress (${inProgress.length})**`);
    out.push(inProgress.length ? inProgress.slice(0, 6).map((i) => line(i, ` — ${person(ctx, i.assigneeId)}`)).join('\n') : '- Nothing in progress.');
    if (overdue.length || blockedNow.length) {
      out.push('\n**Needs attention**');
      overdue.slice(0, 5).forEach((i) => out.push(line(i, ` — overdue since ${formatDate(i.dueDate)}`)));
      blockedNow.slice(0, 5).forEach((i) => out.push(line(i, ` — blocked by ${openBlockers(p, issues, i).map((b) => b.key).join(', ')}`)));
    }
    const upcoming = containerForecasts(p, issues, ctx.now).filter((r) => r.level === 'low' || r.level === 'medium').slice(0, 3);
    if (upcoming.length) {
      out.push('\n**Milestones & epics to watch**');
      upcoming.forEach((r) => out.push(`- **${r.key}** ${r.title}: ${CONFIDENCE_STYLE[r.level].label}${r.probability !== null ? `, ${Math.round(r.probability * 100)}% to hit ${formatDate(r.dueDate)}` : ''}`));
    }
  }
  return { text: out.join('\n'), actions: [] };
}

interface Risk {
  severity: 1 | 2 | 3;
  text: string;
}

function riskRadar(ctx: CopilotContext): CopilotReply {
  const { projects, label } = scope(ctx);
  const risks: Risk[] = [];
  const actions: ProposedAction[] = [];

  for (const p of projects) {
    const issues = ctx.issues.filter((i) => i.projectId === p.id);
    const work = issues.filter((i) => typeOf(p, i.typeId)?.level === 1 && !isDone(p, i));
    const tag = projects.length > 1 ? ` _(${p.name})_` : '';

    for (const i of work.filter((x) => isOverdue(p, x))) risks.push({ severity: 3, text: `**${i.key}** ${i.title} is overdue (due ${formatDate(i.dueDate)}, ${person(ctx, i.assigneeId)}).${tag}` });
    for (const i of work) {
      const blockers = openBlockers(p, issues, i);
      if (blockers.length && i.dueDate && i.dueDate <= fromDay(todayDay() + 7)) risks.push({ severity: 3, text: `**${i.key}** ${i.title} is due ${formatDate(i.dueDate)} but blocked by ${blockers.map((b) => `**${b.key}**`).join(', ')}.${tag}` });
    }
    for (const c of scheduleConflicts(issues)) {
      const a = issues.find((x) => x.id === c.issueId)!;
      const b = issues.find((x) => x.id === c.blockerId)!;
      risks.push({ severity: 2, text: `**${a.key}** is scheduled to start before its blocker **${b.key}** is due (${formatDate(b.dueDate)}).${tag}` });
    }
    const sprint = ctx.sprints.find((s) => s.projectId === p.id && s.state === 'active');
    if (sprint) {
      const f = sprintForecast(p, sprint, issues, ctx.now);
      if (f.level === 'low' || f.level === 'medium') {
        risks.push({ severity: f.level === 'low' ? 3 : 2, text: `**${sprint.name}** has ${Math.round((f.probability ?? 0) * 100)}% chance of finishing all ${f.remaining} remaining ${f.unit} by ${formatDate(sprint.endDate)}${f.p85Date ? ` (likely done by ${formatDate(f.p85Date)})` : ''}.${tag}` });
      }
      for (const i of work.filter((x) => x.sprintId === sprint.id && !x.assigneeId)) {
        risks.push({ severity: 2, text: `**${i.key}** ${i.title} is in the sprint but unassigned.${tag}` });
        const least = [...ctx.members].map((m) => ({ m, load: work.filter((x) => x.assigneeId === m.id).length })).sort((a, b) => a.load - b.load)[0]?.m;
        if (least) actions.push({ id: aid(), type: 'update_issue', label: `Assign ${i.key} to ${least.name} (lightest load)`, issueId: i.id, patch: { assigneeId: least.id } });
      }
    }
    for (const r of containerForecasts(p, issues, ctx.now)) {
      if (r.level === 'low' || r.level === 'medium') {
        risks.push({ severity: r.level === 'low' ? 3 : 2, text: `**${r.key}** ${r.title}: ${r.probability !== null ? `${Math.round(r.probability * 100)}% chance` : 'uncertain'} to finish ${r.remaining} remaining items by ${formatDate(r.dueDate)}${r.p85Date ? `; realistic date ${formatDate(r.p85Date)}` : ''}.${tag}` });
      }
    }
    for (const i of work) {
      const stale = (ctx.now.getTime() - new Date(i.updatedAt).getTime()) / 86400000;
      if (stale > 10 && p.statuses.find((s) => s.id === i.statusId)?.category === 'in_progress') risks.push({ severity: 1, text: `**${i.key}** ${i.title} has been in progress with no update for ${Math.floor(stale)} days.${tag}` });
    }
  }

  if (!risks.length) return { text: `## Risk radar · ${label}\nNothing looks risky right now: no overdue work, blocked deadlines or at-risk forecasts. 🎉`, actions: [] };
  const icon = { 3: '🔴', 2: '🟠', 1: '🟡' } as const;
  const sorted = risks.sort((a, b) => b.severity - a.severity).slice(0, 12);
  return { text: [`## Risk radar · ${label}`, ...sorted.map((r) => `- ${icon[r.severity]} ${r.text}`)].join('\n'), actions: actions.slice(0, 5) };
}

function blocked(ctx: CopilotContext): CopilotReply {
  const { projects, label } = scope(ctx);
  const rows: string[] = [];
  for (const p of projects) {
    const issues = ctx.issues.filter((i) => i.projectId === p.id);
    for (const i of issues.filter((x) => !isDone(p, x))) {
      const b = openBlockers(p, issues, i);
      if (b.length) rows.push(`- **${i.key}** ${i.title} ← waiting on ${b.map((x) => `**${x.key}** (${person(ctx, x.assigneeId)})`).join(', ')}`);
    }
  }
  return { text: rows.length ? [`## Blocked work · ${label}`, ...rows].join('\n') : `## Blocked work · ${label}\nNothing is blocked by an unfinished dependency.`, actions: [] };
}

function workloadReply(ctx: CopilotContext): CopilotReply {
  const { projects, label } = scope(ctx);
  const actions: ProposedAction[] = [];
  const out = [`## Workload · ${label}`];
  for (const p of projects) {
    const rows = workload(p, ctx.issues, ctx.members, ctx.now);
    if (!rows.length) continue;
    if (projects.length > 1) out.push(`\n### ${p.name}`);
    rows.forEach((r) => out.push(`- **${r.name}**: ${r.openIssues} open issues, ${r.openPoints} pts${r.overdue ? `, ${r.overdue} overdue` : ''}`));
    const people = rows.filter((r) => r.userId);
    const heavy = people[0];
    const free = ctx.members.map((m) => ({ m, r: people.find((x) => x.userId === m.id) })).sort((a, b) => (a.r?.openPoints ?? 0) - (b.r?.openPoints ?? 0))[0];
    if (heavy && free && free.m.id !== heavy.userId && heavy.openPoints - (free.r?.openPoints ?? 0) >= 5) {
      const candidate = ctx.issues
        .filter((i) => i.projectId === p.id && i.assigneeId === heavy.userId && typeOf(p, i.typeId)?.level === 1 && !isDone(p, i))
        .sort((a, b) => ['low', 'medium', 'high', 'critical'].indexOf(a.priority) - ['low', 'medium', 'high', 'critical'].indexOf(b.priority) || (b.estimate ?? 0) - (a.estimate ?? 0))[0];
      if (candidate) {
        out.push(`\n**${heavy.name}** carries ${heavy.openPoints - (free.r?.openPoints ?? 0)} more points than **${free.m.name}**. Suggestion: hand over **${candidate.key}** (${candidate.priority} priority).`);
        actions.push({ id: aid(), type: 'update_issue', label: `Reassign ${candidate.key} to ${free.m.name}`, issueId: candidate.id, patch: { assigneeId: free.m.id } });
      }
    }
  }
  return { text: out.length > 1 ? out.join('\n') : `## Workload · ${label}\nNo open work is assigned.`, actions };
}

function describeIssue(issue: Issue, ctx: CopilotContext): CopilotReply {
  const p = projectOf(ctx, issue)!;
  const status = p.statuses.find((s) => s.id === issue.statusId)?.name;
  const kids = childrenOf(ctx.issues, issue.id);
  const b = openBlockers(p, ctx.issues, issue);
  const lines = [
    `## ${issue.key} · ${issue.title}`,
    `- Status **${status}**, priority **${issue.priority}**, assignee **${person(ctx, issue.assigneeId)}**`,
    issue.dueDate ? `- Due ${formatDate(issue.dueDate)}${isOverdue(p, issue) ? ' (**overdue**)' : ''}` : '- No due date',
    kids.length ? `- ${kids.filter((k) => isDone(p, k)).length}/${kids.length} child items done` : '',
    b.length ? `- Blocked by ${b.map((x) => x.key).join(', ')}` : '',
  ].filter(Boolean);
  return { text: lines.join('\n'), actions: [] };
}

// ---- creating & planning ---------------------------------------------------------------

function createIssue(typeWord: string | undefined, rest: string, ctx: CopilotContext): CopilotReply {
  let project = ctx.project;
  const inProject = /\bin\s+([A-Za-z][A-Za-z0-9]{1,9})\b/i.exec(rest);
  if (inProject) project = ctx.projects.find((p) => low(p.key) === low(inProject[1])) ?? project;
  if (!project) return { text: 'Open a project first (or add “in PLT” to your request) so I know where to create it.', actions: [] };

  const type =
    project.issueTypes.find((t) => typeWord && low(t.name) === low(typeWord)) ??
    project.issueTypes.find((t) => t.level === 1)!;
  const priority = findPriority(rest);
  const assignee = /\bassign(?:ed)?\s+to\s+(.+?)(?=,|\.| due | priority |$)/i.exec(rest);
  const who = assignee ? findMember(assignee[1], ctx) : undefined;
  const due = /\bdue\b\s*(.*)$/i.exec(rest);
  const dueDate = due ? parseDue(due[1], ctx.now) : undefined;

  const title = rest
    .replace(/\s+in\s+[A-Za-z][A-Za-z0-9]{1,9}\b(?=\s*$|,)/i, '')
    .replace(/[,.]?\s*assign(?:ed)?\s+to\s+.+?(?=,|\.| due | priority |$)/i, '')
    .replace(/[,.]?\s*\bdue\b.*$/i, '')
    .replace(/[,.]?\s*\bpriority\s+\w+/i, '')
    .replace(/[,.]?\s*\b(critical|urgent|high|medium|low)\s+priority\b/i, '')
    .replace(/[.,:;\s]+$/, '')
    .replace(/^(that|which|for)\s+/i, '')
    .trim();
  if (!title) return { text: 'What should the new issue be called?', actions: [] };
  const clean = title.charAt(0).toUpperCase() + title.slice(1);

  const bits = [`**${type.name}** “${clean}” in **${project.name}**`, priority ? `priority ${priority}` : '', who ? `assigned to ${who.name}` : '', dueDate ? `due ${formatDate(dueDate)}` : ''].filter(Boolean);
  return {
    text: `I'll create ${bits.join(', ')}. Apply it below.`,
    actions: [
      {
        id: aid(),
        type: 'create_issue',
        label: `Create ${type.name}: ${clean}`,
        input: { projectId: project.id, typeId: type.id, title: clean, priority, assigneeId: who?.id, dueDate },
      },
    ],
  };
}

const BREAKDOWN_STORY = ['Design & acceptance criteria', 'Implement', 'Write tests', 'Review & QA', 'Docs & release notes'];
const BREAKDOWN_EPIC = ['Define scope & success measures', 'Build the core', 'Integrations & edge cases', 'Test & harden', 'Roll out'];

function breakdown(issue: Issue, ctx: CopilotContext): CopilotReply {
  const p = projectOf(ctx, issue)!;
  const level = typeOf(p, issue.typeId)?.level;
  if (level === 2) return { text: `**${issue.key}** is already a sub-task, so it can't be split further.`, actions: [] };
  const childType = p.issueTypes.find((t) => t.level === (level === 0 ? 1 : 2));
  if (!childType) return { text: `This project has no ${level === 0 ? 'work item' : 'sub-task'} type to split into.`, actions: [] };
  const existing = childrenOf(ctx.issues, issue.id).map((c) => low(c.title));
  const steps = (level === 0 ? BREAKDOWN_EPIC : BREAKDOWN_STORY).filter((s) => !existing.includes(low(s)));
  if (!steps.length) return { text: `**${issue.key}** already has all the usual steps.`, actions: [] };
  return {
    text: [`Here is a starting breakdown for **${issue.key}** (${issue.title}). Apply the steps you want:`, ...steps.map((s) => `- ${s}`)].join('\n'),
    actions: steps.map((s) => ({
      id: aid(),
      type: 'create_issue' as const,
      label: `Add ${childType.name}: ${s}`,
      input: { projectId: p.id, typeId: childType.id, title: level === 0 ? `${s}: ${issue.title}` : s, parentId: issue.id, sprintId: level === 0 ? undefined : issue.sprintId },
    })),
  };
}
