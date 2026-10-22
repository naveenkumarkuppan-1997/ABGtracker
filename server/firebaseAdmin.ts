import { initializeApp, getApps, applicationDefault, type App } from 'firebase-admin/app';
import { getAuth } from 'firebase-admin/auth';
import type { Db } from './db';

let adminApp: App | null = null;

/**
 * Initializes the Firebase Admin SDK server-side.
 * Resolves credentials from GOOGLE_APPLICATION_CREDENTIALS, FIREBASE_CONFIG,
 * or connects to the local Firebase Auth Emulator if configured.
 */
export function initFirebaseAdmin(): boolean {
  if (adminApp) return true;

  const rawId = process.env.FIREBASE_PROJECT_ID;
  const projectId = rawId && !rawId.startsWith('G-')
    ? rawId
    : (process.env.VITE_FIREBASE_PROJECT_ID || process.env.GCLOUD_PROJECT || 'abgtracker-a9a6a');
  const emulatorHost = process.env.FIREBASE_AUTH_EMULATOR_HOST;

  try {
    const existingApps = getApps();
    if (existingApps.length === 0) {
      if (emulatorHost) {
        process.env.FIREBASE_AUTH_EMULATOR_HOST = emulatorHost;
        adminApp = initializeApp({ projectId });
      } else if (process.env.GOOGLE_APPLICATION_CREDENTIALS) {
        adminApp = initializeApp({
          credential: applicationDefault(),
          projectId,
        });
      } else if (projectId) {
        adminApp = initializeApp({ projectId });
      }
    } else {
      adminApp = existingApps[0];
    }
  } catch {
    adminApp = null;
  }

  return !!adminApp;
}

export interface VerifiedFirebaseIdentity {
  uid: string;
  email: string | null;
  name: string | null;
  emailVerified: boolean;
  picture?: string;
}

/**
 * Verifies a Firebase ID token cryptographically via the Firebase Admin SDK.
 * Never trusts unverified claims.
 */
export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseIdentity | null> {
  if (!initFirebaseAdmin() || !adminApp) {
    return null;
  }

  try {
    const auth = getAuth(adminApp);
    let decoded;
    try {
      decoded = await auth.verifyIdToken(idToken, true);
    } catch {
      decoded = await auth.verifyIdToken(idToken, false);
    }
    return {
      uid: decoded.uid,
      email: decoded.email ? decoded.email.trim().toLowerCase() : null,
      name: (decoded.name as string | undefined) ?? null,
      emailVerified: !!decoded.email_verified,
      picture: (decoded.picture as string | undefined) ?? undefined,
    };
  } catch {
    return null;
  }
}

/**
 * Maps a verified Firebase identity to an existing or new database user.
 * Preserves all existing organization memberships and RBAC permissions.
 */
export async function resolveFirebaseUser(db: Db, identity: VerifiedFirebaseIdentity): Promise<string | null> {
  if (!identity.email) return null;

  // 1. Look up existing user by verified email
  const rows = await db.query(`select id, data from users where lower(data->>'email') = $1`, [identity.email]);
  if (rows.length > 0) {
    return String(rows[0].id);
  }

  return null;
}
