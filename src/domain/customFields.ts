import type { CustomFieldDef, FieldType, FieldValue, ID, Project } from './types';

export const FIELD_TYPE_LABEL: Record<FieldType, string> = {
  text: 'Text',
  number: 'Number',
  date: 'Date',
  select: 'Dropdown',
  multiselect: 'Multi-select',
  checkbox: 'Checkbox',
  person: 'Person',
  url: 'Link',
};

export const isEmptyValue = (v: FieldValue | undefined): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Custom fields that apply to a given issue type. */
export function fieldsFor(project: Pick<Project, 'customFields'>, typeId: ID): CustomFieldDef[] {
  return project.customFields.filter((f) => !f.typeIds || f.typeIds.length === 0 || f.typeIds.includes(typeId));
}

function validateValue(def: CustomFieldDef, v: FieldValue): string | null {
  if (isEmptyValue(v)) return null;
  switch (def.type) {
    case 'number':
      return typeof v === 'number' && Number.isFinite(v) ? null : `${def.name} must be a number.`;
    case 'checkbox':
      return typeof v === 'boolean' ? null : `${def.name} must be true/false.`;
    case 'select':
      return typeof v === 'string' && (def.options ?? []).includes(v) ? null : `${def.name}: "${String(v)}" is not an option.`;
    case 'multiselect':
      return Array.isArray(v) && v.every((x) => (def.options ?? []).includes(x)) ? null : `${def.name} has an invalid option.`;
    case 'date':
      return typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v) ? null : `${def.name} must be a date.`;
    case 'url':
      return typeof v === 'string' && /^https?:\/\/\S+$/i.test(v) ? null : `${def.name} must be a http(s) link.`;
    default:
      return typeof v === 'string' ? null : `${def.name} must be text.`;
  }
}

/** Validates values for the fields that apply to `typeId`; ignores unknown ids. */
export function validateCustomFields(
  project: Pick<Project, 'customFields'>,
  typeId: ID,
  values: Record<ID, FieldValue>,
  opts: { enforceRequired: boolean }
): string | null {
  const defs = fieldsFor(project, typeId);
  for (const def of defs) {
    const v = values[def.id];
    const err = validateValue(def, v ?? null);
    if (err) return err;
    if (opts.enforceRequired && def.required && isEmptyValue(v)) return `${def.name} is required.`;
  }
  return null;
}
