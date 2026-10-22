import { useMemo, useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowDown, ArrowUp, ChevronRight, LayoutDashboard, RotateCcw } from 'lucide-react';
import { computeDashboard, defaultLayout, normalizeLayout, validateLayout, WIDGETS, type DashboardData, type Row, type TileId } from '@/domain/dashboard';
import { projectHealth, HEALTH_STYLE } from '@/domain/portfolio';
import { formatDate, statusOf, timeAgo, typeOf } from '@/domain/selectors';
import { TEMPLATES } from '@/domain/templates';
import type { Activity, DashboardLayout, OrgData, Priority, WidgetId } from '@/domain/types';
import { BACKEND, useApp, useRole } from '@/store/app';
import { Badge, Button, cn, EmptyState, Select } from './ui';
import { BarChart, HBars, Legend, SERIES } from './charts';
import { BriefingCard } from './Briefing';
import { PriorityIcon, TypeIcon } from './icons';

// ---- remembering the arrangement ---------------------------------------------------------------------------------

const localKey = (userId: string) => `abg2:dashboard:${userId}`;
const readLocal = (userId: string): DashboardLayout | null => {
  try {
    return JSON.parse(localStorage.getItem(localKey(userId)) ?? 'null');
  } catch {
    return null;
  }
};

/** The signed-in person's layout (server-side on the real server, in this browser in the offline demo), repaired if needed. */
function useLayout() {
  const userId = useApp((s) => s.userId);
  const authUser = useApp((s) => s.authUser);
  const saveRemote = useApp((s) => s.saveDashboard);
  const notify = useApp((s) => s.notify);
  const role = useRole();
  const [local, setLocal] = useState<DashboardLayout | null>(() => readLocal(userId));
  const stored = BACKEND === 'api' ? authUser?.dashboard : local;
  const layout = useMemo(() => normalizeLayout(stored, role), [stored, role]);
  const custom = !!stored;

  const save = async (next: DashboardLayout | null): Promise<boolean> => {
    if (BACKEND === 'api') return saveRemote(next);
    try {
      if (next) {
        validateLayout(next);
        localStorage.setItem(localKey(userId), JSON.stringify(next));
      } else localStorage.removeItem(localKey(userId));
      setLocal(next);
      return true;
    } catch {
      notify('Could not save the dashboard in this browser.');
      return false;
    }
  };
  return { layout, custom, save, role };
}

// ---- building blocks ------------------------------------------------------------------------------------------------

function Card({ title, action, children, wide }: { title: string; action?: ReactNode; children: ReactNode; wide: boolean }) {
  return (
    <section aria-label={title} className={cn('min-w-0 rounded-xl border border-line bg-surface p-4 shadow-card', wide ? 'md:col-span-2' : '')}>
      <header className="mb-3 flex items-center justify-between gap-2">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      {children}
    </section>
  );
}

function Items({ rows, slug, empty, right, limit = 8 }: { rows: Row[]; slug: string; empty: string; right: (r: Row) => ReactNode; limit?: number }) {
  if (rows.length === 0) return <p className="text-sm text-muted">{empty}</p>;
  return (
    <>
      <ul className="divide-y divide-line">
        {rows.slice(0, limit).map((r) => (
          <li key={r.issue.id}>
            <Link to={`/${slug}/p/${r.project.key}/board?issue=${r.issue.key}`} className="flex items-center gap-2 py-1.5 text-sm hover:bg-surface-2">
              <TypeIcon type={typeOf(r.project, r.issue.typeId)} />
              <span className="w-14 shrink-0 text-xs text-muted">{r.issue.key}</span>
              <span className="min-w-0 flex-1 truncate">{r.issue.title}</span>
              {right(r)}
            </Link>
          </li>
        ))}
      </ul>
      {rows.length > limit && <p className="mt-1 text-xs text-muted">and {rows.length - limit} more</p>}
    </>
  );
}

const dueCell = (today: string) => (r: Row) => (
  <span className={cn('w-14 shrink-0 text-right text-xs', r.issue.dueDate && r.issue.dueDate < today ? 'font-medium text-danger' : 'text-muted')}>{formatDate(r.issue.dueDate)}</span>
);

const TILES: { id: TileId; label: string; tone?: 'bad' | 'good' }[] = [
  { id: 'open', label: 'Open work' },
  { id: 'overdue', label: 'Overdue', tone: 'bad' },
  { id: 'blocked', label: 'Blocked', tone: 'bad' },
  { id: 'doneThisWeek', label: 'Finished this week', tone: 'good' },
  { id: 'myOpen', label: 'Mine, open' },
  { id: 'myOverdue', label: 'Mine, overdue', tone: 'bad' },
];

function Tile({ label, value, tone, selected, onClick }: { label: string; value: number; tone?: 'bad' | 'good'; selected: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      disabled={value === 0}
      aria-pressed={selected}
      aria-label={`${label}: ${value}${value === 0 ? '' : ', show the items'}`}
      title={value === 0 ? 'Nothing to show' : 'Show the items'}
      onClick={onClick}
      className={cn(
        'rounded-lg border p-3 text-left transition',
        selected ? 'border-accent bg-accent/10 ring-1 ring-accent' : 'border-line bg-surface-2',
        value === 0 ? 'cursor-default opacity-70' : 'hover:border-accent'
      )}
    >
      <p className={cn('text-2xl font-semibold', tone === 'bad' && value > 0 && 'text-danger', tone === 'good' && 'text-[#2f9e6b]')}>{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </button>
  );
}

/** The six numbers, each a button: press one to see exactly the items it counted, right underneath. */
function Kpis({ title, wide, stats, data }: { title: string; wide: boolean; stats: DashboardData; data: OrgData }) {
  const [shown, setShown] = useState<TileId | null>(null);
  const tile = TILES.find((t) => t.id === shown);
  const rows = shown ? stats.tiles[shown] : [];
  return (
    <Card title={title} wide={wide}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-6">
        {TILES.map((t) => (
          <Tile key={t.id} label={t.label} tone={t.tone} value={stats.tiles[t.id].length} selected={shown === t.id} onClick={() => setShown((cur) => (cur === t.id ? null : t.id))} />
        ))}
      </div>
      {tile && (
        <div role="region" aria-label={`${tile.label}: the items`} className="mt-3 rounded-lg border border-line p-3">
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold">
              {tile.label} ({rows.length})
            </h3>
            <button type="button" className="text-xs text-muted underline hover:text-fg" onClick={() => setShown(null)}>
              Close
            </button>
          </div>
          <div className="max-h-80 overflow-y-auto">
            <Items
              rows={rows}
              slug={data.org.slug}
              limit={100}
              empty="Nothing here any more."
              right={(r) => (
                <>
                  <span className="hidden max-w-24 truncate text-xs text-muted sm:inline">{data.members.find((m) => m.id === r.issue.assigneeId)?.name.split(' ')[0] ?? 'Unassigned'}</span>
                  <Badge>{statusOf(r.project, r.issue.statusId)?.name}</Badge>
                  {dueCell(stats.today)(r)}
                </>
              )}
            />
          </div>
        </div>
      )}
    </Card>
  );
}
const ACTIVITY_TEXT = (a: Activity) =>
  a.kind === 'created' ? 'created' : a.kind === 'commented' ? 'commented on' : a.kind === 'deleted' ? 'deleted' : `changed ${a.field ?? 'a field'}${a.to ? ` to “${a.to.slice(0, 40)}”` : ''} on`;

function ProjectCards({ data }: { data: OrgData }) {
  return data.projects.length === 0 ? (
    <p className="text-sm text-muted">No projects yet.</p>
  ) : (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {data.projects.map((p) => {
        const issues = data.issues.filter((i) => i.projectId === p.id);
        const done = issues.filter((i) => statusOf(p, i.statusId)?.category === 'done').length;
        const pct = issues.length ? Math.round((done / issues.length) * 100) : 0;
        return (
          <Link key={p.id} to={`/${data.org.slug}/p/${p.key}/board`} className="rounded-lg border border-line p-3 transition hover:border-accent">
            <div className="flex items-center gap-2">
              <span className="h-3 w-3 rounded" style={{ background: p.color }} />
              <span className="truncate font-semibold">{p.name}</span>
              <Badge className="ml-auto">{TEMPLATES[p.workStyle].label}</Badge>
            </div>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-surface-2">
              <div className="h-full rounded-full bg-accent" style={{ width: `${pct}%` }} />
            </div>
            <div className="mt-1.5 flex justify-between text-xs text-muted">
              <span>{p.key}</span>
              <span>{done}/{issues.length} done</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}

function Health({ data, projectId }: { data: OrgData; projectId?: string }) {
  const rows = useMemo(
    () => data.projects.filter((p) => !projectId || p.id === projectId).map((p) => projectHealth(p, data.issues, data.sprints)),
    [data, projectId]
  );
  if (rows.length === 0) return <p className="text-sm text-muted">No projects yet.</p>;
  return (
    <ul className="divide-y divide-line">
      {rows.map((h) => (
        <li key={h.project.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
          <span className="h-2.5 w-2.5 rounded-full" style={{ background: HEALTH_STYLE[h.health].color }} aria-hidden />
          <b className="font-medium">{h.project.name}</b>
          <span className="text-xs" style={{ color: HEALTH_STYLE[h.health].color }}>{HEALTH_STYLE[h.health].label}</span>
          <span className="ml-auto text-xs text-muted">{h.progress}% · {h.overdue} overdue · {h.blocked} blocked</span>
          {h.reasons.length > 0 && <span className="w-full text-xs text-muted">{h.reasons.slice(0, 2).join(' · ')}</span>}
        </li>
      ))}
    </ul>
  );
}

function Widget({ id, data, stats, slug, projectId, wide }: { id: WidgetId; data: OrgData; stats: DashboardData; slug: string; projectId?: string; wide: boolean }) {
  const title = WIDGETS.find((w) => w.id === id)!.title;
  const k = stats.kpis;
  switch (id) {
    case 'kpis':
      return <Kpis title={title} wide={wide} stats={stats} data={data} />;
    case 'briefing':
      return (
        <Card title={title} wide={wide}>
          <BriefingCard slug={slug} orgId={data.org.id} projectKeys={Object.fromEntries(data.projects.map((p) => [p.key, p.key]))} />
        </Card>
      );
    case 'mine':
      return (
        <Card title={`${title} (${stats.mine.length})`} wide={wide}>
          <Items rows={stats.mine} slug={slug} empty="Nothing assigned to you. 🎉" right={(r) => <><Badge>{statusOf(r.project, r.issue.statusId)?.name}</Badge><PriorityIcon priority={r.issue.priority} />{dueCell(stats.today)(r)}</>} />
        </Card>
      );
    case 'dueSoon':
      return (
        <Card title={`${title} (${stats.dueSoon.length})`} wide={wide}>
          <Items rows={stats.dueSoon} slug={slug} empty="No deadlines in the next 7 days." right={dueCell(stats.today)} />
        </Card>
      );
    case 'approvals':
      return (
        <Card title={`${title} (${stats.approvals.length})`} wide={wide}>
          <Items rows={stats.approvals} slug={slug} empty="Nothing needs your sign-off." right={dueCell(stats.today)} />
        </Card>
      );
    case 'watching':
      return (
        <Card title={`${title} (${stats.watching.length})`} wide={wide}>
          <Items rows={stats.watching} slug={slug} empty="You are not following anything. Use Watch on an item." right={dueCell(stats.today)} />
        </Card>
      );
    case 'projects':
      return (
        <Card title={title} wide={wide}>
          <ProjectCards data={data} />
        </Card>
      );
    case 'health':
      return (
        <Card title={title} wide={wide} action={<Link to={`/${slug}/portfolio`} className="inline-flex items-center text-xs text-muted hover:text-fg">Portfolio <ChevronRight size={12} /></Link>}>
          <Health data={data} projectId={projectId} />
        </Card>
      );
    case 'workload':
      return (
        <Card title={title} wide={wide}>
          {stats.workload.length === 0 ? <p className="text-sm text-muted">No open work.</p> : <HBars rows={stats.workload.map((w) => ({ label: w.name, value: w.open, extra: w.overdue ? `${w.overdue} overdue` : undefined }))} />}
        </Card>
      );
    case 'trend':
      return (
        <Card title={title} wide={wide}>
          <BarChart ariaLabel="Items created and finished per week, last 6 weeks" labels={stats.trend.labels} series={[{ name: 'Created', color: SERIES[1], values: stats.trend.created }, { name: 'Finished', color: SERIES[0], values: stats.trend.finished }]} height={160} />
          <div className="mt-2"><Legend items={[{ name: 'Created', color: SERIES[1] }, { name: 'Finished', color: SERIES[0] }]} /></div>
        </Card>
      );
    case 'status': {
      const total = stats.stage.todo + stats.stage.in_progress + stats.stage.done;
      const parts = [{ name: 'Not started', n: stats.stage.todo, color: '#94a3b8' }, { name: 'In progress', n: stats.stage.in_progress, color: SERIES[1] }, { name: 'Done', n: stats.stage.done, color: SERIES[0] }];
      return (
        <Card title={title} wide={wide}>
          {total === 0 ? (
            <p className="text-sm text-muted">No work yet.</p>
          ) : (
            <>
              <div className="flex h-4 overflow-hidden rounded bg-surface-2" role="img" aria-label={parts.map((p) => `${p.name}: ${p.n}`).join(', ')}>
                {parts.map((p) => <div key={p.name} style={{ width: `${(p.n / total) * 100}%`, background: p.color }} />)}
              </div>
              <ul className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted">
                {parts.map((p) => <li key={p.name}><span className="mr-1 inline-block h-2.5 w-2.5 rounded-sm align-middle" style={{ background: p.color }} />{p.name} <b className="text-fg">{p.n}</b> ({Math.round((p.n / total) * 100)}%)</li>)}
              </ul>
            </>
          )}
        </Card>
      );
    }
    case 'priority': {
      const order: Priority[] = ['critical', 'high', 'medium', 'low'];
      return (
        <Card title={title} wide={wide}>
          <HBars color={SERIES[1]} rows={order.map((p) => ({ label: p[0].toUpperCase() + p.slice(1), value: stats.priority[p] }))} />
        </Card>
      );
    }
    case 'upcoming':
      return (
        <Card title={title} wide={wide}>
          <Items rows={stats.upcoming} slug={slug} empty="Nothing due in the next 14 days." right={(r) => <><span className="max-w-24 truncate text-xs text-muted">{data.members.find((m) => m.id === r.issue.assigneeId)?.name.split(' ')[0] ?? 'Unassigned'}</span>{dueCell(stats.today)(r)}</>} />
        </Card>
      );
    case 'activity':
      return (
        <Card title={title} wide={wide}>
          {stats.activity.length === 0 ? (
            <p className="text-sm text-muted">Nothing yet.</p>
          ) : (
            <ul className="space-y-1.5 text-sm">
              {stats.activity.map((a) => {
                const issue = data.issues.find((i) => i.id === a.issueId);
                const project = issue && data.projects.find((p) => p.id === issue.projectId);
                const who = data.members.find((m) => m.id === a.actorId)?.name ?? (a.actorId === 'automation' ? 'Automation' : a.actorId === 'intake' ? 'A request form' : 'Someone');
                return (
                  <li key={a.id} className="flex flex-wrap gap-x-1.5">
                    <b className="font-medium">{who}</b>
                    <span className="text-muted">{ACTIVITY_TEXT(a)}</span>
                    {issue && project ? <Link className="underline" to={`/${slug}/p/${project.key}/board?issue=${issue.key}`}>{issue.key}</Link> : <span className="text-muted">an item</span>}
                    <span className="ml-auto text-xs text-muted">{timeAgo(a.createdAt)}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      );
  }
}

// ---- customizing -------------------------------------------------------------------------------------------------------

function Customize({ initial, onSave, onReset, onCancel, isCustom, hide }: { hide: WidgetId[]; initial: DashboardLayout; onSave: (l: DashboardLayout) => Promise<void>; onReset: () => Promise<void>; onCancel: () => void; isCustom: boolean }) {
  const [draft, setDraft] = useState(initial);
  const [busy, setBusy] = useState(false);
  const move = (i: number, d: -1 | 1) =>
    setDraft((cur) => {
      const w = [...cur.widgets];
      [w[i], w[i + d]] = [w[i + d], w[i]];
      return { widgets: w };
    });
  const patch = (id: WidgetId, p: Partial<DashboardLayout['widgets'][number]>) => setDraft((cur) => ({ widgets: cur.widgets.map((w) => (w.id === id ? { ...w, ...p } : w)) }));

  return (
    <section aria-label="Customize dashboard" className="space-y-3 rounded-xl border border-accent/50 bg-surface p-4">
      <header>
        <h2 className="font-semibold">Customize your dashboard</h2>
        <p className="text-xs text-muted">Tick what you want to see, choose half or full width, and use the arrows to reorder. Only you see your arrangement.</p>
      </header>
      <ol className="divide-y divide-line rounded-lg border border-line">
        {draft.widgets.map((w, i) => {
          if (hide.includes(w.id)) return null; // not available on this server
          const def = WIDGETS.find((x) => x.id === w.id)!;
          return (
            <li key={w.id} className="flex flex-wrap items-center gap-2 px-3 py-2">
              <label className="flex min-w-0 flex-1 items-start gap-2 text-sm">
                <input type="checkbox" className="mt-1" checked={w.visible} onChange={(e) => patch(w.id, { visible: e.target.checked })} aria-label={`Show ${def.title}`} />
                <span>
                  <span className="font-medium">{def.title}</span>
                  <span className="block text-xs text-muted">{def.hint}</span>
                </span>
              </label>
              <Button size="sm" variant="ghost" aria-label={`${def.title}: ${w.size === 'full' ? 'full width, click for half' : 'half width, click for full'}`} onClick={() => patch(w.id, { size: w.size === 'full' ? 'half' : 'full' })}>
                {w.size === 'full' ? 'Full' : 'Half'}
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Move ${def.title} up`} disabled={i === 0} onClick={() => move(i, -1)}>
                <ArrowUp size={13} />
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Move ${def.title} down`} disabled={i === draft.widgets.length - 1} onClick={() => move(i, 1)}>
                <ArrowDown size={13} />
              </Button>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Button
          size="sm"
          variant="ghost"
          disabled={busy || !isCustom}
          onClick={async () => {
            setBusy(true);
            await onReset();
            setBusy(false);
          }}
        >
          <RotateCcw size={13} /> Back to the default
        </Button>
        <span className="flex gap-2">
          <Button onClick={onCancel}>Cancel</Button>
          <Button
            variant="primary"
            disabled={busy || !draft.widgets.some((w) => w.visible)}
            onClick={async () => {
              setBusy(true);
              await onSave(draft);
              setBusy(false);
            }}
          >
            Save
          </Button>
        </span>
      </div>
    </section>
  );
}

/** The Home dashboard: the widgets a person chose, in their order, for all projects or one. */
export function Dashboard() {
  const data = useApp((s) => s.data)!;
  const userId = useApp((s) => s.userId);
  const notify = useApp((s) => s.notify);
  const { layout, custom, save, role } = useLayout();
  const aiOn = !!useApp((s) => s.serverConfig?.ai);
  const [editing, setEditing] = useState(false);
  const pkey = `abg2:dashboard-project:${data.org.id}`;
  const [projectId, setProjectId] = useState<string>(() => {
    try {
      return localStorage.getItem(pkey) ?? '';
    } catch {
      return '';
    }
  });
  const project = data.projects.some((p) => p.id === projectId) ? projectId : ''; // a deleted project quietly falls back to "all"
  const stats = useMemo(() => computeDashboard(data, userId, new Date(), project || undefined), [data, userId, project]);
  const visible = layout.widgets.filter((w) => w.visible && (w.id !== 'briefing' || aiOn)); // the briefing needs an AI assistant on the server

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-muted">
          <LayoutDashboard size={14} /> Dashboard
        </h2>
        <div className="flex items-center gap-2">
          {data.projects.length > 1 && (
            <Select
              aria-label="Show numbers for"
              className="w-44"
              value={project}
              onChange={(e) => {
                setProjectId(e.target.value);
                try {
                  localStorage.setItem(pkey, e.target.value);
                } catch {
                  /* remembered next time if possible */
                }
              }}
            >
              <option value="">All projects</option>
              {data.projects.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          )}
          {!editing && (
            <Button size="sm" onClick={() => setEditing(true)}>
              Customize
            </Button>
          )}
        </div>
      </div>

      {editing && (
        <Customize
          initial={layout}
          hide={aiOn ? [] : ['briefing']}
          isCustom={custom}
          onCancel={() => setEditing(false)}
          onSave={async (l) => {
            if (await save(l)) {
              notify('Dashboard saved.');
              setEditing(false);
            }
          }}
          onReset={async () => {
            if (await save(null)) {
              notify(`Back to the default for ${role === 'guest' ? 'guests' : 'your role'}.`);
              setEditing(false);
            }
          }}
        />
      )}

      {visible.length === 0 ? (
        <EmptyState title="Your dashboard is empty" body="Choose what to show with Customize." />
      ) : (
        <div className="grid gap-4 md:grid-cols-2">
          {visible.map((w) => (
            <Widget key={w.id} id={w.id} data={data} stats={stats} slug={data.org.slug} projectId={project || undefined} wide={w.size === 'full'} />
          ))}
        </div>
      )}
    </div>
  );
}

export { defaultLayout };
