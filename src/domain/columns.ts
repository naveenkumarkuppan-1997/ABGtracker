import type { Status, StatusCategory } from './types';

// Pure helpers behind "add / rename / move / recolour a column". A column is a status.

export const CATEGORY_LABEL: Record<StatusCategory, string> = {
  todo: 'Not started',
  in_progress: 'In progress',
  done: 'Finished',
};

export const CATEGORY_HELP: Record<StatusCategory, string> = {
  todo: 'Work that has not begun.',
  in_progress: 'Work that someone is on.',
  done: 'Work that is complete. Counts toward progress and reports.',
};

export const MAX_COLUMNS = 12;
export const MAX_COLUMN_NAME = 40;

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'column';

/** A stable id that doesn't clash with existing ones. */
export function newStatusId(name: string, existing: Pick<Status, 'id'>[]): string {
  const base = slug(name);
  const taken = new Set(existing.map((s) => s.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

/** Returns what is wrong with a column name, or null. */
export function nameProblem(statuses: Pick<Status, 'id' | 'name'>[], name: string, exceptId?: string): string | null {
  const n = name.trim();
  if (!n) return 'Give the column a name.';
  if (n.length > MAX_COLUMN_NAME) return `Keep the name under ${MAX_COLUMN_NAME} characters.`;
  if (statuses.some((s) => s.id !== exceptId && s.name.trim().toLowerCase() === n.toLowerCase())) return `There is already a column called “${n}”.`;
  return null;
}

/** New column goes just before the first "Finished" column, so Done stays last. */
export function addColumn(statuses: Status[], name: string): Status[] {
  const col: Status = { id: newStatusId(name, statuses), name: name.trim(), category: 'in_progress' };
  const firstDone = statuses.findIndex((s) => s.category === 'done');
  if (firstDone < 0) return [...statuses, col];
  return [...statuses.slice(0, firstDone), col, ...statuses.slice(firstDone)];
}

export const renameColumn = (statuses: Status[], id: string, name: string): Status[] => statuses.map((s) => (s.id === id ? { ...s, name: name.trim() } : s));

export function moveColumn(statuses: Status[], id: string, dir: -1 | 1): Status[] {
  const i = statuses.findIndex((s) => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= statuses.length) return statuses;
  const next = [...statuses];
  [next[i], next[j]] = [next[j], next[i]];
  return next;
}

/** Changing what a column "counts as" must leave at least one Finished column. */
export function categoryProblem(statuses: Status[], id: string, category: StatusCategory): string | null {
  const next = statuses.map((s) => (s.id === id ? { ...s, category } : s));
  if (!next.some((s) => s.category === 'done')) return 'At least one column must count as Finished.';
  return null;
}

export const setColumnCategory = (statuses: Status[], id: string, category: StatusCategory): Status[] =>
  statuses.map((s) => (s.id === id ? { ...s, category } : s));

/** Can this column be removed at all (not the last Finished one, not below two columns)? */
export function removeProblem(statuses: Status[], id: string): string | null {
  if (statuses.length <= 2) return 'A project needs at least two columns.';
  const rest = statuses.filter((s) => s.id !== id);
  if (!rest.some((s) => s.category === 'done')) return 'At least one column must count as Finished.';
  return null;
}

/** Sensible categories for a list of column names: first = not started, last = finished, the rest in progress. */
export function statusesFromNames(names: string[], keepIds: Pick<Status, 'id' | 'name'>[] = []): Status[] {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  const out: Status[] = [];
  clean.forEach((name, i) => {
    const category: StatusCategory = i === 0 ? 'todo' : i === clean.length - 1 ? 'done' : 'in_progress';
    const known = keepIds.find((k) => k.name.trim().toLowerCase() === name.toLowerCase() && !out.some((o) => o.id === k.id));
    out.push({ id: known?.id ?? newStatusId(name, out), name, category });
  });
  return out;
}

/** Whole-set check used when a project is created with its own columns. */
export function columnsProblem(statuses: Pick<Status, 'name' | 'category'>[]): string | null {
  if (statuses.length < 2) return 'A project needs at least two columns.';
  if (statuses.length > MAX_COLUMNS) return `A project can have at most ${MAX_COLUMNS} columns.`;
  const names = new Set<string>();
  for (const s of statuses) {
    const n = s.name.trim().toLowerCase();
    if (!n) return 'Every column needs a name.';
    if (s.name.trim().length > MAX_COLUMN_NAME) return `Column names must be under ${MAX_COLUMN_NAME} characters.`;
    if (names.has(n)) return `There is already a column called “${s.name.trim()}”.`;
    names.add(n);
  }
  if (!statuses.some((s) => s.category === 'done')) return 'At least one column must count as Finished.';
  return null;
}
