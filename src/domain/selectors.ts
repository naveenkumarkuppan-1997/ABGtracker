import type { Issue, IssueType, Project, Status } from './types';

export const statusOf = (p: Project, id: string): Status | undefined => p.statuses.find((s) => s.id === id);
export const typeOf = (p: Project, id: string): IssueType | undefined => p.issueTypes.find((t) => t.id === id);

export function isDone(p: Project, issue: Issue): boolean {
  return statusOf(p, issue.statusId)?.category === 'done';
}

export function isOverdue(p: Project, issue: Issue): boolean {
  if (!issue.dueDate || isDone(p, issue)) return false;
  return issue.dueDate < new Date().toISOString().slice(0, 10);
}

export function childrenOf(issues: Issue[], parentId: string): Issue[] {
  return issues.filter((i) => i.parentId === parentId).sort((a, b) => a.number - b.number);
}

export function progressOf(p: Project, issues: Issue[], parentId: string): { done: number; total: number } {
  const kids = childrenOf(issues, parentId);
  return { done: kids.filter((k) => isDone(p, k)).length, total: kids.length };
}

export function formatDate(d?: string): string {
  if (!d) return '';
  const date = new Date(d.length === 10 ? d + 'T00:00:00' : d);
  return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
}

export function timeAgo(iso: string): string {
  const s = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 30) return `${d}d ago`;
  return new Date(iso).toLocaleDateString();
}
