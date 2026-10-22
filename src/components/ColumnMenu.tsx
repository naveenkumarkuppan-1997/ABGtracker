import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, ChevronDown, Plus, Trash2 } from 'lucide-react';
import { useApp } from '@/store/app';
import { addColumn, CATEGORY_HELP, CATEGORY_LABEL, categoryProblem, MAX_COLUMNS, moveColumn, nameProblem, removeProblem, renameColumn, setColumnCategory } from '@/domain/columns';
import type { Project, Status, StatusCategory } from '@/domain/types';
import { Button, cn, Input, Select } from './ui';

/** The column title. For people who may restructure the project it opens a small menu; otherwise it's plain text. */
export function ColumnTitle({ project, status, count, canManage }: { project: Project; status: Status; count: number; canManage: boolean }) {
  const updateProject = useApp((s) => s.updateProject);
  const deleteStatus = useApp((s) => s.deleteStatus);
  const notify = useApp((s) => s.notify);
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(status.name);
  const [deleting, setDeleting] = useState(false);
  const [moveTo, setMoveTo] = useState('');
  const box = useRef<HTMLDivElement>(null);
  const index = project.statuses.findIndex((s) => s.id === status.id);
  const others = project.statuses.filter((s) => s.id !== status.id);

  useEffect(() => {
    setName(status.name);
  }, [status.name]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => !box.current?.contains(e.target as Node) && setOpen(false);
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  if (!canManage) return <h3 className="text-xs font-semibold uppercase tracking-wide">{status.name}</h3>;

  const save = (statuses: Status[]) => updateProject(project.id, { statuses });

  const commitName = async () => {
    const n = name.trim();
    if (n === status.name) return;
    const problem = nameProblem(project.statuses, n, status.id);
    if (problem) {
      notify(problem);
      setName(status.name);
      return;
    }
    await save(renameColumn(project.statuses, status.id, n));
  };

  const setCategory = async (c: StatusCategory) => {
    const problem = categoryProblem(project.statuses, status.id, c);
    if (problem) return notify(problem);
    await save(setColumnCategory(project.statuses, status.id, c));
  };

  const removeBlocked = removeProblem(project.statuses, status.id);

  return (
    <div ref={box} className="relative min-w-0">
      <h3 className="text-xs font-semibold uppercase tracking-wide">
        <button
          aria-haspopup="dialog"
          aria-expanded={open}
          title="Rename, recolour or remove this column"
          onClick={() => setOpen((o) => !o)}
          className="inline-flex max-w-full items-center gap-1 rounded px-1 py-0.5 uppercase hover:bg-surface"
        >
          <span className="truncate">{status.name}</span>
          <ChevronDown size={11} className="shrink-0 text-muted" />
        </button>
      </h3>
      {open && (
        <div role="dialog" aria-label={`Column: ${status.name}`} className="absolute left-0 top-full z-30 mt-1 w-72 space-y-3 rounded-xl border border-line bg-surface p-3 normal-case tracking-normal shadow-card">
          <label className="block">
            <span className="mb-1 block text-xs font-medium text-muted">Name</span>
            <Input
              value={name}
              maxLength={60}
              onChange={(e) => setName(e.target.value)}
              onBlur={() => void commitName()}
              onKeyDown={(e) => e.key === 'Enter' && void commitName()}
            />
          </label>

          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted">Cards here count as</legend>
            <div className="grid grid-cols-3 gap-1" role="radiogroup">
              {(Object.keys(CATEGORY_LABEL) as StatusCategory[]).map((c) => (
                <button
                  key={c}
                  role="radio"
                  aria-checked={status.category === c}
                  onClick={() => void setCategory(c)}
                  className={cn('rounded-md border px-1 py-1.5 text-xs', status.category === c ? 'border-accent bg-accent/15 font-medium' : 'border-line text-muted hover:bg-surface-2')}
                >
                  {CATEGORY_LABEL[c]}
                </button>
              ))}
            </div>
            <p className="mt-1 text-[11px] text-muted">{CATEGORY_HELP[status.category]}</p>
          </fieldset>

          <div className="flex items-center gap-2">
            <Button size="sm" disabled={index <= 0} onClick={() => void save(moveColumn(project.statuses, status.id, -1))}>
              <ArrowLeft size={12} /> Move left
            </Button>
            <Button size="sm" disabled={index >= project.statuses.length - 1} onClick={() => void save(moveColumn(project.statuses, status.id, 1))}>
              Move right <ArrowRight size={12} />
            </Button>
          </div>

          <div className="border-t border-line pt-3">
            {deleting ? (
              <div className="space-y-2">
                {count > 0 ? (
                  <label className="block text-sm">
                    Move the {count} card{count > 1 ? 's' : ''} to
                    <Select className="mt-1" value={moveTo} onChange={(e) => setMoveTo(e.target.value)}>
                      <option value="">Choose a column…</option>
                      {others.map((s) => (
                        <option key={s.id} value={s.id}>
                          {s.name}
                        </option>
                      ))}
                    </Select>
                  </label>
                ) : (
                  <p className="text-sm">This column is empty. Remove it?</p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={count > 0 && !moveTo}
                    onClick={async () => {
                      if (await deleteStatus(project.id, status.id, count > 0 ? moveTo : null)) setOpen(false);
                    }}
                  >
                    Remove column
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setDeleting(false)}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button
                disabled={!!removeBlocked}
                title={removeBlocked ?? 'Remove this column'}
                onClick={() => {
                  setDeleting(true);
                  setMoveTo(others.find((s) => s.category === status.category)?.id ?? others[0]?.id ?? '');
                }}
                className="flex items-center gap-1.5 text-sm text-danger disabled:cursor-not-allowed disabled:opacity-40"
              >
                <Trash2 size={13} /> Remove column…
              </button>
            )}
            {removeBlocked && <p className="mt-1 text-[11px] text-muted">{removeBlocked}</p>}
          </div>
        </div>
      )}
    </div>
  );
}

/** The "+ Add column" tile at the end of the board. */
export function AddColumn({ project }: { project: Project }) {
  const updateProject = useApp((s) => s.updateProject);
  const notify = useApp((s) => s.notify);
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');

  if (project.statuses.length >= MAX_COLUMNS) return null;

  const submit = async () => {
    const n = name.trim();
    if (!n) return setEditing(false);
    const problem = nameProblem(project.statuses, n);
    if (problem) return notify(problem);
    if (await updateProject(project.id, { statuses: addColumn(project.statuses, n) })) {
      setName('');
      setEditing(false);
    }
  };

  return (
    <div className="w-72 shrink-0">
      {editing ? (
        <div className="rounded-xl border border-accent bg-surface p-3">
          <Input
            autoFocus
            aria-label="New column name"
            placeholder="Column name, e.g. Testing"
            value={name}
            maxLength={60}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit();
              if (e.key === 'Escape') {
                setName('');
                setEditing(false);
              }
            }}
          />
          <div className="mt-2 flex gap-2">
            <Button size="sm" variant="primary" onClick={() => void submit()}>
              Add column
            </Button>
            <Button size="sm" variant="ghost" onClick={() => { setName(''); setEditing(false); }}>
              Cancel
            </Button>
          </div>
          <p className="mt-2 text-[11px] text-muted">It goes just before Done. You can rename, recolour or move it any time from its title.</p>
        </div>
      ) : (
        <button
          onClick={() => setEditing(true)}
          className="flex w-full items-center gap-1.5 rounded-xl border border-dashed border-line px-3 py-3 text-sm text-muted hover:border-accent hover:bg-surface hover:text-fg"
        >
          <Plus size={14} /> Add column
        </button>
      )}
    </div>
  );
}
