import type { Database } from '../src/data/seed';
import type { SnapshotStore } from '../src/data/localRepository';
import { COLLECTIONS, type Collection, type Db } from './db';

type Rec = { id: string; orgId?: string };

/** Always in memory: small, shared across organizations. */
const GLOBAL: readonly Collection[] = ['organizations', 'users', 'memberships'];
/** Loaded per organization, only while that organization is in use. */
export const SCOPED = COLLECTIONS.filter((c) => !GLOBAL.includes(c)) as Exclude<Collection, 'organizations' | 'users' | 'memberships'>[];
export type ScopedTable = (typeof SCOPED)[number];

const parse = (v: unknown): Rec => (typeof v === 'string' ? JSON.parse(v) : v) as Rec;

/**
 * Hands the repository an in-memory data set and writes every change through to PostgreSQL.
 *
 * Only the small shared collections (organizations, users, memberships) are always in memory.
 * Everything inside an organization (projects, issues, comments…) is loaded the first time that
 * organization is used and dropped again when it has been idle, so memory follows the number of
 * *active* organizations, not the total. Writes go out as one transaction per request, and only
 * rows that really changed are written.
 */
export class PostgresSnapshotStore implements SnapshotStore {
  private persisted = new Map<Collection, Map<string, string>>();
  private current: Database | null = null;
  /** org id -> last time it was used (ms) */
  private loaded = new Map<string, number>();

  private constructor(private db: Db) {}

  static async open(db: Db): Promise<PostgresSnapshotStore> {
    const store = new PostgresSnapshotStore(db);
    await store.reload();
    return store;
  }

  get loadedOrgCount(): number {
    return this.loaded.size;
  }

  isLoaded(orgId: string): boolean {
    return this.loaded.has(orgId);
  }

  private async readTable(table: Collection, where?: { orgId: string }): Promise<{ rows: Rec[]; map: Map<string, string> }> {
    const rows = where ? await this.db.query(`select id, data from ${table} where org_id = $1`, [where.orgId]) : await this.db.query(`select id, data from ${table}`);
    const map = new Map<string, string>();
    const recs = rows.map((r) => {
      const rec = parse(r.data);
      map.set(String(r.id), JSON.stringify(rec));
      return rec;
    });
    return { rows: recs, map };
  }

  /** (Re)reads the shared collections and every organization that is currently loaded. Discards unsaved changes. */
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
    // Replace contents in place so a repository holding this object sees the reloaded data.
    if (this.current) Object.assign(this.current, fresh);
    else this.current = fresh;
    this.persisted = persisted;
  }

  /** Makes sure an organization's data is in memory. Unknown organizations are ignored. */
  async ensureOrg(orgId: string): Promise<void> {
    if (this.loaded.has(orgId)) {
      this.loaded.set(orgId, Date.now());
      return;
    }
    const db = this.load();
    if (!db.organizations.some((o) => o.id === orgId)) return;
    const loadedRows: Record<string, { rows: Rec[]; map: Map<string, string> }> = {};
    for (const c of SCOPED) loadedRows[c] = await this.readTable(c, { orgId }); // read everything first, then swap in
    for (const c of SCOPED) {
      (db[c] as unknown as Rec[]).push(...loadedRows[c].rows);
      const p = this.persisted.get(c)!;
      for (const [k, v] of loadedRows[c].map) p.set(k, v);
    }
    this.loaded.set(orgId, Date.now());
  }

  /** Which organization owns a record? Used to load the right organization before a call. */
  async orgOf(table: ScopedTable, id: string): Promise<string | undefined> {
    if (!SCOPED.includes(table)) throw new Error('Unknown table.'); // never built from user input, but guard anyway
    const rows = await this.db.query(`select org_id from ${table} where id = $1`, [id]);
    return rows.length && rows[0].org_id ? String(rows[0].org_id) : undefined;
  }

  /**
   * Drops organizations that are idle or beyond the cap (least recently used first), never one
   * in `keep`. Saves first, so nothing is lost.
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

  /** After demo data was inserted straight into memory: every organization present counts as loaded. */
  markAllLoaded(): void {
    for (const o of this.load().organizations) this.loaded.set(o.id, Date.now());
  }

  /** The repository's synchronous load hook: returns the in-memory data. */
  load(): Database {
    if (!this.current) throw new Error('Store not loaded.');
    return this.current;
  }

  /** The repository calls this after each change; persistence happens in `flush()`. */
  save(db: Database): void {
    this.current = db;
  }

  /** Writes changed rows. Call (and await) after each request that may have mutated data. */
  async flush(): Promise<number> {
    const db = this.current;
    if (!db) return 0;
    const ops: { sql: string; params: unknown[] }[] = [];
    const nextPersisted = new Map<Collection, Map<string, string>>();

    for (const c of COLLECTIONS) {
      const before = this.persisted.get(c) ?? new Map<string, string>();
      const after = new Map<string, string>();
      for (const rec of db[c] as unknown as Rec[]) {
        const json = JSON.stringify(rec);
        after.set(rec.id, json);
        if (before.get(rec.id) !== json) {
          ops.push({
            sql: `insert into ${c} (id, org_id, data, updated_at) values ($1, $2, $3::jsonb, now())
                  on conflict (id) do update set org_id = excluded.org_id, data = excluded.data, updated_at = now()`,
            params: [rec.id, rec.orgId ?? null, json],
          });
        }
      }
      // `before` only ever holds rows of loaded organizations, so a missing row really was deleted.
      for (const id of before.keys()) {
        if (!after.has(id)) ops.push({ sql: `delete from ${c} where id = $1`, params: [id] });
      }
      nextPersisted.set(c, after);
    }
    if (ops.length === 0) return 0;

    await this.db.tx(async (q) => {
      for (const op of ops) await q(op.sql, op.params);
    });
    this.persisted = nextPersisted; // only after the transaction committed
    return ops.length;
  }
}
