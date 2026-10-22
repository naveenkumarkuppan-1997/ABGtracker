import type {
  Comment,
  ID,
  Issue,
  IssuePatch,
  NewIssue,
  NewProject,
  Organization,
  OrgData,
  Project,
  ProjectPatch,
  Role,
  SavedFilter,
  ApprovalDecision,
  AutomationRule,
  FormPatch,
  IntakeForm,
  NewForm,
  PublicForm,
  NewRule,
  RulePatch,
  NewSprint,
  Sprint,
  SprintPatch,
  NotifyPrefs,
  DashboardLayout,
  User,
} from '@/domain/types';

/**
 * Data-access contract. The UI only ever talks to this interface, so the
 * localStorage implementation can be swapped for a real API without UI changes.
 * All methods are async on purpose, and every call is scoped by org / actor.
 */
/** What a visitor gets back after sending a request form. upload is present when the form asks for files. */
export interface SubmitResult {
  key: string;
  upload?: { token: string; maxFiles: number; maxFileBytes: number };
}

export interface Repository {
  getSessionUserId(): Promise<ID>;
  setSessionUserId(userId: ID): Promise<void>;
  listOrganizations(userId: ID): Promise<Organization[]>;
  loadOrg(orgId: ID, userId: ID): Promise<OrgData>;

  createProject(orgId: ID, input: NewProject, actorId: ID): Promise<Project>;
  updateProject(projectId: ID, patch: ProjectPatch, actorId: ID): Promise<Project>;
  /** Removes a column, moving its cards to `moveToStatusId` (required when it has cards). */
  deleteStatus(projectId: ID, statusId: ID, moveToStatusId: ID | null, actorId: ID): Promise<Project>;
  /** Removes an issue type, moving its items (and request forms) to `moveToTypeId`. */
  deleteIssueType(projectId: ID, typeId: ID, moveToTypeId: ID | null, actorId: ID): Promise<Project>;
  markNotificationRead(notificationId: ID, actorId: ID): Promise<void>;
  markAllNotificationsRead(orgId: ID, actorId: ID): Promise<void>;
  /** How the signed-in person wants Inbox items emailed. Returns their updated account. */
  setNotifyPrefs(prefs: NotifyPrefs, actorId: ID): Promise<User>;
  /** How the signed-in person arranged their Home dashboard. */
  setDashboardLayout(layout: DashboardLayout | null, actorId: ID): Promise<User>;
  saveFilter(orgId: ID, input: { name: string; query: string; shared: boolean }, actorId: ID): Promise<SavedFilter>;
  deleteFilter(filterId: ID, actorId: ID): Promise<void>;
  createIssue(orgId: ID, input: NewIssue, actorId: ID): Promise<Issue>;
  updateIssue(issueId: ID, patch: IssuePatch, actorId: ID): Promise<Issue>;
  deleteIssue(issueId: ID, actorId: ID): Promise<void>;
  addComment(issueId: ID, body: string, actorId: ID): Promise<Comment>;
  /** Follow or stop following an item (followers hear about its comments and status changes). */
  setWatching(issueId: ID, watching: boolean, actorId: ID): Promise<Issue>;
  /** Add your reaction to a comment, or take it back. */
  toggleReaction(commentId: ID, emoji: string, actorId: ID): Promise<Comment>;

  createSprint(projectId: ID, input: NewSprint, actorId: ID): Promise<Sprint>;
  updateSprint(sprintId: ID, patch: SprintPatch, actorId: ID): Promise<Sprint>;
  startSprint(sprintId: ID, actorId: ID): Promise<Sprint>;
  /** Unfinished issues move to `moveToSprintId`, or back to the backlog when null. */
  completeSprint(sprintId: ID, moveToSprintId: ID | null, actorId: ID): Promise<Sprint>;
  deleteSprint(sprintId: ID, actorId: ID): Promise<void>;

  updateMemberRole(orgId: ID, userId: ID, role: Role, actorId: ID): Promise<void>;
  removeMember(orgId: ID, userId: ID, actorId: ID): Promise<void>;

  /** The uploader or a project admin may remove a file. (Uploading goes through the server's upload route.) */
  deleteAttachment(attachmentId: ID, actorId: ID): Promise<void>;

  createForm(projectId: ID, input: NewForm, actorId: ID): Promise<IntakeForm>;
  updateForm(formId: ID, patch: FormPatch, actorId: ID): Promise<IntakeForm>;
  deleteForm(formId: ID, actorId: ID): Promise<void>;
  /** Public: no sign-in. Exposes only what a visitor needs to fill the form. */
  getPublicForm(orgSlug: string, formSlug: string): Promise<PublicForm>;
  /** Public: no sign-in. `honeypot` must be empty (bots fill it). */
  submitForm(
    orgSlug: string,
    formSlug: string,
    answers: Record<string, string>,
    submitter: { name: string; email: string },
    honeypot?: string
  ): Promise<SubmitResult>;

  createRule(projectId: ID, input: NewRule, actorId: ID): Promise<AutomationRule>;
  updateRule(ruleId: ID, patch: RulePatch, actorId: ID): Promise<AutomationRule>;
  deleteRule(ruleId: ID, actorId: ID): Promise<void>;
  /** Fires time-based rules (e.g. "becomes overdue"); returns how many issues were changed. */
  runScheduledAutomations(orgId: ID, actorId: ID): Promise<number>;

  decideApproval(issueId: ID, decision: ApprovalDecision, comment: string | undefined, actorId: ID): Promise<Issue>;
  /** Clears all decisions so approvers sign off again (e.g. after rework). */
  resetApproval(issueId: ID, actorId: ID): Promise<Issue>;

  resetDemo(): Promise<void>;
}
