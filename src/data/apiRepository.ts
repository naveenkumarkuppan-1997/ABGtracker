import type {
  ApprovalDecision,
  AttachmentView,
  AutomationRule,
  Comment,
  ID,
  IntakeForm,
  Issue,
  IssuePatch,
  FormPatch,
  NewForm,
  NewIssue,
  NewProject,
  NewRule,
  NewSprint,
  NotifyPrefs,
  DashboardLayout,
  Organization,
  OrgData,
  Project,
  ProjectPatch,
  PublicForm,
  Role,
  RulePatch,
  SavedFilter,
  Sprint,
  SprintPatch,
  User,
} from '@/domain/types';
import type { Repository, SubmitResult } from './repository';
import { getFirebaseIdToken } from '@/firebase/auth';

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
    this.name = 'ApiError';
  }
}

/**
 * The headers for a call. A JSON content-type is only sent when there is a JSON body: the server (rightly) refuses
 * "this is JSON" with nothing inside, which used to make every body-less POST (sign out, test email, AI buttons…) fail in the browser.
 */
export const requestHeaders = (hasBody: boolean): Record<string, string> => ({ ...(hasBody ? { 'content-type': 'application/json' } : {}), 'x-requested-with': 'abg-tracker' });

async function request<T>(method: 'GET' | 'POST' | 'DELETE', url: string, body?: unknown, retryCount = 0): Promise<T> {
  const headers = requestHeaders(body !== undefined);
  try {
    const fbToken = await getFirebaseIdToken();
    if (fbToken) headers['authorization'] = `Bearer ${fbToken}`;
  } catch {
    /* fallback to cookie */
  }

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'same-origin',
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    if (method === 'GET' && retryCount < 2) {
      await new Promise((r) => setTimeout(r, 600 * (retryCount + 1)));
      return request<T>(method, url, body, retryCount + 1);
    }
    throw new ApiError(0, 'Cannot reach the server. Check that it is running and try again.');
  }

  if (method === 'GET' && (res.status === 502 || res.status === 503) && retryCount < 2) {
    await new Promise((r) => setTimeout(r, 600 * (retryCount + 1)));
    return request<T>(method, url, body, retryCount + 1);
  }

  let json: { error?: string } & Record<string, unknown> = {};
  try {
    json = (await res.json()) as typeof json;
  } catch {
    /* empty or non-JSON body */
  }
  if (!res.ok) throw new ApiError(res.status, typeof json.error === 'string' ? json.error : `Request failed (${res.status}).`);
  return json as T;
}

/** Sends a file as the request body (the name travels in a header), reporting progress. fetch can't report upload progress, so this uses XMLHttpRequest. */
function sendFile(url: string, file: File, onProgress?: (fraction: number) => void): Promise<{ attachment: AttachmentView }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.setRequestHeader('content-type', 'application/octet-stream');
    xhr.setRequestHeader('x-requested-with', 'abg-tracker');
    xhr.setRequestHeader('x-file-name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (e) => e.lengthComputable && onProgress?.(e.loaded / e.total);
    xhr.onerror = () => reject(new ApiError(0, 'Cannot reach the server. Check your connection and try again.'));
    xhr.onload = () => {
      let json: { error?: string; attachment?: AttachmentView } = {};
      try {
        json = JSON.parse(xhr.responseText);
      } catch {
        /* non-JSON error page */
      }
      if (xhr.status >= 200 && xhr.status < 300 && json.attachment) resolve({ attachment: json.attachment });
      else reject(new ApiError(xhr.status, json.error ?? `Upload failed (${xhr.status}).`));
    };
    xhr.send(file);
  });
}
export interface ServerConfigView {
  allowSignup: boolean;
  emailEnabled: boolean;
  sso?: { id: string; label: string; mock: boolean } | null;
  billing?: { mock: boolean } | null;
  ai?: { label: string; mock: boolean } | null;
  attachments: { enabled: boolean; publicMaxFileBytes?: number; maxFileBytes?: number; maxFilesPerIssue?: number; blockedExtensions?: string[] };
}

export interface Session {
  user: User;
  orgs: Organization[];
}

export interface Briefing {
  summary: string;
  focus: { key: string; title: string; why: string }[];
  watchouts: string[];
  provider: string;
  mock: boolean;
  at: string;
}

export interface BillingView {
  mode: 'mock' | 'none' | 'live';
  plan: 'free' | 'team' | 'business';
  plans: Record<'free' | 'team' | 'business', { label: string; priceUsdPerMonth: number; people: number; projects: number }>;
  usage: { people: number; pendingInvites: number; projects: number };
  invoices: { id: string; plan: 'free' | 'team' | 'business'; amountUsd: number; at: string; mock: boolean }[];
  canChange: boolean;
}

export interface TokenInfo {
  id: string;
  name: string;
  scope: 'read' | 'write' | 'calendar';
  hint: string;
  createdAt: string;
  lastUsedAt: string | null;
}

export interface WebhookInfo {
  id: string;
  url: string;
  format: 'json' | 'slack';
  events: string[];
  active: boolean;
  lastStatus: string | null;
  lastAt: string | null;
}

export interface AuditEvent {
  id: string;
  at: string;
  actor: string;
  action: string;
  detail: string;
}

export interface DeviceView {
  id: string;
  device: string;
  ip: string;
  createdAt: string;
  current: boolean;
}

export interface InviteView {
  id: string;
  email: string;
  role: Role;
  expiresAt: string;
}

/** Account and invitation endpoints (everything that isn't a Repository call). */
export const api = {
  me: () => request<Session>('GET', '/api/auth/me'),
  firebaseSession: (idToken: string, orgName?: string) => request<Session>('POST', '/api/auth/firebase-session', { idToken, orgName }),
  login: (email: string, password: string, code?: string) => request<Session | { twoFactorRequired: true }>('POST', '/api/auth/login', { email, password, ...(code ? { code } : {}) }),
  /** Sends spreadsheet text to create work items in a project. */
  importCsv: async (projectId: ID, csv: string): Promise<{ created: number; skipped: { row: number; reason: string }[] }> => {
    let res: Response;
    try {
      res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/import`, { method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'text/csv', 'x-requested-with': 'abg-tracker' }, body: csv });
    } catch {
      throw new ApiError(0, 'Cannot reach the server. Check that it is running and try again.');
    }
    const json = (await res.json().catch(() => ({}))) as { error?: string; created?: number; skipped?: { row: number; reason: string }[] };
    if (!res.ok) throw new ApiError(res.status, json.error ?? `Import failed (${res.status}).`);
    return { created: json.created ?? 0, skipped: json.skipped ?? [] };
  },
  billing: (orgId: ID) => request<BillingView>('GET', `/api/orgs/${encodeURIComponent(orgId)}/billing`),
  changePlan: (orgId: ID, plan: string) => request<{ ok?: true; redirectTo?: string }>('POST', `/api/orgs/${encodeURIComponent(orgId)}/billing/plan`, { plan }),
  briefing: (slug: string) => request<Briefing>('POST', `/api/orgs/${encodeURIComponent(slug)}/briefing`),
  summarize: (slug: string, key: string) => request<{ summary: string; provider: string; mock: boolean }>('POST', `/api/orgs/${encodeURIComponent(slug)}/issues/${encodeURIComponent(key)}/summary`),
  tokens: () => request<{ tokens: TokenInfo[] }>('GET', '/api/me/tokens'),
  createToken: (name: string, scope: 'read' | 'write' | 'calendar') => request<{ token: string; view: TokenInfo }>('POST', '/api/me/tokens', { name, scope }),
  revokeToken: (id: string) => request<{ ok: true }>('DELETE', `/api/me/tokens/${encodeURIComponent(id)}`),
  webhooks: (orgId: ID) => request<{ hooks: WebhookInfo[]; events: string[] }>('GET', `/api/orgs/${encodeURIComponent(orgId)}/webhooks`),
  createWebhook: (orgId: ID, body: { url: string; events: string[]; format: 'json' | 'slack' }) => request<{ hook: WebhookInfo; secret: string }>('POST', `/api/orgs/${encodeURIComponent(orgId)}/webhooks`, body),
  deleteWebhook: (orgId: ID, id: string) => request<{ ok: true }>('DELETE', `/api/orgs/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(id)}`),
  setWebhookActive: (orgId: ID, id: string, active: boolean) => request<{ ok: true }>('POST', `/api/orgs/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(id)}/active`, { active }),
  testWebhook: (orgId: ID, id: string) => request<{ result: string }>('POST', `/api/orgs/${encodeURIComponent(orgId)}/webhooks/${encodeURIComponent(id)}/test`),  auditLog: (orgId: ID) => request<{ events: AuditEvent[] }>('GET', `/api/orgs/${encodeURIComponent(orgId)}/audit`),
  deleteOrganization: (orgId: ID, body: { password: string; confirmName: string; code?: string }) => request<{ ok: true }>('POST', `/api/orgs/${encodeURIComponent(orgId)}/delete`, body),
  deleteAccount: (body: { password: string; code?: string }) => request<{ ok: true }>('POST', '/api/me/delete', body),
  updateProfile: (name: string) => request<{ user: User }>('POST', '/api/me/profile', { name }),
  sessions: () => request<{ sessions: DeviceView[] }>('GET', '/api/me/sessions'),
  signOutDevice: (id: string) => request<{ ok: true }>('DELETE', `/api/me/sessions/${encodeURIComponent(id)}`),
  signOutOthers: () => request<{ ok: true }>('POST', '/api/me/sessions/sign-out-others'),
  twoFactorStatus: () => request<{ enabled: boolean; recoveryLeft: number }>('GET', '/api/me/2fa'),
  twoFactorBegin: () => request<{ secret: string; uri: string; qr: string }>('POST', '/api/me/2fa/begin'),
  twoFactorConfirm: (code: string) => request<{ recoveryCodes: string[] }>('POST', '/api/me/2fa/confirm', { code }),
  twoFactorDisable: (password: string) => request<{ ok: true }>('POST', '/api/me/2fa/disable', { password }),
  register: (input: { name: string; email: string; password: string; orgName: string }) => request<Session>('POST', '/api/auth/register', input),
  logout: () => request<{ ok: true }>('POST', '/api/auth/logout'),
  changePassword: (current: string, next: string) => request<{ ok: true }>('POST', '/api/auth/password', { current, next }),
  config: () => request<ServerConfigView>('GET', '/api/config'),
  uploadAttachment: (issueId: ID, file: File, onProgress?: (fraction: number) => void, commentId?: ID) =>
    sendFile(`/api/issues/${encodeURIComponent(issueId)}/attachments${commentId ? `?comment=${encodeURIComponent(commentId)}` : ''}`, file, onProgress),
  /** For request-form visitors: uses the one-time ticket the submission returned. */
  uploadPublic: (token: string, file: File, onProgress?: (fraction: number) => void) => sendFile(`/api/public/uploads/${encodeURIComponent(token)}`, file, onProgress),
  unsubscribeInfo: (token: string) => request<{ name: string }>('GET', `/api/unsubscribe/${encodeURIComponent(token)}`),
  unsubscribe: (token: string) => request<{ ok: true }>('POST', `/api/unsubscribe/${encodeURIComponent(token)}`),
  sendTestEmail: () => request<{ sent: boolean; reason?: string }>('POST', '/api/me/test-email'),
  forgotPassword: (email: string) => request<{ ok: true }>('POST', '/api/auth/forgot', { email }),
  resetPassword: (token: string, password: string) => request<{ ok: true }>('POST', `/api/auth/reset/${encodeURIComponent(token)}`, { password }),
  createInvite: (orgId: ID, email: string, role: Role) => request<{ invite: InviteView; link: string; emailed: boolean }>('POST', `/api/orgs/${encodeURIComponent(orgId)}/invites`, { email, role }),
  listInvites: (orgId: ID) => request<{ invites: InviteView[] }>('GET', `/api/orgs/${encodeURIComponent(orgId)}/invites`),
  revokeInvite: (orgId: ID, id: ID) => request<{ ok: true }>('DELETE', `/api/orgs/${encodeURIComponent(orgId)}/invites/${encodeURIComponent(id)}`),
  getInvite: (token: string) => request<{ orgName: string; email: string; role: Role; existingAccount: boolean }>('GET', `/api/invites/${encodeURIComponent(token)}`),
  acceptInvite: (token: string, input: { name?: string; password?: string }) => request<{ orgSlug: string }>('POST', `/api/invites/${encodeURIComponent(token)}/accept`, input),
};

const rpc = async <T,>(method: string, ...args: unknown[]): Promise<T> => (await request<{ result: T }>('POST', `/api/rpc/${method}`, { args })).result;

/**
 * Talks to the server. The signed-in user comes from the session cookie, so the `actorId` /
 * `userId` arguments the interface requires are intentionally not sent.
 */
export class ApiRepository implements Repository {
  async getSessionUserId(): Promise<ID> {
    return (await api.me()).user.id;
  }
  async setSessionUserId(): Promise<void> {
    throw new Error('Switching users is only available in demo mode.');
  }
  resetDemo(): Promise<void> {
    throw new Error('Resetting data is only available in demo mode.');
  }

  listOrganizations = () => rpc<Organization[]>('listOrganizations');
  loadOrg = (orgId: ID) => rpc<OrgData>('loadOrg', orgId);

  createProject = (orgId: ID, input: NewProject) => rpc<Project>('createProject', orgId, input);
  updateProject = (projectId: ID, patch: ProjectPatch) => rpc<Project>('updateProject', projectId, patch);
  deleteStatus = (projectId: ID, statusId: ID, moveTo: ID | null) => rpc<Project>('deleteStatus', projectId, statusId, moveTo);
  deleteAttachment = (attachmentId: ID) => rpc<void>('deleteAttachment', attachmentId);
  deleteIssueType = (projectId: ID, typeId: ID, moveTo: ID | null) => rpc<Project>('deleteIssueType', projectId, typeId, moveTo);
  markNotificationRead =(id: ID) => rpc<void>('markNotificationRead', id);
  markAllNotificationsRead = (orgId: ID) => rpc<void>('markAllNotificationsRead', orgId);
  setNotifyPrefs = (prefs: NotifyPrefs) => rpc<User>('setNotifyPrefs', prefs);
  setDashboardLayout = (layout: DashboardLayout | null) => rpc<User>('setDashboardLayout', layout);
  saveFilter = (orgId: ID, input: { name: string; query: string; shared: boolean }) => rpc<SavedFilter>('saveFilter', orgId, input);
  deleteFilter = (id: ID) => rpc<void>('deleteFilter', id);

  createIssue = (orgId: ID, input: NewIssue) => rpc<Issue>('createIssue', orgId, input);
  updateIssue = (issueId: ID, patch: IssuePatch) => rpc<Issue>('updateIssue', issueId, patch);
  deleteIssue = (issueId: ID) => rpc<void>('deleteIssue', issueId);
  addComment = (issueId: ID, body: string) => rpc<Comment>('addComment', issueId, body);
  setWatching = (issueId: ID, watching: boolean) => rpc<Issue>('setWatching', issueId, watching);
  toggleReaction = (commentId: ID, emoji: string) => rpc<Comment>('toggleReaction', commentId, emoji);

  createSprint = (projectId: ID, input: NewSprint) => rpc<Sprint>('createSprint', projectId, input);
  updateSprint = (sprintId: ID, patch: SprintPatch) => rpc<Sprint>('updateSprint', sprintId, patch);
  startSprint = (sprintId: ID) => rpc<Sprint>('startSprint', sprintId);
  completeSprint = (sprintId: ID, moveTo: ID | null) => rpc<Sprint>('completeSprint', sprintId, moveTo);
  deleteSprint = (sprintId: ID) => rpc<void>('deleteSprint', sprintId);

  updateMemberRole = (orgId: ID, userId: ID, role: Role) => rpc<void>('updateMemberRole', orgId, userId, role);
  removeMember = (orgId: ID, userId: ID) => rpc<void>('removeMember', orgId, userId);

  createForm = (projectId: ID, input: NewForm) => rpc<IntakeForm>('createForm', projectId, input);
  updateForm = (formId: ID, patch: FormPatch) => rpc<IntakeForm>('updateForm', formId, patch);
  deleteForm = (formId: ID) => rpc<void>('deleteForm', formId);
  getPublicForm = (orgSlug: string, formSlug: string) => rpc<PublicForm>('getPublicForm', orgSlug, formSlug);
  submitForm = (orgSlug: string, formSlug: string, answers: Record<string, string>, submitter: { name: string; email: string }, honeypot?: string) =>
    rpc<SubmitResult>('submitForm', orgSlug, formSlug, answers, submitter, honeypot ?? '');

  createRule = (projectId: ID, input: NewRule) => rpc<AutomationRule>('createRule', projectId, input);
  updateRule = (ruleId: ID, patch: RulePatch) => rpc<AutomationRule>('updateRule', ruleId, patch);
  deleteRule = (ruleId: ID) => rpc<void>('deleteRule', ruleId);
  runScheduledAutomations = (orgId: ID) => rpc<number>('runScheduledAutomations', orgId);

  decideApproval = (issueId: ID, decision: ApprovalDecision, comment?: string) => rpc<Issue>('decideApproval', issueId, decision, comment ?? null);
  resetApproval = (issueId: ID) => rpc<Issue>('resetApproval', issueId);
}
