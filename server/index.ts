import { LocalRepository } from '../src/data/localRepository';
import { Accounts, DEMO_PASSWORD } from './accounts';
import { buildApp } from './app';
import { purgeExpired } from './auth';
import { loadConfig } from './config';
import { migrate, openDb } from './db';
import { FileStore } from './files';
import { createMailer } from './mailer';
import { NotificationEmailer } from './notifier';
import { PostgresSnapshotStore } from './store';
import { MongoSnapshotStore } from './mongoStore';
import { initMongoClient, closeMongoClient } from './mongodb';
import { migratePgToMongo } from './migrateMongo';

try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.('.env');
} catch {
  // .env file is optional in containerized production with injected env vars
}

async function main() {
  const cfg = loadConfig(); // exits with a clear message if the settings are unsafe or incomplete

  // DATABASE_URL = real PostgreSQL. Without it, an embedded Postgres (PGlite) keeps data in DATA_DIR.
  const db = await openDb({ databaseUrl: cfg.databaseUrl, dataDir: cfg.databaseUrl ? undefined : cfg.dataDir });
  await migrate(db);
  await purgeExpired(db);

  let store: PostgresSnapshotStore | MongoSnapshotStore = await PostgresSnapshotStore.open(db);

  if (cfg.mongodbUri && cfg.useMongoStore) {
    try {
      const client = await initMongoClient(cfg.mongodbUri);
      if (client) {
        const mongoDb = client.db('abg_tracker');
        const summary = await migratePgToMongo(db, mongoDb);
        console.log(`MongoDB Atlas: synced ${summary.totalMigrated} entities across collections (${summary.success ? 'healthy' : 'with warnings'})`);
        store = await MongoSnapshotStore.open(mongoDb);
        console.log('MongoDB Atlas: active snapshot store engaged for all entity persistence');
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      const isWhitelist = msg.includes('alert number 80') || msg.includes('whitelist');
      console.log(`MongoDB Atlas: connection deferred (${isWhitelist ? 'current IP awaiting Atlas Network Access whitelist' : msg}) · primary PostgreSQL (${db.kind}) active`);
    }
  }

  const repo = new LocalRepository(store);
  const mailer = createMailer(cfg.smtpUrl, cfg.mailFrom, { verbose: !cfg.production });
  if (cfg.production && mailer.kind === 'console') {
    console.warn('WARNING: SMTP_URL is not set. Invitation and password-reset emails will NOT be delivered. Admins must share invite links by hand and password reset will not work.');
  }
  const mailErrors: unknown[] = [];
  const accounts = new Accounts(db, store, repo.snapshot, mailer, (e) => {
    mailErrors.push(e);
    console.error('Could not send email:', e instanceof Error ? e.message : e);
  });

  if (cfg.seedDemo && (await accounts.seedDemo())) {
    console.log(`Demo data loaded. Sign in as alex@acme.dev, priya@acme.dev, sam@acme.dev (Acme) or jordan@northwind.io, maya@northwind.io (Northwind) with password "${DEMO_PASSWORD}".`);
  }

  const files = new FileStore(cfg.filesDir);
  const app = await buildApp({
    db,
    store,
    repo,
    accounts,
    mailer,
    files,
    attachmentLimits: { maxFileBytes: cfg.maxFileMb * 1024 * 1024, maxFilesPerIssue: cfg.maxFilesPerIssue, orgQuotaBytes: cfg.orgStorageMb * 1024 * 1024 },
    blockedExtensions: cfg.blockedExtensions,
    publicMaxFileBytes: cfg.publicMaxFileMb * 1024 * 1024,
    config: {
      secureCookies: cfg.production,
      publicUrl: cfg.publicUrl,
      logger: true,
      trustProxy: cfg.trustProxy,
      allowSignup: cfg.allowSignup,
      registrationPolicy: cfg.registrationPolicy,
      superAdminEmails: cfg.superAdminEmails,
      staticDir: cfg.staticDir,
      devTools: !cfg.production,
      orgCache: { max: cfg.orgCacheMax, idleMs: cfg.orgCacheIdleMinutes * 60_000 },
      services: cfg.services,
    },
  });

  const sweep = setInterval(() => void purgeExpired(db).catch(() => undefined), 60 * 60_000);
  sweep.unref();

  // Files nothing refers to (left behind by a crash mid-upload) are removed after a day.
  const sweepFiles = async () => {
    const rows = await db.query(`select org_id, data->>'storageKey' as k from attachments`);
    const known = new Set(rows.map((r) => `${r.org_id}/${r.k}`));
    const n = await files.sweep((org, key) => known.has(`${org}/${key}`), 24 * 60 * 60_000);
    if (n) console.log(`Removed ${n} unused stored file${n === 1 ? '' : 's'}.`);
  };
  const sweepNow = () => void sweepFiles().catch((e) => console.error('File cleanup failed:', e instanceof Error ? e.message : e));
  setTimeout(sweepNow, 2 * 60_000).unref();
  setInterval(sweepNow, 6 * 60 * 60_000).unref();

  // Due-date reminders land in people's Inbox (and, per their settings, in their email).
  const remind = () => void app.remindDue().catch((e) => console.error('Due reminders failed:', e instanceof Error ? e.message : e));
  setTimeout(remind, 30_000).unref();
  setInterval(remind, 15 * 60_000).unref();

  // Inbox items by email, per each person's settings. Skipped when mail would only be logged in production.
  if (mailer.kind === 'smtp' || !cfg.production) {
    const emailer = new NotificationEmailer({ db, store, mailer, baseUrl: cfg.publicUrl, digestHour: cfg.digestHour, log: (l) => console.error(l) });
    const tick = setInterval(() => void emailer.runOnce().catch((e) => console.error('Notification emails failed:', e instanceof Error ? e.message : e)), 60_000);
    tick.unref();
  }

  let stopping = false;
  const shutdown = async (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`${signal} received: finishing in-flight requests…`);
    try {
      await app.close(); // stops accepting, waits for running requests
      await store.flush(); // nothing pending is left behind
      await db.close();
      await closeMongoClient();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));

  await app.listen({ port: cfg.port, host: cfg.host });
  console.log(
    `ABG Tracker on http://${cfg.host}:${cfg.port} · database: ${db.kind}${cfg.mongodbUri ? ' · mongodb: configured' : ''} · email: ${mailer.kind}${mailer.kind === 'console' ? ' (not delivered)' : ''} · sign-up: ${cfg.allowSignup ? 'open' : 'invite only'}${cfg.production ? ' · production' : ''}`
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
