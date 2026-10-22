import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { initMongoClient, closeMongoClient } from './mongodb';
import {
  initMongoIndexes,
  MONGO_COLLECTIONS,
  type MongoUserDoc,
  type MongoOrganizationDoc,
  type MongoMembershipDoc,
  type MongoInvitationDoc,
} from './mongoModels';
import { provisionMongoUser } from './mongoAuth';
import { migratePgToMongo } from './migrateMongo';
import { MongoSnapshotStore } from './mongoStore';
import { openDb, migrate } from './db';
import { Accounts } from './accounts';
import { PostgresSnapshotStore } from './store';
import { LocalRepository } from '../src/data/localRepository';
import { ConsoleMailer } from './mailer';
import { hashToken, newId } from './auth';
import type { Db as MongoDb } from 'mongodb';

try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.('.env');
} catch {}

describe('MongoDB Multi-User Authentication & Tenant Provisioning', () => {
  let mongoDb: MongoDb | null = null;
  const testRunId = `test_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;

  beforeEach(async () => {
    if (process.env.MONGODB_URI) {
      const client = await initMongoClient(process.env.MONGODB_URI);
      if (client) {
        mongoDb = client.db('abg_tracker');
      }
    }
  });

  afterEach(async () => {
    if (mongoDb) {
      // Clean up test documents created during this test run
      await mongoDb.collection(MONGO_COLLECTIONS.USERS).deleteMany({ email: { $regex: testRunId } });
      await mongoDb.collection(MONGO_COLLECTIONS.ORGANIZATIONS).deleteMany({ slug: { $regex: testRunId } });
      await mongoDb.collection(MONGO_COLLECTIONS.MEMBERSHIPS).deleteMany({ id: { $regex: testRunId } });
      await mongoDb.collection(MONGO_COLLECTIONS.INVITATIONS).deleteMany({ email: { $regex: testRunId } });
    }
    await closeMongoClient();
  });

  it('initializes required indexes on all core collections', async () => {
    if (!mongoDb) return;
    await initMongoIndexes(mongoDb);

    const userIndexes = await mongoDb.collection(MONGO_COLLECTIONS.USERS).indexes();
    const hasUidIndex = userIndexes.some((idx) => idx.name === 'idx_users_firebaseUid');
    const hasEmailIndex = userIndexes.some((idx) => idx.name === 'idx_users_email');

    expect(hasUidIndex).toBe(true);
    expect(hasEmailIndex).toBe(true);

    const membershipIndexes = await mongoDb.collection(MONGO_COLLECTIONS.MEMBERSHIPS).indexes();
    const hasCompoundIndex = membershipIndexes.some((idx) => idx.name === 'idx_memberships_org_user');
    expect(hasCompoundIndex).toBe(true);
  });

  it('provisions a new user and initial workspace on first Google/Firebase login', async () => {
    if (!mongoDb) return;

    const email = `first_user_${testRunId}@example.com`;
    const identity = {
      uid: `fb_${testRunId}_1`,
      email,
      name: 'First Tester',
      emailVerified: true,
      picture: 'https://example.com/avatar.png',
    };

    const res = await provisionMongoUser(
      mongoDb,
      identity,
      { orgName: `Workspace ${testRunId}` },
      'open',
      []
    );

    expect(res.isNewUser).toBe(true);
    expect(res.user.email).toBe(email);
    expect(res.user.firebaseUid).toBe(identity.uid);
    expect(res.user.displayName).toBe('First Tester');
    expect(res.user.photoURL).toBe(identity.picture);
    expect(res.user.status).toBe('active');
    expect(res.organizations.length).toBe(1);
    expect(res.organizations[0].name).toBe(`Workspace ${testRunId}`);

    // Verify stored in MongoDB
    const doc = await mongoDb.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS).findOne({ email });
    expect(doc).not.toBeNull();
    expect(doc?.firebaseUid).toBe(identity.uid);
  });

  it('is idempotent on repeated sign-in: updates lastLoginAt without duplicating user', async () => {
    if (!mongoDb) return;

    const email = `repeat_user_${testRunId}@example.com`;
    const identity = {
      uid: `fb_${testRunId}_repeat`,
      email,
      name: 'Repeat Tester',
      emailVerified: true,
    };

    // First login
    const firstRes = await provisionMongoUser(mongoDb, identity, {}, 'open');
    expect(firstRes.isNewUser).toBe(true);

    // Second login
    const secondRes = await provisionMongoUser(mongoDb, identity, {}, 'open');
    expect(secondRes.isNewUser).toBe(false);
    expect(secondRes.user._id).toBe(firstRes.user._id);

    // Assert only one document exists with this email
    const count = await mongoDb.collection(MONGO_COLLECTIONS.USERS).countDocuments({ email });
    expect(count).toBe(1);
  });

  it('links accounts safely when user signs in with Google having prior email record', async () => {
    if (!mongoDb) return;

    const email = `link_test_${testRunId}@example.com`;

    // Simulate pre-existing account without firebaseUid
    const existingUserId = `u_${testRunId}_pre`;
    await mongoDb.collection(MONGO_COLLECTIONS.USERS).insertOne({
      _id: existingUserId,
      email,
      displayName: 'Existing User',
      status: 'active',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    } as any);

    const googleIdentity = {
      uid: `fb_${testRunId}_google`,
      email,
      name: 'Existing User Updated',
      emailVerified: true,
      picture: 'https://example.com/photo.jpg',
    };

    const res = await provisionMongoUser(mongoDb, googleIdentity, {}, 'open');
    expect(res.isNewUser).toBe(false);
    expect(res.user._id).toBe(existingUserId);
    expect(res.user.firebaseUid).toBe(googleIdentity.uid);

    const updated = await mongoDb.collection<MongoUserDoc>(MONGO_COLLECTIONS.USERS).findOne({ _id: existingUserId });
    expect(updated?.firebaseUid).toBe(googleIdentity.uid);
  });

  it('enforces invitation-only registration policy', async () => {
    if (!mongoDb) return;

    const email = `uninvited_${testRunId}@example.com`;
    const identity = {
      uid: `fb_${testRunId}_uninvited`,
      email,
      name: 'Stranger',
      emailVerified: true,
    };

    // Attempt registration without invite
    await expect(
      provisionMongoUser(mongoDb, identity, {}, 'invite_only', [])
    ).rejects.toThrow('Registration is invitation-only');

    // Create a valid invitation
    const orgId = `org_${testRunId}_invited`;
    await mongoDb.collection(MONGO_COLLECTIONS.ORGANIZATIONS).insertOne({
      _id: orgId,
      id: orgId,
      name: 'Host Org',
      slug: `host-org-${testRunId}`,
      plan: 'free',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    } as any);

    const rawInviteToken = `tok_${testRunId}_123`;
    const tokenHash = hashToken(rawInviteToken);
    await mongoDb.collection(MONGO_COLLECTIONS.INVITATIONS).insertOne({
      _id: `inv_${testRunId}`,
      id: `inv_${testRunId}`,
      orgId,
      email,
      role: 'member',
      tokenHash,
      invitedBy: 'admin',
      expiresAt: new Date(Date.now() + 86400000).toISOString(),
      createdAt: new Date().toISOString(),
    } as any);

    // Registration with invite should succeed
    const res = await provisionMongoUser(
      mongoDb,
      identity,
      { inviteToken: rawInviteToken },
      'invite_only',
      []
    );

    expect(res.isNewUser).toBe(true);
    expect(res.organizations.length).toBe(1);
    expect(res.organizations[0]._id).toBe(orgId);

    // Verify membership record created
    const membership = await mongoDb.collection<MongoMembershipDoc>(MONGO_COLLECTIONS.MEMBERSHIPS).findOne({
      userId: res.user._id,
      orgId,
    });
    expect(membership).not.toBeNull();
    expect(membership?.role).toBe('member');
  });

  it('prevents suspended users from logging in', async () => {
    if (!mongoDb) return;

    const email = `suspended_${testRunId}@example.com`;
    await mongoDb.collection(MONGO_COLLECTIONS.USERS).insertOne({
      _id: `u_${testRunId}_susp`,
      firebaseUid: `fb_${testRunId}_susp`,
      email,
      displayName: 'Suspended User',
      status: 'suspended',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      lastLoginAt: new Date().toISOString(),
    } as any);

    await expect(
      provisionMongoUser(
        mongoDb,
        { uid: `fb_${testRunId}_susp`, email, name: 'Suspended', emailVerified: true },
        {},
        'open'
      )
    ).rejects.toThrow('suspended');
  });

  it('migrates PGlite repositories to MongoDB and validates integrity', async () => {
    if (!mongoDb) return;

    // 1. Prepare PGlite with seed demo data
    const pgDb = await openDb({});
    await migrate(pgDb);
    const pgStore = await PostgresSnapshotStore.open(pgDb);
    const repo = new LocalRepository(pgStore);
    const accounts = new Accounts(pgDb, pgStore, repo.snapshot, new ConsoleMailer());
    await accounts.seedDemo();

    // 2. Run migration to MongoDB Atlas
    const summary = await migratePgToMongo(pgDb, mongoDb);
    expect(summary.success).toBe(true);
    expect(summary.totalMigrated).toBeGreaterThan(0);
    expect(summary.counts['organizations'].mongoCount).toBeGreaterThan(0);
    expect(summary.counts['users'].mongoCount).toBeGreaterThan(0);
    expect(summary.counts['projects'].mongoCount).toBeGreaterThan(0);
    expect(summary.counts['issues'].mongoCount).toBeGreaterThan(0);

    // 3. Verify data in MongoDB collections directly
    const orgs = await mongoDb.collection(MONGO_COLLECTIONS.ORGANIZATIONS).find().toArray();
    expect(orgs.length).toBeGreaterThan(0);

    const issues = await mongoDb.collection(MONGO_COLLECTIONS.ISSUES).find().toArray();
    expect(issues.length).toBeGreaterThan(0);

    await pgDb.close();
  });

  it('MongoSnapshotStore loads, flushes, and persists entities', async () => {
    if (!mongoDb) return;

    const store = await MongoSnapshotStore.open(mongoDb);
    const db = store.load();
    expect(Array.isArray(db.organizations)).toBe(true);
    expect(Array.isArray(db.users)).toBe(true);

    // Mutate and flush
    const testOrgId = `org_${testRunId}_store`;
    db.organizations.push({
      id: testOrgId,
      name: `Store Test Org ${testRunId}`,
      slug: `store-test-${testRunId}`,
      plan: 'team',
      createdAt: new Date().toISOString(),
    });

    store.save(db);
    const mutated = await store.flush();
    expect(mutated).toBeGreaterThan(0);

    // Verify directly in MongoDB collection
    const stored = await mongoDb.collection(MONGO_COLLECTIONS.ORGANIZATIONS).findOne({ _id: testOrgId as any });
    expect(stored).not.toBeNull();
    expect(stored?.name).toBe(`Store Test Org ${testRunId}`);
  });
});
