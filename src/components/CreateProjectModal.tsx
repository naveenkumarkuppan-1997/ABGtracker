import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, X } from 'lucide-react';
import { useApp } from '@/store/app';
import { CATEGORY_LABEL, columnsProblem, MAX_COLUMNS } from '@/domain/columns';
import { PROJECT_COLORS, TEMPLATES } from '@/domain/templates';
import type { StatusCategory, WorkStyle } from '@/domain/types';
import { Button, cn, Field, Input, Modal, Textarea } from './ui';

const suggestKey = (name: string) => {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const raw = words.length > 1 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 3);
  return raw.replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 5);
};

type ColumnDraft = { name: string; category: StatusCategory };
const templateColumns = (style: WorkStyle): ColumnDraft[] => TEMPLATES[style].statuses.map((s) => ({ name: s.name, category: s.category }));

export function CreateProjectModal({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const orgSlug = useApp((s) => s.data!.org.slug);
  const createProject = useApp((s) => s.createProject);
  const [name, setName] = useState('');
  const [key, setKey] = useState('');
  const [keyTouched, setKeyTouched] = useState(false);
  const [description, setDescription] = useState('');
  const [color, setColor] = useState(PROJECT_COLORS[0]);
  const [workStyle, setWorkStyle] = useState<WorkStyle>('agile');
  const [columns, setColumns] = useState<ColumnDraft[]>(() => templateColumns('agile'));
  const [busy, setBusy] = useState(false);

  const columnsError = columnsProblem(columns);
  const changed = JSON.stringify(columns) !== JSON.stringify(templateColumns(workStyle));

  const pickStyle = (style: WorkStyle) => {
    setWorkStyle(style);
    setColumns(templateColumns(style)); // each style brings its own sensible starting columns
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (columnsError) return;
    setBusy(true);
    const p = await createProject({ name, key, description, color, workStyle, statuses: columns.map((c) => ({ name: c.name.trim(), category: c.category })) });
    setBusy(false);
    if (p) {
      onClose();
      navigate(`/${orgSlug}/p/${p.key}/board`);
    }
  };

  return (
    <Modal title="Create project" onClose={onClose} width="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-[1fr_110px] gap-3">
          <Field label="Name">
            <Input
              required
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!keyTouched) setKey(suggestKey(e.target.value));
              }}
              placeholder="e.g. Customer Portal"
            />
          </Field>
          <Field label="Key">
            <Input
              required
              value={key}
              onChange={(e) => {
                setKeyTouched(true);
                setKey(e.target.value.toUpperCase());
              }}
              maxLength={10}
              placeholder="CP"
            />
          </Field>
        </div>
        <Field label="Description">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Work style</span>
          <div className="grid gap-2 sm:grid-cols-3">
            {Object.values(TEMPLATES).map((t) => (
              <button
                type="button"
                key={t.style}
                onClick={() => pickStyle(t.style)}
                className={cn(
                  'rounded-lg border p-3 text-left transition',
                  workStyle === t.style ? 'border-accent bg-surface-2 ring-1 ring-accent' : 'border-line hover:bg-surface-2'
                )}
              >
                <div className="text-sm font-semibold">{t.label}</div>
                <div className="mt-1 text-xs text-muted">{t.tagline}</div>
              </button>
            ))}
          </div>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="text-xs font-medium text-muted">Columns</span>
            {changed && (
              <button type="button" className="text-xs text-muted underline hover:text-fg" onClick={() => setColumns(templateColumns(workStyle))}>
                Reset to {TEMPLATES[workStyle].label}
              </button>
            )}
          </div>
          <ul className="flex flex-wrap items-center gap-2" aria-label="Columns">
            {columns.map((c, i) => (
              <li key={i} className="flex items-center gap-1 rounded-md border border-line bg-surface-2 pl-2">
                <span className="h-2 w-2 rounded-full" style={{ background: c.category === 'done' ? '#2f9e6b' : c.category === 'in_progress' ? '#3b82f6' : '#9aa5a1' }} title={CATEGORY_LABEL[c.category]} />
                <input
                  aria-label={`Column ${i + 1} name`}
                  value={c.name}
                  maxLength={40}
                  size={Math.max(4, c.name.length + 1)}
                  onChange={(e) => setColumns((l) => l.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                  className="bg-transparent py-1 text-sm"
                />
                <button
                  type="button"
                  aria-label={`Remove column ${c.name}`}
                  disabled={columns.length <= 2 || (c.category === 'done' && columns.filter((x) => x.category === 'done').length === 1)}
                  onClick={() => setColumns((l) => l.filter((_, j) => j !== i))}
                  className="px-1.5 py-1 text-muted hover:text-danger disabled:opacity-30"
                >
                  <X size={12} />
                </button>
              </li>
            ))}
            {columns.length < MAX_COLUMNS && (
              <li>
                <button
                  type="button"
                  onClick={() =>
                    setColumns((l) => {
                      const firstDone = l.findIndex((x) => x.category === 'done');
                      const col = { name: `Column ${l.length + 1}`, category: 'in_progress' as const };
                      return firstDone < 0 ? [...l, col] : [...l.slice(0, firstDone), col, ...l.slice(firstDone)];
                    })
                  }
                  className="flex items-center gap-1 rounded-md border border-dashed border-line px-2 py-1 text-sm text-muted hover:border-accent hover:text-fg"
                >
                  <Plus size={12} /> Add column
                </button>
              </li>
            )}
          </ul>
          <p className="mt-1.5 text-xs text-muted">
            Start with these, or make them your own. You can change them any time, right on the board.
            {columnsError && <span className="ml-1 text-danger">{columnsError}</span>}
          </p>
        </div>

        <div>
          <span className="mb-1 block text-xs font-medium text-muted">Color</span>
          <div className="flex gap-2">
            {PROJECT_COLORS.map((c) => (
              <button
                type="button"
                key={c}
                aria-label={`Color ${c}`}
                onClick={() => setColor(c)}
                className={cn('h-6 w-6 rounded-full', color === c && 'ring-2 ring-offset-2 ring-accent ring-offset-surface')}
                style={{ background: c }}
              />
            ))}
          </div>
        </div>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !name.trim() || !key.trim()}>
            Create project
          </Button>
        </div>
      </form>
    </Modal>
  );
}
