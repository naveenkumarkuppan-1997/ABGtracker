import { describe, expect, it } from 'vitest';
import { addType, isMilestoneType, needsApproval, newTypeId, removeTypeProblem, typeProblem, typesProblem } from './issueTypes';
import type { IssueType } from './types';

const base: IssueType[] = [
  { id: 'task', name: 'Task', icon: 'check', color: '#3b82f6', level: 1 },
  { id: 'bug', name: 'Bug', icon: 'bug', color: '#dc4b4b', level: 1 },
  { id: 'subtask', name: 'Sub-task', icon: 'branch', color: '#64748b', level: 2 },
];

describe('issue type helpers', () => {
  it('adds a new type before the sub-task types, with a unique id', () => {
    const a = addType(base, { name: ' Customer request ', icon: 'phone', color: '#0f766e', level: 1 });
    expect(a.map((t) => t.name)).toEqual(['Task', 'Bug', 'Customer request', 'Sub-task']);
    expect(a[2]).toMatchObject({ id: 'customer_request', icon: 'phone' });
    const b = addType(a, { name: 'Customer request 2', icon: 'phone', color: '#0f766e', level: 1 });
    expect(new Set(b.map((t) => t.id)).size).toBe(5);
    expect(newTypeId('Bug', base)).toBe('bug_2');
    const sub = addType(base, { name: 'Checklist item', icon: 'check', color: '#64748b', level: 2 });
    expect(sub[sub.length - 1].name).toBe('Checklist item'); // sub-task kinds stay last
    expect(addType(base, { name: 'Gate', icon: 'shield', color: '#0f8b8d', level: 1, kind: 'approval' }).find((t) => t.name === 'Gate')?.kind).toBe('approval');
  });

  it('validates names, icons and colours', () => {
    const ok = { name: 'Idea', icon: 'lightbulb', color: '#f28c28', level: 1 as const };
    expect(typeProblem(base, ok)).toBeNull();
    expect(typeProblem(base, { ...ok, name: '  ' })).toMatch(/name/);
    expect(typeProblem(base, { ...ok, name: 'bug' })).toMatch(/already/);
    expect(typeProblem(base, { ...ok, name: 'bug' }, 'bug')).toBeNull(); // may keep its own name
    expect(typeProblem(base, { ...ok, name: 'x'.repeat(31) })).toMatch(/under/);
    expect(typeProblem(base, { ...ok, icon: 'not-an-icon' })).toMatch(/icon/);
    expect(typeProblem(base, { ...ok, color: 'red' })).toMatch(/colour/);
  });

  it('keeps at least one work-item type, and finds special behaviours by flag or legacy id', () => {
    expect(typesProblem(base)).toBeNull();
    expect(typesProblem(base.filter((t) => t.level !== 1))).toMatch(/work-item/);
    expect(removeTypeProblem(base, 'bug')).toBeNull();
    expect(removeTypeProblem([base[0], base[2]], 'task')).toMatch(/work-item/);
    expect(removeTypeProblem(base, 'subtask')).toBeNull();
    expect(isMilestoneType({ id: 'x', kind: 'milestone' })).toBe(true);
    expect(isMilestoneType({ id: 'milestone' })).toBe(true); // projects created before types had flags
    expect(isMilestoneType({ id: 'task' })).toBe(false);
    expect(needsApproval({ id: 'sign_off', kind: 'approval' })).toBe(true);
    expect(needsApproval(undefined)).toBe(false);
  });
});
