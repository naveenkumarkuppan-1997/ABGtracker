import { describe, expect, it, beforeEach, afterEach, vi } from 'vitest';
import { LocalRepository } from '../src/data/localRepository';
import { Accounts } from './accounts';
import { buildApp } from './app';
import { openDb, migrate } from './db';
import { PostgresSnapshotStore } from './store';
import { ConsoleMailer } from './mailer';
import { initMongoClient, closeMongoClient, getMongoDb } from './mongodb';
import { Collection } from 'mongodb';

try {
  (process as unknown as { loadEnvFile?: (path?: string) => void }).loadEnvFile?.('.env');
} catch {}

describe('Controlled MongoDB Integration Endpoint (/api/test/mongodb-integration)', () => {
  const originalEnv = { ...process.env };

  beforeEach(() => {
    process.env = { ...originalEnv };
  });

  afterEach(async () => {
    process.env = { ...originalEnv };
    await closeMongoClient();
  });

  async function createTestApp(options?: {
    isProduction?: boolean;
    integrationEnabled?: boolean;
    seedDemo?: boolean;
  }) {
    if (options?.integrationEnabled !== false) {
      process.env.MONGODB_INTEGRATION_TEST_ENABLED = 'true';
    } else {
      delete process.env.MONGODB_INTEGRATION_TEST_ENABLED;
    }

    const db = await openDb({});
    await migrate(db);
    const store = await PostgresSnapshotStore.open(db);
    const repo = new LocalRepository(store);
    const accounts = new Accounts(db, store, repo.snapshot, new ConsoleMailer());

    if (options?.seedDemo) {
      await accounts.seedDemo();
    }

    const app = await buildApp({
      db,
      store,
      repo,
      accounts,
      config: {
        secureCookies: false,
        publicUrl: 'http://localhost:3000',
        logger: false,
        production: !!options?.isProduction,
      },
    });

    return { app, db, accounts };
  }

  it('is completely unregistered (returns 404) when MONGODB_INTEGRATION_TEST_ENABLED is not enabled', async () => {
    const { app, db } = await createTestApp({ integrationEnabled: false });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mongodb-integration',
      headers: {
        'x-requested-with': 'abg-tracker',
      },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
    await db.close();
  });

  it('is completely unregistered (returns 404) in production mode even if MONGODB_INTEGRATION_TEST_ENABLED is true', async () => {
    const { app, db } = await createTestApp({
      integrationEnabled: true,
      isProduction: true,
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mongodb-integration',
      headers: {
        'x-requested-with': 'abg-tracker',
      },
    });

    expect(res.statusCode).toBe(404);
    await app.close();
    await db.close();
  });

  it('rejects unauthenticated requests with HTTP 401', async () => {
    const { app, db } = await createTestApp({ integrationEnabled: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mongodb-integration',
      headers: {
        'x-requested-with': 'abg-tracker',
      },
    });

    expect(res.statusCode).toBe(401);
    await app.close();
    await db.close();
  });

  it('rejects invalid Bearer tokens with HTTP 401', async () => {
    const { app, db } = await createTestApp({ integrationEnabled: true });

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mongodb-integration',
      headers: {
        authorization: 'Bearer bad.token.here',
      },
    });

    expect(res.statusCode).toBe(401);
    const body = JSON.parse(res.payload);
    expect(body.error).toBe('Invalid or expired authorization token.');
    await app.close();
    await db.close();
  });

  it('returns HTTP 503 when user is authenticated but MongoDB client is uninitialized', async () => {
    const { app, db } = await createTestApp({ integrationEnabled: true, seedDemo: true });

    // Authenticate as demo user to get session
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'abg-tracker',
      },
      payload: {
        email: 'alex@acme.dev',
        password: 'demo-password-1',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'abg_session');
    expect(sessionCookie).toBeDefined();

    // Ensure MongoDB client is closed
    await closeMongoClient();

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mongodb-integration',
      headers: {
        cookie: `${sessionCookie!.name}=${sessionCookie!.value}`,
        'x-requested-with': 'abg-tracker',
      },
    });

    expect(res.statusCode).toBe(503);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.stages.clientReady).toBe(false);
    expect(body.error).toContain('MongoDB Atlas client is unavailable');

    await app.close();
    await db.close();
  });

  it('executes atomic write, read, delete, and confirmed cleanup when MongoDB is connected', async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) {
      console.warn('Skipping live Atlas test: MONGODB_URI not configured in test environment.');
      return;
    }

    // Connect real Atlas client
    await initMongoClient(uri);
    const mongoDb = getMongoDb('abg_tracker');
    if (!mongoDb) {
      console.warn('Skipping live Atlas test: cluster unreachable.');
      return;
    }

    const { app, db } = await createTestApp({ integrationEnabled: true, seedDemo: true });

    // Authenticate
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'abg-tracker',
      },
      payload: {
        email: 'alex@acme.dev',
        password: 'demo-password-1',
      },
    });

    expect(loginRes.statusCode).toBe(200);
    const sessionCookie = loginRes.cookies.find((c) => c.name === 'abg_session');

    // Call test integration endpoint
    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mongodb-integration',
      headers: {
        cookie: `${sessionCookie!.name}=${sessionCookie!.value}`,
        'x-requested-with': 'abg-tracker',
      },
    });

    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.payload);

    expect(body.success).toBe(true);
    expect(body.database).toBe('abg_tracker');
    expect(body.collection).toBe('_test_diagnostics');
    expect(body.testRunId).toMatch(/^phase4a_\d+_[0-9a-f]+$/);
    expect(body.stages.authenticated).toBe(true);
    expect(body.stages.userAuthorized).toBe(true);
    expect(body.stages.clientReady).toBe(true);
    expect(body.stages.writeAcknowledged).toBe(true);
    expect(body.stages.readVerified).toBe(true);
    expect(body.stages.deleted).toBe(true);
    expect(body.stages.cleanupConfirmed).toBe(true);

    // Verify in Atlas directly that no residual documents with this testRunId exist
    const residual = await mongoDb.collection('_test_diagnostics').findOne({ testRunId: body.testRunId });
    expect(residual).toBeNull();

    await app.close();
    await db.close();
  });

  it('guarantees cleanup runs in finally block even if verification step throws', async () => {
    const uri = process.env.MONGODB_URI;
    if (!uri) return;

    await initMongoClient(uri);
    const mongoDb = getMongoDb('abg_tracker');
    if (!mongoDb) return;

    const { app, db } = await createTestApp({ integrationEnabled: true, seedDemo: true });

    let capturedTestRunId: string | null = null;
    const originalFindOne = Collection.prototype.findOne;
    let callCount = 0;
    const spy = vi.spyOn(Collection.prototype, 'findOne').mockImplementation(async function (this: any, filter: any, ...args: any[]) {
      if (this.collectionName === '_test_diagnostics') {
        callCount++;
        if (filter?.testRunId) {
          capturedTestRunId = filter.testRunId;
        }
        if (callCount === 1) {
          throw new Error('Simulated verification read crash');
        }
      }
      return (originalFindOne as any).apply(this, [filter, ...args]);
    });

    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'abg-tracker',
      },
      payload: {
        email: 'alex@acme.dev',
        password: 'demo-password-1',
      },
    });

    const sessionCookie = loginRes.cookies.find((c) => c.name === 'abg_session');

    const res = await app.inject({
      method: 'POST',
      url: '/api/test/mongodb-integration',
      headers: {
        cookie: `${sessionCookie!.name}=${sessionCookie!.value}`,
        'x-requested-with': 'abg-tracker',
      },
    });

    expect(res.statusCode).toBe(500);
    const body = JSON.parse(res.payload);
    expect(body.success).toBe(false);
    expect(body.error).toContain('Simulated verification read crash');
    expect(body.stages.writeAcknowledged).toBe(true);
    expect(body.stages.deleted).toBe(true);
    expect(body.stages.cleanupConfirmed).toBe(true);

    spy.mockRestore();

    if (capturedTestRunId) {
      const residual = await mongoDb.collection('_test_diagnostics').findOne({ testRunId: capturedTestRunId });
      expect(residual).toBeNull();
    }
    await app.close();
    await db.close();
  });
});
