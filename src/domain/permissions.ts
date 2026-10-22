import type { Role } from './types';

export type Action =
  | 'project.create'
  | 'issue.create'
  | 'issue.edit'
  | 'issue.delete'
  | 'comment.add'
  | 'project.manage'
  | 'sprint.manage'
  | 'automation.manage'
  | 'filter.share'
  | 'member.manage';

const MATRIX: Record<Role, Action[]> = {
  owner: ['automation.manage', 'sprint.manage', 'project.create', 'project.manage', 'filter.share', 'issue.create', 'issue.edit', 'issue.delete', 'comment.add', 'member.manage'],
  admin: ['automation.manage', 'sprint.manage', 'project.create', 'project.manage', 'filter.share', 'issue.create', 'issue.edit', 'issue.delete', 'comment.add', 'member.manage'],
  member: ['sprint.manage', 'project.create', 'issue.create', 'issue.edit', 'comment.add'],
  guest: ['comment.add'],
};

/**
 * Single source of truth for authorization. The UI uses it to hide controls;
 * the future backend must enforce the same matrix on every request.
 */
export function can(role: Role | undefined, action: Action): boolean {
  return !!role && MATRIX[role].includes(action);
}

export const ROLE_LABEL: Record<Role, string> = {
  owner: 'Owner',
  admin: 'Admin',
  member: 'Member',
  guest: 'Guest',
};
