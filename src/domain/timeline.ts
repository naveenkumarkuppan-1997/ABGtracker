import type { Issue } from './types';

const DAY = 86400000;

/** 'YYYY-MM-DD' -> whole days since 1970-01-01 (UTC, so no DST surprises). */
export const toDay = (s: string): number => Math.floor(Date.parse(s + 'T00:00:00Z') / DAY);
export const fromDay = (n: number): string => new Date(n * DAY).toISOString().slice(0, 10);
export const todayDay = (): number => {
  const d = new Date();
  return toDay(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`);
};

export interface Span {
  start: number;
  end: number;
}

/** Bar for an issue; null when it has no dates. A single date becomes a one-day bar. */
export function spanOf(issue: Pick<Issue, 'startDate' | 'dueDate'>): Span | null {
  const a = issue.startDate ? toDay(issue.startDate) : undefined;
  const b = issue.dueDate ? toDay(issue.dueDate) : undefined;
  if (a === undefined && b === undefined) return null;
  const start = a ?? b!;
  const end = b ?? a!;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

export type DragMode = 'move' | 'start' | 'end';

/** Dates after dragging a bar by `delta` days. Never lets end go before start. */
export function applyDrag(span: Span, delta: number, mode: DragMode): { startDate: string; dueDate: string } {
  let { start, end } = span;
  if (mode === 'move') {
    start += delta;
    end += delta;
  } else if (mode === 'start') {
    start = Math.min(start + delta, end);
  } else {
    end = Math.max(end + delta, start);
  }
  return { startDate: fromDay(start), dueDate: fromDay(end) };
}

export const ZOOMS = {
  week: { label: 'Weeks', px: 28 },
  month: { label: 'Months', px: 12 },
  quarter: { label: 'Quarters', px: 4.5 },
} as const;
export type Zoom = keyof typeof ZOOMS;
