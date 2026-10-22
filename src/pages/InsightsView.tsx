import { useMemo, type ReactNode } from 'react';
import { Info } from 'lucide-react';
import { CONFIDENCE_STYLE, containerForecasts, projectForecast, sprintForecast, type ForecastRow } from '@/domain/insights';
import { burndown, cycleTime, statusBreakdown, weekBuckets, weeklyCreated, weeklyResolved, workload } from '@/domain/reports';
import { formatDate } from '@/domain/selectors';
import { velocity } from '@/domain/sprints';
import { Badge, EmptyState } from '@/components/ui';
import { BarChart, HBars, Legend, LineChart, SERIES } from '@/components/charts';
import { useProjectCtx } from './ProjectPage';

function Card({ title, hint, children, className }: { title: string; hint?: string; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-line bg-surface p-4 ${className ?? ''}`}>
      <h2 className="text-sm font-semibold">{title}</h2>
      {hint && <p className="mb-3 text-xs text-muted">{hint}</p>}
      {!hint && <div className="mb-3" />}
      {children}
    </section>
  );
}

function ForecastLine({ row }: { row: ForecastRow }) {
  const style = CONFIDENCE_STYLE[row.level];
  const pct = row.probability === null ? null : Math.round(row.probability * 100);
  return (
    <li className="space-y-1.5 rounded-lg border border-line p-3">
      <div className="flex flex-wrap items-center gap-2">
        {row.key && <span className="text-xs text-muted">{row.key}</span>}
        <span className="min-w-0 flex-1 truncate text-sm font-medium">{row.title}</span>
        <Badge color={style.color}>{style.label}</Badge>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted">
        <span>
          {row.remaining} {row.unit} left
        </span>
        {row.dueDate && <span>target {formatDate(row.dueDate)}</span>}
        {pct !== null && (
          <span>
            <b className="text-fg">{pct}%</b> chance to make it
          </span>
        )}
        {row.p50Date && (
          <span>
            likely <b className="text-fg">{formatDate(row.p50Date)}</b>
            {row.p85Date && <> · safe bet {formatDate(row.p85Date)}</>}
          </span>
        )}
      </div>
      {pct !== null && (
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-2" role="img" aria-label={`${pct}% chance`}>
          <div className="h-full rounded-full" style={{ width: `${pct}%`, background: style.color }} />
        </div>
      )}
      {row.note && <p className="text-xs text-muted">{row.note}</p>}
    </li>
  );
}

export function InsightsView() {
  const { project, allIssues, sprints, members } = useProjectCtx();
  const now = useMemo(() => new Date(), []);
  const activeSprint = project.workStyle === 'agile' ? sprints.find((s) => s.state === 'active') : undefined;

  const buckets = weekBuckets(now, 8);
  const labels = buckets.map((b) => b.label);
  const resolved = weeklyResolved(project, allIssues, now, 8);
  const created = weeklyCreated(project, allIssues, now, 8);
  const cycle = cycleTime(project, allIssues);
  const load = workload(project, allIssues, members, now);
  const statuses = statusBreakdown(project, allIssues);
  const vel = velocity(sprints, 6);
  const bd = activeSprint ? burndown(project, activeSprint, allIssues, now) : null;

  const forecasts: ForecastRow[] = [
    ...(activeSprint ? [sprintForecast(project, activeSprint, allIssues, now)] : []),
    ...containerForecasts(project, allIssues, now),
    projectForecast(project, allIssues, now),
  ];

  if (allIssues.length === 0) return <EmptyState title="No data yet" body="Create and finish some issues to see insights." />;

  return (
    <div className="mx-auto grid max-w-6xl gap-4 p-4 lg:grid-cols-2">
      <Card
        title="Delivery forecast"
        hint="Simulates 2,000 futures from your team's last 8 weeks of finished work. “Likely” is the median; “safe bet” is the date reached in 85% of simulations."
        className="lg:col-span-2"
      >
        <ul className="grid gap-2 md:grid-cols-2">
          {forecasts.map((f) => (
            <ForecastLine key={f.id} row={f} />
          ))}
        </ul>
        <p className="mt-3 inline-flex items-center gap-1.5 text-xs text-muted">
          <Info size={12} /> Forecasts are estimates based on past pace. They don't know about holidays, scope changes or new blockers.
        </p>
      </Card>

      {bd && activeSprint && (
        <Card title={`Burndown · ${activeSprint.name}`} hint={`${bd.total} points in scope. The dashed line is the ideal pace.`}>
          <LineChart
            ariaLabel="Sprint burndown"
            labels={bd.points.map((p) => p.date)}
            series={[
              { name: 'Ideal', color: '#7b8794', dashed: true, values: bd.points.map((p) => p.ideal) },
              { name: 'Remaining', color: SERIES[0], values: bd.points.map((p) => p.actual) },
            ]}
          />
          <Legend items={[{ name: 'Ideal', color: '#7b8794' }, { name: 'Remaining points', color: SERIES[0] }]} />
        </Card>
      )}

      {project.workStyle === 'agile' && (
        <Card title="Velocity" hint={vel.sprints.length ? `Average ${vel.average} points over the last ${vel.sprints.length} completed sprint${vel.sprints.length > 1 ? 's' : ''}.` : 'Complete a sprint to see velocity.'}>
          {vel.sprints.length > 0 ? (
            <>
              <BarChart
                ariaLabel="Velocity by sprint"
                labels={[...vel.sprints].reverse().map((s) => s.name.replace('Sprint ', 'S'))}
                series={[
                  { name: 'Committed', color: '#7b8794', values: [...vel.sprints].reverse().map((s) => s.committedPoints ?? 0) },
                  { name: 'Completed', color: SERIES[2], values: [...vel.sprints].reverse().map((s) => s.completedPoints ?? 0) },
                ]}
              />
              <Legend items={[{ name: 'Committed', color: '#7b8794' }, { name: 'Completed', color: SERIES[2] }]} />
            </>
          ) : (
            <p className="text-sm text-muted">No completed sprints yet.</p>
          )}
        </Card>
      )}

      <Card title="Throughput" hint="Work items finished per week (current week is the last bar).">
        <BarChart ariaLabel="Items finished per week" labels={labels} series={[{ name: 'Finished', color: SERIES[2], values: resolved }]} />
      </Card>

      <Card title="Created vs finished" hint="If the blue bars stay taller, the backlog is growing.">
        <BarChart
          ariaLabel="Created versus finished per week"
          labels={labels}
          series={[
            { name: 'Created', color: SERIES[0], values: created },
            { name: 'Finished', color: SERIES[2], values: resolved },
          ]}
        />
        <Legend items={[{ name: 'Created', color: SERIES[0] }, { name: 'Finished', color: SERIES[2] }]} />
      </Card>

      <Card title="Cycle time" hint="Days from creation to finish, across finished work items.">
        {cycle.count ? (
          <dl className="grid grid-cols-3 gap-3 text-center">
            {[
              ['Items', String(cycle.count)],
              ['Median', `${cycle.median} d`],
              ['85th percentile', `${cycle.p85} d`],
            ].map(([k, v]) => (
              <div key={k} className="rounded-lg bg-surface-2 p-3">
                <dt className="text-xs text-muted">{k}</dt>
                <dd className="text-xl font-semibold">{v}</dd>
              </div>
            ))}
          </dl>
        ) : (
          <p className="text-sm text-muted">Nothing finished yet.</p>
        )}
        <p className="mt-2 text-xs text-muted">Use the 85th percentile when you promise dates: 85% of items finish within it.</p>
      </Card>

      <Card title="Workload" hint="Open work per person (points when estimated).">
        {load.length ? (
          <HBars rows={load.map((r) => ({ label: r.name, value: r.openPoints || r.openIssues, extra: `${r.openIssues} issues${r.overdue ? `, ${r.overdue} late` : ''}` }))} suffix={load.some((r) => r.openPoints) ? ' pts' : ''} color={SERIES[1]} />
        ) : (
          <p className="text-sm text-muted">No open work.</p>
        )}
      </Card>

      <Card title="Where work sits" hint="Work items per status.">
        <HBars rows={statuses.map((s) => ({ label: s.name, value: s.count }))} color={SERIES[3]} />
      </Card>
    </div>
  );
}
