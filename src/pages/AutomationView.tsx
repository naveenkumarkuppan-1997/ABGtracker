import { useMemo, useState } from 'react';
import { CheckCircle2, CircleSlash, FlaskConical, Pencil, Plus, Trash2, XCircle, Zap } from 'lucide-react';
import { useApp, useCan } from '@/store/app';
import { describeRule, simulateRule, TRIGGER_LABEL, validateRule } from '@/domain/automation';
import { formatDate, timeAgo } from '@/domain/selectors';
import { PRIORITIES } from '@/domain/templates';
import type { ActionType, AutomationAction, AutomationCondition, AutomationRule, Project, TriggerType } from '@/domain/types';
import { Badge, Button, cn, EmptyState, Field, Input, Modal, Select } from '@/components/ui';
import { useProjectCtx } from './ProjectPage';

export function AutomationView() {
  const { project } = useProjectCtx();
  const data = useApp((s) => s.data)!;
  const canManage = useCan('automation.manage');
  const updateRule = useApp((s) => s.updateRule);
  const deleteRule = useApp((s) => s.deleteRule);
  const [editing, setEditing] = useState<AutomationRule | 'new' | null>(null);

  if (!canManage) return <EmptyState title="Admins only" body="Ask an organization admin or owner to manage automation." />;

  const rules = data.rules.filter((r) => r.projectId === project.id);
  const runs = data.runs.filter((r) => r.projectId === project.id).slice(0, 15);

  return (
    <div className="mx-auto max-w-4xl space-y-6 p-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">Automation</h2>
          <p className="text-sm text-muted">Rules run automatically when work changes. Everything they do is logged and shows as “Automation” on the issue.</p>
        </div>
        <Button variant="primary" onClick={() => setEditing('new')}>
          <Plus size={14} /> New rule
        </Button>
      </header>

      {rules.length === 0 ? (
        <EmptyState title="No rules yet" body="Example: when a bug is created with no assignee, assign it to the triage owner and label it." />
      ) : (
        <ul className="space-y-2">
          {rules.map((r) => (
            <li key={r.id} className="rounded-xl border border-line bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2">
                <Zap size={15} className={r.enabled ? 'text-accent-text' : 'text-muted'} />
                <h3 className="font-medium">{r.name}</h3>
                {!r.enabled && <Badge>Paused</Badge>}
                <span className="ml-auto text-xs text-muted">{r.runCount} run{r.runCount === 1 ? '' : 's'}</span>
                <label className="flex items-center gap-1.5 text-xs">
                  <input type="checkbox" role="switch" aria-label={`${r.name} enabled`} checked={r.enabled} onChange={(e) => void updateRule(r.id, { enabled: e.target.checked })} />
                  On
                </label>
                <Button size="sm" variant="ghost" aria-label={`Edit ${r.name}`} onClick={() => setEditing(r)}>
                  <Pencil size={13} />
                </Button>
                <Button
                  size="sm"
                  variant="ghost"
                  aria-label={`Delete ${r.name}`}
                  onClick={() => confirm(`Delete rule “${r.name}”?`) && void deleteRule(r.id)}
                >
                  <Trash2 size={13} />
                </Button>
              </div>
              <p className="mt-1 text-sm text-muted">{describeRule(r, project, data.members)}</p>
            </li>
          ))}
        </ul>
      )}

      <section>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">Recent activity</h3>
        {runs.length === 0 ? (
          <p className="text-sm text-muted">Nothing has run yet.</p>
        ) : (
          <ul className="divide-y divide-line overflow-hidden rounded-xl border border-line bg-surface text-sm">
            {runs.map((r) => (
              <li key={r.id} className="flex items-start gap-2.5 px-4 py-2">
                {r.result === 'success' ? <CheckCircle2 size={15} className="mt-0.5 text-[#2f9e6b]" /> : r.result === 'error' ? <XCircle size={15} className="mt-0.5 text-danger" /> : <CircleSlash size={15} className="mt-0.5 text-muted" />}
                <div className="min-w-0 flex-1">
                  <p>
                    <b>{r.ruleName}</b> on <span className="text-muted">{r.issueKey}</span>
                  </p>
                  <p className="text-xs text-muted">{r.message}</p>
                </div>
                <span className="shrink-0 text-xs text-muted">{timeAgo(r.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </section>

      {editing && <RuleEditor project={project} rule={editing === 'new' ? undefined : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

const ACTION_LABEL: Record<ActionType, string> = {
  set_assignee: 'Assign to',
  set_priority: 'Set priority',
  move_to_status: 'Move to status',
  add_label: 'Add label',
  add_comment: 'Post comment',
  notify: 'Notify',
};

const FIELD_LABEL: Record<AutomationCondition['field'], string> = { type: 'Type', priority: 'Priority', label: 'Label', assignee: 'Assignee', status: 'Status' };
const OP_LABEL: Record<AutomationCondition['op'], string> = { is: 'is', is_not: 'is not', is_empty: 'is empty', is_not_empty: 'is set' };

function RuleEditor({ project, rule, onClose }: { project: Project; rule?: AutomationRule; onClose: () => void }) {
  const data = useApp((s) => s.data)!;
  const createRule = useApp((s) => s.createRule);
  const updateRule = useApp((s) => s.updateRule);
  const [name, setName] = useState(rule?.name ?? '');
  const [trigger, setTrigger] = useState<AutomationRule['trigger']>(rule?.trigger ?? { type: 'issue_created' });
  const [conditions, setConditions] = useState<AutomationCondition[]>(rule?.conditions ?? []);
  const [actions, setActions] = useState<AutomationAction[]>(rule?.actions ?? [{ type: 'add_label', value: '' }]);
  const [error, setError] = useState<string | null>(null);

  const draft = { name, trigger, conditions, actions };
  const problem = validateRule(draft, project);
  const projectIssues = data.issues.filter((i) => i.projectId === project.id);
  const sim = useMemo(
    () => simulateRule({ trigger, conditions }, project, projectIssues, data.activity),
    [trigger, conditions, project, projectIssues, data.activity]
  );

  const valueOptions = (field: AutomationCondition['field']): { value: string; label: string }[] => {
    switch (field) {
      case 'type':
        return project.issueTypes.map((t) => ({ value: t.id, label: t.name }));
      case 'status':
        return project.statuses.map((s) => ({ value: s.id, label: s.name }));
      case 'priority':
        return PRIORITIES.map((p) => ({ value: p.id, label: p.label }));
      case 'assignee':
        return data.members.map((m) => ({ value: m.id, label: m.name }));
      default:
        return [];
    }
  };

  const save = async () => {
    setError(null);
    if (problem) return setError(problem);
    const ok = rule ? await updateRule(rule.id, draft) : await createRule(project.id, draft);
    if (ok) onClose();
  };

  const setAction = (i: number, p: Partial<AutomationAction>) => setActions((l) => l.map((a, idx) => (idx === i ? { ...a, ...p } : a)));
  const setCond = (i: number, p: Partial<AutomationCondition>) => setConditions((l) => l.map((c, idx) => (idx === i ? { ...c, ...p } : c)));

  return (
    <Modal title={rule ? 'Edit rule' : 'New rule'} onClose={onClose} width="max-w-2xl">
      <div className="space-y-5">
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Escalate overdue bugs" />
        </Field>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">When</h3>
          <div className="flex flex-wrap gap-2">
            <Select aria-label="Trigger" className="w-64" value={trigger.type} onChange={(e) => setTrigger({ type: e.target.value as TriggerType })}>
              {Object.entries(TRIGGER_LABEL).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </Select>
            {trigger.type === 'status_changed' && (
              <Select aria-label="Status filter" className="w-52" value={trigger.statusId ?? ''} onChange={(e) => setTrigger({ type: 'status_changed', statusId: e.target.value || undefined })}>
                <option value="">to any status</option>
                {project.statuses.map((s) => (
                  <option key={s.id} value={s.id}>
                    to {s.name}
                  </option>
                ))}
              </Select>
            )}
          </div>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Only if (all must match)</h3>
          {conditions.map((c, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label="Condition field" className="w-32" value={c.field} onChange={(e) => setCond(i, { field: e.target.value as AutomationCondition['field'], value: '' })}>
                {Object.entries(FIELD_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              <Select aria-label="Condition operator" className="w-32" value={c.op} onChange={(e) => setCond(i, { op: e.target.value as AutomationCondition['op'] })}>
                {Object.entries(OP_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              {(c.op === 'is' || c.op === 'is_not') &&
                (c.field === 'label' ? (
                  <Input aria-label="Condition value" className="w-44" value={c.value ?? ''} onChange={(e) => setCond(i, { value: e.target.value })} placeholder="label" />
                ) : (
                  <Select aria-label="Condition value" className="w-44" value={c.value ?? ''} onChange={(e) => setCond(i, { value: e.target.value })}>
                    <option value="">Choose…</option>
                    {valueOptions(c.field).map((o) => (
                      <option key={o.value} value={o.value}>
                        {o.label}
                      </option>
                    ))}
                  </Select>
                ))}
              <Button size="sm" variant="ghost" aria-label="Remove condition" onClick={() => setConditions((l) => l.filter((_, idx) => idx !== i))}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setConditions((l) => [...l, { field: 'type', op: 'is', value: '' }])}>
            <Plus size={12} /> Add condition
          </Button>
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-semibold uppercase tracking-wide text-muted">Then</h3>
          {actions.map((a, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <Select aria-label="Action" className="w-40" value={a.type} onChange={(e) => setAction(i, { type: e.target.value as ActionType, value: e.target.value === 'notify' ? 'assignee' : '' })}>
                {Object.entries(ACTION_LABEL).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
              {a.type === 'set_assignee' && (
                <Select aria-label="Action value" className="w-48" value={a.value ?? ''} onChange={(e) => setAction(i, { value: e.target.value })}>
                  <option value="">Choose…</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
              {a.type === 'notify' && (
                <Select aria-label="Action value" className="w-48" value={a.value ?? 'assignee'} onChange={(e) => setAction(i, { value: e.target.value })}>
                  <option value="assignee">The assignee</option>
                  <option value="reporter">The reporter</option>
                  {data.members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.name}
                    </option>
                  ))}
                </Select>
              )}
              {a.type === 'set_priority' && (
                <Select aria-label="Action value" className="w-40" value={a.value ?? ''} onChange={(e) => setAction(i, { value: e.target.value })}>
                  <option value="">Choose…</option>
                  {PRIORITIES.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.label}
                    </option>
                  ))}
                </Select>
              )}
              {a.type === 'move_to_status' && (
                <Select aria-label="Action value" className="w-44" value={a.value ?? ''} onChange={(e) => setAction(i, { value: e.target.value })}>
                  <option value="">Choose…</option>
                  {project.statuses.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              )}
              {(a.type === 'add_label' || a.type === 'add_comment') && (
                <Input aria-label="Action value" className="min-w-52 flex-1" value={a.value ?? ''} onChange={(e) => setAction(i, { value: e.target.value })} placeholder={a.type === 'add_label' ? 'label' : 'comment text'} />
              )}
              <Button size="sm" variant="ghost" aria-label="Remove action" onClick={() => setActions((l) => l.filter((_, idx) => idx !== i))}>
                <Trash2 size={13} />
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => setActions((l) => [...l, { type: 'add_label', value: '' }])}>
            <Plus size={12} /> Add action
          </Button>
        </section>

        <section className="rounded-lg border border-dashed border-line bg-surface-2 p-3">
          <h3 className="mb-1 flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-muted">
            <FlaskConical size={13} /> Simulator · last 30 days
          </h3>
          <p className="text-sm">
            This rule would have fired <b>{sim.length}</b> time{sim.length === 1 ? '' : 's'}.
          </p>
          {sim.length > 0 && (
            <ul className="mt-1 max-h-28 space-y-0.5 overflow-auto text-xs text-muted">
              {sim.slice(0, 8).map((f, i) => (
                <li key={f.issueId + i}>
                  <b className="text-fg">{f.issueKey}</b> {f.title} · {f.detail} · {formatDate(f.at)}
                </li>
              ))}
            </ul>
          )}
          <p className="mt-1 text-[11px] text-muted">Estimate from the activity log; conditions use each issue's current values. Nothing is changed.</p>
        </section>

        {(error || (problem && name)) && (
          <p role="alert" className={cn('text-sm', error ? 'text-danger' : 'text-muted')}>
            {error ?? problem}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" onClick={save} disabled={!!problem}>
            {rule ? 'Save rule' : 'Create rule'}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
