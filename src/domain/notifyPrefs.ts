import { isValidTimeZone } from './timeZone';
import type { NotificationKind, NotifyPrefs, User } from './types';

/** What a person gets unless they choose otherwise: an email soon after something needs them. */
export const DEFAULT_NOTIFY_PREFS: NotifyPrefs = { email: 'instant', scope: 'important' };

/** Things that are addressed to you or wait on you. Everything else is "nice to know". */
export const IMPORTANT_KINDS: readonly NotificationKind[] = ['mention', 'assigned', 'approval', 'intake', 'due'];
export const MAX_MUTED_PROJECTS = 200;

/** Plain-words description of each kind, used in emails ("Priya assigned you PLT-3"). */
export const NOTIFY_VERB: Record<NotificationKind, string> = {
  mention: 'mentioned you in',
  assigned: 'assigned you',
  comment: 'commented on',
  status: 'changed the status of',
  approval: 'updated the approval on',
  automation: 'ran an automation on',
  intake: 'sent a request:',
  due: 'about', // "Reminder about PLT-3 Fix login" + the detail "Due tomorrow (2026-10-10)"
};

export const isLead = (v: unknown): v is number => typeof v === 'number' && Number.isInteger(v) && v >= 1 && v <= 7;

const cleanIds = (v: unknown): string[] =>
  Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && x.length > 0 && x.length <= 64))].slice(0, MAX_MUTED_PROJECTS) : [];

export const EMAIL_CHOICES: { value: NotifyPrefs['email']; label: string; hint: string }[] = [
  { value: 'instant', label: 'As it happens', hint: 'One email within a few minutes. Several updates close together are grouped.' },
  { value: 'daily', label: 'Once a day', hint: 'A single morning summary of everything new.' },
  { value: 'off', label: 'Never', hint: 'Only the Inbox in the app.' },
];

export const SCOPE_CHOICES: { value: NotifyPrefs['scope']; label: string; hint: string }[] = [
  { value: 'important', label: 'Only what needs me', hint: 'Mentions, assignments, approvals and new requests.' },
  { value: 'all', label: 'Everything in my Inbox', hint: 'Also comments, status changes and automations on my work.' },
];

/** The person's choices with any missing or invalid part replaced by the default. */
export function resolvePrefs(user: Pick<User, 'notify'> | undefined): NotifyPrefs {
  const p = user?.notify;
  return {
    email: p && EMAIL_CHOICES.some((c) => c.value === p.email) ? p.email : DEFAULT_NOTIFY_PREFS.email,
    scope: p && SCOPE_CHOICES.some((c) => c.value === p.scope) ? p.scope : DEFAULT_NOTIFY_PREFS.scope,
    mutedProjects: cleanIds(p?.mutedProjects),
    ...(isValidTimeZone(p?.timeZone) ? { timeZone: p!.timeZone } : {}),
    ...(isLead(p?.dueLeadDays) ? { dueLeadDays: p!.dueLeadDays } : {}),
  };
}

/** Throws a user-facing message for anything that is not one of the offered choices. */
export function validatePrefs(input: unknown): NotifyPrefs {
  const p = (input ?? {}) as Record<string, unknown>;
  const email = EMAIL_CHOICES.find((c) => c.value === p.email)?.value;
  const scope = SCOPE_CHOICES.find((c) => c.value === p.scope)?.value;
  if (!email || !scope) throw new Error('Choose one of the offered options.');
  if (p.mutedProjects !== undefined && (!Array.isArray(p.mutedProjects) || p.mutedProjects.length > MAX_MUTED_PROJECTS)) throw new Error('Choose one of the offered options.');
  if (p.timeZone !== undefined && p.timeZone !== null && !isValidTimeZone(p.timeZone)) throw new Error('Choose a time zone from the list.');
  if (p.dueLeadDays !== undefined && p.dueLeadDays !== null && !isLead(p.dueLeadDays)) throw new Error('Choose 1 to 7 days.');
  return { email, scope, mutedProjects: cleanIds(p.mutedProjects), ...(isValidTimeZone(p.timeZone) ? { timeZone: p.timeZone } : {}), ...(isLead(p.dueLeadDays) ? { dueLeadDays: p.dueLeadDays } : {}) };
}

export function wantsEmail(prefs: NotifyPrefs, kind: NotificationKind, projectId?: string): boolean {
  if (prefs.email === 'off') return false;
  if (projectId && prefs.mutedProjects?.includes(projectId)) return false;
  return prefs.scope === 'all' || IMPORTANT_KINDS.includes(kind);
}
