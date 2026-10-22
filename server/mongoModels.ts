import type { Db, Collection, IndexDescription } from 'mongodb';

export type UserStatus = 'active' | 'suspended';
export type AppRole = 'superadmin' | 'owner' | 'admin' | 'manager' | 'member' | 'guest';
export type RegistrationPolicy = 'open' | 'invite_only' | 'admin_only';

export interface MongoUserDoc {
  _id: string; // Internal user ID (e.g. u_xxxx)
  firebaseUid?: string; // Stable Firebase UID
  email: string;
  displayName: string;
  photoURL?: string;
  status: UserStatus;
  isSuperAdmin?: boolean;
  color?: string;
  notify?: Record<string, unknown>;
  dashboard?: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  lastLoginAt: string;
}

export interface MongoOrganizationDoc {
  _id: string; // e.g. org_xxxx
  id: string;
  name: string;
  slug: string;
  plan: 'free' | 'team' | 'business';
  createdBy?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MongoMembershipDoc {
  _id: string; // e.g. m_xxxx
  id: string;
  orgId: string;
  userId: string;
  role: AppRole;
  status: 'active' | 'suspended';
  createdAt: string;
  updatedAt: string;
}

export interface MongoWorkspaceDoc {
  _id: string;
  id: string;
  orgId: string;
  name: string;
  description?: string;
  leadId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface MongoWorkspaceMembershipDoc {
  _id: string;
  id: string;
  workspaceId: string;
  orgId: string;
  userId: string;
  role: AppRole;
  createdAt: string;
}

export interface MongoInvitationDoc {
  _id: string; // e.g. inv_xxxx
  id: string;
  orgId: string;
  email: string;
  role: AppRole;
  tokenHash: string;
  invitedBy: string;
  expiresAt: string;
  acceptedAt?: string | null;
  createdAt: string;
}

export interface MongoAppConfigDoc {
  _id: string; // config key, e.g. 'registration'
  registrationPolicy: RegistrationPolicy;
  superAdminEmails: string[];
  updatedAt: string;
  updatedBy?: string;
}

export const MONGO_COLLECTIONS = {
  USERS: 'users',
  ORGANIZATIONS: 'organizations',
  MEMBERSHIPS: 'organization_memberships',
  LEGACY_MEMBERSHIPS: 'memberships',
  WORKSPACES: 'workspaces',
  WORKSPACE_MEMBERSHIPS: 'workspace_memberships',
  INVITATIONS: 'invitations',
  LEGACY_INVITES: 'invites',
  APP_CONFIG: 'app_config',
  PROJECTS: 'projects',
  SPRINTS: 'sprints',
  ISSUES: 'issues',
  COMMENTS: 'comments',
  ACTIVITY: 'activity',
  NOTIFICATIONS: 'notifications',
  FILTERS: 'filters',
  FORMS: 'forms',
  ATTACHMENTS: 'attachments',
  RULES: 'rules',
  RUNS: 'runs',
  SESSIONS: 'sessions',
  CREDENTIALS: 'credentials',
} as const;

/**
 * Ensures indexes exist on MongoDB collections for tenant isolation, uniqueness, and fast lookups.
 */
export async function initMongoIndexes(db: Db): Promise<void> {
  // 1. users: unique firebaseUid (sparse), unique email
  const users = db.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS);
  await users.createIndex({ firebaseUid: 1 }, { unique: true, sparse: true, name: 'idx_users_firebaseUid' });
  await users.createIndex({ email: 1 }, { unique: true, name: 'idx_users_email' });

  // 2. organizations: unique slug, id
  const orgs = db.collection<MongoOrganizationDoc>(MONGO_COLLECTIONS.ORGANIZATIONS);
  await orgs.createIndex({ slug: 1 }, { unique: true, name: 'idx_orgs_slug' });
  await orgs.createIndex({ id: 1 }, { unique: true, sparse: true, name: 'idx_orgs_id' });

  // 3. memberships: compound orgId + userId (unique), userId, orgId
  const memberships = db.collection(MONGO_COLLECTIONS.MEMBERSHIPS);
  await memberships.createIndex({ orgId: 1, userId: 1 }, { unique: true, name: 'idx_memberships_org_user' });
  await memberships.createIndex({ userId: 1 }, { name: 'idx_memberships_userId' });
  await memberships.createIndex({ orgId: 1 }, { name: 'idx_memberships_orgId' });

  // 4. invitations: tokenHash (unique), orgId + email
  const invites = db.collection(MONGO_COLLECTIONS.INVITATIONS);
  await invites.createIndex({ tokenHash: 1 }, { unique: true, name: 'idx_invites_tokenHash' });
  await invites.createIndex({ orgId: 1, email: 1 }, { name: 'idx_invites_org_email' });

  // 5. tenant-scoped entity collections
  const tenantCollections = [
    MONGO_COLLECTIONS.PROJECTS,
    MONGO_COLLECTIONS.SPRINTS,
    MONGO_COLLECTIONS.ISSUES,
    MONGO_COLLECTIONS.COMMENTS,
    MONGO_COLLECTIONS.ACTIVITY,
    MONGO_COLLECTIONS.NOTIFICATIONS,
    MONGO_COLLECTIONS.FILTERS,
    MONGO_COLLECTIONS.FORMS,
    MONGO_COLLECTIONS.ATTACHMENTS,
    MONGO_COLLECTIONS.RULES,
    MONGO_COLLECTIONS.RUNS,
  ];

  for (const collName of tenantCollections) {
    const coll = db.collection(collName);
    await coll.createIndex({ orgId: 1 }, { name: `idx_${collName}_orgId` });
    await coll.createIndex({ id: 1 }, { unique: true, sparse: true, name: `idx_${collName}_id` });
  }

  // 6. issue search and filtering
  const issues = db.collection(MONGO_COLLECTIONS.ISSUES);
  await issues.createIndex({ orgId: 1, projectId: 1, statusId: 1 }, { name: 'idx_issues_org_proj_status' });
  await issues.createIndex({ orgId: 1, assigneeId: 1 }, { name: 'idx_issues_org_assignee' });

  // 7. sessions
  const sessions = db.collection(MONGO_COLLECTIONS.SESSIONS);
  await sessions.createIndex({ tokenHash: 1 }, { unique: true, name: 'idx_sessions_tokenHash' });
  await sessions.createIndex({ userId: 1 }, { name: 'idx_sessions_userId' });
}
