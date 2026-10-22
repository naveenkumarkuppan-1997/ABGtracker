import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, connectAuthEmulator, type Auth } from 'firebase/auth';

/**
 * Environment-based Firebase configuration interface.
 * All public client configuration must be prefixed with VITE_.
 * Never place private keys, service account credentials, or database secrets here.
 */
export interface FirebaseConfig {
  apiKey?: string;
  authDomain?: string;
  projectId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  authEmulatorUrl?: string;
}

/**
 * Resolves Firebase configuration from environment variables.
 */
export function getFirebaseEnvConfig(): FirebaseConfig {
  const env = import.meta.env;
  return {
    apiKey: env.VITE_FIREBASE_API_KEY,
    authDomain: env.VITE_FIREBASE_AUTH_DOMAIN,
    projectId: env.VITE_FIREBASE_PROJECT_ID,
    storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET,
    messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appId: env.VITE_FIREBASE_APP_ID,
    authEmulatorUrl: env.VITE_FIREBASE_AUTH_EMULATOR_URL,
  };
}

/**
 * Validates whether the required Firebase client configuration parameters are present.
 */
export function validateFirebaseConfig(config: FirebaseConfig): {
  valid: boolean;
  missing: string[];
  usingEmulator: boolean;
} {
  const requiredFields: (keyof FirebaseConfig)[] = ['apiKey', 'authDomain', 'projectId', 'appId'];
  const missing = requiredFields.filter((key) => !config[key]);
  const usingEmulator = !!config.authEmulatorUrl;

  return {
    valid: missing.length === 0,
    missing,
    usingEmulator,
  };
}

let appInstance: FirebaseApp | null = null;
let authInstance: Auth | null = null;

/**
 * Initializes and returns the Firebase client application.
 * Returns null if the required environment variables are not yet configured.
 */
export function initFirebase(): { app: FirebaseApp | null; auth: Auth | null } {
  if (appInstance && authInstance) {
    return { app: appInstance, auth: authInstance };
  }

  const config = getFirebaseEnvConfig();
  const validation = validateFirebaseConfig(config);

  if (!validation.valid && !validation.usingEmulator) {
    return { app: null, auth: null };
  }

  // Fallback placeholder values for local emulator mode if fields are omitted
  const activeConfig = {
    apiKey: config.apiKey || 'emulator-api-key',
    authDomain: config.authDomain || 'localhost',
    projectId: config.projectId || 'demo-abg-tracker',
    storageBucket: config.storageBucket || 'demo-abg-tracker.appspot.com',
    messagingSenderId: config.messagingSenderId || '000000000000',
    appId: config.appId || '1:000000000000:web:emulatorapp',
  };

  if (!getApps().length) {
    appInstance = initializeApp(activeConfig);
  } else {
    appInstance = getApps()[0];
  }

  authInstance = getAuth(appInstance);

  if (config.authEmulatorUrl) {
    try {
      connectAuthEmulator(authInstance, config.authEmulatorUrl, { disableWarnings: true });
    } catch {
      // Connect once
    }
  }

  return { app: appInstance, auth: authInstance };
}

/**
 * Returns the active Firebase Auth instance, or null if unconfigured.
 */
export function getFirebaseAuth(): Auth | null {
  if (!authInstance) {
    initFirebase();
  }
  return authInstance;
}
