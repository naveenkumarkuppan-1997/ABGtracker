// Database access. PostgreSQL in production (DATABASE_URL), embedded PGlite for local
// development and tests. PGlite is a real Postgres engine compiled to WebAssembly, so the
// SQL below runs unchanged on both.

import { PGlite } from '@electric-sql/pglite';
import pg from 'pg';

export type Row = Record<string, unknown>;

export interface Db {
  query(sql: string, params?: unknown[]): Promise<Row[]>;
  /** Runs `fn` in a transaction; rolls back if it throws. */
  tx<T>(fn: (q: Db['query']) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'pglite' | 'postgres';
}

export async function openDb(opts: { databaseUrl?: string; dataDir?: string }): Promise<Db> {
  if (opts.databaseUrl) return openPostgres(opts.databaseUrl);
  return openPglite(opts.dataDir);
}

async function openPglite(dataDir?: string): Promise<Db> {
  // No dataDir = in memory (tests). A path = persisted on disk.
  const db = dataDir ? new PGlite(dataDir) : new PGlite();
  await db.waitReady;
  return {
    kind: 'pglite',
    async query(sql, params) {
      return (await db.query(sql, params as unknown[])).rows as Row[];
    },
    async tx(fn) {
      return db.transaction(async (t) => fn(async (sql, params) => (await t.query(sql, params as unknown[])).rows as Row[]));
    },
    close: () => db.close(),
  };
}

async function openPostgres(url: string): Promise<Db> {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  await pool.query('select 1'); // fail fast on a bad connection string
  return {
    kind: 'postgres',
    async query(sql, params) {
      return (await pool.query(sql, params as unknown[])).rows as Row[];
    },
    async tx(fn) {
      const client = await pool.connect();
      try {
        await client.query('begin');
        const out = await fn(async (sql, params) => (await client.query(sql, params as unknown[])).rows as Row[]);
        await client.query('commit');
        return out;
      } catch (e) {
        await client.query('rollback');
        throw e;
      } finally {
        client.release();
      }
    },
    close: () => pool.end(),
  };
}

/** The business collections stored as one row per record: id, org, and the record as JSONB. */
export const COLLECTIONS = [
  'organizations',
  'users',
  'memberships',
  'projects',
  'sprints',
  'issues',
  'comments',
  'activity',
  'notifications',
  'filters',
  'forms',
  'attachments',
  'rules',
  'runs',
] as const;
export type Collection = (typeof COLLECTIONS)[number];

export async function migrate(db: Db): Promise<void> {
  for (const c of COLLECTIONS) {
    await db.query(`create table if not exists ${c} (
      id text primary key,
      org_id text,
      data jsonb not null,
      updated_at timestamptz not null default now()
    )`);
    await db.query(`create index if not exists ${c}_org_idx on ${c} (org_id)`);
  }
  // One account per email, case-insensitively.
  await db.query(`create unique index if not exists users_email_uq on users (lower(data->>'email'))`);
  await db.query(`create unique index if not exists organizations_slug_uq on organizations ((data->>'slug'))`);

  await db.query(`create table if not exists credentials (
    user_id text primary key,
    password_hash text not null,
    updated_at timestamptz not null default now()
  )`);
  await db.query(`create table if not exists sessions (
    token_hash text primary key,
    user_id text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`);
  await db.query(`create index if not exists sessions_user_idx on sessions (user_id)`);
  await db.query(`create table if not exists invites (
    id text primary key,
    org_id text not null,
    email text not null,
    role text not null,
    token_hash text not null unique,
    invited_by text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null,
    accepted_at timestamptz
  )`);
  await db.query(`create index if not exists invites_org_idx on invites (org_id)`);
  await db.query(`create table if not exists password_resets (
    token_hash text primary key,
    user_id text not null,
    created_at timestamptz not null default now(),
    expires_at timestamptz not null
  )`);
  await db.query(`create index if not exists password_resets_user_idx on password_resets (user_id)`);
  // Which Inbox items have been dealt with by the emailer (emailed, or deliberately skipped). Kept apart
  // from the notification itself so marking one read never makes it eligible for email again.
  await db.query(`create table if not exists notification_emails (
    notification_id text primary key,
    outcome text not null,
    handled_at timestamptz not null default now()
  )`);
  await db.query(`create table if not exists two_factor (
    user_id text primary key,
    secret_enc text not null,
    enabled boolean not null default false,
    last_step bigint not null default 0,
    created_at timestamptz not null default now()
  )`);
  await db.query(`create table if not exists recovery_codes (
    user_id text not null,
    code_hash text not null,
    used_at timestamptz,
    primary key (user_id, code_hash)
  )`);
  await db.query(`alter table sessions add column if not exists user_agent text`);
  await db.query(`alter table sessions add column if not exists ip text`);
  await db.query(`create table if not exists api_tokens (
    id text primary key,
    user_id text not null,
    name text not null,
    scope text not null,
    token_hash text not null unique,
    hint text not null,
    created_at timestamptz not null default now(),
    last_used_at timestamptz
  )`);
  await db.query(`create index if not exists api_tokens_user_idx on api_tokens (user_id)`);
  await db.query(`create table if not exists webhooks (
    id text primary key,
    org_id text not null,
    url text not null,
    secret text not null,
    format text not null default 'json',
    events text not null,
    active boolean not null default true,
    created_by text not null,
    created_at timestamptz not null default now(),
    last_status text,
    last_at timestamptz
  )`);
  await db.query(`create index if not exists webhooks_org_idx on webhooks (org_id)`);
  await db.query(`create table if not exists mock_invoices (
    id text primary key,
    org_id text not null,
    plan text not null,
    amount_usd integer not null,
    created_at timestamptz not null default now()
  )`);
  await db.query(`create table if not exists audit_log (
    id text primary key,
    org_id text not null,
    actor_id text not null,
    action text not null,
    detail text not null default '',
    at timestamptz not null default now()
  )`);
  await db.query(`create index if not exists audit_log_org_idx on audit_log (org_id, at desc)`);
  await db.query(`create table if not exists app_secrets (
    name text primary key,
    value text not null
  )`);
  await db.query(`create table if not exists digest_state (
    user_id text primary key,
    last_sent timestamptz not null
  )`);
}
