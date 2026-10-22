import type { IssueType } from './types';

// Helpers behind "add / edit / remove an issue type". A team's own types sit alongside the
// work style's starting ones, and behave exactly the same.

/** Icons a team can choose from (names resolved in components/icons.tsx). */
export const TYPE_ICONS = [
  'check', 'bookmark', 'bug', 'zap', 'star', 'lightbulb', 'rocket', 'wrench', 'megaphone', 'users',
  'phone', 'mail', 'file', 'package', 'truck', 'wallet', 'cart', 'calendar', 'heart', 'palette', 'flag', 'shield', 'branch',
] as const;

export const TYPE_COLORS = ['#3b82f6', '#0f766e', '#2f9e6b', '#f28c28', '#dc4b4b', '#7c5cd6', '#0f8b8d', '#64748b', '#d9a21b', '#db2777'];

/** What kind of thing a type is, in plain words. */
export const LEVEL_CHOICES: { level: IssueType['level']; label: string; help: string }[] = [
  { level: 1, label: 'Work item', help: 'Appears on the board. Most types are this.' },
  { level: 0, label: 'Group of work', help: 'Collects other items under it, like an epic or a milestone.' },
  { level: 2, label: 'Part of an item', help: 'A small step inside another item, like a sub-task.' },
];

export const MAX_TYPES = 15;
export const MAX_TYPE_NAME = 30;

/** Milestones are drawn as diamonds on the timeline. */
export const isMilestoneType = (t?: Pick<IssueType, 'id' | 'kind'>): boolean => !!t && (t.kind === 'milestone' || t.id === 'milestone');

/** Items of this type collect approvers and can't be finished until approved. */
export const needsApproval = (t?: Pick<IssueType, 'id' | 'kind'>): boolean => !!t && (t.kind === 'approval' || t.id === 'approval');

const slug = (s: string) =>
  s
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24) || 'type';

export function newTypeId(name: string, existing: Pick<IssueType, 'id'>[]): string {
  const base = slug(name);
  const taken = new Set(existing.map((t) => t.id));
  if (!taken.has(base)) return base;
  for (let n = 2; ; n++) if (!taken.has(`${base}_${n}`)) return `${base}_${n}`;
}

export interface TypeDraft {
  name: string;
  icon: string;
  color: string;
  level: IssueType['level'];
  kind?: IssueType['kind'];
}

/** What is wrong with a type's details, or null. */
export function typeProblem(types: Pick<IssueType, 'id' | 'name'>[], draft: Pick<TypeDraft, 'name' | 'icon' | 'color' | 'level'>, exceptId?: string): string | null {
  const n = draft.name.trim();
  if (!n) return 'Give the type a name.';
  if (n.length > MAX_TYPE_NAME) return `Keep the name under ${MAX_TYPE_NAME} characters.`;
  if (types.some((t) => t.id !== exceptId && t.name.trim().toLowerCase() === n.toLowerCase())) return `There is already a type called “${n}”.`;
  if (!(TYPE_ICONS as readonly string[]).includes(draft.icon)) return 'Choose an icon from the list.';
  if (!/^#[0-9a-fA-F]{6}$/.test(draft.color)) return 'Choose a colour.';
  if (![0, 1, 2].includes(draft.level)) return 'Choose what kind of item this is.';
  return null;
}

export function addType(types: IssueType[], draft: TypeDraft): IssueType[] {
  const t: IssueType = { id: newTypeId(draft.name, types), name: draft.name.trim(), icon: draft.icon, color: draft.color, level: draft.level, ...(draft.kind ? { kind: draft.kind } : {}) };
  // keep sub-task types last, so the list reads from big to small
  const firstSub = draft.level === 2 ? types.length : types.findIndex((x) => x.level === 2);
  if (firstSub < 0 || draft.level === 2) return [...types, t];
  return [...types.slice(0, firstSub), t, ...types.slice(firstSub)];
}

/** Whole-set rules. A project always needs at least one work-item type. */
export function typesProblem(types: Pick<IssueType, 'id' | 'name' | 'level' | 'icon' | 'color'>[]): string | null {
  if (types.length === 0 || !types.some((t) => t.level === 1)) return 'A project needs at least one work-item type.';
  if (types.length > MAX_TYPES) return `A project can have at most ${MAX_TYPES} types.`;
  if (new Set(types.map((t) => t.id)).size !== types.length) return 'Type ids must be unique.';
  if (types.some((t) => !/^[a-z0-9_-]{1,40}$/i.test(t.id))) return 'A type id may only contain letters, digits, dashes and underscores.';
  const seen = new Set<string>();
  for (const t of types) {
    const problem = typeProblem(types.filter((x) => x.id !== t.id), t, t.id);
    if (problem) return problem;
    const key = t.name.trim().toLowerCase();
    if (seen.has(key)) return `There is already a type called “${t.name}”.`;
    seen.add(key);
  }
  return null;
}

/** Can this type be removed (not the last work-item type)? */
export function removeTypeProblem(types: Pick<IssueType, 'id' | 'level'>[], id: string): string | null {
  const t = types.find((x) => x.id === id);
  if (!t) return 'Type not found.';
  if (t.level === 1 && types.filter((x) => x.level === 1).length <= 1) return 'A project needs at least one work-item type.';
  return null;
}
