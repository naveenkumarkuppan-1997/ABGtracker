import { cleanFileName, fileProblem, formatBytes, type AttachmentLimits } from '@/domain/attachments';
import { columnsProblem, newStatusId, removeProblem } from '@/domain/columns';
import { removeTypeProblem, typesProblem } from '@/domain/issueTypes';
import { buildIssue, MAX_SUBMISSIONS_PER_HOUR, slugify, validateForm, validateSubmission } from '@/domain/forms';
import { planActions, ruleMatches, validateRule, type IssueEvent } from '@/domain/automation';
import { applyDecision, approvalState, checkApprovalGate, resetDecisions, setApprovers } from '@/domain/approvals';
import { validateCustomFields } from '@/domain/customFields';
import { wouldCreateCycle } from '@/domain/dependencies';
import { checkStart, sprintStats, validateSprintDates } from '@/domain/sprints';
import { isDone as isDoneIssue } from '@/domain/selectors';
import { extractMentions, REACTIONS } from '@/domain/mentions';
import { can, type Action } from '@/domain/permissions';
import { defaultCustomFields, TEMPLATES } from '@/domain/templates';
import { checkRequired, checkTransition, defaultWorkflow, sanitizeWorkflow } from '@/domain/workflow';
import type {
  Activity,
  ApprovalDecision,
  AutomationRule,
  AutomationRun,
  FormPatch,
  IntakeForm,
  NewForm,
  PublicForm,
  NewRule,
  RulePatch,
  Comment,
  ID,
  NewSprint,
  Sprint,
  SprintPatch,
  Issue,
  IssuePatch,
  Member,
  NewIssue,
  NewProject,
  Notification,
  NotificationKind,
  Organization,
  OrgData,
  Project,
  ProjectPatch,
  Attachment,
  AttachmentView,
  IssueType,
  Status,
  Role,
  SavedFilter,
  NotifyPrefs,
  DashboardLayout,
  User,
} from '@/domain/types';
import { validateLayout } from '@/domain/dashboard';
import { resolvePrefs, validatePrefs } from '@/domain/notifyPrefs';
import { localDate, nextDay } from '@/domain/timeZone';
import { DomainError } from '@/domain/errors';
import type { Repository } from './repository';
import { buildSeed, type Database } from './seed';

const STORAGE_KEY = 'abg2:db:v5';
const MAX_CHAIN_DEPTH = 3;
const AUTOMATION_ACTOR = 'automation';

const uid = (p: string) => `${p}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36).slice(-4)}`;
const now = () => new Date().toISOString();

function load(): Database {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const db = JSON.parse(raw) as Database;
      // Stored data from an older build may lack newer collections; start fresh rather than crash.
      const collections: (keyof Database)[] = ['organizations', 'users', 'memberships', 'projects', 'sprints', 'issues', 'comments', 'activity', 'notifications', 'filters', 'forms', 'attachments', 'rules', 'runs'];
      if (collections.every((k) => Array.isArray(db[k])) && typeof db.sessionUserId === 'string') return db;
    }
  } catch {
    /* fall through to seed */
  }
  const seed = buildSeed();
  persist(seed);
  return seed;
}

function persist(db: Database) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(db));
  } catch {
    /* storage unavailable: keep in-memory only */
  }
}

/** Where the repository keeps its data. Browser: localStorage. Server: PostgreSQL. */
export interface SnapshotStore {
  load(): Database;
  /** Called after every change. Implementations may persist lazily. */
  save(db: Database): void;
}

export const browserStore: SnapshotStore = { load, save: persist };

/**
 * All business rules (permissions, workflows, sprints, approvals, automation, forms) live here.
 * The same class runs in the browser (demo mode) and on the server (real mode), so both behave
 * identically and the server's authorization cannot drift from what the UI assumes.
 */
export class LocalRepository implements Repository {
  private db: Database;

  constructor(private store: SnapshotStore = browserStore) {
    this.db = store.load();
  }

  /** The live data object (the server's account service shares it). */
  get snapshot(): Database {
    return this.db;
  }

  private save() {
    this.store.save(this.db);
  }

  /** Authorization is re-checked here, as the real backend will do. */
  private authorize(orgId: ID, actorId: ID, action: Action) {
    const m = this.db.memberships.find((x) => x.orgId === orgId && x.userId === actorId);
    if (!m) throw new DomainError('You are not a member of this organization.');
    if (!can(m.role, action)) throw new DomainError(`Your role (${m.role}) is not allowed to do this.`);
  }

  private issueOrThrow(id: ID): Issue {
    const issue = this.db.issues.find((i) => i.id === id);
    if (!issue) throw new DomainError('Issue not found.');
    return issue;
  }

  private projectOrThrow(id: ID): Project {
    const p = this.db.projects.find((x) => x.id === id);
    if (!p) throw new DomainError('Project not found.');
    return p;
  }

  private members(orgId: ID): Member[] {
    return this.db.memberships
      .filter((m) => m.orgId === orgId)
      .map((m) => {
        const { notify: _private, dashboard: _layout, ...user } = this.db.users.find((x) => x.id === m.userId)!; // how someone wants email, and how they arranged their dashboard, is theirs alone
        return { ...user, role: m.role, membershipId: m.id };
      });
  }

  private isMember(orgId: ID, userId: ID) {
    return this.db.memberships.some((m) => m.orgId === orgId && m.userId === userId);
  }

  async getSessionUserId() {
    return this.db.sessionUserId;
  }

  async setSessionUserId(userId: ID) {
    this.db.sessionUserId = userId;
    this.save();
  }

  async listOrganizations(userId: ID): Promise<Organization[]> {
    const orgIds = new Set(this.db.memberships.filter((m) => m.userId === userId).map((m) => m.orgId));
    return this.db.organizations.filter((o) => orgIds.has(o.id));
  }

  async loadOrg(orgId: ID, userId: ID): Promise<OrgData> {
    if (!this.isMember(orgId, userId)) throw new DomainError('You are not a member of this organization.');
    const org = this.db.organizations.find((o) => o.id === orgId)!;
    const clone = <T,>(a: T[]) => a.map((x) => ({ ...x }));
    return {
      org: { ...org },
      members: this.members(orgId),
      projects: this.db.projects.filter((p) => p.orgId === orgId).map((p) => structuredClone(p)),
      sprints: clone(this.db.sprints.filter((s) => s.orgId === orgId)),
      issues: this.db.issues.filter((i) => i.orgId === orgId).map((i) => structuredClone(i)),
      forms: structuredClone(this.db.forms.filter((f) => f.orgId === orgId)),
      // Where the bytes are stored is the server's business, never the browser's.
      attachments: this.db.attachments.filter((a) => a.orgId === orgId).map(({ storageKey: _hidden, ...view }) => ({ ...view })),
      rules: structuredClone(this.db.rules.filter((r) => r.orgId === orgId)),
      runs: clone(this.db.runs.filter((r) => r.orgId === orgId).slice(0, 100)),
      comments: clone(this.db.comments.filter((c) => c.orgId === orgId)),
      activity: clone(this.db.activity.filter((a) => a.orgId === orgId)),
      notifications: clone(this.db.notifications.filter((n) => n.orgId === orgId && n.userId === userId)),
      filters: clone(this.db.filters.filter((f) => f.orgId === orgId && (f.ownerId === userId || f.shared))),
    };
  }

  // ---- members -----------------------------------------------------------

  private ownerCount(orgId: ID) {
    return this.db.memberships.filter((m) => m.orgId === orgId && m.role === 'owner').length;
  }

  async updateMemberRole(orgId: ID, userId: ID, role: Role, actorId: ID): Promise<void> {
    this.authorize(orgId, actorId, 'member.manage');
    if (!['owner', 'admin', 'member', 'guest'].includes(role)) throw new DomainError('Unknown role.');
    const target = this.db.memberships.find((m) => m.orgId === orgId && m.userId === userId);
    if (!target) throw new DomainError('That person is not in this organization.');
    const actor = this.db.memberships.find((m) => m.orgId === orgId && m.userId === actorId)!;
    // Only owners may create or change owners.
    if ((role === 'owner' || target.role === 'owner') && actor.role !== 'owner') throw new DomainError('Only an owner can change owner roles.');
    if (target.role === 'owner' && role !== 'owner' && this.ownerCount(orgId) <= 1) throw new DomainError('An organization needs at least one owner.');
    target.role = role;
    this.save();
  }

  async removeMember(orgId: ID, userId: ID, actorId: ID): Promise<void> {
    // People may always leave; removing someone else needs member.manage.
    if (userId !== actorId) this.authorize(orgId, actorId, 'member.manage');
    const target = this.db.memberships.find((m) => m.orgId === orgId && m.userId === userId);
    if (!target) throw new DomainError('That person is not in this organization.');
    const actor = this.db.memberships.find((m) => m.orgId === orgId && m.userId === actorId);
    if (!actor) throw new DomainError('You are not a member of this organization.');
    if (target.role === 'owner' && actor.role !== 'owner') throw new DomainError('Only an owner can remove an owner.');
    if (target.role === 'owner' && this.ownerCount(orgId) <= 1) throw new DomainError('An organization needs at least one owner.');

    this.db.memberships = this.db.memberships.filter((m) => m.id !== target.id);
    // Their open work is unassigned (never silently lost); their private filters go with them.
    for (const i of this.db.issues) {
      if (i.orgId !== orgId) continue;
      if (i.assigneeId === userId) i.assigneeId = undefined;
      if (i.approval) i.approval.approverIds = i.approval.approverIds.filter((a) => a !== userId);
    }
    this.db.filters = this.db.filters.filter((f) => !(f.orgId === orgId && f.ownerId === userId));
    this.db.notifications = this.db.notifications.filter((n) => !(n.orgId === orgId && n.userId === userId));
    this.save();
  }

  // ---- projects --------------------------------------------------------

  async createProject(orgId: ID, input: NewProject, actorId: ID): Promise<Project> {
    this.authorize(orgId, actorId, 'project.create');
    const key = input.key.trim().toUpperCase();
    if (!/^[A-Z][A-Z0-9]{1,9}$/.test(key)) throw new DomainError('Key must be 2-10 letters/digits and start with a letter.');
    if (this.db.projects.some((p) => p.orgId === orgId && p.key === key)) throw new DomainError(`Key ${key} is already used.`);
    const tpl = TEMPLATES[input.workStyle];
    let statuses = tpl.statuses.map((s) => ({ ...s }));
    let workflow = defaultWorkflow(input.workStyle, statuses);
    if (input.statuses) {
      const problem = columnsProblem(input.statuses);
      if (problem) throw new DomainError(problem);
      const unchanged = input.statuses.length === statuses.length && input.statuses.every((s, i) => s.name.trim() === statuses[i].name && s.category === statuses[i].category);
      if (!unchanged) {
        // The team chose its own columns: keep ids for columns that match a template one, and let work move freely.
        const built: Status[] = [];
        for (const s of input.statuses) {
          const known = tpl.statuses.find((t) => t.name.toLowerCase() === s.name.trim().toLowerCase() && !built.some((b) => b.id === t.id));
          built.push({ id: known?.id ?? newStatusId(s.name, built), name: s.name.trim(), category: s.category });
        }
        statuses = built;
        workflow = sanitizeWorkflow({ ...defaultWorkflow(input.workStyle, built), restrict: false, transitions: {} }, built);
      }
    }
    const project: Project = {
      id: uid('p'),
      orgId,
      key,
      name: input.name.trim(),
      description: input.description.trim(),
      color: input.color,
      workStyle: input.workStyle,
      statuses,
      issueTypes: tpl.issueTypes.map((t) => ({ ...t })),
      workflow,
      customFields: defaultCustomFields(input.workStyle),
      leadId: actorId,
      nextNumber: 1,
      createdAt: now(),
    };
    this.db.projects.push(project);
    this.save();
    return structuredClone(project);
  }

  /** Removes a column; its cards move to `moveToStatusId` first, so nothing is lost or left stranded. */
  async deleteStatus(projectId: ID, statusId: ID, moveToStatusId: ID | null, actorId: ID): Promise<Project> {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, 'project.manage');
    const target = project.statuses.find((s) => s.id === statusId);
    if (!target) throw new DomainError('Column not found.');
    const problem = removeProblem(project.statuses, statusId);
    if (problem) throw new DomainError(problem);

    const cards = this.db.issues.filter((i) => i.projectId === projectId && i.statusId === statusId);
    if (cards.length) {
      const dest = project.statuses.find((s) => s.id === moveToStatusId && s.id !== statusId);
      if (!dest) throw new DomainError(`Choose where the ${cards.length} card${cards.length > 1 ? 's' : ''} in “${target.name}” should go.`);
      const top = this.db.issues.filter((i) => i.projectId === projectId && i.statusId === dest.id).reduce((m, i) => Math.max(m, i.rank), 0);
      cards.sort((a, b) => a.rank - b.rank).forEach((i, n) => {
        this.log(i, actorId, 'updated', 'status', target.name, dest.name);
        i.statusId = dest.id;
        i.rank = top + 1000 * (n + 1);
        i.resolvedAt = dest.category === 'done' ? i.resolvedAt ?? now() : undefined;
        i.updatedAt = now();
      });
    }
    project.statuses = project.statuses.filter((s) => s.id !== statusId);
    project.workflow = sanitizeWorkflow(project.workflow, project.statuses);
    this.save();
    return structuredClone(project);
  }

  /** Removes an issue type; items (and request forms) of that type move to `moveToTypeId` first. */
  async deleteIssueType(projectId: ID, typeId: ID, moveToTypeId: ID | null, actorId: ID): Promise<Project> {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, 'project.manage');
    const type = project.issueTypes.find((t) => t.id === typeId);
    if (!type) throw new DomainError('Type not found.');
    const problem = removeTypeProblem(project.issueTypes, typeId);
    if (problem) throw new DomainError(problem);

    const items = this.db.issues.filter((i) => i.projectId === projectId && i.typeId === typeId);
    const forms = this.db.forms.filter((f) => f.projectId === projectId && f.issueTypeId === typeId);
    let dest: IssueType | undefined;
    if (items.length || forms.length) {
      dest = project.issueTypes.find((t) => t.id === moveToTypeId && t.id !== typeId && (items.length ? t.level === type.level : t.level !== 2));
      if (!dest) {
        const what = items.length ? `${items.length} item${items.length > 1 ? 's' : ''}` : `the request form “${forms[0].name}”`;
        throw new DomainError(`Choose another type for ${what} to become.`);
      }
    }
    if (dest) {
      for (const i of items) {
        this.log(i, actorId, 'updated', 'type', type.name, dest.name);
        i.typeId = dest.id;
        i.updatedAt = now();
      }
      for (const f of forms) f.issueTypeId = dest.id;
    }
    // Rules and field scopes that named the removed type follow the work to its new type (or lose the reference).
    for (const r of this.db.rules.filter((x) => x.projectId === projectId)) {
      for (const c of r.conditions) if (c.field === 'type' && [type.id, type.name.toLowerCase()].includes((c.value ?? '').toLowerCase()) && dest) c.value = dest.id;
    }
    project.customFields = project.customFields.map((f) =>
      f.typeIds?.includes(typeId) ? { ...f, typeIds: [...new Set(f.typeIds.map((x) => (x === typeId ? dest?.id : x)).filter((x): x is string => !!x))] } : f
    );
    project.issueTypes = project.issueTypes.filter((t) => t.id !== typeId);
    this.save();
    return structuredClone(project);
  }

  async updateProject(projectId: ID, patch: ProjectPatch, actorId: ID): Promise<Project> {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, 'project.manage');

    if (patch.name !== undefined) {
      if (!patch.name.trim()) throw new DomainError('Project name is required.');
      project.name = patch.name.trim();
    }
    if (patch.description !== undefined) project.description = patch.description;
    if (patch.color !== undefined) project.color = patch.color;

    if (patch.statuses) {
      const next = patch.statuses;
      if (next.length < 2) throw new DomainError('A project needs at least two statuses.');
      if (new Set(next.map((s) => s.id)).size !== next.length) throw new DomainError('Status ids must be unique.');
      if (next.some((s) => !s.name.trim())) throw new DomainError('Every status needs a name.');
      if (new Set(next.map((s) => s.name.trim().toLowerCase())).size !== next.length) throw new DomainError('Status names must be unique.');
      if (!next.some((s) => s.category === 'done')) throw new DomainError('At least one status must be in the "Done" category.');
      const keep = new Set(next.map((s) => s.id));
      const orphaned = this.db.issues.filter((i) => i.projectId === projectId && !keep.has(i.statusId));
      if (orphaned.length) {
        const gone = project.statuses.filter((s) => !keep.has(s.id) && orphaned.some((i) => i.statusId === s.id)).map((s) => s.name);
        throw new DomainError(`Move issues out of ${gone.join(', ')} before deleting ${gone.length > 1 ? 'those statuses' : 'that status'} (${orphaned.length} issue${orphaned.length > 1 ? 's' : ''}).`);
      }
      project.statuses = next.map((s) => ({ ...s, name: s.name.trim() }));
      // Resolved date must follow the category of the (possibly changed) status.
      for (const i of this.db.issues.filter((x) => x.projectId === projectId)) {
        const isDone = project.statuses.find((s) => s.id === i.statusId)?.category === 'done';
        i.resolvedAt = isDone ? i.resolvedAt ?? now() : undefined;
      }
    }

    if (patch.workflow || patch.statuses) {
      project.workflow = sanitizeWorkflow(patch.workflow ?? project.workflow, project.statuses);
    }

    if (patch.issueTypes) {
      const next = patch.issueTypes;
      const problem = typesProblem(next);
      if (problem) throw new DomainError(problem);
      const used = new Set(this.db.issues.filter((i) => i.projectId === projectId).map((i) => i.typeId));
      const formTypes = new Set(this.db.forms.filter((f) => f.projectId === projectId).map((f) => f.issueTypeId));
      for (const old of project.issueTypes) {
        const kept = next.find((t) => t.id === old.id);
        if (!kept) {
          // Dropping a type must go through deleteIssueType, which moves the work somewhere first.
          if (used.has(old.id) || formTypes.has(old.id)) throw new DomainError(`“${old.name}” is still in use. Remove it from its own menu so its items can move to another type.`);
        } else if (kept.level !== old.level && used.has(old.id)) {
          throw new DomainError(`“${old.name}” already has items, so it can't change what kind of item it is.`);
        }
      }
      project.issueTypes = next.map((t) => ({ id: t.id, name: t.name.trim(), icon: t.icon, color: t.color, level: t.level, ...(t.kind ? { kind: t.kind } : {}) }));
    }

    if (patch.customFields) {
      const names = new Set<string>();
      for (const f of patch.customFields) {
        if (!f.name.trim()) throw new DomainError('Every custom field needs a name.');
        const n = f.name.trim().toLowerCase();
        if (names.has(n)) throw new DomainError(`Duplicate field name "${f.name}".`);
        names.add(n);
        if ((f.type === 'select' || f.type === 'multiselect') && !(f.options ?? []).length) {
          throw new DomainError(`"${f.name}" needs at least one option.`);
        }
      }
      project.customFields = patch.customFields.map((f) => ({ ...f, name: f.name.trim() }));
      // Drop stored values of deleted fields so ids can't leak back in.
      const ids = new Set(project.customFields.map((f) => f.id));
      for (const i of this.db.issues.filter((x) => x.projectId === projectId)) {
        for (const k of Object.keys(i.customFields)) if (!ids.has(k)) delete i.customFields[k];
      }
    }

    this.save();
    return structuredClone(project);
  }

  // ---- issues ----------------------------------------------------------

  async createIssue(orgId: ID, input: NewIssue, actorId: ID): Promise<Issue> {
    this.authorize(orgId, actorId, 'issue.create');
    const project = this.db.projects.find((p) => p.id === input.projectId && p.orgId === orgId);
    if (!project) throw new DomainError('Project not found.');
    if (!input.title.trim()) throw new DomainError('Title is required.');
    if (!project.issueTypes.some((t) => t.id === input.typeId)) throw new DomainError('Unknown issue type.');
    const statusId = input.statusId ?? project.statuses[0].id;
    const status = project.statuses.find((s) => s.id === statusId);
    if (!status) throw new DomainError('Unknown status.');
    if (input.assigneeId && !this.isMember(orgId, input.assigneeId)) throw new DomainError('Assignee is not in this organization.');

    const fieldErr = validateCustomFields(project, input.typeId, input.customFields ?? {}, { enforceRequired: true });
    if (fieldErr) throw new DomainError(fieldErr);
    const reqErr = checkRequired(project, { assigneeId: input.assigneeId, estimate: input.estimate, dueDate: input.dueDate, description: input.description ?? '' }, statusId);
    if (reqErr) throw new DomainError(reqErr);

    this.checkSprint(project, input.sprintId);
    this.checkParent(project, input.parentId);
    const blockedBy = input.blockedBy ?? [];
    this.checkBlockers(orgId, undefined, blockedBy);
    const approval = input.approverIds?.length ? setApprovers(undefined, this.checkApprovers(orgId, input.approverIds)) : undefined;

    const number = project.nextNumber++;
    const inColumn = this.db.issues.filter((i) => i.projectId === project.id && i.statusId === statusId);
    const issue: Issue = {
      id: uid('i'),
      orgId,
      projectId: project.id,
      key: `${project.key}-${number}`,
      number,
      typeId: input.typeId,
      title: input.title.trim(),
      description: input.description ?? '',
      statusId,
      priority: input.priority ?? 'medium',
      assigneeId: input.assigneeId,
      reporterId: actorId,
      parentId: input.parentId,
      labels: input.labels ?? [],
      estimate: input.estimate,
      startDate: input.startDate,
      dueDate: input.dueDate,
      customFields: input.customFields ?? {},
      sprintId: input.sprintId,
      blockedBy,
      approval,
      source: input.source,
      rank: this.db.issues.filter((i) => i.projectId === project.id).reduce((m, i) => Math.max(m, i.rank), 0) + 1000,
      createdAt: now(),
      updatedAt: now(),
      resolvedAt: status.category === 'done' ? now() : undefined,
    };
    this.db.issues.push(issue);
    this.log(issue, actorId, 'created');
    if (issue.assigneeId) this.notify(issue, issue.assigneeId, actorId, 'assigned');
    for (const a of approval?.approverIds ?? []) this.notify(issue, a, actorId, 'approval', 'Your approval is requested');
    this.fireRules({ type: 'issue_created', issue }, project, 0, new Set());
    this.save();
    return structuredClone(issue);
  }

  /** Throws unless the sprint exists in the project and still accepts work. */
  private checkSprint(project: Project, sprintId?: ID) {
    if (!sprintId) return;
    const sprint = this.db.sprints.find((s) => s.id === sprintId && s.projectId === project.id);
    if (!sprint) throw new DomainError('Sprint not found in this project.');
    if (sprint.state === 'completed') throw new DomainError(`“${sprint.name}” is completed and can't take new work.`);
  }

  /** A parent must be an issue of the same project, and may not be one of the issue's own descendants. */
  private checkParent(project: Project, parentId?: ID, selfId?: ID) {
    if (!parentId) return;
    const parent = this.db.issues.find((i) => i.id === parentId && i.projectId === project.id);
    if (!parent) throw new DomainError('The parent issue was not found in this project.');
    for (let cur: Issue | undefined = parent; cur; cur = cur.parentId ? this.db.issues.find((i) => i.id === cur!.parentId) : undefined) {
      if (selfId && cur.id === selfId) throw new DomainError('That parent would create a loop.');
    }
  }

  private checkBlockers(orgId: ID, issueId: ID | undefined, blockedBy: ID[]) {
    for (const id of blockedBy) {
      const b = this.db.issues.find((i) => i.id === id && i.orgId === orgId);
      if (!b) throw new DomainError('A blocking issue was not found.');
      if (id === issueId) throw new DomainError('An issue cannot block itself.');
    }
    if (issueId && wouldCreateCycle(this.db.issues, issueId, blockedBy)) {
      throw new DomainError('That dependency would create a loop (the blocker already depends on this issue).');
    }
  }

  private checkApprovers(orgId: ID, ids: ID[]): ID[] {
    for (const id of ids) if (!this.isMember(orgId, id)) throw new DomainError('An approver is not in this organization.');
    return ids;
  }

  async updateIssue(issueId: ID, patch: IssuePatch, actorId: ID): Promise<Issue> {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, 'issue.edit');
    const project = this.projectOrThrow(issue.projectId);

    if (patch.statusId && !project.statuses.some((s) => s.id === patch.statusId)) throw new DomainError('Unknown status.');
    if (patch.parentId === issue.id) throw new DomainError('An issue cannot be its own parent.');
    if (patch.parentId) this.checkParent(project, patch.parentId, issue.id);
    if (patch.assigneeId && !this.isMember(issue.orgId, patch.assigneeId)) throw new DomainError('Assignee is not in this organization.');
    if (patch.typeId && !project.issueTypes.some((t) => t.id === patch.typeId)) throw new DomainError('Unknown issue type.');

    if ('sprintId' in patch) this.checkSprint(project, patch.sprintId);
    if (patch.blockedBy) this.checkBlockers(issue.orgId, issue.id, patch.blockedBy);
    if (patch.approverIds) this.checkApprovers(issue.orgId, patch.approverIds);

    if (patch.statusId) {
      const err = checkTransition(project, issue, patch.statusId, patch);
      if (err) throw new DomainError(err);
      const gate = checkApprovalGate(project, issue, patch.statusId);
      if (gate) throw new DomainError(gate);
    }
    if (patch.customFields) {
      const err = validateCustomFields(project, patch.typeId ?? issue.typeId, patch.customFields, { enforceRequired: true });
      if (err) throw new DomainError(err);
    }
    // Clearing a field that the issue's current status requires is not allowed either.
    if (!patch.statusId && ('assigneeId' in patch || 'estimate' in patch || 'dueDate' in patch || 'description' in patch)) {
      const err = checkRequired(project, { ...issue, ...patch }, issue.statusId);
      if (err) throw new DomainError(err.replace('Moving to', 'Issues in'));
    }

    const label = (field: keyof IssuePatch, v: unknown): string => {
      if (v === undefined || v === null || v === '') return '';
      if (field === 'statusId') return project.statuses.find((s) => s.id === v)?.name ?? String(v);
      if (field === 'typeId') return project.issueTypes.find((t) => t.id === v)?.name ?? String(v);
      if (field === 'assigneeId') return this.db.users.find((u) => u.id === v)?.name ?? String(v);
      if (field === 'parentId') return this.db.issues.find((i) => i.id === v)?.key ?? String(v);
      if (field === 'sprintId') return this.db.sprints.find((s) => s.id === v)?.name ?? String(v);
      if (field === 'blockedBy' && Array.isArray(v)) return v.map((id) => this.db.issues.find((i) => i.id === id)?.key ?? id).join(', ');
      if (Array.isArray(v)) return v.join(', ');
      return String(v);
    };
    const FIELD_NAME: Partial<Record<keyof IssuePatch, string>> = {
      title: 'title',
      description: 'description',
      statusId: 'status',
      priority: 'priority',
      assigneeId: 'assignee',
      parentId: 'parent',
      typeId: 'type',
      labels: 'labels',
      estimate: 'estimate',
      startDate: 'start date',
      dueDate: 'due date',
      sprintId: 'sprint',
      blockedBy: 'blocked by',
    };

    const prevStatus = issue.statusId;
    const prevAssignee = issue.assigneeId;
    const before: Issue = structuredClone(issue);
    const { approverIds, ...fields } = patch;

    for (const field of Object.keys(fields) as (keyof typeof fields)[]) {
      const next = fields[field];
      const prev = (issue as unknown as Record<string, unknown>)[field];
      if (JSON.stringify(prev) === JSON.stringify(next)) continue;
      if (field === 'customFields') {
        const defs = project.customFields;
        const before = (prev ?? {}) as Record<string, unknown>;
        const after = (next ?? {}) as Record<string, unknown>;
        for (const d of defs) {
          if (JSON.stringify(before[d.id] ?? null) !== JSON.stringify(after[d.id] ?? null)) {
            const show = (v: unknown) => (v === undefined || v === null || v === '' ? '' : Array.isArray(v) ? v.join(', ') : String(v));
            this.log(issue, actorId, 'updated', d.name, show(before[d.id]), show(after[d.id]));
          }
        }
      } else if (field === 'description') {
        this.log(issue, actorId, 'updated', 'description');
      } else if (FIELD_NAME[field]) {
        this.log(issue, actorId, 'updated', FIELD_NAME[field], label(field, prev), label(field, next));
      }
      (issue as unknown as Record<string, unknown>)[field] = next;
    }

    if (patch.statusId) {
      const cat = project.statuses.find((s) => s.id === patch.statusId)!.category;
      issue.resolvedAt = cat === 'done' ? issue.resolvedAt ?? now() : undefined;
    }
    // Sub-tasks always travel with their parent's sprint.
    if ('sprintId' in patch) {
      for (const child of this.db.issues.filter((i) => i.parentId === issue.id)) child.sprintId = issue.sprintId;
    }
    if (approverIds) {
      const before = issue.approval?.approverIds ?? [];
      const next = setApprovers(issue.approval, approverIds);
      const name = (id: ID) => this.db.users.find((u) => u.id === id)?.name ?? id;
      if (JSON.stringify(before) !== JSON.stringify(next.approverIds)) {
        this.log(issue, actorId, 'updated', 'approvers', before.map(name).join(', '), next.approverIds.map(name).join(', '));
        for (const a of next.approverIds.filter((x) => !before.includes(x))) this.notify(issue, a, actorId, 'approval', 'Your approval is requested');
      }
      issue.approval = next.approverIds.length ? next : undefined;
    }
    issue.updatedAt = now();

    if (issue.assigneeId && issue.assigneeId !== prevAssignee) this.notify(issue, issue.assigneeId, actorId, 'assigned');
    if (issue.statusId !== prevStatus) {
      const nm = (id: string) => project.statuses.find((s) => s.id === id)?.name ?? id;
      for (const uid_ of new Set([issue.assigneeId, issue.reporterId, ...(issue.watcherIds ?? [])])) {
        if (uid_ && !(uid_ === issue.assigneeId && issue.assigneeId !== prevAssignee)) {
          this.notify(issue, uid_, actorId, 'status', `${nm(prevStatus)} → ${nm(issue.statusId)}`);
        }
      }
    }
    const fired = new Set<string>();
    for (const type of ['status_changed', 'assignee_changed', 'priority_changed'] as const) {
      this.fireRules({ type, issue, before }, project, 0, fired);
    }
    this.save();
    return structuredClone(issue);
  }

  // ---- automation ----------------------------------------------------------

  /**
   * Runs every enabled rule of the project that matches `ev`. A rule fires at most once per
   * issue per chain, and chains are capped, so rules can't loop forever.
   */
  private fireRules(ev: IssueEvent, project: Project, depth: number, fired: Set<string>) {
    if (depth >= MAX_CHAIN_DEPTH) return;
    for (const rule of this.db.rules.filter((r) => r.projectId === project.id && r.enabled)) {
      const key = `${rule.id}:${ev.issue.id}`;
      if (fired.has(key) || !ruleMatches(rule, ev, project)) continue;
      fired.add(key);
      this.executeRule(rule, ev.issue, project, depth, fired);
    }
  }

  private recordRun(rule: AutomationRule, issue: Issue, result: AutomationRun['result'], message: string) {
    this.db.runs.unshift({
      id: uid('run'),
      orgId: rule.orgId,
      projectId: rule.projectId,
      ruleId: rule.id,
      ruleName: rule.name,
      issueId: issue.id,
      issueKey: issue.key,
      at: now(),
      result,
      message,
    });
    if (this.db.runs.length > 1000) this.db.runs.length = 1000;
    if (result === 'success') rule.runCount += 1;
  }

  private executeRule(rule: AutomationRule, issue: Issue, project: Project, depth: number, fired: Set<string>) {
    const plan = planActions(rule, issue, project, this.members(issue.orgId));
    const notes: string[] = [...plan.errors];
    const patch = { ...plan.patch };

    // Automation may move issues anywhere, but never past a required-field or approval gate.
    if (patch.statusId && patch.statusId !== issue.statusId) {
      const blocked =
        checkRequired(project, { ...issue, ...patch }, patch.statusId) ?? checkApprovalGate(project, issue, patch.statusId);
      if (blocked) {
        notes.push(`Skipped the status change: ${blocked}`);
        delete patch.statusId;
      }
    }

    const before: Issue = structuredClone(issue);
    const changes: string[] = [];
    const nm = (id?: string) => this.db.users.find((u) => u.id === id)?.name ?? '';
    const sName = (id: string) => project.statuses.find((s) => s.id === id)?.name ?? id;

    if (patch.assigneeId !== undefined && patch.assigneeId !== issue.assigneeId) {
      this.log(issue, AUTOMATION_ACTOR, 'updated', 'assignee', nm(issue.assigneeId), nm(patch.assigneeId));
      changes.push(`assigned to ${nm(patch.assigneeId)}`);
      issue.assigneeId = patch.assigneeId;
      this.notify(issue, patch.assigneeId, AUTOMATION_ACTOR, 'assigned', `Automation “${rule.name}”`);
    }
    if (patch.priority && patch.priority !== issue.priority) {
      this.log(issue, AUTOMATION_ACTOR, 'updated', 'priority', issue.priority, patch.priority);
      changes.push(`priority ${patch.priority}`);
      issue.priority = patch.priority;
    }
    if (patch.labels && patch.labels.join('|') !== issue.labels.join('|')) {
      this.log(issue, AUTOMATION_ACTOR, 'updated', 'labels', issue.labels.join(', '), patch.labels.join(', '));
      changes.push(`labels ${patch.labels.join(', ')}`);
      issue.labels = patch.labels;
    }
    if (patch.statusId && patch.statusId !== issue.statusId) {
      this.log(issue, AUTOMATION_ACTOR, 'updated', 'status', sName(issue.statusId), sName(patch.statusId));
      changes.push(`moved to ${sName(patch.statusId)}`);
      issue.statusId = patch.statusId;
      const done = project.statuses.find((s) => s.id === patch.statusId)?.category === 'done';
      issue.resolvedAt = done ? issue.resolvedAt ?? now() : undefined;
    }
    for (const body of plan.comments) {
      this.db.comments.push({ id: uid('c'), orgId: issue.orgId, issueId: issue.id, authorId: AUTOMATION_ACTOR, body, mentions: [], createdAt: now() });
      this.log(issue, AUTOMATION_ACTOR, 'commented');
      changes.push('commented');
    }
    for (const userId of new Set(plan.notify)) {
      this.notify(issue, userId, AUTOMATION_ACTOR, 'automation', `“${rule.name}”`);
      changes.push(`notified ${nm(userId)}`);
    }
    if (changes.length) issue.updatedAt = now();

    const failed = plan.errors.length > 0;
    this.recordRun(
      rule,
      issue,
      failed ? 'error' : changes.length ? 'success' : 'skipped',
      [changes.length ? changes.join(', ') : 'Nothing to change', ...notes].join(' · ')
    );

    // Chained rules: our own changes may trigger other rules.
    if (changes.length) {
      for (const type of ['status_changed', 'assignee_changed', 'priority_changed'] as const) {
        this.fireRules({ type, issue, before }, project, depth + 1, fired);
      }
    }
  }

  // ---- intake forms --------------------------------------------------------

  private formOrThrow(id: ID): IntakeForm {
    const f = this.db.forms.find((x) => x.id === id);
    if (!f) throw new DomainError('Form not found.');
    return f;
  }

  private slugTaken(orgId: ID, slug: string, exceptId?: ID) {
    return this.db.forms.some((f) => f.orgId === orgId && f.slug === slug && f.id !== exceptId);
  }

  async createForm(projectId: ID, input: NewForm, actorId: ID): Promise<IntakeForm> {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, 'project.manage');
    const slug = input.slug?.trim() || slugify(input.name);
    const err = validateForm({ ...input, slug }, project);
    if (err) throw new DomainError(err);
    if (this.slugTaken(project.orgId, slug)) throw new DomainError(`The link name “${slug}” is already used.`);
    if (input.defaultAssigneeId && !this.isMember(project.orgId, input.defaultAssigneeId)) throw new DomainError('The default assignee is not in this organization.');
    const form: IntakeForm = {
      id: uid('form'),
      orgId: project.orgId,
      projectId,
      slug,
      name: input.name.trim(),
      description: input.description.trim(),
      enabled: input.enabled ?? true,
      fields: input.fields,
      issueTypeId: input.issueTypeId,
      defaultPriority: input.defaultPriority,
      defaultAssigneeId: input.defaultAssigneeId,
      createdBy: actorId,
      createdAt: now(),
      submissionCount: 0,
    };
    this.db.forms.push(form);
    this.save();
    return structuredClone(form);
  }

  async updateForm(formId: ID, patch: FormPatch, actorId: ID): Promise<IntakeForm> {
    const form = this.formOrThrow(formId);
    this.authorize(form.orgId, actorId, 'project.manage');
    const project = this.projectOrThrow(form.projectId);
    const next = { ...form, ...patch };
    const err = validateForm(next, project);
    if (err) throw new DomainError(err);
    if (this.slugTaken(form.orgId, next.slug, form.id)) throw new DomainError(`The link name “${next.slug}” is already used.`);
    Object.assign(form, { ...patch, name: next.name.trim() });
    this.save();
    return structuredClone(form);
  }

  async deleteForm(formId: ID, actorId: ID): Promise<void> {
    const form = this.formOrThrow(formId);
    this.authorize(form.orgId, actorId, 'project.manage');
    this.db.forms = this.db.forms.filter((f) => f.id !== formId);
    this.save();
  }

  private publicFormOrThrow(orgSlug: string, formSlug: string) {
    const org = this.db.organizations.find((o) => o.slug === orgSlug);
    const form = org && this.db.forms.find((f) => f.orgId === org.id && f.slug === formSlug);
    if (!org || !form || !form.enabled) throw new DomainError('This form is not available.');
    return { org, form, project: this.projectOrThrow(form.projectId) };
  }

  async getPublicForm(orgSlug: string, formSlug: string): Promise<PublicForm> {
    const { org, form, project } = this.publicFormOrThrow(orgSlug, formSlug);
    return {
      orgName: org.name,
      projectName: project.name,
      form: { id: form.id, slug: form.slug, name: form.name, description: form.description, fields: structuredClone(form.fields) },
    };
  }

  async submitForm(
    orgSlug: string,
    formSlug: string,
    answers: Record<string, string>,
    submitter: { name: string; email: string },
    honeypot?: string
  ): Promise<{ key: string }> {
    const { org, form, project } = this.publicFormOrThrow(orgSlug, formSlug);
    // Bots fill hidden fields. Pretend it worked so they don't adapt.
    if (honeypot?.trim()) return { key: `${project.key}-0` };

    const err = validateSubmission(form, answers, submitter);
    if (err) throw new DomainError(err);
    const hourAgo = Date.now() - 3600000;
    const recent = this.db.issues.filter((i) => i.source?.formId === form.id && new Date(i.createdAt).getTime() > hourAgo).length;
    if (recent >= MAX_SUBMISSIONS_PER_HOUR) throw new DomainError('Too many requests right now. Please try again later.');

    const input = buildIssue(form, project, answers, submitter);
    input.source = { formId: form.id, formName: form.name, submitterName: submitter.name.trim(), submitterEmail: submitter.email.trim() };
    let issue: Issue;
    try {
      issue = await this.createIssue(org.id, input, form.createdBy);
    } catch (e) {
      // Surface validation problems, but hide permission details from the public.
      const msg = e instanceof Error ? e.message : '';
      throw new DomainError(/not allowed|not a member/.test(msg) ? 'This form is temporarily unavailable.' : msg || 'Could not submit the request.');
    }
    form.submissionCount += 1;
    const stored = this.db.issues.find((i) => i.id === issue.id)!;
    for (const to of new Set([project.leadId, form.createdBy])) this.notify(stored, to, 'intake', 'intake', `${submitter.name.trim()} via “${form.name}”`);
    this.save();
    return { key: issue.key };
  }

  async createRule(projectId: ID, input: NewRule, actorId: ID): Promise<AutomationRule> {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, 'automation.manage');
    const err = validateRule(input, project);
    if (err) throw new DomainError(err);
    const rule: AutomationRule = {
      id: uid('r'),
      orgId: project.orgId,
      projectId,
      name: input.name.trim(),
      enabled: input.enabled ?? true,
      trigger: input.trigger,
      conditions: input.conditions,
      actions: input.actions,
      createdBy: actorId,
      createdAt: now(),
      runCount: 0,
    };
    this.db.rules.push(rule);
    this.save();
    return structuredClone(rule);
  }

  async updateRule(ruleId: ID, patch: RulePatch, actorId: ID): Promise<AutomationRule> {
    const rule = this.db.rules.find((r) => r.id === ruleId);
    if (!rule) throw new DomainError('Rule not found.');
    this.authorize(rule.orgId, actorId, 'automation.manage');
    const project = this.projectOrThrow(rule.projectId);
    const next = { ...rule, ...patch };
    const err = validateRule(next, project);
    if (err) throw new DomainError(err);
    Object.assign(rule, { ...patch, name: next.name.trim() });
    this.save();
    return structuredClone(rule);
  }

  async deleteRule(ruleId: ID, actorId: ID): Promise<void> {
    const rule = this.db.rules.find((r) => r.id === ruleId);
    if (!rule) throw new DomainError('Rule not found.');
    this.authorize(rule.orgId, actorId, 'automation.manage');
    this.db.rules = this.db.rules.filter((r) => r.id !== ruleId);
    this.save();
  }

  async runScheduledAutomations(orgId: ID, actorId: ID): Promise<number> {
    if (!this.isMember(orgId, actorId)) throw new DomainError('You are not a member of this organization.');
    const today = now().slice(0, 10);
    let changed = 0;
    for (const rule of this.db.rules.filter((r) => r.orgId === orgId && r.enabled && r.trigger.type === 'due_date_passed')) {
      const project = this.projectOrThrow(rule.projectId);
      for (const issue of this.db.issues.filter((i) => i.projectId === rule.projectId)) {
        if (!issue.dueDate || issue.dueDate >= today || isDoneIssue(project, issue)) continue;
        // Each issue fires a given rule once.
        if (this.db.runs.some((r) => r.ruleId === rule.id && r.issueId === issue.id && r.result !== 'error')) continue;
        if (!ruleMatches(rule, { type: 'due_date_passed', issue }, project)) continue;
        this.executeRule(rule, issue, project, 0, new Set([`${rule.id}:${issue.id}`]));
        changed += 1;
      }
    }
    if (changed) this.save();
    return changed;
  }

  /**
   * Reminds assignees about unfinished work that is due tomorrow, due today, or has just become overdue.
   * Each stage is sent once per item and due date (moving the date re-arms it). Called by the server on a timer,
   * never by a browser. `today` is "YYYY-MM-DD". Returns how many reminders were created.
   */
  createDueReminders(orgId: ID, at: Date): number {
    let created = 0;
    const remind = (issue: Issue, userId: ID, detail: string) => {
      if (this.db.notifications.some((n) => n.kind === 'due' && n.issueId === issue.id && n.userId === userId && n.detail === detail)) return;
      const before = this.db.notifications.length;
      this.notify(issue, userId, 'reminder', 'due', detail);
      created += this.db.notifications.length - before;
    };
    for (const issue of this.db.issues.filter((i) => i.orgId === orgId && i.dueDate)) {
      const project = this.db.projects.find((p) => p.id === issue.projectId);
      if (!project || isDoneIssue(project, issue)) continue;
      const due = issue.dueDate!;
      const day = (userId?: ID) => localDate(at, resolvePrefs(this.db.users.find((u) => u.id === userId)).timeZone); // each person's own "today"

      if (issue.assigneeId) {
        const prefs = resolvePrefs(this.db.users.find((u) => u.id === issue.assigneeId));
        const lead = prefs.dueLeadDays ?? 1;
        const today = day(issue.assigneeId);
        const tomorrow = nextDay(today);
        let soonest = today; // the last day that still counts as "soon"
        for (let n = 0; n < lead; n++) soonest = nextDay(soonest);
        const detail = due < today ? `Overdue since ${due}` : due === today ? `Due today (${due})` : due === tomorrow && lead === 1 ? `Due tomorrow (${due})` : due > today && due <= soonest ? (due === tomorrow ? `Due tomorrow (${due})` : `Due soon (${due})`) : null;
        // A "soon" reminder is sent once however many days ahead it starts, so it must read the same every day.
        const stable = detail && due > today && due !== tomorrow ? `Due soon (${due})` : detail && due === tomorrow && lead > 1 ? `Due soon (${due})` : detail;
        if (stable) remind(issue, issue.assigneeId, stable);
      }
      // The person who asked for the work, and anyone watching it, hear when it slips.
      for (const id of new Set([issue.reporterId, ...(issue.watcherIds ?? [])])) {
        if (id && id !== issue.assigneeId && due < day(id)) remind(issue, id, `Overdue since ${due}`);
      }
    }
    if (created) this.save();
    return created;
  }

  /** Follow or stop following an item: followers are told about its comments and status changes. Anyone in the organization can follow. */
  async setWatching(issueId: ID, watching: boolean, actorId: ID): Promise<Issue> {
    const issue = this.issueOrThrow(issueId);
    if (!this.isMember(issue.orgId, actorId)) throw new DomainError('You are not a member of this organization.');
    const now0 = issue.watcherIds ?? [];
    issue.watcherIds = watching ? [...new Set([...now0, actorId])] : now0.filter((id) => id !== actorId);
    this.save();
    return structuredClone(issue);
  }

  /** Adds your reaction to a comment, or takes it back if you already used it. Only a small set of emoji is accepted. */
  async toggleReaction(commentId: ID, emoji: string, actorId: ID): Promise<Comment> {
    const comment = this.db.comments.find((c) => c.id === commentId);
    if (!comment) throw new DomainError('Comment not found.');
    this.authorize(comment.orgId, actorId, 'comment.add');
    if (!REACTIONS.includes(emoji)) throw new DomainError('Choose one of the offered reactions.');
    const reactions = { ...(comment.reactions ?? {}) };
    const mine = reactions[emoji] ?? [];
    const next = mine.includes(actorId) ? mine.filter((id) => id !== actorId) : [...mine, actorId];
    if (next.length) reactions[emoji] = next;
    else delete reactions[emoji];
    comment.reactions = reactions;
    this.save();
    return structuredClone(comment);
  }

  async deleteIssue(issueId: ID, actorId: ID): Promise<void> {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, 'issue.delete');
    // Children are detached, not deleted, so work is never lost silently.
    this.db.issues.forEach((i) => {
      if (i.parentId === issueId) i.parentId = undefined;
      i.blockedBy = i.blockedBy.filter((b) => b !== issueId);
    });
    this.db.issues = this.db.issues.filter((i) => i.id !== issueId);
    this.db.comments = this.db.comments.filter((c) => c.issueId !== issueId);
    this.db.activity = this.db.activity.filter((a) => a.issueId !== issueId);
    for (const a of this.db.attachments.filter((x) => x.issueId === issueId)) this.pendingFiles.push({ orgId: a.orgId, storageKey: a.storageKey });
    this.db.attachments = this.db.attachments.filter((a) => a.issueId !== issueId);
    this.db.notifications = this.db.notifications.filter((n) => n.issueId !== issueId);
    this.save();
  }

  async addComment(issueId: ID, body: string, actorId: ID): Promise<Comment> {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, 'comment.add');
    if (!body.trim()) throw new DomainError('Comment is empty.');
    const mentions = extractMentions(body, this.members(issue.orgId)).filter((id) => id !== actorId);
    const comment: Comment = { id: uid('c'), orgId: issue.orgId, issueId, authorId: actorId, body: body.trim(), mentions, createdAt: now() };
    this.db.comments.push(comment);
    this.log(issue, actorId, 'commented');

    const preview = comment.body.replace(/\s+/g, ' ').slice(0, 120);
    for (const id of mentions) this.notify(issue, id, actorId, 'mention', preview);
    for (const id of new Set([issue.assigneeId, issue.reporterId, ...(issue.watcherIds ?? [])])) {
      if (id && !mentions.includes(id)) this.notify(issue, id, actorId, 'comment', preview);
    }
    // Commenting on something means you want to hear how it goes.
    if (!(issue.watcherIds ?? []).includes(actorId) && actorId !== issue.assigneeId && actorId !== issue.reporterId) issue.watcherIds = [...(issue.watcherIds ?? []), actorId];
    this.save();
    return { ...comment };
  }

  // ---- attachments ---------------------------------------------------------

  /** Files whose records were removed and whose bytes the server should now delete. */
  private pendingFiles: { orgId: ID; storageKey: string }[] = [];

  drainFileDeletions(): { orgId: ID; storageKey: string }[] {
    const out = this.pendingFiles;
    this.pendingFiles = [];
    return out;
  }

  /** Total bytes an organization has stored (used for its quota). */
  orgStorageUsed(orgId: ID): number {
    return this.db.attachments.filter((a) => a.orgId === orgId).reduce((s, a) => s + a.size, 0);
  }

  /**
   * Records a file whose bytes the server has already written. Called by the server's upload
   * route only. Re-checks who may attach and enforces the per-issue and per-organization limits.
   */
  async registerAttachment(
    issueId: ID,
    file: { name: string; size: number; mime: string; sha256: string; storageKey: string },
    limits: AttachmentLimits,
    actorId: ID,
    opts: { commentId?: ID; externalName?: string } = {}
  ): Promise<AttachmentView> {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, 'issue.edit');
    if (opts.commentId) {
      const comment = this.db.comments.find((c) => c.id === opts.commentId);
      // Only the author may add files to their own comment, and only on the issue it belongs to.
      if (!comment || comment.issueId !== issueId) throw new DomainError('Comment not found.');
      if (comment.authorId !== actorId) throw new DomainError('You can only attach files to your own comments.');
    }
    const problem = fileProblem(file.name, file.size, limits);
    if (problem) throw new DomainError(problem);
    if (this.db.attachments.filter((a) => a.issueId === issueId).length >= limits.maxFilesPerIssue) {
      throw new DomainError(`An item can have up to ${limits.maxFilesPerIssue} files. Remove one first.`);
    }
    if (this.orgStorageUsed(issue.orgId) + file.size > limits.orgQuotaBytes) {
      throw new DomainError(`Your organization's file storage (${formatBytes(limits.orgQuotaBytes)}) is full. Remove some files first.`);
    }
    const att: Attachment = {
      id: uid('att'),
      orgId: issue.orgId,
      projectId: issue.projectId,
      issueId,
      ...(opts.commentId ? { commentId: opts.commentId } : {}),
      ...(opts.externalName ? { externalName: opts.externalName.slice(0, 100) } : {}),
      name: cleanFileName(file.name),
      size: file.size,
      mime: file.mime,
      uploaderId: actorId,
      createdAt: now(),
      storageKey: file.storageKey,
      sha256: file.sha256,
    };
    this.db.attachments.push(att);
    this.log(issue, opts.externalName ? 'intake' : actorId, 'updated', 'attachment', '', att.name);
    issue.updatedAt = now();
    this.save();
    const { storageKey: _hidden, ...view } = att;
    void _hidden;
    return view;
  }

  /** Throws unless this person may attach files to the issue. Checked before any bytes are written. */
  assertCanAttach(issueId: ID, actorId: ID): { orgId: ID } {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, 'issue.edit');
    return { orgId: issue.orgId };
  }

  /** The uploader, or a project admin, may remove a file. */
  async deleteAttachment(attachmentId: ID, actorId: ID): Promise<void> {
    const att = this.db.attachments.find((a) => a.id === attachmentId);
    if (!att) throw new DomainError('File not found.');
    const mine = att.uploaderId === actorId;
    if (mine) this.authorize(att.orgId, actorId, 'issue.edit');
    else this.authorize(att.orgId, actorId, 'project.manage');
    const issue = this.db.issues.find((i) => i.id === att.issueId);
    if (issue) {
      this.log(issue, actorId, 'updated', 'attachment', att.name, '');
      issue.updatedAt = now();
    }
    this.db.attachments = this.db.attachments.filter((a) => a.id !== attachmentId);
    this.pendingFiles.push({ orgId: att.orgId, storageKey: att.storageKey });
    this.save();
  }

  /** Looks a file up for download. Only members of its organization get it. */
  findAttachmentFor(attachmentId: ID, userId: ID): Attachment | undefined {
    const att = this.db.attachments.find((a) => a.id === attachmentId);
    return att && this.isMember(att.orgId, userId) ? att : undefined;
  }

  // ---- notifications & filters ----------------------------------------

  async markNotificationRead(notificationId: ID, actorId: ID): Promise<void> {
    const n = this.db.notifications.find((x) => x.id === notificationId);
    if (!n || n.userId !== actorId) throw new DomainError('Notification not found.');
    n.read = true;
    this.save();
  }

  async markAllNotificationsRead(orgId: ID, actorId: ID): Promise<void> {
    this.db.notifications.forEach((n) => {
      if (n.orgId === orgId && n.userId === actorId) n.read = true;
    });
    this.save();
  }

  /** Saves how this person arranged their Home dashboard. Anything not a well-formed layout is refused. */
  async setDashboardLayout(layout: DashboardLayout | null, actorId: ID): Promise<User> {
    const user = this.db.users.find((u) => u.id === actorId);
    if (!user) throw new DomainError('Account not found.');
    try {
      if (layout === null) delete user.dashboard; // back to the default for their role
      else user.dashboard = validateLayout(layout);
    } catch (e) {
      throw new DomainError((e as Error).message);
    }
    this.save();
    return { ...user };
  }

  async setNotifyPrefs(prefs: NotifyPrefs, actorId: ID): Promise<User> {
    const user = this.db.users.find((u) => u.id === actorId);
    if (!user) throw new DomainError('Account not found.');
    let clean: NotifyPrefs;
    try {
      clean = validatePrefs(prefs);
    } catch (e) {
      throw new DomainError((e as Error).message);
    }
    user.notify = clean;
    this.save();
    return { ...user };
  }

  async saveFilter(orgId: ID, input: { name: string; query: string; shared: boolean }, actorId: ID): Promise<SavedFilter> {
    if (!this.isMember(orgId, actorId)) throw new DomainError('You are not a member of this organization.');
    if (!input.name.trim()) throw new DomainError('Give the filter a name.');
    if (input.shared) this.authorize(orgId, actorId, 'filter.share');
    const f: SavedFilter = { id: uid('f'), orgId, ownerId: actorId, name: input.name.trim(), query: input.query, shared: input.shared, createdAt: now() };
    this.db.filters.push(f);
    this.save();
    return { ...f };
  }

  async deleteFilter(filterId: ID, actorId: ID): Promise<void> {
    const f = this.db.filters.find((x) => x.id === filterId);
    if (!f) throw new DomainError('Filter not found.');
    const isAdmin = can(this.db.memberships.find((m) => m.orgId === f.orgId && m.userId === actorId)?.role, 'project.manage');
    if (f.ownerId !== actorId && !isAdmin) throw new DomainError('Only the owner or an admin can delete this filter.');
    this.db.filters = this.db.filters.filter((x) => x.id !== filterId);
    this.save();
  }

  // ---- sprints -----------------------------------------------------------

  private sprintOrThrow(id: ID): Sprint {
    const s = this.db.sprints.find((x) => x.id === id);
    if (!s) throw new DomainError('Sprint not found.');
    return s;
  }

  async createSprint(projectId: ID, input: NewSprint, actorId: ID): Promise<Sprint> {
    const project = this.projectOrThrow(projectId);
    this.authorize(project.orgId, actorId, 'sprint.manage');
    if (!input.name.trim()) throw new DomainError('Sprint name is required.');
    const dateErr = validateSprintDates(input.startDate, input.endDate);
    if (dateErr) throw new DomainError(dateErr);
    const sprint: Sprint = {
      id: uid('sp'),
      orgId: project.orgId,
      projectId,
      name: input.name.trim(),
      goal: input.goal?.trim() ?? '',
      startDate: input.startDate,
      endDate: input.endDate,
      state: 'planned',
      createdAt: now(),
    };
    this.db.sprints.push(sprint);
    this.save();
    return { ...sprint };
  }

  async updateSprint(sprintId: ID, patch: SprintPatch, actorId: ID): Promise<Sprint> {
    const sprint = this.sprintOrThrow(sprintId);
    this.authorize(sprint.orgId, actorId, 'sprint.manage');
    if (sprint.state === 'completed') throw new DomainError('A completed sprint cannot be edited.');
    const next = { ...sprint, ...patch };
    if (!next.name.trim()) throw new DomainError('Sprint name is required.');
    const dateErr = validateSprintDates(next.startDate, next.endDate);
    if (dateErr) throw new DomainError(dateErr);
    Object.assign(sprint, { ...patch, name: next.name.trim() });
    this.save();
    return { ...sprint };
  }

  async startSprint(sprintId: ID, actorId: ID): Promise<Sprint> {
    const sprint = this.sprintOrThrow(sprintId);
    this.authorize(sprint.orgId, actorId, 'sprint.manage');
    const err = checkStart(sprint, this.db.sprints.filter((s) => s.projectId === sprint.projectId));
    if (err) throw new DomainError(err);
    const project = this.projectOrThrow(sprint.projectId);
    sprint.state = 'active';
    sprint.startedAt = now();
    sprint.committedPoints = sprintStats(project, this.db.issues, sprint.id).points;
    this.save();
    return { ...sprint };
  }

  async completeSprint(sprintId: ID, moveToSprintId: ID | null, actorId: ID): Promise<Sprint> {
    const sprint = this.sprintOrThrow(sprintId);
    this.authorize(sprint.orgId, actorId, 'sprint.manage');
    if (sprint.state !== 'active') throw new DomainError('Only an active sprint can be completed.');
    const project = this.projectOrThrow(sprint.projectId);
    if (moveToSprintId) {
      const target = this.sprintOrThrow(moveToSprintId);
      if (target.projectId !== sprint.projectId || target.state !== 'planned') throw new DomainError('Unfinished work can only move to a planned sprint.');
    }
    sprint.completedPoints = sprintStats(project, this.db.issues, sprint.id).donePoints;
    for (const issue of this.db.issues.filter((i) => i.sprintId === sprint.id && !isDoneIssue(project, i))) {
      this.log(issue, actorId, 'updated', 'sprint', sprint.name, moveToSprintId ? this.sprintOrThrow(moveToSprintId).name : '');
      issue.sprintId = moveToSprintId ?? undefined;
    }
    sprint.state = 'completed';
    sprint.completedAt = now();
    this.save();
    return { ...sprint };
  }

  async deleteSprint(sprintId: ID, actorId: ID): Promise<void> {
    const sprint = this.sprintOrThrow(sprintId);
    this.authorize(sprint.orgId, actorId, 'sprint.manage');
    if (sprint.state !== 'planned') throw new DomainError('Only a planned sprint can be deleted.');
    this.db.issues.forEach((i) => {
      if (i.sprintId === sprintId) i.sprintId = undefined;
    });
    this.db.sprints = this.db.sprints.filter((s) => s.id !== sprintId);
    this.save();
  }

  // ---- approvals ---------------------------------------------------------

  async decideApproval(issueId: ID, decision: ApprovalDecision, comment: string | undefined, actorId: ID): Promise<Issue> {
    const issue = this.issueOrThrow(issueId);
    // Deliberately not role-gated: any approver (even a guest) may decide.
    if (!this.isMember(issue.orgId, actorId)) throw new DomainError('You are not a member of this organization.');
    if (!issue.approval) throw new DomainError('This item does not need approval.');
    if (decision === 'rejected' && !comment?.trim()) throw new DomainError('Please explain why you are rejecting.');
    const project = this.projectOrThrow(issue.projectId);
    issue.approval = applyDecision(issue.approval, actorId, decision, comment, now());
    const state = approvalState(issue.approval);
    this.log(issue, actorId, 'updated', 'approval', '', decision + (comment?.trim() ? `: ${comment.trim()}` : ''));

    const target =
      state === 'approved'
        ? project.statuses.find((s) => s.category === 'done')
        : state === 'rejected'
          ? project.statuses.find((s) => s.category === 'todo')
          : undefined;
    if (target && issue.statusId !== target.id) {
      this.log(issue, actorId, 'updated', 'status', project.statuses.find((s) => s.id === issue.statusId)?.name ?? '', target.name);
      issue.statusId = target.id;
      issue.resolvedAt = target.category === 'done' ? now() : undefined;
    }
    issue.updatedAt = now();
    const who = this.db.users.find((u) => u.id === actorId)?.name ?? 'Someone';
    const detail = `${who} ${decision}${state === 'approved' ? ' · fully approved' : ''}`;
    for (const id of new Set([issue.reporterId, issue.assigneeId])) if (id) this.notify(issue, id, actorId, 'approval', detail);
    this.save();
    return structuredClone(issue);
  }

  async resetApproval(issueId: ID, actorId: ID): Promise<Issue> {
    const issue = this.issueOrThrow(issueId);
    this.authorize(issue.orgId, actorId, 'issue.edit');
    if (!issue.approval) throw new DomainError('This item does not need approval.');
    issue.approval = resetDecisions(issue.approval);
    this.log(issue, actorId, 'updated', 'approval', '', 'requested again');
    for (const a of issue.approval.approverIds) this.notify(issue, a, actorId, 'approval', 'Your approval is requested again');
    issue.updatedAt = now();
    this.save();
    return structuredClone(issue);
  }

  async resetDemo(): Promise<void> {
    this.db = buildSeed();
    this.save();
  }

  // ---- internals -------------------------------------------------------

  private notify(issue: Issue, userId: ID, actorId: ID, kind: NotificationKind, detail?: string) {
    if (userId === actorId || !this.isMember(issue.orgId, userId)) return;
    const n: Notification = {
      id: uid('n'),
      orgId: issue.orgId,
      userId,
      actorId,
      issueId: issue.id,
      projectId: issue.projectId,
      kind,
      detail,
      read: false,
      createdAt: now(),
    };
    this.db.notifications.push(n);
  }

  private log(issue: Issue, actorId: ID, kind: Activity['kind'], field?: string, from?: string, to?: string) {
    this.db.activity.push({
      id: uid('a'),
      orgId: issue.orgId,
      projectId: issue.projectId,
      issueId: issue.id,
      actorId,
      kind,
      field,
      from,
      to,
      createdAt: now(),
    });
  }
}
