import { useState, type ReactNode } from 'react';
import { ArrowDown, ArrowUp, Plus, Trash2 } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { FIELD_TYPE_LABEL } from '@/domain/customFields';
import { PROJECT_COLORS } from '@/domain/templates';
import { REQUIRED_FIELD_LABEL, sanitizeWorkflow } from '@/domain/workflow';
import type { CustomFieldDef, FieldType, Project, RequiredField, Status, StatusCategory, Workflow } from '@/domain/types';
import { Button, cn, EmptyState, Field, Input, Select, Textarea } from '@/components/ui';
import { useProjectCtx } from './ProjectPage';

const rid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 8)}`;
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function ProjectSettings() {
  const { project } = useProjectCtx();
  const canManage = useCan('project.manage');
  if (!canManage) return <EmptyState title="Admins only" body="Ask an organization admin or owner to change project settings." />;
  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <General key={`g-${project.id}`} project={project} />
      <WorkflowEditor key={`w-${project.id}`} project={project} />
      <FieldsEditor key={`f-${project.id}`} project={project} />
    </div>
  );
}

function Card({ title, hint, children, footer }: { title: string; hint?: string; children: ReactNode; footer: ReactNode }) {
  return (
    <section className="rounded-xl border border-line bg-surface">
      <header className="border-b border-line px-5 py-3">
        <h2 className="font-semibold">{title}</h2>
        {hint && <p className="text-xs text-muted">{hint}</p>}
      </header>
      <div className="space-y-4 p-5">{children}</div>
      <footer className="flex items-center justify-end gap-2 border-t border-line bg-surface-2 px-5 py-3">{footer}</footer>
    </section>
  );
}

function SaveBar({ dirty, onSave, onReset }: { dirty: boolean; onSave: () => void; onReset: () => void }) {
  return (
    <>
      {dirty && <span className="mr-auto text-xs text-muted">Unsaved changes</span>}
      <Button onClick={onReset} disabled={!dirty}>
        Discard
      </Button>
      <Button variant="primary" onClick={onSave} disabled={!dirty}>
        Save changes
      </Button>
    </>
  );
}

// ---- General ------------------------------------------------------------------

function General({ project }: { project: Project }) {
  const updateProject = useApp((s) => s.updateProject);
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [color, setColor] = useState(project.color);
  const dirty = name !== project.name || description !== project.description || color !== project.color;
  return (
    <Card
      title="General"
      footer={
        <SaveBar
          dirty={dirty}
          onSave={() => void updateProject(project.id, { name, description, color })}
          onReset={() => {
            setName(project.name);
            setDescription(project.description);
            setColor(project.color);
          }}
        />
      }
    >
      <Field label="Name">
        <Input value={name} onChange={(e) => setName(e.target.value)} />
      </Field>
      <Field label="Description">
        <Textarea rows={2} value={description} onChange={(e) => setDescription(e.target.value)} />
      </Field>
      <div className="flex items-center gap-2">
        <span className="text-xs font-medium text-muted">Color</span>
        {PROJECT_COLORS.map((c) => (
          <button
            key={c}
            aria-label={`Color ${c}`}
            onClick={() => setColor(c)}
            className={cn('h-6 w-6 rounded-full', color === c && 'ring-2 ring-offset-2 ring-accent ring-offset-surface')}
            style={{ background: c }}
          />
        ))}
        <span className="ml-auto text-xs text-muted">Key {project.key} cannot be changed</span>
      </div>
    </Card>
  );
}

// ---- Statuses + workflow ------------------------------------------------------

const CATEGORY_LABEL: Record<StatusCategory, string> = { todo: 'To do', in_progress: 'In progress', done: 'Done' };

function WorkflowEditor({ project }: { project: Project }) {
  const updateProject = useApp((s) => s.updateProject);
  const issues = useApp((s) => s.data!.issues);
  const [statuses, setStatuses] = useState<Status[]>(project.statuses);
  const [workflow, setWorkflow] = useState<Workflow>(project.workflow);
  const dirty = !same(statuses, project.statuses) || !same(workflow, project.workflow);
  const usage = (id: string) => issues.filter((i) => i.projectId === project.id && i.statusId === id).length;

  const move = (idx: number, dir: -1 | 1) =>
    setStatuses((list) => {
      const next = [...list];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return list;
      [next[idx], next[j]] = [next[j], next[idx]];
      return next;
    });

  const toggleTransition = (from: string, to: string) =>
    setWorkflow((w) => {
      const cur = new Set(w.transitions[from] ?? []);
      cur.has(to) ? cur.delete(to) : cur.add(to);
      return { ...w, transitions: { ...w.transitions, [from]: [...cur] } };
    });

  const toggleRequired = (statusId: string, field: RequiredField) =>
    setWorkflow((w) => {
      const rule = w.rules.find((r) => r.toStatusId === statusId);
      const req = new Set(rule?.require ?? []);
      req.has(field) ? req.delete(field) : req.add(field);
      const rules = w.rules.filter((r) => r.toStatusId !== statusId);
      if (req.size) rules.push({ toStatusId: statusId, require: [...req] });
      return { ...w, rules };
    });

  const save = () => void updateProject(project.id, { statuses, workflow: sanitizeWorkflow(workflow, statuses) });

  return (
    <Card
      title="Statuses & workflow"
      hint="Statuses are the board columns. Add rules to control how work moves."
      footer={
        <SaveBar
          dirty={dirty}
          onSave={save}
          onReset={() => {
            setStatuses(project.statuses);
            setWorkflow(project.workflow);
          }}
        />
      }
    >
      <ul className="space-y-2">
        {statuses.map((s, idx) => (
          <li key={s.id} className="flex items-center gap-2">
            <Input aria-label={`Status ${idx + 1} name`} value={s.name} onChange={(e) => setStatuses((l) => l.map((x) => (x.id === s.id ? { ...x, name: e.target.value } : x)))} />
            <Select
              aria-label={`Category of ${s.name}`}
              className="w-40"
              value={s.category}
              onChange={(e) => setStatuses((l) => l.map((x) => (x.id === s.id ? { ...x, category: e.target.value as StatusCategory } : x)))}
            >
              {Object.entries(CATEGORY_LABEL).map(([v, label]) => (
                <option key={v} value={v}>
                  {label}
                </option>
              ))}
            </Select>
            <span className="w-16 text-right text-xs text-muted">{usage(s.id)} issues</span>
            <Button size="sm" variant="ghost" aria-label={`Move ${s.name} up`} disabled={idx === 0} onClick={() => move(idx, -1)}>
              <ArrowUp size={14} />
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Move ${s.name} down`} disabled={idx === statuses.length - 1} onClick={() => move(idx, 1)}>
              <ArrowDown size={14} />
            </Button>
            <Button size="sm" variant="ghost" aria-label={`Delete ${s.name}`} onClick={() => setStatuses((l) => l.filter((x) => x.id !== s.id))}>
              <Trash2 size={14} />
            </Button>
          </li>
        ))}
      </ul>
      <Button size="sm" onClick={() => setStatuses((l) => [...l, { id: rid('s'), name: `New status ${l.length + 1}`, category: 'in_progress' }])}>
        <Plus size={13} /> Add status
      </Button>

      <div className="border-t border-line pt-4">
        <label className="flex items-start gap-2 text-sm">
          <input type="checkbox" className="mt-1" checked={workflow.restrict} onChange={(e) => setWorkflow((w) => ({ ...w, restrict: e.target.checked }))} />
          <span>
            <b>Restrict transitions</b>
            <span className="block text-xs text-muted">Only the moves ticked below are allowed (board, list and detail all respect this). Off = any status to any status.</span>
          </span>
        </label>

        {workflow.restrict && (
          <div className="mt-3 overflow-x-auto">
            <table className="text-xs">
              <thead>
                <tr>
                  <th className="p-1.5 text-left font-medium text-muted">From ↓ / To →</th>
                  {statuses.map((s) => (
                    <th key={s.id} className="p-1.5 font-medium">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {statuses.map((from) => (
                  <tr key={from.id} className="border-t border-line">
                    <td className="p-1.5 font-medium">{from.name}</td>
                    {statuses.map((to) => (
                      <td key={to.id} className="p-1.5 text-center">
                        {from.id === to.id ? (
                          <span className="text-muted">–</span>
                        ) : (
                          <input
                            type="checkbox"
                            aria-label={`${from.name} to ${to.name}`}
                            checked={(workflow.transitions[from.id] ?? []).includes(to.id)}
                            onChange={() => toggleTransition(from.id, to.id)}
                          />
                        )}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      <div className="border-t border-line pt-4">
        <h3 className="text-sm font-semibold">Required fields</h3>
        <p className="mb-2 text-xs text-muted">An issue can only enter a status once these fields are filled.</p>
        <div className="overflow-x-auto">
          <table className="text-xs">
            <thead>
              <tr>
                <th className="p-1.5 text-left font-medium text-muted">Entering status</th>
                {(Object.keys(REQUIRED_FIELD_LABEL) as RequiredField[]).map((f) => (
                  <th key={f} className="p-1.5 font-medium">
                    {REQUIRED_FIELD_LABEL[f]}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {statuses.map((s) => (
                <tr key={s.id} className="border-t border-line">
                  <td className="p-1.5 font-medium">{s.name}</td>
                  {(Object.keys(REQUIRED_FIELD_LABEL) as RequiredField[]).map((f) => (
                    <td key={f} className="p-1.5 text-center">
                      <input
                        type="checkbox"
                        aria-label={`${s.name} requires ${REQUIRED_FIELD_LABEL[f]}`}
                        checked={workflow.rules.find((r) => r.toStatusId === s.id)?.require.includes(f) ?? false}
                        onChange={() => toggleRequired(s.id, f)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </Card>
  );
}

// ---- Custom fields ------------------------------------------------------------

function FieldsEditor({ project }: { project: Project }) {
  const updateProject = useApp((s) => s.updateProject);
  const [fields, setFields] = useState<CustomFieldDef[]>(project.customFields);
  const dirty = !same(fields, project.customFields);
  const patch = (id: string, p: Partial<CustomFieldDef>) => setFields((l) => l.map((f) => (f.id === id ? { ...f, ...p } : f)));

  return (
    <Card
      title="Custom fields"
      hint="Extra data on issues: budgets, customers, environments… Fields can be limited to some issue types."
      footer={<SaveBar dirty={dirty} onSave={() => void updateProject(project.id, { customFields: fields })} onReset={() => setFields(project.customFields)} />}
    >
      {fields.length === 0 && <p className="text-sm text-muted">No custom fields yet.</p>}
      <ul className="space-y-3">
        {fields.map((f) => (
          <li key={f.id} className="space-y-2 rounded-lg border border-line p-3">
            <div className="flex items-center gap-2">
              <Input aria-label="Field name" value={f.name} onChange={(e) => patch(f.id, { name: e.target.value })} />
              <Select
                aria-label={`Type of ${f.name}`}
                className="w-40"
                value={f.type}
                onChange={(e) => patch(f.id, { type: e.target.value as FieldType, options: ['select', 'multiselect'].includes(e.target.value) ? f.options ?? ['Option 1'] : undefined })}
              >
                {Object.entries(FIELD_TYPE_LABEL).map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1.5 text-xs">
                <input type="checkbox" checked={!!f.required} onChange={(e) => patch(f.id, { required: e.target.checked })} /> Required
              </label>
              <Button size="sm" variant="ghost" aria-label={`Delete ${f.name}`} onClick={() => setFields((l) => l.filter((x) => x.id !== f.id))}>
                <Trash2 size={14} />
              </Button>
            </div>
            {(f.type === 'select' || f.type === 'multiselect') && (
              <Field label="Options (comma separated)">
                <Input
                  value={(f.options ?? []).join(', ')}
                  onChange={(e) => patch(f.id, { options: e.target.value.split(',').map((o) => o.trimStart()) })}
                  onBlur={(e) => patch(f.id, { options: e.target.value.split(',').map((o) => o.trim()).filter(Boolean) })}
                />
              </Field>
            )}
            <div className="flex flex-wrap items-center gap-3 text-xs">
              <span className="text-muted">Applies to:</span>
              {project.issueTypes.map((t) => {
                const all = !f.typeIds || f.typeIds.length === 0;
                const on = all || f.typeIds!.includes(t.id);
                return (
                  <label key={t.id} className="flex items-center gap-1">
                    <input
                      type="checkbox"
                      checked={on}
                      onChange={() => {
                        const current = all ? project.issueTypes.map((x) => x.id) : f.typeIds!;
                        const next = on ? current.filter((x) => x !== t.id) : [...current, t.id];
                        patch(f.id, { typeIds: next.length === project.issueTypes.length ? undefined : next });
                      }}
                    />
                    {t.name}
                  </label>
                );
              })}
            </div>
          </li>
        ))}
      </ul>
      <Button size="sm" onClick={() => setFields((l) => [...l, { id: rid('cf'), name: `Field ${l.length + 1}`, type: 'text' }])}>
        <Plus size={13} /> Add field
      </Button>
    </Card>
  );
}
