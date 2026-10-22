import { useState } from 'react';
import { ArrowDown, ArrowUp, Copy, ExternalLink, Pencil, Plus, Trash2 } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { FIELD_KIND_LABEL, slugify, validateForm } from '@/domain/forms';
import { timeAgo } from '@/domain/selectors';
import { PRIORITIES } from '@/domain/templates';
import type { FormField, FormFieldKind, FormFieldTarget, IntakeForm, Priority, Project } from '@/domain/types';
import { Badge, Button, Field, Input, Modal, Select, Textarea, EmptyState } from '@/components/ui';
import { Question } from './PublicForm';
import { useProjectCtx } from './ProjectPage';

const rid = () => `q_${Math.random().toString(36).slice(2, 7)}`;

export function FormsView() {
  const { project, allIssues } = useProjectCtx();
  const data = useApp((s) => s.data)!;
  const canManage = useCan('project.manage');
  const updateForm = useApp((s) => s.updateForm);
  const deleteForm = useApp((s) => s.deleteForm);
  const notify = useApp((s) => s.notify);
  const [editing, setEditing] = useState<IntakeForm | 'new' | null>(null);

  if (!canManage) return <EmptyState title="Admins only" body="Ask an organization admin or owner to manage request forms." />;

  const forms = data.forms.filter((f) => f.projectId === project.id);
  const link = (f: IntakeForm) => `${location.origin}/forms/${data.org.slug}/${f.slug}`;
  const submissions = allIssues.filter((i) => i.source).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 8);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Request forms</h2>
          <p className="text-sm text-muted">Let anyone, even people without an account, send requests straight into this project. Each answer lands on the right field.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={14} /> New form
        </Button>
      </header>

      {forms.length === 0 ? (
        <EmptyState title="No forms yet" body="Create a bug-report or request form and share its link." />
      ) : (
        <ul className="space-y-2">
          {forms.map((f) => (
            <li key={f.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <h3 className="font-medium">{f.name}</h3>
                {!f.enabled && <Badge>Closed</Badge>}
                <span className="ml-auto text-xs text-muted">
                  {f.submissionCount} submission{f.submissionCount === 1 ? '' : 's'}
                </span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" role="switch" aria-label={`${f.name} accepting requests`} checked={f.enabled} onChange={(e) => void updateForm(f.id, { enabled: e.target.checked })} />
                  Open
                </label>
                <Button size="sm" variant="ghost" aria-label={`Edit ${f.name}`} onClick={() => setEditing(f)}>
                  <Pencil size={13} />
                </Button>
                <Button size="sm" variant="ghost" aria-label={`Delete ${f.name}`} onClick={() => confirm(`Delete “${f.name}”? Its public link will stop working.`) && void deleteForm(f.id)}>
                  <Trash2 size={13} />
                </Button>
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <code className="min-w-0 flex-1 truncate rounded bg-surface-2 px-2 py-1 text-xs">{link(f)}</code>
                <Button
                  size="sm"
                  onClick={async () => {
                    try {
                      await navigator.clipboard.writeText(link(f));
                      notify('Link copied');
                    } catch {
                      notify('Could not copy the link');
                    }
                  }}
                >
                  <Copy size={12} /> Copy
                </Button>
                <a href={link(f)} target="_blank" rel="noreferrer" className="inline-flex h-7 items-center gap-1 rounded-md border border-line px-2.5 text-xs hover:bg-surface-2">
                  <ExternalLink size={12} /> Open
                </a>
              </div>
            </li>
          ))}
        </ul>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent submissions</h3>
        {submissions.length === 0 ? (
          <p className="text-sm text-muted">Nothing submitted yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-sm">
            {submissions.map((i) => (
              <li key={i.id} className="flex items-center gap-3 px-4 py-2">
                <span className="w-16 shrink-0 text-xs text-muted">{i.key}</span>
                <span className="min-w-0 flex-1 truncate">{i.title}</span>
                <span className="hidden text-xs text-muted sm:inline">
                  {i.source!.submitterName} · {i.source!.formName}
                </span>
                <span className="shrink-0 text-xs text-muted">{timeAgo(i.createdAt)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <FormEditor project={project} form={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const TARGETS: { value: FormFieldTarget; label: string }[] = [
  { value: 'title', label: 'Issue title' },
  { value: 'description', label: 'Description' },
  { value: 'priority', label: 'Priority' },
  { value: 'dueDate', label: 'Due date' },
];

function FormEditor({ project, form, onClose }: { project: Project; form?: IntakeForm; onClose: () => void }) {
  const members = useApp((s) => s.data!.members);
  const createForm = useApp((s) => s.createForm);
  const updateForm = useApp((s) => s.updateForm);
  const types = project.issueTypes.filter((t) => t.level !== 2);

  const [name, setName] = useState(form?.name ?? '');
  const [description, setDescription] = useState(form?.description ?? '');
  const [slug, setSlug] = useState(form?.slug ?? '');
  const [slugTouched, setSlugTouched] = useState(!!form);
  const [issueTypeId, setIssueTypeId] = useState(form?.issueTypeId ?? (types.find((t) => t.level === 1) ?? types[0]).id);
  const [defaultPriority, setPriority] = useState<Priority>(form?.defaultPriority ?? 'medium');
  const [defaultAssigneeId, setAssignee] = useState(form?.defaultAssigneeId ?? '');
  const [fields, setFields] = useState<FormField[]>(
    form?.fields ?? [
      { id: rid(), label: 'Summary', kind: 'short', required: true, target: 'title' },
      { id: rid(), label: 'Details', kind: 'long', required: false, target: 'description' },
    ]
  );
  const [preview, setPreview] = useState(false);

  const draft = { name, description, slug, fields, issueTypeId, defaultPriority, defaultAssigneeId: defaultAssigneeId || undefined };
  const problem = validateForm(draft, project);

  const patch = (id: string, p: Partial<FormField>) => setFields((l) => l.map((f) => (f.id === id ? { ...f, ...p } : f)));
  const move = (i: number, d: -1 | 1) =>
    setFields((l) => {
      const n = [...l];
      const j = i + d;
      if (j < 0 || j >= n.length) return l;
      [n[i], n[j]] = [n[j], n[i]];
      return n;
    });

  const targetsFor = (f: FormField): { value: FormFieldTarget; label: string }[] => [
    ...TARGETS,
    ...project.customFields.map((c) => ({ value: `cf:${c.id}` as FormFieldTarget, label: `Field: ${c.name}` })),
  ].filter((t) => t.value === f.target || !fields.some((o) => o.id !== f.id && o.target === t.value) || t.value === 'description');

  const save = async () => {
    const ok = form ? await updateForm(form.id, draft) : await createForm(project.id, draft);
    if (ok) onClose();
  };

  return (
    <Modal title={form ? `Edit “${form.name}”` : 'New request form'} onClose={onClose} width="max-w-3xl">
      <div className="space-y-5">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input
              value={name}
              onChange={(e) => {
                setName(e.target.value);
                if (!slugTouched) setSlug(slugify(e.target.value));
              }}
              placeholder="e.g. Report a bug"
            />
          </Field>
          <Field label="Link name" hint="/forms/…/your-link">
            <Input
              value={slug}
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(slugify(e.target.value));
              }}
            />
          </Field>
        </div>
        <Field label="Intro shown to people filling it in">
          <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
        </Field>

        <div className="grid gap-3 sm:grid-cols-3">
          <Field label="Becomes a…">
            <Select value={issueTypeId} onChange={(e) => setIssueTypeId(e.target.value)}>
              {types.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Default priority">
            <Select value={defaultPriority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Assign to">
            <Select value={defaultAssigneeId} onChange={(e) => setAssignee(e.target.value)}>
              <option value="">Nobody (triage)</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>

        <section className="space-y-2">
          <div className="flex items-center justify-between">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Questions</h3>
            <button className="text-xs text-muted underline hover:text-fg" onClick={() => setPreview((p) => !p)}>
              {preview ? 'Back to editing' : 'Preview'}
            </button>
          </div>
          {preview ? (
            <div className="space-y-3 rounded-lg border border-line bg-surface-2 p-4">
              {fields.map((f) => (
                <Question key={f.id} field={f} value="" onChange={() => {}} disabled />
              ))}
            </div>
          ) : (
            <ul className="space-y-2">
              {fields.map((f, i) => (
                <li key={f.id} className="space-y-2 rounded-lg border border-line p-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <Input aria-label={`Question ${i + 1} label`} className="min-w-48 flex-1" value={f.label} onChange={(e) => patch(f.id, { label: e.target.value })} />
                    <Select
                      aria-label={`Question ${i + 1} type`}
                      className="w-36"
                      value={f.kind}
                      onChange={(e) => patch(f.id, { kind: e.target.value as FormFieldKind, options: e.target.value === 'select' ? f.options ?? ['Option 1'] : undefined })}
                    >
                      {Object.entries(FIELD_KIND_LABEL).map(([v, l]) => (
                        <option key={v} value={v}>
                          {l}
                        </option>
                      ))}
                    </Select>
                    <Select aria-label={`Question ${i + 1} goes to`} className="w-44" value={f.target} onChange={(e) => patch(f.id, { target: e.target.value as FormFieldTarget })}>
                      {targetsFor(f).map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                    <label className="flex items-center gap-1 text-xs">
                      <input type="checkbox" checked={f.required} onChange={(e) => patch(f.id, { required: e.target.checked })} /> Required
                    </label>
                    <Button size="sm" variant="ghost" aria-label="Move up" disabled={i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Move down" disabled={i === fields.length - 1} onClick={() => move(i, 1)}>
                      <ArrowDown size={13} />
                    </Button>
                    <Button size="sm" variant="ghost" aria-label="Remove question" onClick={() => setFields((l) => l.filter((x) => x.id !== f.id))}>
                      <Trash2 size={13} />
                    </Button>
                  </div>
                  {f.kind === 'select' && (
                    <Input
                      aria-label="Options"
                      value={(f.options ?? []).join(', ')}
                      onChange={(e) => patch(f.id, { options: e.target.value.split(',').map((o) => o.trimStart()) })}
                      onBlur={(e) => patch(f.id, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                      placeholder="Options, comma separated"
                    />
                  )}
                </li>
              ))}
            </ul>
          )}
          {!preview && (
            <Button size="sm" onClick={() => setFields((l) => [...l, { id: rid(), label: `Question ${l.length + 1}`, kind: 'short', required: false, target: 'description' }])}>
              <Plus size={12} /> Add question
            </Button>
          )}
        </section>

        {problem && name && (
          <p role="alert" className="text-sm text-muted">
            {problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" disabled={!!problem} onClick={save}>
            {form ? 'Save form' : 'Create form'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
