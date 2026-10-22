import { useEffect, useState } from 'react';
import { Link2, Trash2, X } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { PRIORITIES } from '@/domain/templates';
import { childrenOf, formatDate, isDone, statusOf, timeAgo, typeOf } from '@/domain/selectors';
import type { Activity, Priority, Project } from '@/domain/types';
import { Avatar, Badge, Button, Input, Select } from './ui';
import { Markdown, RichEditor } from './Markdown';
import { CustomFieldInput } from './CustomFieldInput';
import { fieldsFor } from '@/domain/customFields';
import { allowedTargets } from '@/domain/workflow';
import { PriorityIcon, TypeIcon } from './icons';
import { ApprovalSection, DependenciesSection } from './IssueExtras';
import { AttachmentsSection, CommentFiles } from './Attachments';
import { CommentComposer } from './CommentComposer';
import { Reactions, WatchButton } from './Social';
import { AiSummary } from './AiSummary';

export function IssueDetail({
  project,
  issueKey,
  onClose,
  onOpen,
}: {
  project: Project;
  issueKey: string;
  onClose: () => void;
  onOpen: (key: string) => void;
}) {
  const data = useApp((s) => s.data)!;
  const { updateIssue, deleteIssue, addComment, createIssue } = useApp();
  const canEdit = useCan('issue.edit');
  const canDelete = useCan('issue.delete');
  const canComment = useCan('comment.add');
  const canCreate = useCan('issue.create');

  const issue = data.issues.find((i) => i.key === issueKey && i.projectId === project.id);
  const [title, setTitle] = useState(issue?.title ?? '');
  const [description, setDescription] = useState(issue?.description ?? '');
  const [labels, setLabels] = useState((issue?.labels ?? []).join(', '));
  const [comment, setComment] = useState('');
  const [childTitle, setChildTitle] = useState('');

  // Re-sync local drafts when navigating to a different issue.
  useEffect(() => {
    setTitle(issue?.title ?? '');
    setDescription(issue?.description ?? '');
    setLabels((issue?.labels ?? []).join(', '));
    setComment('');
    setChildTitle('');
  }, [issue?.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  if (!issue) {
    return (
      <Shell onClose={onClose}>
        <div className="p-8 text-muted">Issue {issueKey} was not found (it may have been deleted).</div>
      </Shell>
    );
  }

  const type = typeOf(project, issue.typeId)!;
  const parent = issue.parentId ? data.issues.find((i) => i.id === issue.parentId) : undefined;
  const children = childrenOf(data.issues, issue.id);
  const member = (id?: string) => data.members.find((m) => m.id === id);
  const comments = data.comments.filter((c) => c.issueId === issue.id).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const activity = data.activity.filter((a) => a.issueId === issue.id && a.kind !== 'commented').sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const childType = project.issueTypes.find((t) => t.level === (type.level === 0 ? 1 : 2));

  const commitTitle = () => {
    const t = title.trim();
    if (!t) return setTitle(issue.title);
    if (t !== issue.title) void updateIssue(issue.id, { title: t });
  };
  const commitLabels = () => {
    const next = labels.split(',').map((l) => l.trim()).filter(Boolean);
    if (next.join('|') !== issue.labels.join('|')) void updateIssue(issue.id, { labels: next });
  };

  const addChild = async () => {
    const t = childTitle.trim();
    if (!t || !childType) return;
    setChildTitle('');
    await createIssue({ projectId: project.id, typeId: childType.id, title: t, parentId: issue.id, statusId: project.statuses[0].id });
  };

  const copyLink = async () => {
    try {
      await navigator.clipboard.writeText(`${location.origin}${location.pathname}?issue=${issue.key}`);
      useApp.getState().notify('Link copied');
    } catch {
      useApp.getState().notify('Could not copy link');
    }
  };

  const describe = (a: Activity) => {
    if (a.kind === 'created') return 'created this issue';
    if (a.field === 'description') return 'updated the description';
    if (a.field === 'attachment') return a.to ? <>attached <b>{a.to}</b></> : <>removed <b>{a.from}</b></>;
    return (
      <>
        changed <b>{a.field}</b>
        {a.from ? <> from <b>{a.from}</b></> : null}
        {a.to ? <> to <b>{a.to}</b></> : <> (cleared)</>}
      </>
    );
  };

  return (
    <Shell onClose={onClose}>
      <header className="flex items-center gap-2 border-b border-line px-5 py-3">
        <TypeIcon type={type} />
        {parent && (
          <>
            <button className="text-xs text-muted hover:underline" onClick={() => onOpen(parent.key)}>
              {parent.key}
            </button>
            <span className="text-muted">/</span>
          </>
        )}
        <span className="text-sm font-medium">{issue.key}</span>
        <div className="ml-auto flex items-center gap-1">
          <button aria-label="Copy link" title="Copy link" onClick={copyLink} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <Link2 size={15} />
          </button>
          {canDelete && (
            <button
              aria-label="Delete issue"
              title="Delete issue"
              className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-danger"
              onClick={async () => {
                if (confirm(`Delete ${issue.key}? This cannot be undone.`)) {
                  onClose();
                  await deleteIssue(issue.id);
                }
              }}
            >
              <Trash2 size={15} />
            </button>
          )}
          <button aria-label="Close" onClick={onClose} className="rounded p-1.5 text-muted hover:bg-surface-2 hover:text-fg">
            <X size={16} />
          </button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-1 overflow-y-auto md:grid-cols-[1fr_250px]">
        <div className="space-y-6 p-5">
          <Input
            aria-label="Summary"
            value={title}
            disabled={!canEdit}
            onChange={(e) => setTitle(e.target.value)}
            onBlur={commitTitle}
            onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
            className="h-11 border-transparent px-2 text-lg font-semibold hover:border-line"
          />

          <section>
            <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-muted">Description</h3>
            {canEdit ? (
              <RichEditor
                label="Description"
                rows={6}
                value={description}
                members={data.members}
                placeholder="Add a description…"
                onChange={setDescription}
                onBlur={() => description !== issue.description && void updateIssue(issue.id, { description })}
              />
            ) : issue.description ? (
              <Markdown text={issue.description} members={data.members} />
            ) : (
              <p className="text-sm text-muted">No description</p>
            )}
          </section>

          <AttachmentsSection issueId={issue.id} />

          {childType && (
            <section>
              <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">
                {type.level === 0 ? `Work in this ${type.name.toLowerCase()}` : 'Sub-tasks'}
                {children.length > 0 && (
                  <span className="font-normal normal-case">
                    {children.filter((c) => isDone(project, c)).length}/{children.length} done
                  </span>
                )}
              </h3>
              {children.length > 0 && (
                <ul className="mb-2 divide-y divide-line overflow-hidden rounded-lg border border-line">
                  {children.map((c) => (
                    <li key={c.id}>
                      <button onClick={() => onOpen(c.key)} className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface-2">
                        <TypeIcon type={typeOf(project, c.typeId)} size={14} />
                        <span className="text-xs text-muted">{c.key}</span>
                        <span className={isDone(project, c) ? 'flex-1 truncate text-muted line-through' : 'flex-1 truncate'}>{c.title}</span>
                        <Badge>{statusOf(project, c.statusId)?.name}</Badge>
                        <Avatar user={member(c.assigneeId)} size={20} />
                      </button>
                    </li>
                  ))}
                </ul>
              )}
              {canCreate && (
                <Input
                  aria-label={`Add ${childType.name}`}
                  placeholder={`Add a ${childType.name.toLowerCase()} and press Enter`}
                  value={childTitle}
                  onChange={(e) => setChildTitle(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && void addChild()}
                />
              )}
            </section>
          )}

          <ApprovalSection project={project} issue={issue} />
          {type.level !== 2 && <DependenciesSection project={project} issue={issue} onOpen={onOpen} />}

          <AiSummary slug={data.org.slug} issueKey={issue.key} />

          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Comments ({comments.length})</h3>
              <WatchButton issue={issue} />
            </div>
            <ul className="space-y-3">
              {comments.map((c) => (
                <li key={c.id} className="flex gap-2.5">
                  <Avatar user={member(c.authorId)} size={28} />
                  <div className="min-w-0 flex-1 rounded-lg bg-surface-2 px-3 py-2">
                    <div className="text-xs">
                      <b>{member(c.authorId)?.name ?? (c.authorId === 'automation' ? '⚡ Automation' : 'Unknown')}</b> <span className="text-muted">{timeAgo(c.createdAt)}</span>
                    </div>
                    <Markdown text={c.body} members={data.members} className="mt-0.5" />
                    <CommentFiles commentId={c.id} />
                    <Reactions comment={c} />
                  </div>
                </li>
              ))}
            </ul>
            {canComment ? (
              <CommentComposer issueId={issue.id} members={data.members} />
            ) : (
              <p className="mt-2 text-xs text-muted">You don't have permission to comment.</p>
            )}
          </section>

          <section>
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Activity</h3>
            <ul className="space-y-1.5 text-xs text-muted">
              {activity.map((a) => (
                <li key={a.id}>
                  <b className="text-fg">{member(a.actorId)?.name ?? (a.actorId === 'automation' ? '⚡ Automation' : a.actorId === 'intake' ? 'Request form sender' : 'Someone')}</b> {describe(a)} · {timeAgo(a.createdAt)}
                </li>
              ))}
            </ul>
          </section>
        </div>

        <aside className="space-y-3 border-t border-line bg-surface-2 p-5 md:border-l md:border-t-0">
          <Prop label="Status">
            <Select disabled={!canEdit} value={issue.statusId} onChange={(e) => void updateIssue(issue.id, { statusId: e.target.value })}>
              {allowedTargets(project, issue.statusId).map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
            {project.workflow.restrict && <p className="mt-1 text-[11px] text-muted">Workflow limits the next steps shown here.</p>}
          </Prop>
          {project.workStyle === 'agile' && type.level === 1 && (
            <Prop label="Sprint">
              <Select disabled={!canEdit} value={issue.sprintId ?? ''} onChange={(e) => void updateIssue(issue.id, { sprintId: e.target.value || undefined })}>
                <option value="">Backlog</option>
                {data.sprints
                  .filter((s) => s.projectId === project.id && (s.state !== 'completed' || s.id === issue.sprintId))
                  .map((s) => (
                    <option key={s.id} value={s.id} disabled={s.state === 'completed'}>
                      {s.name}
                      {s.state === 'active' ? ' (active)' : s.state === 'completed' ? ' (completed)' : ''}
                    </option>
                  ))}
              </Select>
            </Prop>
          )}
          <Prop label="Assignee">
            <Select disabled={!canEdit} value={issue.assigneeId ?? ''} onChange={(e) => void updateIssue(issue.id, { assigneeId: e.target.value || undefined })}>
              <option value="">Unassigned</option>
              {data.members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Prop>
          <Prop label="Priority">
            <div className="flex items-center gap-2">
              <PriorityIcon priority={issue.priority} />
              <Select disabled={!canEdit} value={issue.priority} onChange={(e) => void updateIssue(issue.id, { priority: e.target.value as Priority })}>
                {PRIORITIES.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </Select>
            </div>
          </Prop>
          <Prop label="Type">
            <Select disabled={!canEdit} value={issue.typeId} onChange={(e) => void updateIssue(issue.id, { typeId: e.target.value })}>
              {project.issueTypes.filter((t) => t.level === type.level).map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Prop>
          <Prop label={project.workStyle === 'agile' ? 'Story points' : 'Effort'}>
            <Input
              type="number"
              min={0}
              step="0.5"
              disabled={!canEdit}
              defaultValue={issue.estimate ?? ''}
              key={`est-${issue.id}-${issue.estimate ?? ''}`}
              onBlur={(e) => {
                const v = e.target.value === '' ? undefined : Number(e.target.value);
                if (v !== issue.estimate) void updateIssue(issue.id, { estimate: v });
              }}
            />
          </Prop>
          <Prop label="Due date">
            <Input
              type="date"
              disabled={!canEdit}
              value={issue.dueDate ?? ''}
              onChange={(e) => void updateIssue(issue.id, { dueDate: e.target.value || undefined })}
            />
          </Prop>
          {fieldsFor(project, issue.typeId).map((def) => (
            <Prop key={def.id} label={def.name + (def.required ? ' *' : '')}>
              <CustomFieldInput
                key={`${issue.id}-${def.id}`}
                def={def}
                value={issue.customFields[def.id]}
                members={data.members}
                disabled={!canEdit}
                onCommit={(v) => void updateIssue(issue.id, { customFields: { ...issue.customFields, [def.id]: v } })}
              />
            </Prop>
          ))}
          <Prop label="Labels">
            <Input disabled={!canEdit} value={labels} onChange={(e) => setLabels(e.target.value)} onBlur={commitLabels} placeholder="comma, separated" />
          </Prop>
          <div className="space-y-1 border-t border-line pt-3 text-xs text-muted">
            <div className="flex items-center gap-2">
              Reporter <Avatar user={member(issue.reporterId)} size={18} /> {member(issue.reporterId)?.name}
            </div>
            {issue.source && (
              <div className="rounded bg-surface px-2 py-1.5">
                Requested by <b className="text-fg">{issue.source.submitterName}</b> ({issue.source.submitterEmail}) via “{issue.source.formName}”
              </div>
            )}
            <div>Created {formatDate(issue.createdAt)}</div>
            <div>Updated {timeAgo(issue.updatedAt)}</div>
          </div>
        </aside>
      </div>
    </Shell>
  );
}

function Shell({ children, onClose }: { children: React.ReactNode; onClose: () => void }) {
  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-black/30" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-label="Issue details"
        onMouseDown={(e) => e.stopPropagation()}
        className="flex h-full w-full max-w-4xl flex-col border-l border-line bg-surface shadow-card"
      >
        {children}
      </div>
    </div>
  );
}

function Prop({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="mb-1 text-xs font-medium text-muted">{label}</div>
      {children}
    </div>
  );
}

