// Small dependency-free SVG charts. Colors come from CSS tokens so they follow light/dark mode.

const AXIS = 'var(--muted)';
const GRID = 'var(--line)';

export const SERIES = ['#0f766e', '#f28c28', '#64748b', '#2f9e6b'];

function niceMax(v: number): number {
  if (v <= 4) return 4;
  const pow = Math.pow(10, Math.floor(Math.log10(v)));
  const n = v / pow;
  return (n <= 1 ? 1 : n <= 2 ? 2 : n <= 5 ? 5 : 10) * pow;
}

export interface BarSeries {
  name: string;
  color: string;
  values: number[];
}

/** Grouped vertical bars. */
export function BarChart({ labels, series, height = 180, ariaLabel }: { labels: string[]; series: BarSeries[]; height?: number; ariaLabel: string }) {
  const W = Math.max(320, labels.length * (series.length * 14 + 18) + 40);
  const H = height;
  const pad = { l: 30, r: 8, t: 8, b: 22 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values)));
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const group = innerW / Math.max(1, labels.length);
  const bw = Math.min(22, (group - 8) / series.length);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const ticks = [0, max / 2, max];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full" style={{ maxHeight: H }}>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} strokeWidth={1} />
          <text x={pad.l - 5} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS}>
            {Math.round(t * 10) / 10}
          </text>
        </g>
      ))}
      {labels.map((l, i) => (
        <g key={l + i}>
          {series.map((s, si) => {
            const v = s.values[i] ?? 0;
            const x = pad.l + i * group + (group - bw * series.length) / 2 + si * bw;
            return (
              <rect key={s.name} x={x} y={y(v)} width={bw - 1.5} height={Math.max(0, pad.t + innerH - y(v))} rx={2} fill={s.color}>
                <title>{`${l} · ${s.name}: ${v}`}</title>
              </rect>
            );
          })}
          <text x={pad.l + i * group + group / 2} y={H - 7} textAnchor="middle" fontSize={9} fill={AXIS}>
            {l}
          </text>
        </g>
      ))}
    </svg>
  );
}

export interface LineSeries {
  name: string;
  color: string;
  /** null = no data point (e.g. the future) */
  values: (number | null)[];
  dashed?: boolean;
}

export function LineChart({ labels, series, height = 200, ariaLabel }: { labels: string[]; series: LineSeries[]; height?: number; ariaLabel: string }) {
  const W = 640;
  const H = height;
  const pad = { l: 30, r: 10, t: 10, b: 22 };
  const max = niceMax(Math.max(1, ...series.flatMap((s) => s.values.filter((v): v is number => v !== null))));
  const innerW = W - pad.l - pad.r;
  const innerH = H - pad.t - pad.b;
  const x = (i: number) => pad.l + (labels.length <= 1 ? 0 : (i / (labels.length - 1)) * innerW);
  const y = (v: number) => pad.t + innerH - (v / max) * innerH;
  const every = Math.max(1, Math.ceil(labels.length / 8));

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={ariaLabel} className="w-full" style={{ maxHeight: H }}>
      {[0, max / 2, max].map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke={GRID} />
          <text x={pad.l - 5} y={y(t) + 3} textAnchor="end" fontSize={9} fill={AXIS}>
            {Math.round(t * 10) / 10}
          </text>
        </g>
      ))}
      {labels.map((l, i) =>
        i % every === 0 ? (
          <text key={l + i} x={x(i)} y={H - 7} textAnchor="middle" fontSize={9} fill={AXIS}>
            {l.slice(5)}
          </text>
        ) : null
      )}
      {series.map((s) => {
        const pts = s.values.map((v, i) => (v === null ? null : `${x(i)},${y(v)}`)).filter(Boolean);
        return (
          <g key={s.name}>
            <polyline points={pts.join(' ')} fill="none" stroke={s.color} strokeWidth={2} strokeDasharray={s.dashed ? '5 4' : undefined} strokeLinejoin="round" />
            {s.values.map((v, i) =>
              v === null ? null : (
                <circle key={i} cx={x(i)} cy={y(v)} r={2.5} fill={s.color}>
                  <title>{`${labels[i]} · ${s.name}: ${v}`}</title>
                </circle>
              )
            )}
          </g>
        );
      })}
    </svg>
  );
}

export function Legend({ items }: { items: { name: string; color: string }[] }) {
  return (
    <div className="flex flex-wrap gap-3 text-xs text-muted">
      {items.map((i) => (
        <span key={i.name} className="inline-flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm" style={{ background: i.color }} />
          {i.name}
        </span>
      ))}
    </div>
  );
}

/** Horizontal bars with a label and value per row. */
export function HBars({ rows, color = SERIES[0], suffix = '' }: { rows: { label: string; value: number; extra?: string }[]; color?: string; suffix?: string }) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li key={r.label} className="flex items-center gap-2 text-sm">
          <span className="w-28 shrink-0 truncate text-xs">{r.label}</span>
          <div className="h-3 flex-1 overflow-hidden rounded bg-surface-2" role="img" aria-label={`${r.label}: ${r.value}${suffix}`}>
            <div className="h-full rounded" style={{ width: `${(r.value / max) * 100}%`, background: color }} />
          </div>
          <span className="w-24 shrink-0 text-right text-xs text-muted">
            {r.value}
            {suffix}
            {r.extra ? ` · ${r.extra}` : ''}
          </span>
        </li>
      ))}
    </ul>
  );
}
