import { useState } from 'react';
import { useApp, useCan } from '@/store/app';
import { PRIORITIES } from '@/domain/templates';
import { fieldsFor } from '@/domain/customFields';
import { addType, MAX_TYPES, needsApproval, newTypeId } from '@/domain/issueTypes';
import { TypeForm } from './TypesEditor';

const NEW_TYPE = '__new__';
import type { FieldValue, Priority, Project } from '@/domain/types';
import { Button, Field, Input, Modal, Select } from './ui';
import { RichEditor } from './Markdown';
import { CustomFieldInput } from './CustomFieldInput';

export function CreateIssueModal({
  project,
  onClose,
  onCreated,
}: {
  project: Project;
  onClose: () => void;
  onCreated?: (key: string) => void;
}) {
  const { data, createIssue, updateProject } = useApp();
  const canManage = useCan('project.manage');
  const [addingType, setAddingType] = useState(false);
  const members = data!.members;
  const defaultType = project.issueTypes.find((t) => t.level === 1) ?? project.issueTypes[0];
  const [typeId, setTypeId] = useState(defaultType.id);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [statusId, setStatusId] = useState(project.statuses[0].id);
  const [priority, setPriority] = useState<Priority>('medium');
  const [assigneeId, setAssigneeId] = useState('');
  const [parentId, setParentId] = useState('');
  const [estimate, setEstimate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [cf, setCf] = useState<Record<string, FieldValue>>({});
  const [sprintId, setSprintId] = useState('');
  const [approverIds, setApproverIds] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const type = project.issueTypes.find((t) => t.id === typeId)!;
  const parentLevel = type.level === 2 ? 1 : type.level === 1 ? 0 : -1;
  const parentOptions = data!.issues.filter(
    (i) => i.projectId === project.id && project.issueTypes.find((t) => t.id === i.typeId)?.level === parentLevel
  );
  const parentRequired = type.level === 2;
  const fields = fieldsFor(project, typeId);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const issue = await createIssue({
      projectId: project.id,
      typeId,
      title,
      description,
      statusId,
      priority,
      assigneeId: assigneeId || undefined,
      parentId: parentId || undefined,
      estimate: estimate === '' ? undefined : Number(estimate),
      dueDate: dueDate || undefined,
      sprintId: project.workStyle === 'agile' && type.level === 1 && sprintId ? sprintId : undefined,
      approverIds: needsApproval(type) && approverIds.length ? approverIds : undefined,
      customFields: Object.fromEntries(Object.entries(cf).filter(([id]) => fields.some((f) => f.id === id))),
    });
    setBusy(false);
    if (issue) {
      onClose();
      onCreated?.(issue.key);
    }
  };

  return (
    <Modal title={`Create issue in ${project.name}`} onClose={onClose} width="max-w-2xl">
      <form onSubmit={submit} className="space-y-4">
        <div className="grid grid-cols-2 gap-3">
          <Field label="Issue type">
            <Select
              value={typeId}
              onChange={(e) => {
                if (e.target.value === NEW_TYPE) return setAddingType(true);
                setTypeId(e.target.value);
                setParentId('');
              }}
            >
              {project.issueTypes.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.name}
                </option>
              ))}
              {canManage && project.issueTypes.length < MAX_TYPES && <option value={NEW_TYPE}>＋ New type…</option>}
            </Select>
          </Field>
          <Field label="Status">
            <Select value={statusId} onChange={(e) => setStatusId(e.target.value)}>
              {project.statuses.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </Select>
          </Field>
        </div>
        {addingType && (
          <TypeForm
            project={project}
            onCancel={() => setAddingType(false)}
            onSave={async (d) => {
              const id = newTypeId(d.name, project.issueTypes); // same id the server will assign
              const ok = await updateProject(project.id, { issueTypes: addType(project.issueTypes, d) });
              if (ok) {
                setTypeId(id);
                setParentId('');
                setAddingType(false);
              }
              return ok;
            }}
          />
        )}
        <Field label="Summary">
          <Input required autoFocus value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Short, clear summary" />
        </Field>
        <RichEditor label="Description" rows={4} value={description} members={members} onChange={setDescription} />
        {fields.length > 0 && (
          <div className="grid grid-cols-2 gap-3 rounded-lg border border-line bg-surface-2 p-3">
            {fields.map((def) => (
              <Field key={def.id} label={def.name + (def.required ? ' *' : '')}>
                <CustomFieldInput
                  def={def}
                  value={cf[def.id]}
                  members={members}
                  onCommit={(v) => setCf((prev) => ({ ...prev, [def.id]: v }))}
                />
              </Field>
            ))}
          </div>
        )}
        {parentLevel >= 0 && (
          <Field label={parentRequired ? 'Parent issue (required)' : `Parent ${project.issueTypes.find((t) => t.level === 0)?.name ?? ''} (optional)`}>
            <Select required={parentRequired} value={parentId} onChange={(e) => setParentId(e.target.value)}>
              <option value="">{parentRequired ? 'Select parent…' : 'None'}</option>
              {parentOptions.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.key} · {i.title}
                </option>
              ))}
            </Select>
          </Field>
        )}
        {project.workStyle === 'agile' && type.level === 1 && (
          <Field label="Sprint">
            <Select value={sprintId} onChange={(e) => setSprintId(e.target.value)}>
              <option value="">Backlog</option>
              {data!.sprints
                .filter((s) => s.projectId === project.id && s.state !== 'completed')
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                    {s.state === 'active' ? ' (active)' : ''}
                  </option>
                ))}
            </Select>
          </Field>
        )}
        {needsApproval(type) && (
          <fieldset>
            <legend className="mb-1 text-xs font-medium text-muted">Approvers</legend>
            <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
              {members.map((m) => (
                <label key={m.id} className="flex items-center gap-1.5">
                  <input
                    type="checkbox"
                    checked={approverIds.includes(m.id)}
                    onChange={() => setApproverIds((l) => (l.includes(m.id) ? l.filter((x) => x !== m.id) : [...l, m.id]))}
                  />
                  {m.name}
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Assignee">
            <Select value={assigneeId} onChange={(e) => setAssigneeId(e.target.value)}>
              <option value="">Unassigned</option>
              {members.map((m) => (
                <option key={m.id} value={m.id}>
                  {m.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Priority">
            <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
              {PRIORITIES.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={project.workStyle === 'agile' ? 'Story points' : 'Effort'}>
            <Input type="number" min={0} step="0.5" value={estimate} onChange={(e) => setEstimate(e.target.value)} />
          </Field>
          <Field label="Due date">
            <Input type="date" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </Field>
        </div>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" variant="primary" disabled={busy || !title.trim() || (parentRequired && !parentId)}>
            Create
          </Button>
        </div>
      </form>
    </Modal>
  );
}
