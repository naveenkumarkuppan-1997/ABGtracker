import { describe, expect, it } from 'vitest';
import { LocalRepository } from '../src/data/localRepository';
import { Accounts } from './accounts';
import { buildApp } from './app';
import { openDb, migrate } from './db';
import { PostgresSnapshotStore } from './store';
import { ConsoleMailer } from './mailer';
import { verifyFirebaseIdToken, resolveFirebaseUser } from './firebaseAdmin';

describe('Backend Firebase Auth Compatibility Layer', () => {
  it('gracefully handles unconfigured Firebase Admin SDK', async () => {
    // When no service account or emulator is present, verification returns null
    const verified = await verifyFirebaseIdToken('invalid-or-unconfigured-token');
    expect(verified).toBeNull();
  });

  it('rejects /api/auth/firebase-session with missing token', async () => {
    const db = await openDb({});
    await migrate(db);
    const store = await PostgresSnapshotStore.open(db);
    const repo = new LocalRepository(store);
    const accounts = new Accounts(db, store, repo.snapshot, new ConsoleMailer());

    const app = await buildApp({
      db,
      store,
      repo,
      accounts,
      config: {
        secureCookies: false,
        publicUrl: 'http://localhost:3000',
        logger: false,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/firebase-session',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'abg-tracker',
      },
      payload: {},
    });

    expect(res.statusCode).toBe(400);
    const json = JSON.parse(res.payload);
    expect(json.error).toBe('Missing idToken.');
    await app.close();
    await db.close();
  });

  it('rejects /api/auth/firebase-session with invalid token', async () => {
    const db = await openDb({});
    await migrate(db);
    const store = await PostgresSnapshotStore.open(db);
    const repo = new LocalRepository(store);
    const accounts = new Accounts(db, store, repo.snapshot, new ConsoleMailer());

    const app = await buildApp({
      db,
      store,
      repo,
      accounts,
      config: {
        secureCookies: false,
        publicUrl: 'http://localhost:3000',
        logger: false,
      },
    });

    const res = await app.inject({
      method: 'POST',
      url: '/api/auth/firebase-session',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'abg-tracker',
      },
      payload: {
        idToken: 'tampered-or-expired-jwt-token',
      },
    });

    expect(res.statusCode).toBe(401);
    const json = JSON.parse(res.payload);
    expect(json.error).toBe('Invalid or expired Firebase ID token.');
    await app.close();
    await db.close();
  });

  it('resolves existing database user from verified Firebase identity', async () => {
    const db = await openDb({});
    await migrate(db);
    const store = await PostgresSnapshotStore.open(db);
    const repo = new LocalRepository(store);
    const accounts = new Accounts(db, store, repo.snapshot, new ConsoleMailer());
    await accounts.seedDemo();

    const identity = {
      uid: 'firebase_test_uid_123',
      email: 'priya@acme.dev', // demo user in Acme Corp
      name: 'Priya Sharma',
      emailVerified: true,
    };

    const resolvedUserId = await resolveFirebaseUser(db, identity);
    expect(resolvedUserId).toBeTruthy();
    expect(typeof resolvedUserId).toBe('string');

    // Non-existent email returns null
    const unknown = await resolveFirebaseUser(db, {
      uid: 'unknown_uid',
      email: 'stranger@nowhere.dev',
      name: 'Stranger',
      emailVerified: true,
    });
    expect(unknown).toBeNull();

    await db.close();
  });

  it('rejects protected API routes when unauthenticated or with invalid bearer token', async () => {
    const db = await openDb({});
    await migrate(db);
    const store = await PostgresSnapshotStore.open(db);
    const repo = new LocalRepository(store);
    const accounts = new Accounts(db, store, repo.snapshot, new ConsoleMailer());

    const app = await buildApp({
      db,
      store,
      repo,
      accounts,
      config: {
        secureCookies: false,
        publicUrl: 'http://localhost:3000',
        logger: false,
      },
    });

    // 1. Without credentials
    const unauth = await app.inject({
      method: 'GET',
      url: '/api/me/sessions',
    });
    expect(unauth.statusCode).toBe(401);

    // 2. With invalid Bearer token
    const badBearer = await app.inject({
      method: 'GET',
      url: '/api/me/sessions',
      headers: {
        authorization: 'Bearer bad.jwt.token',
      },
    });
    expect(badBearer.statusCode).toBe(401);
    const badJson = JSON.parse(badBearer.payload);
    expect(badJson.error).toBe('Invalid or expired authorization token.');

    // 3. Authenticated session reaches protected endpoint
    await accounts.seedDemo();
    const loginRes = await app.inject({
      method: 'POST',
      url: '/api/auth/login',
      headers: {
        'content-type': 'application/json',
        'x-requested-with': 'abg-tracker',
      },
      payload: {
        email: 'priya@acme.dev',
        password: 'demo-password-1',
      },
    });
    expect(loginRes.statusCode).toBe(200);
    const cookies = loginRes.cookies;
    const sessionCookie = cookies.find((c) => c.name === 'abg_session');
    expect(sessionCookie).toBeDefined();

    // Authenticated request succeeds
    const authedRes = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: {
        abg_session: sessionCookie!.value,
      },
    });
    expect(authedRes.statusCode).toBe(200);
    const authedJson = JSON.parse(authedRes.payload);
    expect(authedJson.user.email).toBe('priya@acme.dev');

    // 4. Unauthorized resource check: user cannot access an organization they do not belong to
    const unauthorizedOrg = await app.inject({
      method: 'GET',
      url: '/api/orgs/unauthorized_foreign_org_id/webhooks',
      cookies: {
        abg_session: sessionCookie!.value,
      },
    });
    expect(unauthorizedOrg.statusCode).toBe(403);

    // 5. Logout invalidates session
    const logoutRes = await app.inject({
      method: 'POST',
      url: '/api/auth/logout',
      headers: {
        'x-requested-with': 'abg-tracker',
      },
      cookies: {
        abg_session: sessionCookie!.value,
      },
    });
    expect(logoutRes.statusCode).toBe(200);

    // Subsequent call after logout receives 401
    const postLogout = await app.inject({
      method: 'GET',
      url: '/api/auth/me',
      cookies: {
        abg_session: sessionCookie!.value,
      },
    });
    expect(postLogout.statusCode).toBe(401);

    await app.close();
    await db.close();
  });
});
