// Delivery forecast: a Monte Carlo simulation over the team's own throughput history.
// Instead of one date, it answers "how likely are we to finish by X?" and gives P50/P85/P95 dates.

export function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const MAX_DAYS = 3650;

/** Days needed to burn `remaining` units when each week delivers a random sample of `weekly`. */
export function simulateDays(weekly: number[], remaining: number, trials: number, rng: () => number): number[] {
  const out: number[] = [];
  const usable = weekly.length > 0 && weekly.some((w) => w > 0);
  for (let t = 0; t < trials; t++) {
    if (remaining <= 0) {
      out.push(0);
      continue;
    }
    if (!usable) {
      out.push(Infinity);
      continue;
    }
    let left = remaining;
    let days = 0;
    while (left > 0 && days < MAX_DAYS) {
      const s = weekly[Math.floor(rng() * weekly.length)];
      if (s <= 0) {
        days += 7;
      } else if (left <= s) {
        days += 7 * (left / s); // partial week
        left = 0;
      } else {
        left -= s;
        days += 7;
      }
    }
    out.push(left > 0 ? Infinity : days);
  }
  return out;
}

const percentile = (sorted: number[], p: number) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.ceil(p * sorted.length) - 1))];

export interface Forecast {
  /** At least 3 of the sampled weeks delivered something. */
  enoughHistory: boolean;
  remaining: number;
  p50Days: number | null;
  p85Days: number | null;
  p95Days: number | null;
  /** Probability (0..1) of finishing within `days` from now. */
  within: (days: number) => number;
}

export function forecast(weekly: number[], remaining: number, opts: { trials?: number; seed?: number } = {}): Forecast {
  const trials = opts.trials ?? 2000;
  const seed = opts.seed ?? (weekly.reduce((s, w, i) => s + w * (i + 1), 0) * 31 + Math.round(remaining * 7) + 17);
  const days = simulateDays(weekly, remaining, trials, mulberry32(seed)).sort((a, b) => a - b);
  const enoughHistory = weekly.filter((w) => w > 0).length >= 3;
  const pick = (p: number) => {
    const v = percentile(days, p);
    return Number.isFinite(v) ? Math.ceil(v) : null;
  };
  return {
    enoughHistory,
    remaining,
    p50Days: pick(0.5),
    p85Days: pick(0.85),
    p95Days: pick(0.95),
    within: (d: number) => days.filter((x) => x <= d).length / days.length,
  };
}

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

export function confidenceOf(f: Forecast, daysAvailable: number): { level: Confidence; probability: number | null } {
  if (f.remaining <= 0) return { level: 'high', probability: 1 };
  if (!f.enoughHistory) return { level: 'unknown', probability: null };
  const p = f.within(Math.max(0, daysAvailable));
  return { level: p >= 0.8 ? 'high' : p >= 0.5 ? 'medium' : 'low', probability: p };
}
