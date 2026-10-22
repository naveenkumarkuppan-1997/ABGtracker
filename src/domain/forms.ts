import type { FieldValue, FormField, IntakeForm, NewForm, NewIssue, Priority, Project } from './types';

export const FIELD_KIND_LABEL: Record<FormField['kind'], string> = {
  short: 'Short text',
  long: 'Long text',
  select: 'Dropdown',
  number: 'Number',
  date: 'Date',
  email: 'Email',
  file: 'File upload',
};

export const MAX_ANSWER_LENGTH = 5000;
export const MAX_SUBMISSIONS_PER_HOUR = 20;
/** Files a visitor can send with one request, and the size limit for each. */
export const PUBLIC_MAX_FILES = 3;

export const slugify = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const PRIORITIES: Priority[] = ['critical', 'high', 'medium', 'low'];

/** Checks a form definition against its project. Returns a problem or null. */
export function validateForm(input: Pick<NewForm, 'name' | 'fields' | 'issueTypeId'> & { slug?: string }, project: Project): string | null {
  if (!input.name.trim()) return 'Give the form a name.';
  if (input.slug !== undefined && !/^[a-z0-9][a-z0-9-]{1,39}$/.test(input.slug)) return 'The link name must be 2-40 lowercase letters, digits or dashes.';
  const type = project.issueTypes.find((t) => t.id === input.issueTypeId);
  if (!type || type.level === 2) return 'Choose the issue type that requests become.';
  if (input.fields.length === 0) return 'Add at least one question.';
  if (input.fields.length > 20) return 'A form can have at most 20 questions.';

  const ids = new Set<string>();
  const targets = new Set<string>();
  if (input.fields.filter((f) => f.kind === 'file').length > 1) return 'A form can have only one file upload question.';
  for (const f of input.fields) {
    if (!f.label.trim()) return 'Every question needs a label.';
    if (ids.has(f.id)) return 'Question ids must be unique.';
    ids.add(f.id);
    if (f.kind === 'select' && !(f.options ?? []).filter(Boolean).length) return `“${f.label}” needs at least one option.`;
    if (f.kind === 'file') continue; // files aren't mapped to a field: they become attachments
    if (f.target !== 'description') {
      if (targets.has(f.target)) return `Two questions fill the same field (${f.target}).`;
      targets.add(f.target);
    }
    if (f.target === 'title' && (f.kind === 'long' || f.kind === 'select')) return 'The title question should be short text.';
    if (f.target === 'priority' && f.kind !== 'select') return 'The priority question must be a dropdown (Critical, High, Medium, Low).';
    if (f.target === 'priority' && (f.options ?? []).some((o) => !PRIORITIES.includes(o.trim().toLowerCase() as Priority))) {
      return 'Priority options must be Critical, High, Medium or Low.';
    }
    if (f.target === 'dueDate' && f.kind !== 'date') return 'The due-date question must be a date.';
    if (f.target.startsWith('cf:')) {
      const def = project.customFields.find((c) => c.id === f.target.slice(3));
      if (!def) return `“${f.label}” points to a custom field that no longer exists.`;
    }
  }
  if (!targets.has('title')) return 'One question must be the issue title.';
  if (!input.fields.some((f) => f.target === 'title' && f.required)) return 'The title question must be required.';
  return null;
}

export type Answers = Record<string, string>;

/** Validates what a visitor submitted. Returns a message for the first problem, or null. */
export function validateSubmission(form: Pick<IntakeForm, 'fields'>, answers: Answers, submitter: { name: string; email: string }): string | null {
  if (!submitter.name.trim()) return 'Please tell us your name.';
  if (!EMAIL_RE.test(submitter.email.trim())) return 'Please enter a valid email address.';
  for (const f of form.fields) {
    if (f.kind === 'file') continue; // checked when the files themselves arrive
    const v = (answers[f.id] ?? '').trim();
    if (f.required && !v) return `“${f.label}” is required.`;
    if (!v) continue;
    if (v.length > MAX_ANSWER_LENGTH) return `“${f.label}” is too long.`;
    if (f.kind === 'email' && !EMAIL_RE.test(v)) return `“${f.label}” must be a valid email.`;
    if (f.kind === 'number' && !Number.isFinite(Number(v))) return `“${f.label}” must be a number.`;
    if (f.kind === 'date' && !/^\d{4}-\d{2}-\d{2}$/.test(v)) return `“${f.label}” must be a date.`;
    if (f.kind === 'select' && !(f.options ?? []).includes(v)) return `“${f.label}”: choose one of the options.`;
  }
  return null;
}

const toPriority = (v: string): Priority | undefined => {
  const l = v.toLowerCase();
  return (PRIORITIES as string[]).includes(l) ? (l as Priority) : undefined;
};

/** Turns validated answers into the issue to create. */
export function buildIssue(
  form: Pick<IntakeForm, 'name' | 'fields' | 'issueTypeId' | 'defaultPriority' | 'defaultAssigneeId' | 'projectId'>,
  project: Project,
  answers: Answers,
  submitter: { name: string; email: string }
): NewIssue {
  let title = '';
  let priority: Priority = form.defaultPriority;
  let dueDate: string | undefined;
  const customFields: Record<string, FieldValue> = {};
  const descriptionLines: string[] = [];

  for (const f of form.fields) {
    if (f.kind === 'file') continue;
    const v = (answers[f.id] ?? '').trim();
    if (!v) continue;
    if (f.target === 'title') title = v.replace(/\s+/g, ' ');
    else if (f.target === 'priority') priority = toPriority(v) ?? priority;
    else if (f.target === 'dueDate') dueDate = v;
    else if (f.target.startsWith('cf:')) {
      const def = project.customFields.find((c) => c.id === f.target.slice(3));
      if (def) customFields[def.id] = def.type === 'number' ? Number(v) : def.type === 'multiselect' ? v.split(',').map((x) => x.trim()) : def.type === 'checkbox' ? /^(yes|true|1)$/i.test(v) : v;
    } else descriptionLines.push(f.kind === 'long' ? `**${f.label}**\n${v}` : `**${f.label}:** ${v}`);
  }

  descriptionLines.push(`\n---\n_Submitted via “${form.name}” by ${submitter.name.trim()} (${submitter.email.trim()})_`);
  return {
    projectId: form.projectId,
    typeId: form.issueTypeId,
    title: title.slice(0, 200),
    description: descriptionLines.join('\n\n'),
    priority,
    assigneeId: form.defaultAssigneeId,
    dueDate,
    customFields,
    labels: ['intake'],
  };
}
