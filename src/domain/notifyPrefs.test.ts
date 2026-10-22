import { describe, expect, it } from 'vitest';
import type { NotifyPrefs } from './types';
import { DEFAULT_NOTIFY_PREFS, resolvePrefs, validatePrefs, wantsEmail } from './notifyPrefs';

describe('email preferences', () => {
  it('defaults to a prompt email about what needs the person', () => {
    expect(resolvePrefs(undefined)).toEqual({ ...DEFAULT_NOTIFY_PREFS, mutedProjects: [] });
    expect(resolvePrefs({})).toEqual({ email: 'instant', scope: 'important', mutedProjects: [] });
    expect(wantsEmail(DEFAULT_NOTIFY_PREFS, 'assigned')).toBe(true);
    expect(wantsEmail(DEFAULT_NOTIFY_PREFS, 'mention')).toBe(true);
    expect(wantsEmail(DEFAULT_NOTIFY_PREFS, 'comment')).toBe(false);
  });

  it('repairs damaged stored values instead of failing', () => {
    expect(resolvePrefs({ notify: { email: 'weekly', scope: 'all' } as never })).toEqual({ email: 'instant', scope: 'all', mutedProjects: [] });
  });

  it('honours off and everything', () => {
    expect(wantsEmail({ email: 'off', scope: 'all' }, 'mention')).toBe(false);
    expect(wantsEmail({ email: 'daily', scope: 'all' }, 'status')).toBe(true);
  });

  it('accepts only the offered choices', () => {
    expect(validatePrefs({ email: 'daily', scope: 'all', extra: 'ignored' })).toEqual({ email: 'daily', scope: 'all', mutedProjects: [] });
    for (const bad of [null, undefined, {}, { email: 'daily' }, { email: 'x', scope: 'all' }, 'instant']) expect(() => validatePrefs(bad)).toThrow(/offered/);
  });

  it('mutes whole projects, and ignores junk in the list', () => {
    const prefs: NotifyPrefs = { email: 'instant', scope: 'all', mutedProjects: ['p1'] };
    expect(wantsEmail(prefs, 'mention', 'p1')).toBe(false);
    expect(wantsEmail(prefs, 'mention', 'p2')).toBe(true);
    expect(validatePrefs({ email: 'daily', scope: 'all', mutedProjects: ['a', 'a', 5, '', 'b'] }).mutedProjects).toEqual(['a', 'b']);
    expect(() => validatePrefs({ email: 'daily', scope: 'all', mutedProjects: 'p1' })).toThrow();
    expect(() => validatePrefs({ email: 'daily', scope: 'all', mutedProjects: Array(201).fill('x') })).toThrow();
  });
});