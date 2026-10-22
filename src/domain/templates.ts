import type { CustomFieldDef, IssueType, Status, WorkStyle } from './types';

// One engine, three work styles. A project picks a template; everything
// (board, list, issue detail) works the same on top of its statuses and types.

export interface WorkStyleTemplate {
  style: WorkStyle;
  label: string;
  tagline: string;
  statuses: Status[];
  issueTypes: IssueType[];
  defaultTypeName: string;
}

const t = (id: string, name: string, icon: string, color: string, level: 0 | 1 | 2): IssueType => ({
  id,
  name,
  icon,
  color,
  level,
});
const s = (id: string, name: string, category: Status['category']): Status => ({ id, name, category });

export const TEMPLATES: Record<WorkStyle, WorkStyleTemplate> = {
  agile: {
    style: 'agile',
    label: 'Agile',
    tagline: 'Sprints, backlog, epics and stories for software teams.',
    defaultTypeName: 'Task',
    statuses: [
      s('backlog', 'Backlog', 'todo'),
      s('selected', 'Selected', 'todo'),
      s('in_progress', 'In Progress', 'in_progress'),
      s('in_review', 'In Review', 'in_progress'),
      s('done', 'Done', 'done'),
    ],
    issueTypes: [
      t('epic', 'Epic', 'zap', '#7c5cd6', 0),
      t('story', 'Story', 'bookmark', '#2f9e6b', 1),
      t('task', 'Task', 'check', '#3b82f6', 1),
      t('bug', 'Bug', 'bug', '#dc4b4b', 1),
      t('subtask', 'Sub-task', 'branch', '#7b8794', 2),
    ],
  },
  flow: {
    style: 'flow',
    label: 'Flow (Kanban)',
    tagline: 'Continuous flow with a simple board and clear limits.',
    defaultTypeName: 'Task',
    statuses: [
      s('todo', 'To Do', 'todo'),
      s('doing', 'Doing', 'in_progress'),
      s('blocked', 'Blocked', 'in_progress'),
      s('done', 'Done', 'done'),
    ],
    issueTypes: [
      t('task', 'Task', 'check', '#3b82f6', 1),
      t('bug', 'Bug', 'bug', '#dc4b4b', 1),
      t('subtask', 'Sub-task', 'branch', '#7b8794', 2),
    ],
  },
  business: {
    style: 'business',
    label: 'Business',
    tagline: 'Tasks, milestones and approvals for ops, marketing and teams.',
    defaultTypeName: 'Task',
    statuses: [
      s('not_started', 'Not started', 'todo'),
      s('in_progress', 'In progress', 'in_progress'),
      s('in_review', 'Needs approval', 'in_progress'),
      s('done', 'Done', 'done'),
    ],
    issueTypes: [
      t('task', 'Task', 'check', '#3b82f6', 1),
      { ...t('milestone', 'Milestone', 'flag', '#f28c28', 0), kind: 'milestone' as const },
      { ...t('approval', 'Approval', 'shield', '#0f8b8d', 1), kind: 'approval' as const },
      t('subtask', 'Sub-task', 'branch', '#7b8794', 2),
    ],
  },
};

/** Starter custom fields per work style (fully editable per project afterwards). */
export function defaultCustomFields(style: WorkStyle): CustomFieldDef[] {
  if (style === 'agile') {
    return [
      { id: 'cf_env', name: 'Environment', type: 'select', options: ['Dev', 'Staging', 'Production'], typeIds: ['bug'] },
      { id: 'cf_customer', name: 'Customer', type: 'text' },
    ];
  }
  if (style === 'business') {
    return [
      { id: 'cf_budget', name: 'Budget', type: 'number' },
      { id: 'cf_channel', name: 'Channel', type: 'multiselect', options: ['Email', 'Social', 'Events', 'PR'] },
    ];
  }
  return [];
}

export const PRIORITIES = [
  { id: 'critical', label: 'Critical', color: '#dc4b4b' },
  { id: 'high', label: 'High', color: '#e8833a' },
  { id: 'medium', label: 'Medium', color: '#d9a21b' },
  { id: 'low', label: 'Low', color: '#5b8def' },
] as const;

export const PROJECT_COLORS = ['#0f766e', '#f28c28', '#2f9e6b', '#64748b', '#3b82f6', '#7c5cd6', '#dc4b4b'];
