/** Time zone helpers (IANA names such as "Asia/Kolkata"). Anything unknown or missing counts as UTC. */

export const isValidTimeZone = (tz: unknown): tz is string => {
  if (typeof tz !== 'string' || tz.length === 0 || tz.length > 64) return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz });
    return true;
  } catch {
    return false;
  }
};

const parts = (at: Date, tz: string | undefined) => {
  const zone = isValidTimeZone(tz) ? tz : 'UTC';
  const out: Record<string, string> = {};
  for (const p of new Intl.DateTimeFormat('en-US', { timeZone: zone, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit' }).formatToParts(at)) out[p.type] = p.value;
  return out;
};

/** The calendar date ("YYYY-MM-DD") it is right now for someone in `tz`. */
export function localDate(at: Date, tz?: string): string {
  const p = parts(at, tz);
  return `${p.year}-${p.month}-${p.day}`;
}

/** The hour of day (0-23) it is right now for someone in `tz`. */
export function localHour(at: Date, tz?: string): number {
  return Number(parts(at, tz).hour) % 24;
}

/** The date after a "YYYY-MM-DD" date. */
export const nextDay = (date: string): string => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000).toISOString().slice(0, 10);

/** The zone this browser is in, if it will say. */
export function browserTimeZone(): string | undefined {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return isValidTimeZone(tz) ? tz : undefined;
  } catch {
    return undefined;
  }
}

/** Every zone the browser knows, for a picker (falls back to just the given ones). */
export function allTimeZones(include: (string | undefined)[] = []): string[] {
  let list: string[] = [];
  try {
    list = (Intl as unknown as { supportedValuesOf?: (k: string) => string[] }).supportedValuesOf?.('timeZone') ?? [];
  } catch {
    /* older browsers */
  }
  return [...new Set(['UTC', ...list, ...include.filter(isValidTimeZone)])].sort();
}
