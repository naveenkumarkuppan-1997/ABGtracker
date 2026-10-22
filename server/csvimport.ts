import type { NewIssue, Priority, Project } from '../src/domain/types';

export const MAX_IMPORT_ROWS = 500;
export const MAX_IMPORT_BYTES = 2 * 1024 * 1024;

/** RFC 4180 CSV: quoted cells, doubled quotes, commas and line breaks inside quotes. Tolerates a leading byte-order mark and ; as separator. */
export function parseCsv(text: string): string[][] {
  const src = text.replace(/^﻿/, '');
  const first = src.split(/\r?\n/, 1)[0] ?? '';
  const sep = (first.match(/;/g)?.length ?? 0) > (first.match(/,/g)?.length ?? 0) ? ';' : ',';
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let quoted = false;
  for (let i = 0; i < src.length; i++) {
    const ch = src[i];
    if (quoted) {
      if (ch === '"') {
        if (src[i + 1] === '"') {
          cell += '"';
          i++;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"' && cell === '') quoted = true;
    else if (ch === sep) {
      row.push(cell);
      cell = '';
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++;
      row.push(cell);
      cell = '';
      if (row.some((c) => c.trim() !== '')) rows.push(row);
      row = [];
    } else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim() !== '')) rows.push(row);
  return rows;
}

const norm = (s: string) => s.trim().toLowerCase();
const HEADER_ALIASES: Record<string, string> = {
  title: 'title', summary: 'title', name: 'title', 'issue summary': 'title',
  description: 'description', details: 'description',
  type: 'type', 'issue type': 'type',
  priority: 'priority',
  status: 'status',
  assignee: 'assignee', 'assigned to': 'assignee',
  labels: 'labels', label: 'labels', tags: 'labels',
  estimate: 'estimate', points: 'estimate', 'story points': 'estimate',
  start: 'start', 'start date': 'start',
  due: 'due', 'due date': 'due',
};

const isDate = (s: string) => /^\d{4}-\d{2}-\d{2}$/.test(s) && !Number.isNaN(Date.parse(s));

export interface ImportResult {
  created: number;
  skipped: { row: number; reason: string }[];
}

/** Turns CSV text into issues for one project. People are matched by email (or exact name); unknown types, statuses and priorities fall back to the project's defaults. */
export function planImport(text: string, project: Project, memberIds: { id: string; email: string; name: string }[]): { items: { row: number; input: NewIssue }[]; skipped: ImportResult['skipped'] } {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error('The file needs a header row (Title, Description, Priority, …) and at least one item.');
  if (rows.length - 1 > MAX_IMPORT_ROWS) throw new Error(`Import up to ${MAX_IMPORT_ROWS} items at a time (this file has ${rows.length - 1}).`);
  const cols = rows[0].map((h) => HEADER_ALIASES[norm(h)]);
  if (!cols.includes('title')) throw new Error('The first row must have a "Title" column.');

  const workType = project.issueTypes.find((t) => t.level === 1) ?? project.issueTypes[0];
  const items: { row: number; input: NewIssue }[] = [];
  const skipped: ImportResult['skipped'] = [];
  rows.slice(1).forEach((cells, idx) => {
    const row = idx + 2; // as numbered in a spreadsheet
    const get = (k: string) => (cells[cols.indexOf(k)] ?? '').trim();
    const title = get('title');
    if (!title) return void skipped.push({ row, reason: 'No title.' });
    if (title.length > 300) return void skipped.push({ row, reason: 'Title is longer than 300 characters.' });
    const priority = (['critical', 'high', 'medium', 'low'] as Priority[]).find((p) => p === norm(get('priority')));
    const person = norm(get('assignee'));
    const assignee = person ? memberIds.find((m) => m.email.toLowerCase() === person || m.name.toLowerCase() === person) : undefined;
    const estimate = get('estimate') === '' ? undefined : Number(get('estimate'));
    const start = get('start');
    const due = get('due');
    if (estimate !== undefined && (!Number.isFinite(estimate) || estimate < 0)) return void skipped.push({ row, reason: 'Estimate must be a number.' });
    if ((start && !isDate(start)) || (due && !isDate(due))) return void skipped.push({ row, reason: 'Dates must look like 2026-12-31.' });
    items.push({
      row,
      input: {
        projectId: project.id,
        typeId: project.issueTypes.find((t) => norm(t.name) === norm(get('type')))?.id ?? workType.id,
        title,
        description: get('description').slice(0, 20000),
        statusId: project.statuses.find((s) => norm(s.name) === norm(get('status')))?.id,
        priority,
        assigneeId: assignee?.id,
        labels: get('labels') ? get('labels').split(/[;,]/).map((l) => l.trim()).filter(Boolean).slice(0, 20) : [],
        estimate,
        startDate: start || undefined,
        dueDate: due || undefined,
      } as NewIssue,
    });
  });
  return { items, skipped };
}
