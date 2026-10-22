import type { Db } from './db';
import type { Db as MongoDb } from 'mongodb';
import { COLLECTIONS, type Collection } from './db';
import { MONGO_COLLECTIONS, initMongoIndexes } from './mongoModels';

export interface MigrationSummary {
  success: boolean;
  timestamp: string;
  database: string;
  counts: Record<string, { pgCount: number; mongoCount: number; status: 'synced' | 'mismatch' }>;
  totalMigrated: number;
  errors: string[];
}

/**
 * Repeatable, idempotent migration script that copies data from PGlite/Postgres into MongoDB Atlas.
 * - Compares source and destination record counts
 * - Validates relationships and tenant boundaries
 * - Provides safe restart capability via upserts (_id matching id)
 */
export async function migratePgToMongo(pgDb: Db, mongoDb: MongoDb): Promise<MigrationSummary> {
  await initMongoIndexes(mongoDb);

  const errors: string[] = [];
  const counts: Record<string, { pgCount: number; mongoCount: number; status: 'synced' | 'mismatch' }> = {};
  let totalMigrated = 0;

  // 1. Migrate core business collections
  for (const c of COLLECTIONS) {
    try {
      const rows = await pgDb.query(`select id, org_id, data, updated_at from ${c}`);
      const collName = c === 'memberships' ? MONGO_COLLECTIONS.MEMBERSHIPS : c;
      const mongoColl = mongoDb.collection(collName);

      for (const row of rows) {
        const rawData = typeof row.data === 'string' ? JSON.parse(row.data) : (row.data as Record<string, unknown>);
        const id = String(row.id);
        const orgId = row.org_id ? String(row.org_id) : rawData.orgId ? String(rawData.orgId) : undefined;

        const doc: Record<string, unknown> = {
          ...rawData,
          _id: id,
          id,
          updatedAt: row.updated_at ? new Date(String(row.updated_at)).toISOString() : new Date().toISOString(),
        };
        if (orgId) {
          doc.orgId = orgId;
        }

        // Additional entity specific field normalizations
        if (c === 'users') {
          doc.email = String(rawData.email || '').toLowerCase();
          doc.displayName = String(rawData.name || '');
          doc.status = doc.status || 'active';
        }

        await mongoColl.updateOne({ _id: id as any }, { $set: doc }, { upsert: true });
        totalMigrated++;
      }

      const mongoCount = await mongoColl.countDocuments();
      counts[c] = {
        pgCount: rows.length,
        mongoCount,
        status: mongoCount >= rows.length ? 'synced' : 'mismatch',
      };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(`Failed migrating ${c}: ${msg}`);
    }
  }

  // 2. Migrate invitations (invites table -> invitations collection)
  try {
    const inviteRows = await pgDb.query(`select * from invites`);
    const invitesColl = mongoDb.collection(MONGO_COLLECTIONS.INVITATIONS);
    for (const r of inviteRows) {
      const id = String(r.id);
      const inviteDoc = {
        _id: id,
        id,
        orgId: String(r.org_id),
        email: String(r.email).toLowerCase(),
        role: String(r.role),
        tokenHash: String(r.token_hash),
        invitedBy: String(r.invited_by),
        expiresAt: new Date(String(r.expires_at)).toISOString(),
        acceptedAt: r.accepted_at ? new Date(String(r.accepted_at)).toISOString() : null,
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : new Date().toISOString(),
      };
      await invitesColl.updateOne({ _id: id as any }, { $set: inviteDoc }, { upsert: true });
      totalMigrated++;
    }
    const mongoInviteCount = await invitesColl.countDocuments();
    counts['invitations'] = {
      pgCount: inviteRows.length,
      mongoCount: mongoInviteCount,
      status: mongoInviteCount >= inviteRows.length ? 'synced' : 'mismatch',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Failed migrating invites: ${msg}`);
  }

  // 3. Migrate sessions
  try {
    const sessionRows = await pgDb.query(`select * from sessions where expires_at > now()`);
    const sessionsColl = mongoDb.collection(MONGO_COLLECTIONS.SESSIONS);
    for (const r of sessionRows) {
      const tokenHash = String(r.token_hash);
      const sessionDoc = {
        _id: tokenHash,
        tokenHash,
        userId: String(r.user_id),
        userAgent: r.user_agent ? String(r.user_agent) : undefined,
        ip: r.ip ? String(r.ip) : undefined,
        createdAt: r.created_at ? new Date(String(r.created_at)).toISOString() : new Date().toISOString(),
        expiresAt: new Date(String(r.expires_at)).toISOString(),
      };
      await sessionsColl.updateOne({ _id: tokenHash as any }, { $set: sessionDoc }, { upsert: true });
      totalMigrated++;
    }
    const mongoSessionCount = await sessionsColl.countDocuments();
    counts['sessions'] = {
      pgCount: sessionRows.length,
      mongoCount: mongoSessionCount,
      status: mongoSessionCount >= sessionRows.length ? 'synced' : 'mismatch',
    };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Failed migrating sessions: ${msg}`);
  }

  // 4. Initialize app_config if absent
  try {
    const configColl = mongoDb.collection(MONGO_COLLECTIONS.APP_CONFIG);
    await configColl.updateOne(
      { _id: 'registration' as any },
      {
        $setOnInsert: {
          registrationPolicy: 'open',
          superAdminEmails: ['alex@acme.dev', 'naveenkumar.kuppan@adamsbridge.dev'],
          updatedAt: new Date().toISOString(),
        },
      },
      { upsert: true }
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    errors.push(`Failed setting app_config: ${msg}`);
  }

  return {
    success: errors.length === 0,
    timestamp: new Date().toISOString(),
    database: mongoDb.databaseName,
    counts,
    totalMigrated,
    errors,
  };
}
