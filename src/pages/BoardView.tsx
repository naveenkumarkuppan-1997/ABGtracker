import { useState } from 'react';
import {
  closestCorners,
  DndContext,
  DragOverlay,
  PointerSensor,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
  type DragStartEvent,
} from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarDays, GitBranch, Lock, Paperclip, Plus, ShieldCheck } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { rankBetween } from '@/domain/rank';
import { allowedTargets } from '@/domain/workflow';
import { formatDate, isOverdue, progressOf, typeOf } from '@/domain/selectors';
import { sprintDaysLeft } from '@/domain/sprints';
import { approvalState } from '@/domain/approvals';
import { openBlockers } from '@/domain/dependencies';
import type { Issue, Project, Status } from '@/domain/types';
import { Avatar, Badge, cn } from '@/components/ui';
import { PriorityIcon, TypeIcon } from '@/components/icons';
import { ColumnTitle, AddColumn } from '@/components/ColumnMenu';
import { formatFieldValue } from '@/components/FieldsMenu';
import { useProjectCtx } from './ProjectPage';

const colId = (statusId: string) => `col:${statusId}`;

export function BoardView() {
  const { project, issues, allIssues, sprints, members, canEdit, openIssue } = useProjectCtx();
  const updateIssue = useApp((s) => s.updateIssue);
  const canManageProject = useCan('project.manage');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [scope, setScope] = useState<'sprint' | 'all'>('sprint');
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));
  const activeSprint = project.workStyle === 'agile' ? sprints.find((s) => s.state === 'active') : undefined;
  const sprintOnly = !!activeSprint && scope === 'sprint';
  const left = activeSprint ? sprintDaysLeft(activeSprint) : null;

  // Containers (epics) and sub-tasks are managed elsewhere; the board shows standard work items.
  const boardIssues = issues.filter((i) => typeOf(project, i.typeId)?.level === 1 && (!sprintOnly || i.sprintId === activeSprint!.id));
  const byStatus = (statusId: string) =>
    boardIssues.filter((i) => i.statusId === statusId).sort((a, b) => a.rank - b.rank);

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    const { active, over } = e;
    if (!over || !canEdit) return;
    const issue = boardIssues.find((i) => i.id === active.id);
    if (!issue) return;

    const overId = String(over.id);
    let targetStatus: string;
    let overIssue: Issue | undefined;
    if (overId.startsWith('col:')) {
      targetStatus = overId.slice(4);
    } else {
      overIssue = boardIssues.find((i) => i.id === overId);
      if (!overIssue) return;
      targetStatus = overIssue.statusId;
    }
    if (overIssue?.id === issue.id) return;

    const original = byStatus(targetStatus);
    const column = original.filter((i) => i.id !== issue.id);
    let index = column.length; // default: end of column
    if (overIssue) {
      const overIdx = column.findIndex((i) => i.id === overIssue!.id);
      const sameColumn = issue.statusId === targetStatus;
      const movingDown = sameColumn && original.findIndex((i) => i.id === issue.id) < original.findIndex((i) => i.id === overIssue!.id);
      index = movingDown ? overIdx + 1 : overIdx;
    }
    const rank = rankBetween(column[index - 1]?.rank, column[index]?.rank);
    if (issue.statusId === targetStatus && rank === issue.rank) return;
    void updateIssue(issue.id, { statusId: targetStatus, rank });
  };

  const onDragStart = (e: DragStartEvent) => setActiveId(String(e.active.id));
  const activeIssue = boardIssues.find((i) => i.id === activeId);

  return (
    <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={onDragStart} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
      {project.workStyle === 'agile' && (
        <div className="flex flex-wrap items-center gap-3 border-b border-line bg-surface-2 px-4 py-2 text-sm">
          {activeSprint ? (
            <>
              <b>{activeSprint.name}</b>
              {left !== null && <span className={left < 0 ? 'text-danger' : 'text-muted'}>{left < 0 ? `${-left}d overdue` : `${left}d left`}</span>}
              {activeSprint.goal && <span className="min-w-0 truncate text-muted">Goal: {activeSprint.goal}</span>}
              <div className="ml-auto inline-flex overflow-hidden rounded-md border border-line" role="group" aria-label="Board scope">
                {(['sprint', 'all'] as const).map((s) => (
                  <button key={s} aria-pressed={scope === s} onClick={() => setScope(s)} className={cn('px-3 py-1 text-xs', scope === s ? 'bg-primary text-primary-fg' : 'hover:bg-surface')}>
                    {s === 'sprint' ? 'Active sprint' : 'All work'}
                  </button>
                ))}
              </div>
            </>
          ) : (
            <span className="text-muted">No active sprint — showing all work. Start one from the Backlog tab.</span>
          )}
        </div>
      )}
      <div className="flex h-full gap-3 overflow-x-auto p-4">
        {project.statuses.map((status) => (
          <Column
            key={status.id}
            project={project}
            status={status}
            issues={byStatus(status.id)}
            allIssues={allIssues}
            members={members}
            canEdit={canEdit}
            onOpen={openIssue}
            blocked={!!activeIssue && !allowedTargets(project, activeIssue.statusId).some((s) => s.id === status.id)}
          />
        ))}
        {canManageProject && <AddColumn project={project} />}
      </div>
      <DragOverlay>
        {activeIssue ? <CardBody project={project} issue={activeIssue} allIssues={allIssues} members={members} dragging /> : null}
      </DragOverlay>
    </DndContext>
  );
}

function Column({
  project,
  status,
  issues,
  allIssues,
  members,
  canEdit,
  onOpen,
  blocked,
}: {
  project: Project;
  status: Status;
  issues: Issue[];
  allIssues: Issue[];
  members: ReturnType<typeof useProjectCtx>['members'];
  canEdit: boolean;
  onOpen: (key: string) => void;
  /** The dragged issue may not move into this column (workflow). */
  blocked: boolean;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: colId(status.id) });
  const canCreate = useCan('issue.create');
  const canManage = useCan('project.manage');
  const createIssue = useApp((s) => s.createIssue);
  const [adding, setAdding] = useState(false);
  const [title, setTitle] = useState('');
  const defaultType = project.issueTypes.find((t) => t.level === 1)!;

  const submit = async () => {
    const t = title.trim();
    if (!t) return setAdding(false);
    setTitle('');
    await createIssue({ projectId: project.id, typeId: defaultType.id, title: t, statusId: status.id });
  };

  const dot = status.category === 'done' ? '#2f9e6b' : status.category === 'in_progress' ? '#3b82f6' : '#9aa5a1';

  return (
    <section
      title={blocked ? `The workflow doesn't allow moving here directly` : undefined}
      className={cn('flex w-72 shrink-0 flex-col rounded-xl bg-surface-2 ring-1 ring-line transition-opacity', blocked && 'opacity-40')}
    >
      <header className="flex items-center gap-2 px-3 py-2.5">
        <span className="h-2 w-2 rounded-full" style={{ background: dot }} />
        <ColumnTitle project={project} status={status} count={allIssues.filter((i) => i.statusId === status.id).length} canManage={canManage} />
        <span className="text-xs text-muted">{issues.length}</span>
        {canCreate && (
          <button aria-label={`Add issue to ${status.name}`} onClick={() => setAdding(true)} className="ml-auto rounded p-1 text-muted hover:bg-surface hover:text-fg">
            <Plus size={14} />
          </button>
        )}
      </header>
      <div ref={setNodeRef} className={cn('min-h-24 flex-1 space-y-2 overflow-y-auto px-2 pb-2', isOver && 'bg-accent/10')}>
        <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          {issues.map((issue) => (
            <SortableCard key={issue.id} project={project} issue={issue} allIssues={allIssues} members={members} disabled={!canEdit} onOpen={onOpen} />
          ))}
        </SortableContext>
        {adding && (
          <input
            autoFocus
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={submit}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') {
                setTitle('');
                setAdding(false);
              }
            }}
            placeholder="What needs to be done?"
            className="w-full rounded-lg border border-accent bg-surface px-2.5 py-2 text-sm"
          />
        )}
        {issues.length === 0 && !adding && <p className="px-1 py-4 text-center text-xs text-muted">Drop issues here</p>}
      </div>
    </section>
  );
}

function SortableCard({
  project,
  issue,
  allIssues,
  members,
  disabled,
  onOpen,
}: {
  project: Project;
  issue: Issue;
  allIssues: Issue[];
  members: ReturnType<typeof useProjectCtx>['members'];
  disabled: boolean;
  onOpen: (key: string) => void;
}) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: issue.id, disabled });
  return (
    <div
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      onClick={() => onOpen(issue.key)}
      onKeyDown={(e) => {
        if (e.key === 'Enter') onOpen(issue.key);
        listeners?.onKeyDown?.(e);
      }}
    >
      <CardBody project={project} issue={issue} allIssues={allIssues} members={members} />
    </div>
  );
}

function CardBody({
  project,
  issue,
  allIssues,
  members,
  dragging,
}: {
  project: Project;
  issue: Issue;
  allIssues: Issue[];
  members: ReturnType<typeof useProjectCtx>['members'];
  dragging?: boolean;
}) {
  const type = typeOf(project, issue.typeId);
  const progress = progressOf(project, allIssues, issue.id);
  const parent = issue.parentId ? allIssues.find((i) => i.id === issue.parentId) : undefined;
  const overdue = isOverdue(project, issue);
  const blockers = openBlockers(project, allIssues, issue);
  const { visibleFields } = useProjectCtx();
  const fileCount = useApp((s) => s.data!.attachments.filter((a) => a.issueId === issue.id).length);
  // The team's own fields, shown on the card when they have a value (kept to three so cards stay tidy).
  const fieldChips = visibleFields
    .filter((f) => !f.typeIds?.length || f.typeIds.includes(issue.typeId))
    .map((f) => ({ f, text: formatFieldValue(f, issue.customFields[f.id], members) }))
    .filter((c) => c.text)
    .slice(0, 3);
  return (
    <article
      className={cn(
        'rounded-lg border border-line bg-surface p-2.5 shadow-sm hover:border-accent',
        dragging && 'rotate-1 shadow-card ring-1 ring-accent'
      )}
    >
      {parent && (
        <div className="mb-1 truncate text-[11px] text-muted">
          {parent.key} · {parent.title}
        </div>
      )}
      <p className="text-sm leading-snug">{issue.title}</p>
      {issue.labels.length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-1">
          {issue.labels.map((l) => (
            <Badge key={l}>{l}</Badge>
          ))}
        </div>
      )}
      {fieldChips.length > 0 && (
        <dl className="mt-1.5 space-y-0.5">
          {fieldChips.map(({ f, text }) => (
            <div key={f.id} className="flex gap-1.5 text-xs">
              <dt className="shrink-0 text-muted">{f.name}</dt>
              <dd className="min-w-0 truncate font-medium">{text}</dd>
            </div>
          ))}
        </dl>
      )}
      <div className="mt-2 flex items-center gap-2 text-xs text-muted">
        <TypeIcon type={type} size={14} />
        <span>{issue.key}</span>
        {issue.dueDate && (
          <span className={cn('inline-flex items-center gap-0.5', overdue && 'font-medium text-danger')}>
            <CalendarDays size={11} /> {formatDate(issue.dueDate)}
          </span>
        )}
        {progress.total > 0 && (
          <span className="inline-flex items-center gap-0.5" title="Sub-tasks done">
            <GitBranch size={11} /> {progress.done}/{progress.total}
          </span>
        )}
        {fileCount > 0 && (
          <span className="inline-flex items-center gap-0.5" title={`${fileCount} file${fileCount > 1 ? 's' : ''}`}>
            <Paperclip size={11} /> {fileCount}
          </span>
        )}
        {blockers.length > 0 && (
          <span className="inline-flex items-center gap-0.5 text-danger" title={`Blocked by ${blockers.map((b) => b.key).join(', ')}`}>
            <Lock size={11} /> {blockers.length}
          </span>
        )}
        {issue.approval && (
          <span
            className="inline-flex items-center"
            title={`Approval: ${approvalState(issue.approval)}`}
            style={{ color: { pending: '#d9a21b', approved: '#2f9e6b', rejected: '#dc4b4b' }[approvalState(issue.approval)] }}
          >
            <ShieldCheck size={12} />
          </span>
        )}
        {issue.estimate !== undefined && <span className="rounded-full bg-surface-2 px-1.5 py-0.5">{issue.estimate}</span>}
        <span className="ml-auto flex items-center gap-1.5">
          <PriorityIcon priority={issue.priority} size={14} />
          <Avatar user={members.find((m) => m.id === issue.assigneeId)} size={20} />
        </span>
      </div>
    </article>
  );
}
