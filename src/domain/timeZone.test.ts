import { describe, expect, it } from 'vitest';
import { allTimeZones, isValidTimeZone, localDate, localHour, nextDay } from './timeZone';
import { validatePrefs, resolvePrefs } from './notifyPrefs';

describe('time zones', () => {
  const at = new Date('2026-10-11T20:00:00Z');

  it('tells the date and hour for a person, wherever they are', () => {
    expect(localDate(at, 'UTC')).toBe('2026-10-11');
    expect(localHour(at, 'UTC')).toBe(20);
    expect(localDate(at, 'Asia/Kolkata')).toBe('2026-10-12'); // already tomorrow there
    expect(localHour(at, 'Asia/Kolkata')).toBe(1);
    expect(localDate(at, 'America/Los_Angeles')).toBe('2026-10-11');
    expect(localHour(at, 'America/Los_Angeles')).toBe(13);
    expect(localHour(new Date('2026-10-11T00:30:00Z'), 'UTC')).toBe(0); // midnight is 0, never 24
  });

  it('treats missing or unknown zones as UTC', () => {
    expect(localDate(at)).toBe('2026-10-11');
    expect(localHour(at, 'Mars/Olympus')).toBe(20);
  });

  it('validates zone names', () => {
    expect(isValidTimeZone('Europe/London')).toBe(true);
    for (const bad of ['', 'Nowhere/Land', 5, null, undefined, 'x'.repeat(100)]) expect(isValidTimeZone(bad)).toBe(false);
    expect(allTimeZones(['Asia/Tokyo', 'bogus'])).toContain('Asia/Tokyo');
    expect(allTimeZones()).toContain('UTC');
  });

  it('steps over month and year ends', () => {
    expect(nextDay('2026-10-31')).toBe('2026-11-01');
    expect(nextDay('2026-12-31')).toBe('2027-01-01');
    expect(nextDay('2028-02-28')).toBe('2028-02-29');
  });

  it('keeps a valid zone in saved choices and rejects a bad one', () => {
    expect(validatePrefs({ email: 'daily', scope: 'all', timeZone: 'Asia/Kolkata' }).timeZone).toBe('Asia/Kolkata');
    expect(validatePrefs({ email: 'daily', scope: 'all' }).timeZone).toBeUndefined();
    expect(() => validatePrefs({ email: 'daily', scope: 'all', timeZone: 'Nowhere/Land' })).toThrow(/time zone/);
    expect(resolvePrefs({ notify: { email: 'daily', scope: 'all', timeZone: 'junk' } }).timeZone).toBeUndefined();
  });
});
