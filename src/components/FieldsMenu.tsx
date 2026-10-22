import { useEffect, useRef, useState } from 'react';
import { Plus, SlidersHorizontal } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { FIELD_TYPE_LABEL } from '@/domain/customFields';
import type { CustomFieldDef, FieldType, FieldValue, Member, Project } from '@/domain/types';
import { Button, cn, Input, Select } from './ui';
import { TypesSection } from './TypesEditor';

const storageKey = (projectId: string) => `abg2:visible-fields:${projectId}`;

/** Which custom fields to show on cards and in the list. A personal view setting, remembered in this browser. */
export function useVisibleFields(project: Project | undefined): [string[], (id: string) => void, (id: string) => void] {
  const pid = project?.id ?? '';
  const defaults = (project?.customFields ?? []).slice(0, 2).map((f) => f.id);
  const [saved, setSaved] = useState<string[] | null>(() => {
    try {
      const raw = pid ? localStorage.getItem(storageKey(pid)) : null;
      return raw ? (JSON.parse(raw) as string[]) : null;
    } catch {
      return null;
    }
  });
  const known = new Set((project?.customFields ?? []).map((f) => f.id));
  const visible = (saved ?? defaults).filter((id) => known.has(id));

  const persist = (next: string[]) => {
    setSaved(next);
    try {
      if (pid) localStorage.setItem(storageKey(pid), JSON.stringify(next));
    } catch {
      /* private mode: the choice just isn't remembered */
    }
  };
  const toggle = (id: string) => persist(visible.includes(id) ? visible.filter((x) => x !== id) : [...visible, id]);
  const show = (id: string) => persist(visible.includes(id) ? visible : [...visible, id]);
  return [visible, toggle, show];
}

/** Human-readable value of a custom field, or '' when empty. */
export function formatFieldValue(def: CustomFieldDef, value: FieldValue | undefined, members: Pick<Member, 'id' | 'name'>[]): string {
  if (value === undefined || value === null || value === '') return '';
  if (Array.isArray(value)) return value.join(', ');
  if (typeof value === 'boolean') return value ? 'Yes' : '';
  if (def.type === 'person') return members.find((m) => m.id === value)?.name ?? '';
  if (def.type === 'date' && typeof value === 'string') return new Date(value + 'T00:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  return String(value);
}

const SIMPLE_TYPES: FieldType[] = ['text', 'number', 'date', 'select', 'checkbox', 'person'];

/**
 * One small menu for the two things teams customize most often: which fields show on cards and in
 * the list, and adding a new field. No settings page needed.
 */
export function FieldsMenu({ project, visible, onToggle, onShow }: { project: Project; visible: string[]; onToggle: (id: string) => void; onShow: (id: string) => void }) {
  const canManage = useCan('project.manage');
  const updateProject = useApp((s) => s.updateProject);
  const [open, setOpen] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState('');
  const [type, setType] = useState<FieldType>('text');
  const [options, setOptions] = useState('');
  const [error, setError] = useState<string | null>(null);
  const box = useRef<HTMLDivElement>(null);

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

  const add = async () => {
    setError(null);
    const n = name.trim();
    if (!n) return setError('Give the field a name.');
    if (project.customFields.some((f) => f.name.toLowerCase() === n.toLowerCase())) return setError(`There is already a field called “${n}”.`);
    const opts = options.split(',').map((o) => o.trim()).filter(Boolean);
    if (type === 'select' && opts.length === 0) return setError('Add at least one choice, separated by commas.');
    const id = `cf_${Math.random().toString(36).slice(2, 8)}`;
    const def: CustomFieldDef = { id, name: n, type, ...(type === 'select' ? { options: opts } : {}) };
    if (await updateProject(project.id, { customFields: [...project.customFields, def] })) {
      onShow(id); // a field you just made is one you want to see
      setName('');
      setOptions('');
      setType('text');
      setAdding(false);
    }
  };

  return (
    <div ref={box} className="relative">
      <Button size="sm" aria-expanded={open} aria-haspopup="dialog" onClick={() => setOpen((o) => !o)} title="Choose which fields show on cards, and add your own fields and issue types">
        <SlidersHorizontal size={13} /> Customize
      </Button>
      {open && (
        <div role="dialog" aria-label="Fields" className="absolute right-0 top-full z-30 mt-1.5 max-h-[75vh] w-[22rem] max-w-[92vw] overflow-y-auto rounded-xl border border-line bg-surface p-3 shadow-card">
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Show on cards and in the list</p>
          {project.customFields.length === 0 ? (
            <p className="mb-2 text-sm text-muted">{canManage ? 'No extra fields yet. Add one for anything your team tracks.' : 'This project has no extra fields.'}</p>
          ) : (
            <ul className="mb-2 space-y-0.5">
              {project.customFields.map((f) => (
                <li key={f.id}>
                  <label className="flex cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-sm hover:bg-surface-2">
                    <input type="checkbox" checked={visible.includes(f.id)} onChange={() => onToggle(f.id)} />
                    <span className="min-w-0 flex-1 truncate">{f.name}</span>
                    <span className="text-[11px] text-muted">{FIELD_TYPE_LABEL[f.type]}</span>
                  </label>
                </li>
              ))}
            </ul>
          )}

          {canManage &&
            (adding ? (
              <div className="space-y-2 border-t border-line pt-3">
                <Input autoFocus aria-label="Field name" placeholder="Field name, e.g. Customer" value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />
                <Select aria-label="Field type" value={type} onChange={(e) => setType(e.target.value as FieldType)}>
                  {SIMPLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {FIELD_TYPE_LABEL[t]}
                    </option>
                  ))}
                </Select>
                {type === 'select' && <Input aria-label="Choices" placeholder="Choices, separated by commas" value={options} onChange={(e) => setOptions(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && void add()} />}
                {error && (
                  <p role="alert" className="text-xs text-danger">
                    {error}
                  </p>
                )}
                <div className="flex gap-2">
                  <Button size="sm" variant="primary" onClick={() => void add()}>
                    Add field
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => { setAdding(false); setError(null); }}>
                    Cancel
                  </Button>
                </div>
              </div>
            ) : (
              <button onClick={() => setAdding(true)} className={cn('flex w-full items-center gap-1.5 rounded-md border border-dashed border-line px-2 py-1.5 text-sm text-muted hover:border-accent hover:text-fg')}>
                <Plus size={13} /> Add a field
              </button>
            ))}
          <p className="mt-2 text-[11px] text-muted">Your choice here is just for you. Fields are shared with the whole project.</p>
          {canManage && (
            <div className="mt-3 border-t border-line pt-3">
              <TypesSection project={project} />
            </div>
          )}
        </div>
      )}
    </div>
  );
}
