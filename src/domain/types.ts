// Domain modxl. Evxry business record carries `orgId` (the tenant boundary).
// IDs are opaque strings and people are always referenced by user id, never by name.

export type ID = string;

export type Role = 'owner' | 'admin' | 'member' | 'guest';
export type WorkStyle = 'agile' | 'flow' | 'business';
export type StatusCategory = 'todo' | 'in_progress' | 'done';
export type Priority = 'critical' | 'high' | 'medium' | 'low';

export interface Organization {
  id: ID;
  name: string;
  slug: string;
  plan: 'free' | 'team' | 'business';
  createdAt: string;
}

/** How a person wants to hear about Inbox items by email. Missing = the defaults (see notifyPrefs.ts). */
export interface NotifyPrefs {
  email: 'instant' | 'daily' | 'off';
  scope: 'important' | 'all';
  /** Projects this person never wants email about (the Inbox still shows them). */
  mutedProjects?: ID[];
  /** Where this person is (IANA name). Decides when their daily summary goes out and which day "due today" means. Missing = UTC. */
  timeZone?: string;
  /** How many days ahead to be reminded about work due (1-7). Missing = 1, the day before. */
  dueLeadDays?: number;
}

export type WidgetId = 'kpis' | 'mine' | 'dueSoon' | 'approvals' | 'projects' | 'health' | 'workload' | 'trend' | 'status' | 'priority' | 'upcoming' | 'watching' | 'activity' | 'briefing';
export type WidgetSize = 'half' | 'full';
export interface DashboardWidget {
  id: WidgetId;
  visible: boolean;
  size: WidgetSize;
}
/** What a person's Home dashboard shows, in what order and how wide. Missing = the default for their role. */
export interface DashboardLayout {
  widgets: DashboardWidget[];
}

export interface User {
  id: ID;
  name: string;
  email: string;
  color: string;
  notify?: NotifyPrefs;
  dashboard?: DashboardLayout;
}

export interface Membership {
  id: ID;
  orgId: ID;
  userId: ID;
  role: Role;
}

/** A user as seen inside one organization. */
export interface Member extends User {
  role: Role;
  membershipId: ID;
}

export interface Status {
  id: ID;
  name: string;
  category: StatusCategory;
}

export interface IssueType {
  id: ID;
  name: string;
  icon: string;
  color: string;
  /** 0 = container (epic), 1 = standard work item, 2 = sub-task */
  level: 0 | 1 | 2;
  /** Optional special behaviour: milestones are drawn as diamonds; approvals collect sign-off. */
  kind?: 'milestone' | 'approval';
}

export type RequiredField = 'assigneeId' | 'estimate' | 'dueDate' | 'description';

export interface WorkflowRule {
  toStatusId: ID;
  /** Fields that must be filled before an issue may enter `toStatusId`. */
  require: RequiredField[];
}

export interface Workflow {
  /** false = any status may move to any other (Kanban-style). */
  restrict: boolean;
  /** from status id -> allowed target status ids (used when `restrict`). */
  transitions: Record<ID, ID[]>;
  rules: WorkflowRule[];
}

export type FieldType = 'text' | 'number' | 'date' | 'select' | 'multiselect' | 'checkbox' | 'person' | 'url';
export type FieldValue = string | number | boolean | string[] | null;

export interface CustomFieldDef {
  id: ID;
  name: string;
  type: FieldType;
  options?: string[];
  required?: boolean;
  /** Issue types the field applies to. Empty/undefined = all types. */
  typeIds?: ID[];
}

export interface Project {
  id: ID;
  orgId: ID;
  key: string;
  name: string;
  description: string;
  color: string;
  workStyle: WorkStyle;
  statuses: Status[];
  issueTypes: IssueType[];
  workflow: Workflow;
  customFields: CustomFieldDef[];
  leadId: ID;
  nextNumber: number;
  createdAt: string;
}

export type FormFieldKind = 'short' | 'long' | 'select' | 'number' | 'date' | 'email' | 'file';
/** Where an answer goes on the created issue. */
export type FormFieldTarget = 'title' | 'description' | 'priority' | 'dueDate' | `cf:${string}`;

export interface FormField {
  id: ID;
  label: string;
  kind: FormFieldKind;
  required: boolean;
  options?: string[];
  /** 'description' (default) appends the answer to the description as "Label: answer". */
  target: FormFieldTarget;
}

export interface IntakeForm {
  id: ID;
  orgId: ID;
  projectId: ID;
  /** URL part: /forms/<org slug>/<slug> */
  slug: string;
  name: string;
  description: string;
  enabled: boolean;
  fields: FormField[];
  issueTypeId: ID;
  defaultPriority: Priority;
  defaultAssigneeId?: ID;
  createdBy: ID;
  createdAt: string;
  submissionCount: number;
}

export type NewForm = Pick<IntakeForm, 'name' | 'description' | 'fields' | 'issueTypeId' | 'defaultPriority'> &
  Partial<Pick<IntakeForm, 'slug' | 'defaultAssigneeId' | 'enabled'>>;
export type FormPatch = Partial<NewForm>;

/** Public view of a form: nothing about members or other projects. */
export interface PublicForm {
  form: Pick<IntakeForm, 'id' | 'slug' | 'name' | 'description' | 'fields'>;
  orgName: string;
  projectName: string;
}

export interface IssueSource {
  formId: ID;
  formName: string;
  submitterName: string;
  submitterEmail: string;
}

export type SprintState = 'planned' | 'active' | 'completed';

export interface Sprint {
  id: ID;
  orgId: ID;
  projectId: ID;
  name: string;
  goal: string;
  startDate?: string;
  endDate?: string;
  state: SprintState;
  /** Points in the sprint when it started / finished (set by start & complete). */
  committedPoints?: number;
  completedPoints?: number;
  startedAt?: string;
  completedAt?: string;
  createdAt: string;
}

export interface Attachment {
  id: ID;
  orgId: ID;
  projectId: ID;
  issueId: ID;
  /** Set when the file was attached to a comment (it then shows under that comment). */
  commentId?: ID;
  /** Set when someone outside the organization sent the file through a request form. */
  externalName?: string;
  /** Display name, already cleaned (no paths, no control characters). */
  name: string;
  size: number;
  /** What the server verified: an image type only when the file's own bytes say so. Everything else is octet-stream. */
  mime: string;
  uploaderId: ID;
  createdAt: string;
  /** Where the bytes live in file storage. Never sent to browsers. */
  storageKey: string;
  sha256: string;
}

/** What browsers receive: everything except where the bytes are stored. */
export type AttachmentView = Omit<Attachment, 'storageKey'>;

export type ApprovalDecision = 'approved' | 'rejected';

export interface Approval {
  approverIds: ID[];
  decisions: Record<ID, { decision: ApprovalDecision; comment?: string; at: string }>;
}

export interface Issue {
  id: ID;
  orgId: ID;
  projectId: ID;
  key: string;
  number: number;
  typeId: ID;
  title: string;
  description: string;
  statusId: ID;
  priority: Priority;
  assigneeId?: ID;
  reporterId: ID;
  parentId?: ID;
  labels: string[];
  estimate?: number;
  startDate?: string;
  dueDate?: string;
  customFields: Record<ID, FieldValue>;
  sprintId?: ID;
  /** Issues that must finish before this one can start. */
  blockedBy: ID[];
  /** Present on issues that need sign-off (Approval type, or any issue once approvers are added). */
  approval?: Approval;
  /** Set when the issue was created from a public intake form. */
  source?: IssueSource;
  /** People who asked to hear about this item's comments and status changes (on top of its assignee and reporter). */
  watcherIds?: ID[];
  /** Priority order across the project (fractional ranking). */
  rank: number;
  createdAt: string;
  updatedAt: string;
  resolvedAt?: string;
}

export interface Comment {
  id: ID;
  orgId: ID;
  issueId: ID;
  authorId: ID;
  body: string;
  /** Users @mentioned in the body (resolved at write time). */
  mentions: ID[];
  /** Emoji reactions: which people used each one. */
  reactions?: Record<string, ID[]>;
  createdAt: string;
}

export type NotificationKind = 'assigned' | 'mention' | 'comment' | 'status' | 'approval' | 'automation' | 'intake' | 'due';

export interface Notification {
  id: ID;
  orgId: ID;
  userId: ID; // recipient
  actorId: ID;
  issueId: ID;
  projectId: ID;
  kind: NotificationKind;
  detail?: string;
  read: boolean;
  createdAt: string;
}

export type TriggerType = 'issue_created' | 'status_changed' | 'assignee_changed' | 'priority_changed' | 'due_date_passed';

export interface AutomationCondition {
  field: 'type' | 'priority' | 'label' | 'assignee' | 'status';
  op: 'is' | 'is_not' | 'is_empty' | 'is_not_empty';
  value?: string;
}

export type ActionType = 'set_assignee' | 'set_priority' | 'move_to_status' | 'add_label' | 'add_comment' | 'notify';

export interface AutomationAction {
  type: ActionType;
  /** set_assignee/notify: user id (notify also accepts 'assignee' | 'reporter'); set_priority: priority;
   *  move_to_status: status id; add_label: label; add_comment: text. */
  value?: string;
}

export interface AutomationRule {
  id: ID;
  orgId: ID;
  projectId: ID;
  name: string;
  enabled: boolean;
  trigger: { type: TriggerType; /** status_changed: only when moving into this status */ statusId?: ID };
  conditions: AutomationCondition[];
  actions: AutomationAction[];
  createdBy: ID;
  createdAt: string;
  runCount: number;
}

export interface AutomationRun {
  id: ID;
  orgId: ID;
  projectId: ID;
  ruleId: ID;
  ruleName: string;
  issueId: ID;
  issueKey: string;
  at: string;
  result: 'success' | 'skipped' | 'error';
  message: string;
}

export type NewRule = Pick<AutomationRule, 'name' | 'trigger' | 'conditions' | 'actions'> & { enabled?: boolean };
export type RulePatch = Partial<Pick<AutomationRule, 'name' | 'enabled' | 'trigger' | 'conditions' | 'actions'>>;

export interface SavedFilter {
  id: ID;
  orgId: ID;
  ownerId: ID;
  name: string;
  query: string;
  /** Visible to everyone in the organization. */
  shared: boolean;
  createdAt: string;
}

export interface Activity {
  id: ID;
  orgId: ID;
  projectId: ID;
  issueId: ID;
  actorId: ID;
  kind: 'created' | 'updated' | 'commented' | 'deleted';
  field?: string;
  from?: string;
  to?: string;
  createdAt: string;
}

export interface OrgData {
  org: Organization;
  members: Member[];
  projects: Project[];
  sprints: Sprint[];
  issues: Issue[];
  comments: Comment[];
  activity: Activity[];
  forms: IntakeForm[];
  attachments: AttachmentView[];
  rules: AutomationRule[];
  /** Most recent automation executions (newest first, capped). */
  runs: AutomationRun[];
  /** Notifications for the current user only. */
  notifications: Notification[];
  /** The current user's own filters plus filters shared in the org. */
  filters: SavedFilter[];
}

export type ProjectPatch = Partial<Pick<Project, 'name' | 'description' | 'color' | 'statuses' | 'workflow' | 'customFields' | 'issueTypes'>>;

export type NewProject = Pick<Project, 'name' | 'key' | 'description' | 'color' | 'workStyle'> & {
  /** Own starting columns instead of the work style's defaults. */
  statuses?: { name: string; category: StatusCategory }[];
};

export type NewIssue = Pick<Issue, 'projectId' | 'typeId' | 'title'> &
  Partial<
    Pick<
      Issue,
      | 'description'
      | 'statusId'
      | 'priority'
      | 'assigneeId'
      | 'parentId'
      | 'labels'
      | 'estimate'
      | 'startDate'
      | 'dueDate'
      | 'customFields'
      | 'sprintId'
      | 'blockedBy'
      | 'source'
    >
  > & { approverIds?: ID[] };

export type NewSprint = Pick<Sprint, 'name'> & Partial<Pick<Sprint, 'goal' | 'startDate' | 'endDate'>>;
export type SprintPatch = Partial<Pick<Sprint, 'name' | 'goal' | 'startDate' | 'endDate'>>;

export type IssuePatch = Partial<
  Pick<
    Issue,
    | 'title'
    | 'description'
    | 'statusId'
    | 'priority'
    | 'assigneeId'
    | 'parentId'
    | 'typeId'
    | 'labels'
    | 'estimate'
    | 'startDate'
    | 'dueDate'
    | 'customFields'
    | 'sprintId'
    | 'blockedBy'
    | 'rank'
  >
> & { approverIds?: ID[] };
