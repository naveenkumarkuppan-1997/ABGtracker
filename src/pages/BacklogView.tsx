import { useState } from 'react';
import { closestCorners, DndContext, DragOverlay, PointerSensor, useDroppable, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { CalendarClock, Pencil, Play, Plus, Square, Trash2 } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { dropRank } from '@/domain/rank';
import { isDone, formatDate, statusOf, typeOf } from '@/domain/selectors';
import { sprintDaysLeft, sprintStats, velocity } from '@/domain/sprints';
import type { Issue, Project, Sprint } from '@/domain/types';
import { Avatar, Badge, Button, cn, EmptyState, Field, Input, Modal, Select, Textarea } from '@/components/ui';
import { PriorityIcon, TypeIcon } from '@/components/icons';
import { useProjectCtx } from './ProjectPage';

const secId = (sprintId?: string) => `sec:${sprintId ?? 'backlog'}`;

export function BacklogView() {
  const { project, issues, allIssues, sprints, members, canEdit, openIssue } = useProjectCtx();
  const updateIssue = useApp((s) => s.updateIssue);
  const canSprint = useCan('sprint.manage');
  const [activeId, setActiveId] = useState<string | null>(null);
  const [editing, setEditing] = useState<Sprint | 'new' | null>(null);
  const [completing, setCompleting] = useState<Sprint | null>(null);
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }));

  const work = issues.filter((i) => typeOf(project, i.typeId)?.level === 1);
  const open = sprints
    .filter((s) => s.state !== 'completed')
    .sort((a, b) => (a.state === b.state ? (a.startDate ?? '9').localeCompare(b.startDate ?? '9') : a.state === 'active' ? -1 : 1));
  const completed = sprints.filter((s) => s.state === 'completed').sort((a, b) => (b.completedAt ?? '').localeCompare(a.completedAt ?? ''));
  const v = velocity(sprints);

  const listFor = (sprintId?: string) =>
    work
      .filter((i) => (sprintId ? i.sprintId === sprintId : !i.sprintId && !isDone(project, i)))
      .sort((a, b) => a.rank - b.rank);

  const onDragEnd = (e: DragEndEvent) => {
    setActiveId(null);
    if (!e.over || !canEdit) return;
    const issue = work.find((i) => i.id === e.active.id);
    if (!issue) return;
    const overId = String(e.over.id);
    let target: string | undefined;
    let over: string | null = null;
    if (overId.startsWith('sec:')) {
      const raw = overId.slice(4);
      target = raw === 'backlog' ? undefined : raw;
    } else {
      const overIssue = work.find((i) => i.id === overId);
      if (!overIssue || overIssue.id === issue.id) return;
      target = overIssue.sprintId;
      over = overIssue.id;
    }
    const rank = dropRank(listFor(target), issue.id, over);
    if (target === issue.sprintId && rank === issue.rank) return;
    void updateIssue(issue.id, { sprintId: target, rank });
  };

  const activeIssue = work.find((i) => i.id === activeId);

  return (
    <div className="mx-auto max-w-5xl space-y-5 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-sm text-muted">
          {v.sprints.length ? (
            <>
              Average velocity <b className="text-fg">{v.average} pts</b> over the last {v.sprints.length} sprint{v.sprints.length > 1 ? 's' : ''}
            </>
          ) : (
            'Complete a sprint to see velocity.'
          )}
        </p>
        {canSprint && (
          <Button onClick={() => setEditing('new')}>
            <Plus size={14} /> Create sprint
          </Button>
        )}
      </div>

      <DndContext sensors={sensors} collisionDetection={closestCorners} onDragStart={(e) => setActiveId(String(e.active.id))} onDragEnd={onDragEnd} onDragCancel={() => setActiveId(null)}>
        {open.map((s) => (
          <Section
            key={s.id}
            project={project}
            sprint={s}
            issues={listFor(s.id)}
            allIssues={allIssues}
            members={members}
            canEdit={canEdit}
            canSprint={canSprint}
            onOpen={openIssue}
            onEdit={() => setEditing(s)}
            onComplete={() => setCompleting(s)}
          />
        ))}
        <Section
          project={project}
          issues={listFor(undefined)}
          allIssues={allIssues}
          members={members}
          canEdit={canEdit}
          canSprint={canSprint}
          onOpen={openIssue}
        />
        <DragOverlay>{activeIssue ? <RowBody project={project} issue={activeIssue} allIssues={allIssues} members={members} dragging /> : null}</DragOverlay>
      </DndContext>

      {completed.length > 0 && (
        <section>
          <h2 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Completed sprints</h2>
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface">
            {completed.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-2.5 text-sm">
                <b>{s.name}</b>
                <span className="text-xs text-muted">
                  {formatDate(s.startDate)} – {formatDate(s.endDate)}
                </span>
                <span className="ml-auto text-xs">
                  <b>{s.completedPoints ?? 0}</b> of {s.committedPoints ?? 0} pts delivered
                </span>
                <div className="h-1.5 w-28 overflow-hidden rounded-full bg-surface-2">
                  <div className="h-full bg-accent" style={{ width: `${s.committedPoints ? Math.min(100, ((s.completedPoints ?? 0) / s.committedPoints) * 100) : 0}%` }} />
                </div>
              </li>
            ))}
          </ul>
        </section>
      )}

      {editing && <SprintDialog project={project} sprint={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
      {completing && <CompleteDialog project={project} sprint={completing} onClose={() => setCompleting(null)} />}
    </div>
  );
}

function Section({
  project,
  sprint,
  issues,
  allIssues,
  members,
  canEdit,
  canSprint,
  onOpen,
  onEdit,
  onComplete,
}: {
  project: Project;
  sprint?: Sprint;
  issues: Issue[];
  allIssues: Issue[];
  members: ReturnType<typeof useProjectCtx>['members'];
  canEdit: boolean;
  canSprint: boolean;
  onOpen: (key: string) => void;
  onEdit?: () => void;
  onComplete?: () => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: secId(sprint?.id) });
  const startSprint = useApp((s) => s.startSprint);
  const deleteSprint = useApp((s) => s.deleteSprint);
  const createIssue = useApp((s) => s.createIssue);
  const [title, setTitle] = useState('');
  const stats = sprintStats(project, allIssues, sprint?.id);
  const backlogStats = {
    count: issues.length,
    points: issues.reduce((sum, i) => sum + (i.estimate ?? 0), 0),
  };
  const left = sprint?.state === 'active' ? sprintDaysLeft(sprint) : null;
  const defaultType = project.issueTypes.find((t) => t.level === 1)!;

  const add = async () => {
    const t = title.trim();
    if (!t) return;
    setTitle('');
    await createIssue({ projectId: project.id, typeId: defaultType.id, title: t, sprintId: sprint?.id });
  };

  return (
    <section className={cn('mb-5 rounded-xl border bg-surface', isOver ? 'border-accent' : 'border-line')}>
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-line px-4 py-2.5">
        <h2 className="font-semibold">{sprint ? sprint.name : 'Backlog'}</h2>
        {sprint && (
          <Badge color={sprint.state === 'active' ? '#2f9e6b' : undefined}>{sprint.state === 'active' ? 'Active' : 'Planned'}</Badge>
        )}
        {sprint && (sprint.startDate || sprint.endDate) && (
          <span className="inline-flex items-center gap-1 text-xs text-muted">
            <CalendarClock size={12} /> {formatDate(sprint.startDate) || '—'} – {formatDate(sprint.endDate) || '—'}
            {left !== null && <span className={left < 0 ? 'text-danger' : ''}> · {left < 0 ? `${-left}d overdue` : `${left}d left`}</span>}
          </span>
        )}
        <span className="text-xs text-muted">
          {sprint ? `${stats.count} issues · ${stats.donePoints}/${stats.points} pts done` : `${backlogStats.count} issues · ${backlogStats.points} pts`}
        </span>
        <div className="ml-auto flex items-center gap-1.5">
          {sprint && canSprint && sprint.state === 'planned' && (
            <>
              <Button size="sm" variant="primary" onClick={() => void startSprint(sprint.id)}>
                <Play size={12} /> Start sprint
              </Button>
              <Button size="sm" variant="ghost" aria-label={`Edit ${sprint.name}`} onClick={onEdit}>
                <Pencil size={13} />
              </Button>
              <Button
                size="sm"
                variant="ghost"
                aria-label={`Delete ${sprint.name}`}
                onClick={() => confirm(`Delete ${sprint.name}? Its issues go back to the backlog.`) && void deleteSprint(sprint.id)}
              >
                <Trash2 size={13} />
              </Button>
            </>
          )}
          {sprint && canSprint && sprint.state === 'active' && (
            <>
              <Button size="sm" variant="ghost" aria-label={`Edit ${sprint.name}`} onClick={onEdit}>
                <Pencil size={13} />
              </Button>
              <Button size="sm" onClick={onComplete}>
                <Square size={12} /> Complete sprint
              </Button>
            </>
          )}
        </div>
      </header>
      {sprint?.goal && <p className="border-b border-line px-4 py-1.5 text-xs text-muted">Goal: {sprint.goal}</p>}

      <div ref={setNodeRef} className="min-h-12 px-2 py-2">
        <SortableContext items={issues.map((i) => i.id)} strategy={verticalListSortingStrategy}>
          <ul className="space-y-1">
            {issues.map((i) => (
              <SortableRow key={i.id} project={project} issue={i} allIssues={allIssues} members={members} disabled={!canEdit} onOpen={onOpen} />
            ))}
          </ul>
        </SortableContext>
        {issues.length === 0 && <p className="px-2 py-3 text-center text-xs text-muted">{sprint ? 'Plan a sprint by dragging issues here from the backlog.' : 'Backlog is empty.'}</p>}
        {canEdit && (
          <input
            aria-label={`Add issue to ${sprint ? sprint.name : 'backlog'}`}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && void add()}
            placeholder="+ Create issue"
            className="mt-1 w-full rounded-md border border-transparent bg-transparent px-2 py-1.5 text-sm placeholder:text-muted hover:border-line focus:border-accent"
          />
        )}
      </div>
    </section>
  );
}

function SortableRow(props: { project: Project; issue: Issue; allIssues: Issue[]; members: ReturnType<typeof useProjectCtx>['members']; disabled: boolean; onOpen: (key: string) => void }) {
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: props.issue.id, disabled: props.disabled });
  return (
    <li
      ref={setNodeRef}
      style={{ transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.35 : 1 }}
      {...attributes}
      {...listeners}
      onClick={() => props.onOpen(props.issue.key)}
    >
      <RowBody project={props.project} issue={props.issue} allIssues={props.allIssues} members={props.members} />
    </li>
  );
}

function RowBody({ project, issue, allIssues, members, dragging }: { project: Project; issue: Issue; allIssues: Issue[]; members: ReturnType<typeof useProjectCtx>['members']; dragging?: boolean }) {
  const parent = issue.parentId ? allIssues.find((i) => i.id === issue.parentId) : undefined;
  const done = isDone(project, issue);
  return (
    <div className={cn('flex items-center gap-2.5 rounded-md border border-line bg-surface px-3 py-1.5 text-sm hover:bg-surface-2', dragging && 'shadow-card ring-1 ring-accent')}>
      <TypeIcon type={typeOf(project, issue.typeId)} size={14} />
      <span className="w-16 shrink-0 text-xs text-muted">{issue.key}</span>
      <span className={cn('min-w-0 flex-1 truncate', done && 'text-muted line-through')}>{issue.title}</span>
      {parent && <Badge className="hidden max-w-32 truncate sm:inline-flex">{parent.title}</Badge>}
      <Badge>{statusOf(project, issue.statusId)?.name}</Badge>
      <PriorityIcon priority={issue.priority} size={14} />
      <span className="w-7 text-center text-xs text-muted">{issue.estimate ?? '–'}</span>
      <Avatar user={members.find((m) => m.id === issue.assigneeId)} size={20} />
    </div>
  );
}

function SprintDialog({ project, sprint, onClose }: { project: Project; sprint?: Sprint; onClose: () => void }) {
  const createSprint = useApp((s) => s.createSprint);
  const updateSprint = useApp((s) => s.updateSprint);
  const sprints = useApp((s) => s.data!.sprints.filter((x) => x.projectId === project.id));
  const [name, setName] = useState(sprint?.name ?? `Sprint ${sprints.length + 1}`);
  const [goal, setGoal] = useState(sprint?.goal ?? '');
  const [startDate, setStart] = useState(sprint?.startDate ?? '');
  const [endDate, setEnd] = useState(sprint?.endDate ?? '');
  return (
    <Modal title={sprint ? `Edit ${sprint.name}` : 'Create sprint'} onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          const input = { name, goal, startDate: startDate || undefined, endDate: endDate || undefined };
          const ok = sprint ? await updateSprint(sprint.id, input) : await createSprint(project.id, input);
          if (ok) onClose();
        }}
      >
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} />
        </Field>
        <Field label="Goal">
          <Textarea rows={2} value={goal} onChange={(e) => setGoal(e.target.value)} placeholder="What should be true when this sprint ends?" />
        </Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Start date">
            <Input type="date" value={startDate} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End date">
            <Input type="date" value={endDate} min={startDate || undefined} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary">
            {sprint ? 'Save' : 'Create'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function CompleteDialog({ project, sprint, onClose }: { project: Project; sprint: Sprint; onClose: () => void }) {
  const data = useApp((s) => s.data!);
  const completeSprint = useApp((s) => s.completeSprint);
  const planned = data.sprints.filter((s) => s.projectId === project.id && s.state === 'planned');
  const stats = sprintStats(project, data.issues, sprint.id);
  const unfinished = data.issues.filter((i) => i.sprintId === sprint.id && !isDone(project, i) && typeOf(project, i.typeId)?.level === 1).length;
  const [target, setTarget] = useState(planned[0]?.id ?? '');
  return (
    <Modal title={`Complete ${sprint.name}`} onClose={onClose}>
      <div className="space-y-4">
        <p className="text-sm">
          <b>{stats.doneCount}</b> of {stats.count} issues are done ({stats.donePoints}/{stats.points} points).
        </p>
        {unfinished > 0 ? (
          <Field label={`Move the ${unfinished} unfinished issue${unfinished > 1 ? 's' : ''} to`}>
            <Select value={target} onChange={(e) => setTarget(e.target.value)}>
              <option value="">Backlog</option>
              {planned.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        ) : (
          <p className="text-sm text-muted">Everything is done. 🎉</p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button
            variant="primary"
            onClick={async () => {
              if (await completeSprint(sprint.id, unfinished > 0 && target ? target : null)) onClose();
            }}
          >
            Complete sprint
          </Button>
        </div>
      </div>
    </Modal>
  );
}

export function BacklogUnavailable() {
  return <EmptyState title="Sprints are for Agile projects" body="This project uses a different work style, so it has no backlog." />;
}

export function BacklogGate() {
  const { project } = useProjectCtx();
  return project.workStyle === 'agile' ? <BacklogView /> : <BacklogUnavailable />;
}
