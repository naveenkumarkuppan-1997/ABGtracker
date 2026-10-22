import { useState } from 'react';
import { Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp } from '@/store/app';
import { addType, LEVEL_CHOICES, MAX_TYPES, needsApproval, isMilestoneType, removeTypeProblem, TYPE_COLORS, TYPE_ICONS, typeProblem, type TypeDraft } from '@/domain/issueTypes';
import type { IssueType, Project } from '@/domain/types';
import { Button, cn, Input, Select } from './ui';
import { TYPE_ICON_COMPONENTS, TypeIcon } from './icons';

const draftOf = (t?: IssueType): TypeDraft => ({ name: t?.name ?? '', icon: t?.icon ?? 'check', color: t?.color ?? TYPE_COLORS[1], level: t?.level ?? 1, kind: t?.kind });

/** Name, look and kind of one issue type, in plain language. */
export function TypeForm({
  project,
  type,
  lockedLevel,
  onSave,
  onCancel,
}: {
  project: Project;
  /** Editing this type, or creating a new one when absent. */
  type?: IssueType;
  /** A type that already has items can't change what kind of item it is. */
  lockedLevel?: boolean;
  onSave: (draft: TypeDraft) => Promise<boolean> | boolean;
  onCancel: () => void;
}) {
  const [draft, setDraft] = useState<TypeDraft>(() => draftOf(type));
  const [error, setError] = useState<string | null>(null);
  const set = (p: Partial<TypeDraft>) => setDraft((d) => ({ ...d, ...p }));

  const submit = async () => {
    const problem = typeProblem(project.issueTypes, draft, type?.id);
    if (problem) return setError(problem);
    setError(null);
    await onSave({ ...draft, name: draft.name.trim() });
  };

  return (
    <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-3">
      <Input
        autoFocus
        aria-label="Type name"
        placeholder="Name, e.g. Customer request"
        value={draft.name}
        maxLength={40}
        onChange={(e) => set({ name: e.target.value })}
        onKeyDown={(e) => e.key === 'Enter' && void submit()}
      />

      <div>
        <p className="mb-1 text-xs font-medium text-muted">Colour</p>
        <div className="flex flex-wrap gap-1.5">
          {TYPE_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              aria-label={`Colour ${c}`}
              aria-pressed={draft.color === c}
              onClick={() => set({ color: c })}
              className={cn('h-6 w-6 rounded-full', draft.color === c && 'ring-2 ring-offset-2 ring-accent ring-offset-surface-2')}
              style={{ background: c }}
            />
          ))}
        </div>
      </div>

      <div>
        <p className="mb-1 text-xs font-medium text-muted">Icon</p>
        <div className="flex flex-wrap gap-1">
          {TYPE_ICONS.map((name) => {
            const Icon = TYPE_ICON_COMPONENTS[name];
            return (
              <button
                key={name}
                type="button"
                aria-label={`Icon ${name}`}
                aria-pressed={draft.icon === name}
                onClick={() => set({ icon: name })}
                className={cn('grid h-7 w-7 place-items-center rounded-md border', draft.icon === name ? 'border-accent bg-accent/15' : 'border-line hover:bg-surface')}
              >
                <Icon size={14} />
              </button>
            );
          })}
        </div>
      </div>

      <fieldset disabled={lockedLevel}>
        <legend className="mb-1 text-xs font-medium text-muted">What is it?</legend>
        <div className="space-y-1" role="radiogroup">
          {LEVEL_CHOICES.map((c) => (
            <label key={c.level} className={cn('flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface', lockedLevel && 'cursor-not-allowed opacity-60')}>
              <input type="radio" name="type-level" className="mt-1" checked={draft.level === c.level} onChange={() => set({ level: c.level, kind: c.level === 2 ? undefined : draft.kind })} />
              <span>
                <b className="font-medium">{c.label}</b>
                <span className="block text-xs text-muted">{c.help}</span>
              </span>
            </label>
          ))}
        </div>
        {lockedLevel && <p className="mt-1 text-[11px] text-muted">This type already has items, so what it is can't change.</p>}
      </fieldset>

      {draft.level !== 2 && (
        <div className="space-y-1 text-sm">
          {draft.level === 1 && (
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={draft.kind === 'approval'} onChange={(e) => set({ kind: e.target.checked ? 'approval' : undefined })} />
              Needs sign-off <span className="text-xs text-muted">(asks for approvers; can't be finished until approved)</span>
            </label>
          )}
          <label className="flex items-center gap-2">
            <input type="checkbox" checked={draft.kind === 'milestone'} onChange={(e) => set({ kind: e.target.checked ? 'milestone' : undefined })} />
            Show as a milestone <span className="text-xs text-muted">(a diamond on the timeline)</span>
          </label>
        </div>
      )}

      {error && (
        <p role="alert" className="text-xs text-danger">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <Button size="sm" variant="primary" onClick={() => void submit()}>
          {type ? 'Save' : 'Add type'}
        </Button>
        <Button size="sm" variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** The project's issue types with add, edit and remove. Used inside the Customize menu. */
export function TypesSection({ project }: { project: Project }) {
  const updateProject = useApp((s) => s.updateProject);
  const deleteIssueType = useApp((s) => s.deleteIssueType);
  const issues = useApp((s) => s.data!.issues);
  const forms = useApp((s) => s.data!.forms);
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [removing, setRemoving] = useState<string | null>(null);
  const [moveTo, setMoveTo] = useState('');

  const count = (id: string) => issues.filter((i) => i.projectId === project.id && i.typeId === id).length;
  const formCount = (id: string) => forms.filter((f) => f.projectId === project.id && f.issueTypeId === id).length;

  return (
    <div>
      <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Issue types</p>
      <ul className="space-y-1">
        {project.issueTypes.map((t) => {
          const n = count(t.id);
          const blocked = removeTypeProblem(project.issueTypes, t.id);
          const needsMove = n > 0 || formCount(t.id) > 0;
          const targets = project.issueTypes.filter((x) => x.id !== t.id && (n > 0 ? x.level === t.level : x.level !== 2));
          return (
            <li key={t.id}>
              {editing === t.id ? (
                <TypeForm
                  project={project}
                  type={t}
                  lockedLevel={n > 0}
                  onCancel={() => setEditing(null)}
                  onSave={async (d) => {
                    const ok = await updateProject(project.id, {
                      issueTypes: project.issueTypes.map((x) => (x.id === t.id ? { ...x, name: d.name, icon: d.icon, color: d.color, level: d.level, kind: d.kind } : x)),
                    });
                    if (ok) setEditing(null);
                    return ok;
                  }}
                />
              ) : removing === t.id ? (
                <div className="space-y-2 rounded-lg border border-line p-2">
                  {needsMove ? (
                    <label className="block text-sm">
                      {n > 0 ? `Make the ${n} item${n > 1 ? 's' : ''} ` : 'Make the request form create '}
                      <Select className="mt-1" aria-label="Move items to" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                        <option value="">Choose a type…</option>
                        {targets.map((x) => (
                          <option key={x.id} value={x.id}>
                            {x.name}
                          </option>
                        ))}
                      </Select>
                    </label>
                  ) : (
                    <p className="text-sm">Nothing uses “{t.name}”. Remove it?</p>
                  )}
                  <div className="flex gap-2">
                    <Button
                      size="sm"
                      variant="danger"
                      disabled={needsMove && !moveTo}
                      onClick={async () => {
                        if (await deleteIssueType(project.id, t.id, needsMove ? moveTo : null)) setRemoving(null);
                      }}
                    >
                      Remove type
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setRemoving(null)}>
                      Cancel
                    </Button>
                  </div>
                </div>
              ) : (
                <div className="group flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-surface-2">
                  <TypeIcon type={t} size={14} />
                  <span className="min-w-0 flex-1 truncate text-sm">{t.name}</span>
                  <span className="text-[11px] text-muted">
                    {t.level === 0 ? (isMilestoneType(t) ? 'Milestone' : 'Group') : t.level === 2 ? 'Part of item' : needsApproval(t) ? 'Needs sign-off' : 'Work item'}
                    {n > 0 && ` · ${n}`}
                  </span>
                  <button aria-label={`Edit ${t.name}`} className="rounded p-1 text-muted hover:bg-surface hover:text-fg" onClick={() => { setEditing(t.id); setRemoving(null); }}>
                    <Pencil size={12} />
                  </button>
                  <button
                    aria-label={`Remove ${t.name}`}
                    title={blocked ?? 'Remove this type'}
                    disabled={!!blocked}
                    className="rounded p-1 text-muted hover:bg-surface hover:text-danger disabled:opacity-30"
                    onClick={() => {
                      setRemoving(t.id);
                      setEditing(null);
                      setMoveTo(targets[0]?.id ?? '');
                    }}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              )}
            </li>
          );
        })}
      </ul>

      {editing === 'new' ? (
        <div className="mt-2">
          <TypeForm
            project={project}
            onCancel={() => setEditing(null)}
            onSave={async (d) => {
              const ok = await updateProject(project.id, { issueTypes: addType(project.issueTypes, d) });
              if (ok) setEditing(null);
              return ok;
            }}
          />
        </div>
      ) : (
        project.issueTypes.length < MAX_TYPES && (
          <button onClick={() => { setEditing('new'); setRemoving(null); }} className="mt-2 flex w-full items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-fg">
            <Plus size={13} /> Add a type
          </button>
        )
      )}
    </div>
  );
}
