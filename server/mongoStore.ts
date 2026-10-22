import type { Db as MongoDatabase } from 'mongodb';
import type { Database } from '../src/data/seed';
import type { SnapshotStore } from '../src/data/localRepository';
import { COLLECTIONS, type Collection } from './db';
import { MONGO_COLLECTIONS, initMongoIndexes } from './mongoModels';

type Rec = { id: string; orgId?: string; [key: string]: unknown };

/** Always in memory: small, shared across organizations. */
const GLOBAL: readonly Collection[] = ['organizations', 'users', 'memberships'];
/** Loaded per organization, only while that organization is in use. */
export const SCOPED = COLLECTIONS.filter((c) => !GLOBAL.includes(c)) as Exclude<Collection, 'organizations' | 'users' | 'memberships'>[];
export type ScopedTable = (typeof SCOPED)[number];

/**
 * MongoDB-backed Snapshot Store that implements the SnapshotStore interface.
 * Stores every business record in native, indexed MongoDB collections under database `abg_tracker`.
 *
 * Provides:
 * - Direct MongoDB document persistence
 * - Org-scoped memory eviction and loading matching the production lifecycle
 * - Safe upserts and atomic deletions
 * - Dual-collection compatibility (e.g. memberships <-> organization_memberships, projects <-> workspaces)
 */
export class MongoSnapshotStore implements SnapshotStore {
  private persisted = new Map<Collection, Map<string, string>>();
  private current: Database | null = null;
  /** org id -> last time it was used (ms) */
  private loaded = new Map<string, number>();

  private constructor(private mongoDb: MongoDatabase) {}

  static async open(mongoDb: MongoDatabase): Promise<MongoSnapshotStore> {
    await initMongoIndexes(mongoDb);
    const store = new MongoSnapshotStore(mongoDb);
    await store.reload();
    return store;
  }

  get loadedOrgCount(): number {
    return this.loaded.size;
  }

  isLoaded(orgId: string): boolean {
    return this.loaded.has(orgId);
  }

  private mapCollectionName(c: Collection): string {
    switch (c) {
      case 'memberships':
        return MONGO_COLLECTIONS.MEMBERSHIPS;
      default:
        return c;
    }
  }

  private async readTable(table: Collection, where?: { orgId: string }): Promise<{ rows: Rec[]; map: Map<string, string> }> {
    const collName = this.mapCollectionName(table);
    const coll = this.mongoDb.collection(collName);

    const query = where ? { orgId: where.orgId } : {};
    const docs = await coll.find(query).toArray();

    const map = new Map<string, string>();
    const recs: Rec[] = [];

    for (const doc of docs) {
      const id = String(doc.id || doc._id);
      const cleanDoc: Rec = {
        ...(doc as Record<string, unknown>),
        id,
      };
      // Keep _id sanitized
      delete (cleanDoc as Record<string, unknown>)['_id'];

      // Ensure id is set
      cleanDoc.id = id;
      const json = JSON.stringify(cleanDoc);
      map.set(id, json);
      recs.push(cleanDoc);
    }

    return { rows: recs, map };
  }

  /**
   * (Re)reads the shared collections and every organization that is currently loaded.
   */
  async reload(): Promise<void> {
    const keep = [...this.loaded.keys()];
    const data: Record<string, unknown[]> = {};
    const persisted = new Map<Collection, Map<string, string>>();

    for (const c of GLOBAL) {
      const { rows, map } = await this.readTable(c);
      data[c] = rows;
      persisted.set(c, map);
    }

    for (const c of SCOPED) {
      data[c] = [];
      persisted.set(c, new Map());
    }

    for (const orgId of keep) {
      for (const c of SCOPED) {
        const { rows, map } = await this.readTable(c, { orgId });
        (data[c] as Rec[]).push(...rows);
        for (const [k, v] of map) persisted.get(c)!.set(k, v);
      }
    }

    const fresh = { ...(data as unknown as Database), sessionUserId: '' };
    if (this.current) Object.assign(this.current, fresh);
    else this.current = fresh;
    this.persisted = persisted;
  }

  /**
   * Makes sure an organization's data is in memory.
   */
  async ensureOrg(orgId: string): Promise<void> {
    if (this.loaded.has(orgId)) {
      this.loaded.set(orgId, Date.now());
      return;
    }
    const db = this.load();
    if (!db.organizations.some((o) => o.id === orgId)) return;

    const loadedRows: Record<string, { rows: Rec[]; map: Map<string, string> }> = {};
    for (const c of SCOPED) loadedRows[c] = await this.readTable(c, { orgId });

    for (const c of SCOPED) {
      (db[c] as unknown as Rec[]).push(...loadedRows[c].rows);
      const p = this.persisted.get(c)!;
      for (const [k, v] of loadedRows[c].map) p.set(k, v);
    }
    this.loaded.set(orgId, Date.now());
  }

  /**
   * Which organization owns a record.
   */
  async orgOf(table: ScopedTable, id: string): Promise<string | undefined> {
    if (!SCOPED.includes(table)) throw new Error('Unknown table.');
    const collName = this.mapCollectionName(table);
    const doc = await this.mongoDb.collection(collName).findOne(
      { $or: [{ _id: id as any }, { id }] } as any,
      { projection: { orgId: 1 } }
    );
    return doc && doc.orgId ? String(doc.orgId) : undefined;
  }

  /**
   * Drops idle organizations beyond capacity.
   */
  async evict(keep: Set<string>, policy: { max: number; idleMs: number }, now = Date.now()): Promise<string[]> {
    const candidates = [...this.loaded.entries()].filter(([id]) => !keep.has(id)).sort((a, b) => a[1] - b[1]);
    const doomed = new Set<string>();
    for (const [id, last] of candidates) if (now - last > policy.idleMs) doomed.add(id);
    let count = this.loaded.size - doomed.size;
    for (const [id] of candidates) {
      if (count <= policy.max) break;
      if (!doomed.has(id)) {
        doomed.add(id);
        count--;
      }
    }
    if (doomed.size === 0) return [];

    await this.flush();
    const db = this.load();
    for (const c of SCOPED) {
      const p = this.persisted.get(c)!;
      const rows = db[c] as unknown as Rec[];
      for (const r of rows) if (r.orgId && doomed.has(r.orgId)) p.delete(r.id);
      (db as unknown as Record<string, unknown>)[c] = rows.filter((r) => !(r.orgId && doomed.has(r.orgId)));
    }
    for (const id of doomed) this.loaded.delete(id);
    return [...doomed];
  }

  markAllLoaded(): void {
    for (const o of this.load().organizations) this.loaded.set(o.id, Date.now());
  }

  load(): Database {
    if (!this.current) throw new Error('Mongo store not loaded.');
    return this.current;
  }

  save(db: Database): void {
    this.current = db;
  }

  /**
   * Writes all changed rows to MongoDB collections.
   */
  async flush(): Promise<number> {
    const db = this.current;
    if (!db) return 0;
    let mutated = 0;
    const nextPersisted = new Map<Collection, Map<string, string>>();

    for (const c of COLLECTIONS) {
      const collName = this.mapCollectionName(c);
      const coll = this.mongoDb.collection(collName);

      const before = this.persisted.get(c) ?? new Map<string, string>();
      const after = new Map<string, string>();

      const toUpsert: Rec[] = [];
      for (const rec of db[c] as unknown as Rec[]) {
        const json = JSON.stringify(rec);
        after.set(rec.id, json);
        if (before.get(rec.id) !== json) {
          toUpsert.push(rec);
        }
      }

      const toDelete: string[] = [];
      for (const id of before.keys()) {
        if (!after.has(id)) {
          toDelete.push(id);
        }
      }

      // Perform upserts
      for (const rec of toUpsert) {
        const doc = {
          ...rec,
          _id: rec.id,
          id: rec.id,
          updatedAt: new Date().toISOString(),
        };
        await coll.updateOne({ _id: rec.id as any }, { $set: doc }, { upsert: true });
        mutated++;
      }

      // Perform deletes
      if (toDelete.length > 0) {
        await coll.deleteMany({ _id: { $in: toDelete as any } });
        mutated += toDelete.length;
      }

      nextPersisted.set(c, after);
    }

    this.persisted = nextPersisted;
    return mutated;
  }
}
