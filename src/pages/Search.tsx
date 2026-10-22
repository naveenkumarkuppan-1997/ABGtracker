import { useMemo } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useApp } from '@/store/app';
import { compileQuery } from '@/domain/query';
import { formatDate, isOverdue, statusOf, typeOf } from '@/domain/selectors';
import { Avatar, Badge, EmptyState, Input } from '@/components/ui';
import { PriorityIcon, TypeIcon } from '@/components/icons';
import { SavedFilters } from '@/components/FilterBar';

const EXAMPLES = [
  'assignee = me AND statusCategory != done',
  'type = Bug AND priority >= high',
  'due < 7d AND assignee is empty',
  'status in ("In Progress", "In Review") ORDER BY priority DESC',
];

export function Search() {
  const data = useApp((s) => s.data)!;
  const userId = useApp((s) => s.userId);
  const [params, setParams] = useSearchParams();
  const q = params.get('q') ?? '';
  const setQ = (v: string) => setParams(v ? { q: v } : {}, { replace: true });

  const result = useMemo(() => {
    const c = compileQuery(q, { userId, members: data.members, projects: data.projects, issues: data.issues, sprints: data.sprints });
    if (!c.ok) return { error: c.error, rows: [] };
    const rows = data.issues.filter(c.match);
    if (c.compare) rows.sort(c.compare);
    else rows.sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    return { error: null, rows };
  }, [q, data, userId]);

  return (
    <div className="mx-auto max-w-5xl space-y-4 p-6">
      <header>
        <h1 className="text-2xl font-semibold">Search</h1>
        <p className="text-muted">Search every project in {data.org.name} with plain words or a query.</p>
      </header>

      <div className="flex flex-wrap items-center gap-3">
        <Input
          aria-label="Search query"
          autoFocus
          className="max-w-xl flex-1 font-mono"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder='e.g. assignee = me AND priority >= high ORDER BY due'
        />
        <SavedFilters query={q} onApply={setQ} canSave />
      </div>

      {result.error ? (
        <p role="alert" className="text-sm text-danger">
          {result.error}
        </p>
      ) : (
        <p className="text-sm text-muted">{result.rows.length} result{result.rows.length === 1 ? '' : 's'}</p>
      )}

      {!q && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <h2 className="mb-2 text-sm font-semibold">Try a query</h2>
          <ul className="space-y-1">
            {EXAMPLES.map((e) => (
              <li key={e}>
                <button onClick={() => setQ(e)} className="font-mono text-xs text-accent-text hover:underline">
                  {e}
                </button>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-muted">
            Fields: status, statusCategory, type, assignee, reporter, priority, label, project, key, parent, due, start, created, updated, resolved, estimate, and any custom field by name.
            Operators: = != ~ &gt; &gt;= &lt; &lt;= in (…) is [not] empty · AND / OR / NOT · ORDER BY.
          </p>
        </div>
      )}

      {result.rows.length === 0 && q && !result.error ? (
        <EmptyState title="No issues match" body="Loosen the query or check the field values." />
      ) : (
        result.rows.length > 0 && (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {result.rows.map((i) => {
              const p = data.projects.find((x) => x.id === i.projectId)!;
              return (
                <li key={i.id}>
                  <Link to={`/${data.org.slug}/p/${p.key}/board?issue=${i.key}`} className="flex items-center gap-3 px-4 py-2.5 hover:bg-surface-2">
                    <TypeIcon type={typeOf(p, i.typeId)} />
                    <span className="w-16 shrink-0 text-xs text-muted">{i.key}</span>
                    <span className="min-w-0 flex-1 truncate">{i.title}</span>
                    <Badge>{statusOf(p, i.statusId)?.name}</Badge>
                    <PriorityIcon priority={i.priority} />
                    <Avatar user={data.members.find((m) => m.id === i.assigneeId)} size={22} />
                    <span className={isOverdue(p, i) ? 'w-14 text-right text-xs text-danger' : 'w-14 text-right text-xs text-muted'}>{formatDate(i.dueDate)}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        )
      )}
    </div>
  );
}
