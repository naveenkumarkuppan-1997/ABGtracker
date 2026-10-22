import { describe, expect, it } from 'vitest';
import { getFriendlyAuthErrorMessage, getMicrosoftConfigRequirements } from './auth';
import { validateFirebaseConfig } from './config';

describe('Firebase Auth Service & Configuration', () => {
  it('validates incomplete Firebase configuration', () => {
    const incomplete = { apiKey: 'test' };
    const result = validateFirebaseConfig(incomplete);
    expect(result.valid).toBe(false);
    expect(result.missing).toContain('authDomain');
    expect(result.missing).toContain('projectId');
    expect(result.missing).toContain('appId');
  });

  it('validates complete Firebase configuration', () => {
    const complete = {
      apiKey: 'AIzaSyFakeKey123',
      authDomain: 'test-app.firebaseapp.com',
      projectId: 'test-app',
      appId: '1:1234:web:abcd',
    };
    const result = validateFirebaseConfig(complete);
    expect(result.valid).toBe(true);
    expect(result.missing).toHaveLength(0);
  });

  it('detects emulator mode when authEmulatorUrl is supplied', () => {
    const emulatorConfig = {
      authEmulatorUrl: 'http://localhost:9099',
    };
    const result = validateFirebaseConfig(emulatorConfig);
    expect(result.usingEmulator).toBe(true);
  });

  it('translates common Firebase Auth error codes to user-friendly messages', () => {
    expect(getFriendlyAuthErrorMessage({ code: 'auth/user-not-found' })).toBe('Incorrect email or password.');
    expect(getFriendlyAuthErrorMessage({ code: 'auth/wrong-password' })).toBe('Incorrect email or password.');
    expect(getFriendlyAuthErrorMessage({ code: 'auth/invalid-credential' })).toBe('Incorrect email or password.');
    expect(getFriendlyAuthErrorMessage({ code: 'auth/email-already-in-use' })).toBe(
      'An account already exists with this email address. Please sign in instead.'
    );
    expect(getFriendlyAuthErrorMessage({ code: 'auth/popup-closed-by-user' })).toBe(
      'The sign-in window was closed before completing. Please try again.'
    );
    expect(getFriendlyAuthErrorMessage({ code: 'auth/user-disabled' })).toBe(
      'This account has been deactivated. Contact an administrator.'
    );
    expect(getFriendlyAuthErrorMessage({ code: 'auth/account-exists-with-different-credential' })).toBe(
      'An account already exists with this email under a different sign-in method. Sign in with your original provider.'
    );
    expect(getFriendlyAuthErrorMessage({ code: 'auth/unauthorized-domain' })).toContain(
      'is not authorized for Firebase Authentication'
    );
  });

  it('generates accurate Microsoft Entra OAuth configuration parameters', () => {
    const config = getMicrosoftConfigRequirements('abg-prod-workspace');
    expect(config.providerId).toBe('microsoft.com');
    expect(config.redirectUriTemplate).toBe('https://abg-prod-workspace.firebaseapp.com/__/auth/handler');
    expect(config.requiredScopes).toEqual(['openid', 'email', 'profile']);
    expect(config.docUrl).toBe('https://firebase.google.com/docs/auth/web/microsoft-oauth');
  });
});
