import { useState } from 'react';
import { Bookmark, Save, Trash2 } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import type { SavedFilter } from '@/domain/types';
import { Button, Input, Modal, Select, Field } from './ui';

/** Dropdown of saved filters + "save current query" dialog. */
export function SavedFilters({
  query,
  onApply,
  canSave,
}: {
  query: string;
  onApply: (q: string) => void;
  canSave: boolean;
}) {
  const data = useApp((s) => s.data)!;
  const userId = useApp((s) => s.userId);
  const deleteFilter = useApp((s) => s.deleteFilter);
  const canManage = useCan('project.manage');
  const [saving, setSaving] = useState(false);
  const [selected, setSelected] = useState('');

  const filters = data.filters;
  const current = filters.find((f) => f.id === selected);
  const mine = (f: SavedFilter) => f.ownerId === userId || canManage;

  return (
    <div className="flex items-center gap-1.5">
      <Bookmark size={14} className="text-muted" />
      <Select
        aria-label="Saved filters"
        className="w-44"
        value={selected}
        onChange={(e) => {
          setSelected(e.target.value);
          const f = filters.find((x) => x.id === e.target.value);
          if (f) onApply(f.query);
        }}
      >
        <option value="">Saved filters…</option>
        {filters.map((f) => (
          <option key={f.id} value={f.id}>
            {f.name}
            {f.shared ? ' (shared)' : ''}
          </option>
        ))}
      </Select>
      {current && mine(current) && (
        <Button
          size="sm"
          variant="ghost"
          aria-label="Delete saved filter"
          onClick={async () => {
            if (confirm(`Delete filter “${current.name}”?`)) {
              await deleteFilter(current.id);
              setSelected('');
            }
          }}
        >
          <Trash2 size={13} />
        </Button>
      )}
      {canSave && (
        <Button size="sm" disabled={!query.trim()} onClick={() => setSaving(true)}>
          <Save size={13} /> Save
        </Button>
      )}
      {saving && <SaveDialog query={query} onClose={() => setSaving(false)} />}
    </div>
  );
}

function SaveDialog({ query, onClose }: { query: string; onClose: () => void }) {
  const saveFilter = useApp((s) => s.saveFilter);
  const canShare = useCan('filter.share');
  const [name, setName] = useState('');
  const [shared, setShared] = useState(false);
  return (
    <Modal title="Save filter" onClose={onClose}>
      <form
        className="space-y-4"
        onSubmit={async (e) => {
          e.preventDefault();
          if (await saveFilter({ name, query, shared })) onClose();
        }}
      >
        <Field label="Name">
          <Input required value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Blocked this week" />
        </Field>
        <p className="rounded-md bg-surface-2 p-2 font-mono text-xs">{query}</p>
        {canShare && (
          <label className="flex items-center gap-2 text-sm">
            <input type="checkbox" checked={shared} onChange={(e) => setShared(e.target.checked)} /> Share with everyone in the organization
          </label>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={!name.trim()}>
            Save filter
          </Button>
        </div>
      </form>
    </Modal>
  );
}
