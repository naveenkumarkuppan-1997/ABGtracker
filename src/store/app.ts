import { create } from 'zustand';
import { ApiError, ApiRepository, api, type ServerConfigView } from '@/data/apiRepository';
import { LocalRepository } from '@/data/localRepository';
import type { Repository } from '@/data/repository';
import { can, type Action } from '@/domain/permissions';
import { checkApprovalGate } from '@/domain/approvals';
import { checkTransition } from '@/domain/workflow';
import { resolvePrefs } from '@/domain/notifyPrefs';
import { browserTimeZone } from '@/domain/timeZone';
import {
  getAuthStatus,
  signInWithGoogle as fbSignInWithGoogle,
  signInWithMicrosoft as fbSignInWithMicrosoft,
  signInWithEmail as fbSignInWithEmail,
  registerWithEmail as fbRegisterWithEmail,
  signOutFirebase,
  getFriendlyAuthErrorMessage,
  subscribeToAuthState,
} from '@/firebase/auth';
import type { User as FirebaseUser } from 'firebase/auth';
import type {
  ApprovalDecision,
  ID,
  Issue,
  IssuePatch,
  NewIssue,
  NewProject,
  NewForm,
  FormPatch,
  NewRule,
  RulePatch,
  NewSprint,
  DashboardLayout,
  NotifyPrefs,
  Organization,
  OrgData,
  Project,
  ProjectPatch,
  Role,
  SprintPatch,
  User,
} from '@/domain/types';

/**
 * 'api'   = the real server (sign-in, shared database). The default.
 * 'local' = offline demo: everything stays in this browser (npm run dev:local).
 */
export const NEEDS_CODE = '__needs_code__';
export const BACKEND: 'api' | 'local' = import.meta.env.VITE_BACKEND === 'local' ? 'local' : 'api';

const repo: Repository = BACKEND === 'api' ? new ApiRepository() : new LocalRepository();

type Theme = 'light' | 'dark';

function initialTheme(): Theme {
  try {
    const saved = localStorage.getItem('abg2:theme');
    if (saved === 'light' || saved === 'dark') return saved;
  } catch {
    /* ignore */
  }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

function applyTheme(t: Theme) {
  document.documentElement.classList.toggle('dark', t === 'dark');
  try {
    localStorage.setItem('abg2:theme', t);
  } catch {
    /* ignore */
  }
}

interface AppState {
  ready: boolean;
  /** Signed-in account (api mode). In local mode this is always null and `userId` is the demo user. */
  authUser: User | null;
  /** Set when the server can't be reached at start-up. */
  connectionError: string | null;
  /** What the server allows (file limits and so on). Null in demo mode or before it has answered. */
  serverConfig: ServerConfigView | null;
  userId: ID;
  orgs: Organization[];
  orgId: ID | null;
  data: OrgData | null;
  theme: Theme;
  toast: { id: number; message: string } | null;

  init(): Promise<void>;
  /** Signed-in Firebase User instance if authenticated with Firebase. */
  firebaseUser: FirebaseUser | null;
  /** Whether Firebase client is configured with required environment variables. */
  firebaseConfigured: boolean;
  /** Resolves to an error message, null on success, or NEEDS_CODE when the account also wants its two-factor code. */
  signIn(email: string, password: string, code?: string): Promise<string | null>;
  register(input: { name: string; email: string; password: string; orgName: string }): Promise<string | null>;
  signInWithGoogle(): Promise<string | null>;
  signInWithMicrosoft(): Promise<string | null>;
  signOut(): Promise<void>;
  /** Re-reads the session (after accepting an invitation, for example). */
  refreshSession(): Promise<void>;
  /** Re-reads the current organization (after something changed outside the normal calls, such as an upload). */
  reloadOrg(): Promise<void>;
  deleteAttachment(attachmentId: ID): Promise<boolean>;
  updateMemberRole(userId: ID, role: Role): Promise<boolean>;
  removeMember(userId: ID): Promise<boolean>;
  selectOrg(orgId: ID): Promise<void>;
  switchUser(userId: ID): Promise<void>;
  resetDemo(): Promise<void>;
  toggleTheme(): void;
  notify(message: string): void;

  createProject(input: NewProject): Promise<Project | null>;
  createIssue(input: NewIssue): Promise<Issue | null>;
  /** Resolves to true when the change was applied. */
  updateIssue(issueId: ID, patch: IssuePatch): Promise<boolean>;
  deleteIssue(issueId: ID): Promise<void>;
  addComment(issueId: ID, body: string): Promise<boolean>;
  /** Posts a comment, then attaches the chosen files to it. Returns the files that could not be sent (with why). */
  postComment(issueId: ID, body: string, files: File[]): Promise<{ posted: boolean; failed: { name: string; reason: string }[] }>;

  createForm(projectId: ID, input: NewForm): Promise<boolean>;
  updateForm(formId: ID, patch: FormPatch): Promise<boolean>;
  deleteForm(formId: ID): Promise<boolean>;

  createRule(projectId: ID, input: NewRule): Promise<boolean>;
  updateRule(ruleId: ID, patch: RulePatch): Promise<boolean>;
  deleteRule(ruleId: ID): Promise<boolean>;

  createSprint(projectId: ID, input: NewSprint): Promise<boolean>;
  updateSprint(sprintId: ID, patch: SprintPatch): Promise<boolean>;
  startSprint(sprintId: ID): Promise<boolean>;
  completeSprint(sprintId: ID, moveToSprintId: ID | null): Promise<boolean>;
  deleteSprint(sprintId: ID): Promise<boolean>;
  decideApproval(issueId: ID, decision: ApprovalDecision, comment?: string): Promise<boolean>;
  resetApproval(issueId: ID): Promise<boolean>;

  updateProject(projectId: ID, patch: ProjectPatch): Promise<boolean>;
  deleteStatus(projectId: ID, statusId: ID, moveToStatusId: ID | null): Promise<boolean>;
  deleteIssueType(projectId: ID, typeId: ID, moveToTypeId: ID | null): Promise<boolean>;
  markNotificationRead(id: ID): Promise<void>;
  markAllNotificationsRead(): Promise<void>;
  setNotifyPrefs(prefs: NotifyPrefs): Promise<boolean>;
  setWatching(issueId: ID, watching: boolean): Promise<void>;
  /** Saves (or, with null, resets) how this person arranged their Home dashboard. */
  saveDashboard(layout: DashboardLayout | null): Promise<boolean>;
  toggleReaction(commentId: ID, emoji: string): Promise<void>;
  saveFilter(input: { name: string; query: string; shared: boolean }): Promise<boolean>;
  deleteFilter(id: ID): Promise<void>;
}

export const useApp = create<AppState>((set, get) => {
  const refresh = async () => {
    const { orgId, userId } = get();
    if (!orgId) return;
    set({ data: await repo.loadOrg(orgId, userId) });
  };

  /** Run a mutation; surface any error as a toast and re-sync from the repository. */
  const run = async <T,>(fn: () => Promise<T>): Promise<T | null> => {
    try {
      const result = await fn();
      await refresh();
      return result;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        // The session expired or was ended elsewhere: back to the sign-in screen.
        set({ authUser: null, orgs: [], orgId: null, data: null, userId: '' });
        return null;
      }
      get().notify(e instanceof Error ? e.message : 'Something went wrong.');
      await refresh().catch(() => undefined);
      return null;
    }
  };

  // Live updates: the server says when an organization changed; we then re-read it the normal way.
  let live: EventSource | null = null;
  let liveTimer: ReturnType<typeof setTimeout> | undefined;
  let wasDown = false;
  const startLive = () => {
    if (BACKEND !== 'api' || live || typeof EventSource === 'undefined') return;
    live = new EventSource('/api/events');
    live.addEventListener('changed', (e) => {
      try {
        if ((JSON.parse((e as MessageEvent).data) as { orgId?: string }).orgId !== get().orgId) return;
      } catch {
        return;
      }
      clearTimeout(liveTimer);
      liveTimer = setTimeout(() => void refresh().catch(() => undefined), 300); // several quick changes become one refresh
    });
    live.onerror = () => {
      wasDown = true; // the browser reconnects by itself
    };
    live.onopen = () => {
      if (wasDown) void refresh().catch(() => undefined); // catch up on what was missed
      wasDown = false;
    };
  };
  const stopLive = () => {
    live?.close();
    live = null;
    clearTimeout(liveTimer);
  };

  const adopt = (session: { user: User; orgs: Organization[] }) => {
    startLive();
    set({ authUser: session.user, userId: session.user.id, orgs: session.orgs, orgId: null, data: null });
    // First time on this account: quietly remember the browser's time zone, so nobody has to find a setting for it.
    const tz = browserTimeZone();
    if (BACKEND === 'api' && tz && !session.user.notify?.timeZone) {
      repo
        .setNotifyPrefs({ ...resolvePrefs(session.user), timeZone: tz }, session.user.id)
        .then((user) => set({ authUser: user }))
        .catch(() => undefined); // not important enough to bother anyone
    }
  };

  return {
    ready: false,
    authUser: null,
    firebaseUser: null,
    firebaseConfigured: getAuthStatus().configured,
    connectionError: null,
    serverConfig: null,
    userId: '',
    orgs: [],
    orgId: null,
    data: null,
    theme: initialTheme(),
    toast: null,

    async init() {
      applyTheme(get().theme);

      // Listen for Firebase Auth state changes
      subscribeToAuthState(async (fbUser) => {
        set({ firebaseUser: fbUser });
        if (fbUser && !get().authUser) {
          try {
            const token = await fbUser.getIdToken();
            const session = await api.firebaseSession(token);
            adopt(session);
          } catch {
            // Keep current session state if exchange fails
          }
        }
      });

      if (BACKEND === 'api') {
        try {
          adopt(await api.me());
        } catch (e) {
          // 401 just means "not signed in"; anything else means the server is unreachable.
          if (!(e instanceof ApiError && e.status === 401)) set({ connectionError: e instanceof Error ? e.message : 'Cannot reach the server.' });
        }
        api.config().then((serverConfig) => set({ serverConfig })).catch(() => undefined);
        set({ ready: true });
        return;
      }
      const userId = await repo.getSessionUserId();
      const orgs = await repo.listOrganizations(userId);
      set({ userId, orgs, ready: true });
    },

    async signIn(email, password, code) {
      const { firebaseConfigured } = get();
      if (firebaseConfigured && !code) {
        try {
          const fbUser = await fbSignInWithEmail(email, password);
          const idToken = await fbUser.getIdToken();
          const session = await api.firebaseSession(idToken);
          adopt(session);
          return null;
        } catch (e) {
          const msg = getFriendlyAuthErrorMessage(e);
          // Fallback to legacy auth if configuration is missing or invalid
          if (!msg.includes('unconfigured') && !msg.includes('API key')) {
            return msg;
          }
        }
      }
      try {
        const r = await api.login(email, password, code);
        if ('twoFactorRequired' in r) return NEEDS_CODE;
        adopt(r);
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : 'Could not sign in.';
      }
    },

    async register(input) {
      const { firebaseConfigured } = get();
      if (firebaseConfigured) {
        try {
          const { user: fbUser } = await fbRegisterWithEmail({
            name: input.name,
            email: input.email,
            password: input.password,
          });
          const idToken = await fbUser.getIdToken();
          const session = await api.firebaseSession(idToken, input.orgName);
          adopt(session);
          return null;
        } catch (e) {
          const msg = getFriendlyAuthErrorMessage(e);
          if (!msg.includes('unconfigured') && !msg.includes('API key')) {
            return msg;
          }
        }
      }
      try {
        adopt(await api.register(input));
        return null;
      } catch (e) {
        return e instanceof Error ? e.message : 'Could not create the account.';
      }
    },

    async signInWithGoogle() {
      try {
        const fbUser = await fbSignInWithGoogle();
        const idToken = await fbUser.getIdToken();
        const session = await api.firebaseSession(idToken);
        adopt(session);
        return null;
      } catch (e) {
        return getFriendlyAuthErrorMessage(e);
      }
    },

    async signInWithMicrosoft() {
      try {
        const fbUser = await fbSignInWithMicrosoft();
        const idToken = await fbUser.getIdToken();
        const session = await api.firebaseSession(idToken);
        adopt(session);
        return null;
      } catch (e) {
        return getFriendlyAuthErrorMessage(e);
      }
    },

    async signOut() {
      await signOutFirebase().catch(() => undefined);
      await api.logout().catch(() => undefined);
      set({ authUser: null, firebaseUser: null, orgs: [], orgId: null, data: null, userId: '' });
    },

    async reloadOrg() {
      await refresh().catch(() => undefined);
    },

    async deleteAttachment(attachmentId) {
      return (await run(async () => (await repo.deleteAttachment(attachmentId, get().userId), true))) !== null;
    },

    async refreshSession() {
      try {
        adopt(await api.me());
      } catch {
        /* stay as we are */
      }
    },

    updateMemberRole: async (userId, role) => (await run(async () => (await repo.updateMemberRole(get().orgId!, userId, role, get().userId), true))) !== null,
    removeMember: async (userId) => (await run(async () => (await repo.removeMember(get().orgId!, userId, get().userId), true))) !== null,

    async selectOrg(orgId) {
      const { userId } = get();
      // Time-based rules (e.g. "becomes overdue") are evaluated whenever an organization is opened.
      await repo.runScheduledAutomations(orgId, userId).catch(() => 0);
      let data: OrgData;
      try {
        data = await repo.loadOrg(orgId, userId);
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) {
          set({ authUser: null, orgs: [], orgId: null, data: null, userId: '' });
        }
        throw e;
      }
      set({ orgId, data });
    },

    async switchUser(userId) {
      await repo.setSessionUserId(userId);
      const orgs = await repo.listOrganizations(userId);
      const current = get().orgId;
      const stillMember = orgs.some((o) => o.id === current);
      // Swap user and data in one update so mounted pages never see a half-switched state.
      const data = stillMember && current ? await repo.loadOrg(current, userId) : null;
      set({ userId, orgs, orgId: stillMember ? current : null, data });
    },

    async resetDemo() {
      await repo.resetDemo();
      const userId = await repo.getSessionUserId();
      const orgs = await repo.listOrganizations(userId);
      const current = get().orgId;
      const data = current && orgs.some((o) => o.id === current) ? await repo.loadOrg(current, userId) : null;
      set({ userId, orgs, orgId: data ? current : null, data });
    },

    toggleTheme() {
      const theme: Theme = get().theme === 'dark' ? 'light' : 'dark';
      applyTheme(theme);
      set({ theme });
    },

    notify(message) {
      const id = Date.now();
      set({ toast: { id, message } });
      setTimeout(() => {
        if (get().toast?.id === id) set({ toast: null });
      }, 4000);
    },

    createProject: (input) => run(() => repo.createProject(get().orgId!, input, get().userId)),
    createIssue: (input) => run(() => repo.createIssue(get().orgId!, input, get().userId)),

    async createForm(projectId, input) {
      return (await run(() => repo.createForm(projectId, input, get().userId))) !== null;
    },
    async updateForm(formId, patch) {
      return (await run(() => repo.updateForm(formId, patch, get().userId))) !== null;
    },
    async deleteForm(formId) {
      return (await run(async () => (await repo.deleteForm(formId, get().userId), true))) !== null;
    },

    async createRule(projectId, input) {
      return (await run(() => repo.createRule(projectId, input, get().userId))) !== null;
    },
    async updateRule(ruleId, patch) {
      return (await run(() => repo.updateRule(ruleId, patch, get().userId))) !== null;
    },
    async deleteRule(ruleId) {
      return (await run(async () => (await repo.deleteRule(ruleId, get().userId), true))) !== null;
    },

    async createSprint(projectId, input) {
      return (await run(() => repo.createSprint(projectId, input, get().userId))) !== null;
    },
    async updateSprint(sprintId, patch) {
      return (await run(() => repo.updateSprint(sprintId, patch, get().userId))) !== null;
    },
    async startSprint(sprintId) {
      return (await run(() => repo.startSprint(sprintId, get().userId))) !== null;
    },
    async completeSprint(sprintId, moveTo) {
      return (await run(() => repo.completeSprint(sprintId, moveTo, get().userId))) !== null;
    },
    async deleteSprint(sprintId) {
      return (await run(async () => (await repo.deleteSprint(sprintId, get().userId), true))) !== null;
    },
    async decideApproval(issueId, decision, comment) {
      return (await run(() => repo.decideApproval(issueId, decision, comment, get().userId))) !== null;
    },
    async resetApproval(issueId) {
      return (await run(() => repo.resetApproval(issueId, get().userId))) !== null;
    },

    async deleteIssueType(projectId, typeId, moveToTypeId) {
      return (await run(() => repo.deleteIssueType(projectId, typeId, moveToTypeId, get().userId))) !== null;
    },

    async deleteStatus(projectId, statusId, moveToStatusId) {
      return (await run(() => repo.deleteStatus(projectId, statusId, moveToStatusId, get().userId))) !== null;
    },

    async updateProject(projectId, patch) {
      return (await run(() => repo.updateProject(projectId, patch, get().userId))) !== null;
    },

    async markNotificationRead(id) {
      await run(() => repo.markNotificationRead(id, get().userId));
    },

    async markAllNotificationsRead() {
      await run(() => repo.markAllNotificationsRead(get().orgId!, get().userId));
    },

    async saveDashboard(layout) {
      const user = await run(() => repo.setDashboardLayout(layout, get().userId));
      if (user && BACKEND === 'api') set({ authUser: user });
      return user !== null;
    },

    async setWatching(issueId, watching) {
      await run(() => repo.setWatching(issueId, watching, get().userId));
    },

    async toggleReaction(commentId, emoji) {
      await run(() => repo.toggleReaction(commentId, emoji, get().userId));
    },

    async setNotifyPrefs(prefs) {
      const user = await run(() => repo.setNotifyPrefs(prefs, get().userId));
      if (user) set({ authUser: user });
      return user !== null;
    },

    async saveFilter(input) {
      return (await run(() => repo.saveFilter(get().orgId!, input, get().userId))) !== null;
    },

    async deleteFilter(id) {
      await run(() => repo.deleteFilter(id, get().userId));
    },

    async updateIssue(issueId, patch) {
      const data = get().data;
      // Validate workflow rules up front so a blocked move never flickers on screen.
      if (data && patch.statusId) {
        const issue = data.issues.find((i) => i.id === issueId);
        const project = data.projects.find((p) => p.id === issue?.projectId);
        if (issue && project) {
          const err = checkTransition(project, issue, patch.statusId, patch) ?? checkApprovalGate(project, issue, patch.statusId);
          if (err) {
            get().notify(err);
            return false;
          }
        }
      }
      // Optimistic update so drag & drop and inline edits feel instant.
      if (data) {
        set({ data: { ...data, issues: data.issues.map((i) => (i.id === issueId ? { ...i, ...patch } : i)) } });
      }
      return (await run(() => repo.updateIssue(issueId, patch, get().userId))) !== null;
    },

    async deleteIssue(issueId) {
      await run(() => repo.deleteIssue(issueId, get().userId));
    },

    async postComment(issueId, body, files) {
      const text = body.trim() || (files.length ? `Attached ${files.map((f) => f.name).join(', ')}` : '');
      const comment = await run(() => repo.addComment(issueId, text, get().userId));
      if (!comment) return { posted: false, failed: [] };
      const failed: { name: string; reason: string }[] = [];
      for (const f of files) {
        try {
          await api.uploadAttachment(issueId, f, undefined, comment.id);
        } catch (e) {
          failed.push({ name: f.name, reason: e instanceof Error ? e.message : 'Upload failed.' });
        }
      }
      await refresh().catch(() => undefined);
      return { posted: true, failed };
    },

    async addComment(issueId, body) {
      return (await run(() => repo.addComment(issueId, body, get().userId))) !== null;
    },
  };
});

// ---- Public (signed-out) access to intake forms ---------------------------

export const getPublicForm = (orgSlug: string, formSlug: string) => repo.getPublicForm(orgSlug, formSlug);
export const submitPublicForm = (
  orgSlug: string,
  formSlug: string,
  answers: Record<string, string>,
  submitter: { name: string; email: string },
  honeypot?: string
) => repo.submitForm(orgSlug, formSlug, answers, submitter, honeypot);

// ---- Selectors / helpers -------------------------------------------------

export function useRole(): Role | undefined {
  return useApp((s) => s.data?.members.find((m) => m.id === s.userId)?.role);
}

export function useUnreadCount(): number {
  return useApp((s) => s.data?.notifications.filter((n) => !n.read).length ?? 0);
}

export function useCan(action: Action): boolean {
  return can(useRole(), action);
}
