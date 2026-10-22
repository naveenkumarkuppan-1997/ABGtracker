import {
  createUserWithEmailAndPassword,
  signInWithEmailAndPassword,
  signOut as firebaseSignOut,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithPopup,
  GoogleAuthProvider,
  OAuthProvider,
  updateProfile,
  onAuthStateChanged,
  type User as FirebaseUser,
  type Unsubscribe,
} from 'firebase/auth';
import { getFirebaseAuth, validateFirebaseConfig, getFirebaseEnvConfig } from './config';

export interface AuthStatus {
  configured: boolean;
  missingFields: string[];
  usingEmulator: boolean;
  googleEnabled: boolean;
  microsoftEnabled: boolean;
}

export interface MicrosoftConfigInfo {
  providerId: 'microsoft.com';
  redirectUriTemplate: string;
  requiredScopes: string[];
  docUrl: string;
}

/**
 * Friendly error message resolver mapping Firebase Auth error codes to user-facing strings.
 */
export function getFriendlyAuthErrorMessage(err: unknown): string {
  if (!err || typeof err !== 'object') {
    return 'An unknown authentication error occurred.';
  }

  const code = 'code' in err ? String(err.code) : '';
  const message = 'message' in err ? String(err.message) : '';

  switch (code) {
    case 'auth/invalid-email':
      return 'The email address is not valid.';
    case 'auth/user-disabled':
      return 'This account has been deactivated. Contact an administrator.';
    case 'auth/user-not-found':
    case 'auth/wrong-password':
    case 'auth/invalid-credential':
      return 'Incorrect email or password.';
    case 'auth/email-already-in-use':
      return 'An account already exists with this email address. Please sign in instead.';
    case 'auth/weak-password':
      return 'The password is too weak. Please use at least 10 characters.';
    case 'auth/popup-closed-by-user':
      return 'The sign-in window was closed before completing. Please try again.';
    case 'auth/popup-blocked':
      return 'The sign-in popup was blocked by your browser. Please allow popups for this site.';
    case 'auth/cancelled-popup-request':
      return 'Multiple sign-in attempts were made. Please try again.';
    case 'auth/account-exists-with-different-credential':
      return 'An account already exists with this email under a different sign-in method. Sign in with your original provider.';
    case 'auth/requires-recent-login':
      return 'This action requires re-authentication. Please sign out and sign back in.';
    case 'auth/network-request-failed':
      return 'Network error connecting to the authentication service. Check your connection.';
    case 'auth/too-many-requests':
      return 'Access to this account has been temporarily disabled due to many failed sign-in attempts. Try again later.';
    case 'auth/unauthorized-domain': {
      const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'current domain';
      return `This domain (${currentHost}) is not authorized for Firebase Authentication. Please authorize "${currentHost}" in Firebase Console (Authentication > Settings > Authorized domains).`;
    }
    case 'auth/operation-not-allowed':
      return 'The requested sign-in provider is not enabled in Firebase Console (Authentication > Sign-in method).';
    case 'auth/unauthorized-continue-uri':
      return 'The redirect URL domain is not authorized in Firebase Console.';
    case 'auth/invalid-api-key':
      return 'Firebase API key is invalid or unconfigured. Verify VITE_FIREBASE_API_KEY.';
    case 'auth/configuration-not-found':
      return 'Authentication provider is not yet enabled in the Firebase Console.';
    default:
      if (code === 'auth/unauthorized-domain' || message.includes('auth/unauthorized-domain') || message.includes('unauthorized-domain')) {
        const currentHost = typeof window !== 'undefined' ? window.location.hostname : 'current domain';
        return `This domain (${currentHost}) is not authorized for Firebase Authentication. Please authorize "${currentHost}" in Firebase Console (Authentication > Settings > Authorized domains).`;
      }
      if (message.includes('API key not valid')) {
        return 'Firebase API key is invalid or unconfigured. Check your environment variables.';
      }
      return message || 'Authentication failed. Please check your credentials.';
  }
}

/**
 * Returns current Firebase Authentication configuration and readiness status.
 */
export function getAuthStatus(): AuthStatus {
  const config = getFirebaseEnvConfig();
  const validation = validateFirebaseConfig(config);

  return {
    configured: validation.valid || validation.usingEmulator,
    missingFields: validation.missing,
    usingEmulator: validation.usingEmulator,
    googleEnabled: validation.valid || validation.usingEmulator,
    microsoftEnabled: validation.valid || validation.usingEmulator,
  };
}

/**
 * Returns the active Firebase User, or null if unauthenticated.
 */
export function getCurrentFirebaseUser(): FirebaseUser | null {
  const auth = getFirebaseAuth();
  return auth ? auth.currentUser : null;
}

/**
 * Retrieves the current user's Firebase ID token for authenticating backend requests.
 */
export async function getFirebaseIdToken(forceRefresh = false): Promise<string | null> {
  const user = getCurrentFirebaseUser();
  if (!user) return null;
  try {
    return await user.getIdToken(forceRefresh);
  } catch {
    return null;
  }
}

/**
 * Subscribes to Firebase Authentication state changes.
 */
export function subscribeToAuthState(callback: (user: FirebaseUser | null) => void): Unsubscribe {
  const auth = getFirebaseAuth();
  if (!auth) {
    callback(null);
    return () => undefined;
  }
  return onAuthStateChanged(auth, callback);
}

/**
 * Registers a new user with email and password, setting display name and sending verification email.
 */
export async function registerWithEmail(input: {
  name: string;
  email: string;
  password: string;
}): Promise<{ user: FirebaseUser; emailSent: boolean }> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured. Set VITE_FIREBASE_* environment variables.');
  }

  const credential = await createUserWithEmailAndPassword(auth, input.email.trim().toLowerCase(), input.password);
  const user = credential.user;

  if (input.name.trim()) {
    await updateProfile(user, { displayName: input.name.trim() }).catch(() => undefined);
  }

  let emailSent = false;
  try {
    await sendEmailVerification(user);
    emailSent = true;
  } catch {
    // Non-fatal if verification rate-limited or disabled
  }

  return { user, emailSent };
}

/**
 * Signs in an existing user using email and password.
 */
export async function signInWithEmail(email: string, password: string): Promise<FirebaseUser> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured. Set VITE_FIREBASE_* environment variables.');
  }

  const credential = await signInWithEmailAndPassword(auth, email.trim().toLowerCase(), password);
  return credential.user;
}

/**
 * Initiates Google Sign-In using Firebase Authentication popup flow.
 */
export async function signInWithGoogle(): Promise<FirebaseUser> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured. Set VITE_FIREBASE_* environment variables.');
  }

  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

/**
 * Initiates Microsoft Sign-In using Firebase Authentication OAuth provider.
 */
export async function signInWithMicrosoft(): Promise<FirebaseUser> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured. Set VITE_FIREBASE_* environment variables.');
  }

  const provider = new OAuthProvider('microsoft.com');
  provider.setCustomParameters({ prompt: 'select_account' });
  provider.addScope('openid');
  provider.addScope('email');
  provider.addScope('profile');

  const credential = await signInWithPopup(auth, provider);
  return credential.user;
}

/**
 * Sends a password reset email to the specified address.
 */
export async function sendPasswordReset(email: string): Promise<void> {
  const auth = getFirebaseAuth();
  if (!auth) {
    throw new Error('Firebase Authentication is not configured. Set VITE_FIREBASE_* environment variables.');
  }

  await sendPasswordResetEmail(auth, email.trim().toLowerCase());
}

/**
 * Signs out the current Firebase user.
 */
export async function signOutFirebase(): Promise<void> {
  const auth = getFirebaseAuth();
  if (auth) {
    await firebaseSignOut(auth);
  }
}

/**
 * Returns configuration guidelines for Microsoft Entra ID integration.
 */
export function getMicrosoftConfigRequirements(projectId?: string): MicrosoftConfigInfo {
  const effectiveProject = projectId || import.meta.env.VITE_FIREBASE_PROJECT_ID || 'your-firebase-project';
  return {
    providerId: 'microsoft.com',
    redirectUriTemplate: `https://${effectiveProject}.firebaseapp.com/__/auth/handler`,
    requiredScopes: ['openid', 'email', 'profile'],
    docUrl: 'https://firebase.google.com/docs/auth/web/microsoft-oauth',
  };
}
