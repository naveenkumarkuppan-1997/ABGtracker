import { describe, expect, it } from 'vitest';
import { addColumn, categoryProblem, columnsProblem, moveColumn, nameProblem, newStatusId, removeProblem, renameColumn, setColumnCategory, statusesFromNames } from './columns';
import type { Status } from './types';

const base: Status[] = [
  { id: 'todo', name: 'To Do', category: 'todo' },
  { id: 'doing', name: 'Doing', category: 'in_progress' },
  { id: 'done', name: 'Done', category: 'done' },
];

describe('column helpers', () => {
  it('adds new columns before Finished so Done stays last, with unique ids', () => {
    const a = addColumn(base, 'Testing');
    expect(a.map((s) => s.name)).toEqual(['To Do', 'Doing', 'Testing', 'Done']);
    expect(a[2].category).toBe('in_progress');
    const b = addColumn(a, 'Testing 2');
    expect(new Set(b.map((s) => s.id)).size).toBe(5);
    expect(newStatusId('Doing', base)).toBe('doing_2');
    expect(newStatusId('???', [])).toBe('column');
    expect(addColumn([{ id: 'x', name: 'X', category: 'todo' }], 'Y').map((s) => s.name)).toEqual(['X', 'Y']); // no Done column: append
  });

  it('validates names (empty, duplicate ignoring case, too long) and allows keeping a column’s own name', () => {
    expect(nameProblem(base, '  ')).toMatch(/name/);
    expect(nameProblem(base, 'doing')).toMatch(/already/);
    expect(nameProblem(base, 'doing', 'doing')).toBeNull();
    expect(nameProblem(base, 'x'.repeat(41))).toMatch(/under/);
    expect(nameProblem(base, 'Review')).toBeNull();
  });

  it('renames and moves without mutating the input', () => {
    expect(renameColumn(base, 'doing', ' In flight ').map((s) => s.name)).toEqual(['To Do', 'In flight', 'Done']);
    expect(base[1].name).toBe('Doing');
    expect(moveColumn(base, 'doing', -1).map((s) => s.id)).toEqual(['doing', 'todo', 'done']);
    expect(moveColumn(base, 'todo', -1)).toBe(base); // already first: nothing to do
    expect(moveColumn(base, 'done', 1)).toBe(base);
  });

  it('protects the Finished column and the minimum size', () => {
    expect(categoryProblem(base, 'done', 'in_progress')).toMatch(/Finished/);
    expect(categoryProblem(base, 'doing', 'done')).toBeNull();
    expect(setColumnCategory(base, 'doing', 'done')[1].category).toBe('done');
    expect(removeProblem(base, 'done')).toMatch(/Finished/);
    expect(removeProblem(base, 'doing')).toBeNull();
    expect(removeProblem(base.slice(0, 2), 'todo')).toMatch(/two/);
  });

  it('turns a list of names into sensible columns, keeping known ids', () => {
    const s = statusesFromNames(['Backlog', ' Build ', 'Test', 'Shipped']);
    expect(s.map((x) => x.category)).toEqual(['todo', 'in_progress', 'in_progress', 'done']);
    expect(s[1].name).toBe('Build');
    const kept = statusesFromNames(['To Do', 'Doing', 'Done'], base);
    expect(kept.map((x) => x.id)).toEqual(['todo', 'doing', 'done']);
    expect(statusesFromNames(['A', 'A']).map((x) => x.id)).toEqual(['a', 'a_2']);
  });

  it('checks a whole set of columns', () => {
    expect(columnsProblem(base)).toBeNull();
    expect(columnsProblem(base.slice(0, 1))).toMatch(/two/);
    expect(columnsProblem(Array.from({ length: 13 }, (_, i) => ({ name: `C${i}`, category: i === 12 ? ('done' as const) : ('todo' as const) })))).toMatch(/at most 12/);
    expect(columnsProblem([{ name: 'A', category: 'todo' }, { name: 'A', category: 'done' }])).toMatch(/already/);
  });
});
