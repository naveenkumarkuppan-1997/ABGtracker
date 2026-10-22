import { useState } from 'react';
import type { CustomFieldDef, FieldValue, Member } from '@/domain/types';
import { cn, Input, Select } from './ui';

/** Renders the right control for a custom field type. Commits on blur/change. */
export function CustomFieldInput({
  def,
  value,
  members,
  disabled,
  onCommit,
}: {
  def: CustomFieldDef;
  value: FieldValue | undefined;
  members: Pick<Member, 'id' | 'name'>[];
  disabled?: boolean;
  onCommit: (v: FieldValue) => void;
}) {
  const label = def.name;
  const [draft, setDraft] = useState<string>(value === undefined || value === null || Array.isArray(value) ? '' : String(value));

  switch (def.type) {
    case 'checkbox':
      return (
        <label className="flex items-center gap-2 text-sm">
          <input aria-label={label} type="checkbox" disabled={disabled} checked={value === true} onChange={(e) => onCommit(e.target.checked)} />
          {value === true ? 'Yes' : 'No'}
        </label>
      );
    case 'select':
      return (
        <Select aria-label={label} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onCommit(e.target.value || null)}>
          <option value="">—</option>
          {(def.options ?? []).map((o) => (
            <option key={o}>{o}</option>
          ))}
        </Select>
      );
    case 'multiselect': {
      const sel = Array.isArray(value) ? value : [];
      return (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label={label}>
          {(def.options ?? []).map((o) => {
            const on = sel.includes(o);
            return (
              <button
                type="button"
                key={o}
                disabled={disabled}
                aria-pressed={on}
                onClick={() => onCommit(on ? sel.filter((x) => x !== o) : [...sel, o])}
                className={cn('rounded-full border px-2 py-0.5 text-xs disabled:opacity-60', on ? 'border-accent bg-accent/20 font-medium' : 'border-line text-muted hover:text-fg')}
              >
                {o}
              </button>
            );
          })}
        </div>
      );
    }
    case 'person':
      return (
        <Select aria-label={label} disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onCommit(e.target.value || null)}>
          <option value="">—</option>
          {members.map((m) => (
            <option key={m.id} value={m.id}>
              {m.name}
            </option>
          ))}
        </Select>
      );
    case 'date':
      return <Input aria-label={label} type="date" disabled={disabled} value={typeof value === 'string' ? value : ''} onChange={(e) => onCommit(e.target.value || null)} />;
    case 'number':
      return (
        <Input
          aria-label={label}
          type="number"
          step="any"
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const next = draft === '' ? null : Number(draft);
            if (next !== (value ?? null)) onCommit(next);
          }}
        />
      );
    default:
      return (
        <Input
          aria-label={label}
          type={def.type === 'url' ? 'url' : 'text'}
          placeholder={def.type === 'url' ? 'https://…' : ''}
          disabled={disabled}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => {
            const next = draft.trim() === '' ? null : draft.trim();
            if (next !== (value ?? null)) onCommit(next);
          }}
        />
      );
  }
}
