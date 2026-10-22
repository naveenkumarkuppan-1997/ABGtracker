import { useMemo, useState } from 'react';
import { ArrowDown, ArrowUp } from 'lucide-react';
import { useApp } from '@/store/app';
import { PRIORITIES } from '@/domain/templates';
import { formatDate, isOverdue, typeOf } from '@/domain/selectors';
import type { Issue } from '@/domain/types';
import { Avatar, cn, EmptyState, Select } from '@/components/ui';
import { PriorityIcon, TypeIcon } from '@/components/icons';
import { formatFieldValue } from '@/components/FieldsMenu';
import { useProjectCtx } from './ProjectPage';

type SortKey = 'key' | 'title' | 'status' | 'priority' | 'due' | 'updated';

export function ListView() {
  const { project, issues, allIssues, members, canEdit, openIssue, visibleFields } = useProjectCtx();
  const updateIssue = useApp((s) => s.updateIssue);
  const [sort, setSort] = useState<{ key: SortKey; dir: 1 | -1 }>({ key: 'key', dir: 1 });

  const rows = useMemo(() => {
    const prio = (i: Issue) => PRIORITIES.findIndex((p) => p.id === i.priority);
    const status = (i: Issue) => project.statuses.findIndex((s) => s.id === i.statusId);
    const val: Record<SortKey, (i: Issue) => string | number> = {
      key: (i) => i.number,
      title: (i) => i.title.toLowerCase(),
      status: status,
      priority: prio,
      due: (i) => i.dueDate ?? '9999-99-99',
      updated: (i) => i.updatedAt,
    };
    return [...issues].sort((a, b) => {
      const x = val[sort.key](a);
      const y = val[sort.key](b);
      return (x < y ? -1 : x > y ? 1 : 0) * sort.dir;
    });
  }, [issues, project.statuses, sort]);

  const th = (key: SortKey, label: string, className = '') => (
    <th className={cn('px-3 py-2 text-left font-medium', className)} aria-sort={sort.key === key ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}>
      <button
        className="inline-flex items-center gap-1 hover:text-fg"
        onClick={() => setSort((s) => (s.key === key ? { key, dir: (s.dir * -1) as 1 | -1 } : { key, dir: 1 }))}
      >
        {label}
        {sort.key === key && (sort.dir === 1 ? <ArrowUp size={12} /> : <ArrowDown size={12} />)}
      </button>
    </th>
  );

  if (rows.length === 0) {
    return <EmptyState title="No issues match" body="Try clearing the filters or create a new issue." />;
  }

  return (
    <div className="p-4">
      <div className="overflow-x-auto rounded-xl border border-line bg-surface">
        <table className="w-full min-w-[860px] text-sm">
          <thead className="border-b border-line bg-surface-2 text-xs text-muted">
            <tr>
              {th('key', 'Issue', 'w-28')}
              {th('title', 'Summary')}
              {th('status', 'Status', 'w-40')}
              <th className="w-44 px-3 py-2 text-left font-medium">Assignee</th>
              {th('priority', 'Priority', 'w-24')}
              {th('due', 'Due', 'w-24')}
              {visibleFields.map((f) => (
                <th key={f.id} className="px-3 py-2 text-left font-medium">
                  {f.name}
                </th>
              ))}
              {th('updated', 'Updated', 'w-24')}
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((i) => {
              const parent = i.parentId ? allIssues.find((x) => x.id === i.parentId) : undefined;
              const level = typeOf(project, i.typeId)?.level ?? 1;
              return (
                <tr key={i.id} className="hover:bg-surface-2">
                  <td className="px-3 py-2">
                    <span className="flex items-center gap-2">
                      <TypeIcon type={typeOf(project, i.typeId)} size={14} />
                      <span className="text-xs text-muted">{i.key}</span>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <button className={cn('text-left hover:underline', level === 2 && 'pl-4')} onClick={() => openIssue(i.key)}>
                      {i.title}
                    </button>
                    {parent && <span className="ml-2 text-xs text-muted">{parent.key}</span>}
                  </td>
                  <td className="px-3 py-1.5">
                    <Select
                      aria-label={`Status of ${i.key}`}
                      disabled={!canEdit}
                      value={i.statusId}
                      onChange={(e) => void updateIssue(i.id, { statusId: e.target.value })}
                      className="h-8 text-xs"
                    >
                      {project.statuses.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </td>
                  <td className="px-3 py-1.5">
                    <span className="flex items-center gap-2">
                      <Avatar user={members.find((m) => m.id === i.assigneeId)} size={22} />
                      <Select
                        aria-label={`Assignee of ${i.key}`}
                        disabled={!canEdit}
                        value={i.assigneeId ?? ''}
                        onChange={(e) => void updateIssue(i.id, { assigneeId: e.target.value || undefined })}
                        className="h-8 text-xs"
                      >
                        <option value="">Unassigned</option>
                        {members.map((m) => (
                          <option key={m.id} value={m.id}>
                            {m.name}
                          </option>
                        ))}
                      </Select>
                    </span>
                  </td>
                  <td className="px-3 py-2">
                    <span className="inline-flex items-center gap-1">
                      <PriorityIcon priority={i.priority} />
                      <span className="text-xs capitalize text-muted">{i.priority}</span>
                    </span>
                  </td>
                  <td className={cn('px-3 py-2 text-xs', isOverdue(project, i) ? 'font-medium text-danger' : 'text-muted')}>
                    {formatDate(i.dueDate)}
                  </td>
                  {visibleFields.map((f) => {
                    const applies = !f.typeIds?.length || f.typeIds.includes(i.typeId);
                    return (
                      <td key={f.id} className="max-w-48 truncate px-3 py-2 text-xs">
                        {applies ? formatFieldValue(f, i.customFields[f.id], members) || <span className="text-muted">–</span> : <span className="text-muted/50">n/a</span>}
                      </td>
                    );
                  })}
                  <td className="px-3 py-2 text-xs text-muted">{formatDate(i.updatedAt)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted">
        {rows.length} issue{rows.length === 1 ? '' : 's'}
      </p>
    </div>
  );
}
