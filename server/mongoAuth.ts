import type { Db } from 'mongodb';
import {
  MONGO_COLLECTIONS,
  type MongoUserDoc,
  type MongoOrganizationDoc,
  type MongoMembershipDoc,
  type MongoInvitationDoc,
  type MongoAppConfigDoc,
  type RegistrationPolicy,
  type AppRole,
} from './mongoModels';
import type { VerifiedFirebaseIdentity } from './firebaseAdmin';
import { newId, hashToken } from './auth';
import { HttpError } from './errors';
import { slugify } from '../src/domain/forms';

const COLORS = ['#0d3133', '#7c5cd6', '#2f9e6b', '#e8833a', '#dc4b4b', '#3b82f6', '#0f8b8d'];

export interface ProvisionUserOptions {
  inviteToken?: string;
  orgName?: string;
  userAgent?: string;
  ip?: string;
}

export interface ProvisionUserResult {
  user: MongoUserDoc;
  organizations: MongoOrganizationDoc[];
  isNewUser: boolean;
}

/**
 * Returns current registration policy from app_config collection or fallback.
 */
export async function getRegistrationPolicy(
  db: Db,
  fallbackPolicy?: RegistrationPolicy
): Promise<{ policy: RegistrationPolicy; superAdminEmails: string[] }> {
  try {
    const configColl = db.collection<MongoAppConfigDoc>(MONGO_COLLECTIONS.APP_CONFIG);
    const config = await configColl.findOne({ _id: 'registration' });
    const policy = fallbackPolicy ?? config?.registrationPolicy ?? 'open';
    return {
      policy,
      superAdminEmails: config?.superAdminEmails ?? [],
    };
  } catch {
    return { policy: fallbackPolicy || 'open', superAdminEmails: [] };
  }
}

/**
 * Generates a unique organization slug in MongoDB.
 */
async function generateUniqueOrgSlug(db: Db, baseName: string): Promise<string> {
  const orgs = db.collection<MongoOrganizationDoc>(MONGO_COLLECTIONS.ORGANIZATIONS);
  let baseSlug = slugify(baseName) || 'workspace';
  if (baseSlug.length < 2) baseSlug = `${baseSlug}-team`;

  let candidate = baseSlug;
  let counter = 2;
  while (await orgs.findOne({ slug: candidate })) {
    candidate = `${baseSlug}-${counter++}`;
  }
  return candidate;
}

/**
 * Provisions or updates a user upon Firebase authentication.
 *
 * Idempotency & Safety guarantees:
 * 1. Matches on firebaseUid first, then lowercase email.
 * 2. If the user exists: only safe metadata is updated (lastLoginAt, photoURL, displayName).
 *    Status and role are NEVER overwritten from client claims.
 * 3. If user is suspended: throws HTTP 403.
 * 4. If user is new: checks registration policy.
 *    - 'invite_only': strictly requires a valid, unaccepted invite token.
 *    - 'admin_only': strictly rejected unless invited.
 *    - 'open': creates personal workspace/organization.
 * 5. Concurrent calls handled safely via MongoDB unique indexes.
 */
export async function provisionMongoUser(
  db: Db,
  identity: VerifiedFirebaseIdentity,
  options: ProvisionUserOptions = {},
  serverConfigPolicy: RegistrationPolicy = 'open',
  configuredSuperAdmins: string[] = []
): Promise<ProvisionUserResult> {
  if (!identity.email) {
    throw new HttpError(400, 'Authenticated identity is missing an email address.');
  }

  const email = identity.email.trim().toLowerCase();
  const usersColl = db.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS);
  const orgsColl = db.collection<MongoOrganizationDoc>(MONGO_COLLECTIONS.ORGANIZATIONS);
  const membershipsColl = db.collection<MongoMembershipDoc>(MONGO_COLLECTIONS.MEMBERSHIPS);
  const invitesColl = db.collection<MongoInvitationDoc>(MONGO_COLLECTIONS.INVITATIONS);

  const now = new Date().toISOString();

  // 1. Check for existing user by firebaseUid or email
  let user = await usersColl.findOne({
    $or: [{ firebaseUid: identity.uid }, { email }],
  });

  if (user) {
    if (user.status === 'suspended') {
      throw new HttpError(403, 'This account has been suspended. Please contact your organization administrator.');
    }

    // Determine if user should be superadmin
    const isSuperAdmin = user.isSuperAdmin || configuredSuperAdmins.includes(email);

    // Update only permitted fields: lastLoginAt, photoURL, firebaseUid link
    const updateFields: Partial<MongoUserDoc> = {
      lastLoginAt: now,
      updatedAt: now,
    };

    if (!user.firebaseUid) {
      updateFields.firebaseUid = identity.uid;
    }
    if (!user.displayName && identity.name) {
      updateFields.displayName = identity.name;
    }
    if (identity.picture && !user.photoURL) {
      updateFields.photoURL = identity.picture;
    }
    if (isSuperAdmin !== user.isSuperAdmin) {
      updateFields.isSuperAdmin = isSuperAdmin;
    }

    await usersColl.updateOne({ _id: user._id }, { $set: updateFields });
    user = (await usersColl.findOne({ _id: user._id }))!;

    // Resolve user's organizations
    const memberships = await membershipsColl.find({ userId: user._id, status: 'active' }).toArray();
    const orgIds = memberships.map((m) => m.orgId);
    const orgs = orgIds.length > 0 ? await orgsColl.find({ $or: [{ _id: { $in: orgIds } }, { id: { $in: orgIds } }] }).toArray() : [];

    return { user, organizations: orgs, isNewUser: false };
  }

  // 2. New user registration check
  const { policy, superAdminEmails } = await getRegistrationPolicy(db, serverConfigPolicy);
  const allSuperAdmins = [...new Set([...configuredSuperAdmins, ...superAdminEmails])];
  const isSuperAdmin = allSuperAdmins.includes(email);

  // Validate invite if provided or required
  let pendingInvite: MongoInvitationDoc | null = null;
  if (options.inviteToken) {
    const tokenH = hashToken(options.inviteToken);
    pendingInvite = await invitesColl.findOne({
      tokenHash: tokenH,
      acceptedAt: null,
      expiresAt: { $gt: now },
    });

    if (!pendingInvite) {
      throw new HttpError(404, 'The invitation link is invalid or has expired.');
    }
    if (pendingInvite.email.toLowerCase() !== email) {
      throw new HttpError(403, `This invitation is addressed to ${pendingInvite.email}, not ${email}.`);
    }
  }

  if (!pendingInvite && !isSuperAdmin) {
    if (policy === 'invite_only') {
      throw new HttpError(403, 'Registration is invitation-only. Please contact an administrator for an invitation.');
    }
    if (policy === 'admin_only') {
      throw new HttpError(403, 'Account registration is disabled. Accounts must be provisioned by an administrator.');
    }
  }

  // 3. Create new user document
  const userId = newId('u');
  const displayName = identity.name || email.split('@')[0];
  const color = COLORS[Math.floor(Math.random() * COLORS.length)];

  const newUser: MongoUserDoc = {
    _id: userId,
    firebaseUid: identity.uid,
    email,
    displayName,
    photoURL: identity.picture,
    status: 'active',
    isSuperAdmin,
    color,
    createdAt: now,
    updatedAt: now,
    lastLoginAt: now,
  };

  try {
    await usersColl.insertOne(newUser);
  } catch (err: unknown) {
    // In case of race condition on unique index (firebaseUid or email)
    const existing = await usersColl.findOne({ $or: [{ firebaseUid: identity.uid }, { email }] });
    if (existing) {
      return provisionMongoUser(db, identity, options, serverConfigPolicy, configuredSuperAdmins);
    }
    throw err;
  }

  const userOrgs: MongoOrganizationDoc[] = [];

  // 4. Handle organization membership for new user
  if (pendingInvite) {
    // Join the invited organization
    const org = await orgsColl.findOne({ $or: [{ _id: pendingInvite.orgId }, { id: pendingInvite.orgId }] });
    if (org) {
      const membershipId = newId('m');
      const membership: MongoMembershipDoc = {
        _id: membershipId,
        id: membershipId,
        orgId: org.id || org._id,
        userId: newUser._id,
        role: pendingInvite.role || 'member',
        status: 'active',
        createdAt: now,
        updatedAt: now,
      };
      await membershipsColl.updateOne(
        { orgId: membership.orgId, userId: membership.userId },
        { $setOnInsert: membership },
        { upsert: true }
      );
      await invitesColl.updateOne({ _id: pendingInvite._id }, { $set: { acceptedAt: now } });
      userOrgs.push(org);
    }
  } else {
    // Open registration: create personal initial organization
    const requestedOrgName = options.orgName?.trim() || `${displayName}'s workspace`;
    const orgId = newId('org');
    const slug = await generateUniqueOrgSlug(db, requestedOrgName);

    const newOrg: MongoOrganizationDoc = {
      _id: orgId,
      id: orgId,
      name: requestedOrgName,
      slug,
      plan: 'free',
      createdBy: newUser._id,
      createdAt: now,
      updatedAt: now,
    };

    await orgsColl.insertOne(newOrg);

    const membershipId = newId('m');
    const newMembership: MongoMembershipDoc = {
      _id: membershipId,
      id: membershipId,
      orgId: newOrg.id,
      userId: newUser._id,
      role: 'owner',
      status: 'active',
      createdAt: now,
      updatedAt: now,
    };

    await membershipsColl.insertOne(newMembership);
    userOrgs.push(newOrg);
  }

  return {
    user: newUser,
    organizations: userOrgs,
    isNewUser: true,
  };
}
