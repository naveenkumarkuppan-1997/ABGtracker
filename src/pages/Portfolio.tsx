import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { Flag } from 'lucide-react';
import { useApp } from '@/store/app';
import { HEALTH_STYLE, orgWorkload, projectHealth, type Health, type ProjectHealth } from '@/domain/portfolio';
import { TEMPLATES } from '@/domain/templates';
import { formatDate } from '@/domain/selectors';
import { Avatar, Badge, cn, EmptyState } from '@/components/ui';
import { HBars, SERIES } from '@/components/charts';

function Spark({ values }: { values: number[] }) {
  const max = Math.max(1, ...values);
  const w = 56;
  const h = 18;
  const bw = w / values.length;
  return (
    <svg width={w} height={h} role="img" aria-label={`Finished per week: ${values.join(', ')}`}>
      {values.map((v, i) => (
        <rect key={i} x={i * bw + 0.5} y={h - (v / max) * h} width={bw - 1.5} height={(v / max) * h} rx={1} fill={SERIES[2]} opacity={i === values.length - 1 ? 0.55 : 1} />
      ))}
    </svg>
  );
}

export function Portfolio() {
  const data = useApp((s) => s.data)!;
  const [filter, setFilter] = useState<Health | 'all'>('all');
  const now = useMemo(() => new Date(), []);

  const rows: ProjectHealth[] = useMemo(() => data.projects.map((p) => projectHealth(p, data.issues, data.sprints, now)), [data, now]);
  const counts = (h: Health) => rows.filter((r) => r.health === h).length;
  const shown = rows.filter((r) => filter === 'all' || r.health === filter).sort((a, b) => ['red', 'amber', 'green', 'grey'].indexOf(a.health) - ['red', 'amber', 'green', 'grey'].indexOf(b.health));

  const milestones = rows
    .flatMap((r) => (r.nextMilestone ? [{ ...r.nextMilestone, row: r }] : []))
    .sort((a, b) => a.daysLeft - b.daysLeft);
  const people = orgWorkload(data.projects, data.issues, data.members, now);
  const totals = rows.reduce((t, r) => ({ open: t.open + r.open, overdue: t.overdue + r.overdue, blocked: t.blocked + r.blocked, done: t.done + r.done, total: t.total + r.total }), { open: 0, overdue: 0, blocked: 0, done: 0, total: 0 });

  if (data.projects.length === 0) return <EmptyState title="No projects yet" body="Create a project to see the portfolio." />;

  return (
    <div className="mx-auto max-w-6xl space-y-6 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Portfolio</h1>
        <p className="text-muted">
          {data.org.name} · {data.projects.length} projects · {totals.open} open items · {totals.done}/{totals.total} done
        </p>
      </header>

      <div className="flex flex-wrap gap-2" role="group" aria-label="Filter by health">
        {(['all', 'red', 'amber', 'green', 'grey'] as const).map((h) => {
          const label = h === 'all' ? 'All' : HEALTH_STYLE[h].label;
          const n = h === 'all' ? rows.length : counts(h);
          return (
            <button
              key={h}
              aria-pressed={filter === h}
              onClick={() => setFilter(h)}
              className={cn('inline-flex items-center gap-2 rounded-full border px-3 py-1 text-sm', filter === h ? 'border-accent bg-surface-2 font-medium' : 'border-line text-muted hover:bg-surface-2')}
            >
              {h !== 'all' && <span className="h-2.5 w-2.5 rounded-full" style={{ background: HEALTH_STYLE[h].color }} />}
              {label} <span className="text-xs">{n}</span>
            </button>
          );
        })}
      </div>

      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[820px] text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs text-muted">
            <tr>
              <th className="px-4 py-2 text-left font-medium">Project</th>
              <th className="px-3 py-2 text-left font-medium">Health</th>
              <th className="w-40 px-3 py-2 text-left font-medium">Progress</th>
              <th className="px-3 py-2 text-right font-medium">Open</th>
              <th className="px-3 py-2 text-right font-medium">Late</th>
              <th className="px-3 py-2 text-right font-medium">Blocked</th>
              <th className="px-3 py-2 text-left font-medium">Pace (8 wks)</th>
              <th className="px-3 py-2 text-left font-medium">Lead</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {shown.map((r) => {
              const lead = data.members.find((m) => m.id === r.project.leadId);
              const style = HEALTH_STYLE[r.health];
              return (
                <tr key={r.project.id} className="align-top hover:bg-surface-2">
                  <td className="px-4 py-3">
                    <Link to={`/${data.org.slug}/p/${r.project.key}/insights`} className="flex items-center gap-2 font-medium hover:underline">
                      <span className="h-3 w-3 rounded" style={{ background: r.project.color }} />
                      {r.project.name}
                    </Link>
                    <div className="mt-0.5 flex items-center gap-2 text-xs text-muted">
                      {r.project.key} · {TEMPLATES[r.project.workStyle].label}
                      {r.sprint && <> · {r.sprint.name}</>}
                    </div>
                  </td>
                  <td className="px-3 py-3">
                    <Badge color={style.color}>{style.label}</Badge>
                    {r.reasons.length > 0 && <ul className="mt-1 space-y-0.5 text-xs text-muted">{r.reasons.slice(0, 3).map((x) => <li key={x}>{x}</li>)}</ul>}
                  </td>
                  <td className="px-3 py-3">
                    <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${Math.round(r.progress * 100)}% done`}>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${r.progress * 100}%` }} />
                    </div>
                    <div className="mt-1 text-xs text-muted">
                      {r.done}/{r.total} done
                    </div>
                  </td>
                  <td className="px-3 py-3 text-right">{r.open}</td>
                  <td className={cn('px-3 py-3 text-right', r.overdue > 0 && 'font-medium text-danger')}>{r.overdue}</td>
                  <td className={cn('px-3 py-3 text-right', r.blocked > 0 && 'font-medium text-[#d9a21b]')}>{r.blocked}</td>
                  <td className="px-3 py-3">
                    <Spark values={r.weekly} />
                    {r.forecast.p50Date && r.open > 0 && <div className="mt-1 text-xs text-muted">clear by ~{formatDate(r.forecast.p50Date)}</div>}
                  </td>
                  <td className="px-3 py-3">
                    <span className="flex items-center gap-1.5 text-xs">
                      <Avatar user={lead} size={20} /> {lead?.name.split(' ')[0]}
                    </span>
                  </td>
                </tr>
              );
            })}
            {shown.length === 0 && (
              <tr>
                <td colSpan={8} className="px-4 py-8 text-center text-muted">
                  No projects with this health.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-3 text-sm font-semibold">Next milestones</h2>
          {milestones.length === 0 ? (
            <p className="text-sm text-muted">No upcoming milestones.</p>
          ) : (
            <ul className="space-y-2">
              {milestones.map((m) => (
                <li key={m.issue.id}>
                  <Link to={`/${data.org.slug}/p/${m.row.project.key}/timeline?issue=${m.issue.key}`} className="flex items-center gap-2 text-sm hover:underline">
                    <Flag size={14} className="text-accent-text" />
                    <span className="min-w-0 flex-1 truncate">{m.issue.title}</span>
                    <span className="text-xs text-muted">{m.row.project.key}</span>
                    <span className={cn('w-20 text-right text-xs', m.daysLeft < 0 ? 'text-danger' : 'text-muted')}>{m.daysLeft < 0 ? `${-m.daysLeft}d late` : m.daysLeft === 0 ? 'today' : `in ${m.daysLeft}d`}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
          {rows.some((r) => r.atRisk.length > 0) && (
            <>
              <h3 className="mb-2 mt-4 text-xs font-semibold uppercase tracking-wide text-muted">Epics & milestones at risk</h3>
              <ul className="space-y-1 text-sm">
                {rows.flatMap((r) => r.atRisk.map((a) => ({ a, r }))).map(({ a, r }) => (
                  <li key={a.id} className="flex items-center gap-2">
                    <Badge color={a.level === 'low' ? '#dc4b4b' : '#d9a21b'}>{a.probability !== null ? `${Math.round(a.probability * 100)}%` : '?'}</Badge>
                    <span className="min-w-0 flex-1 truncate">
                      {a.key} {a.title}
                    </span>
                    <span className="text-xs text-muted">{r.project.key}</span>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-1 text-sm font-semibold">People across projects</h2>
          <p className="mb-3 text-xs text-muted">Open work per person, all projects combined.</p>
          {people.length ? (
            <HBars
              rows={people.map((p) => ({ label: p.name, value: p.openPoints || p.openIssues, extra: `${p.openIssues} items · ${p.projects.join('/')}${p.overdue ? ` · ${p.overdue} late` : ''}` }))}
              suffix={people.some((p) => p.openPoints) ? ' pts' : ''}
              color={SERIES[1]}
            />
          ) : (
            <p className="text-sm text-muted">No open work assigned.</p>
          )}
        </section>
      </div>
    </div>
  );
}
