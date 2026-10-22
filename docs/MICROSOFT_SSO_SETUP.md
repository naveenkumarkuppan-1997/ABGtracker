# ABG Tracker V2 — Microsoft Entra ID (Azure AD) SSO Setup Guide

This guide documents the exact configuration required to enable **Microsoft Sign-In** through Firebase Authentication.

---

## 1. Microsoft Entra ID App Registration Walkthrough

1. Sign in to the [Microsoft Entra admin center](https://entra.microsoft.com/) or Azure Portal.
2. Navigate to **Identity → Applications → App registrations**.
3. Click **New registration**:
   - **Name**: `ABG Tracker V2 Enterprise Identity`
   - **Supported account types**: Select *Accounts in any organizational directory (Any Microsoft Entra ID tenant - Multitenant) and personal Microsoft accounts (e.g. Skype, Xbox)*, or *Accounts in this organizational directory only (Single tenant)* depending on enterprise requirements.
   - **Redirect URI**:
     - Platform: **Web**
     - URI: `https://<YOUR-FIREBASE-PROJECT-ID>.firebaseapp.com/__/auth/handler`
4. Click **Register**.

---

## 2. API Permissions & Client Secret

### 2.1 API Permissions
1. Under **Manage → API permissions**, click **Add a permission**.
2. Select **Microsoft Graph → Delegated permissions**.
3. Ensure the following scopes are checked:
   - `openid` (Sign users in)
   - `email` (View users' email address)
   - `profile` (View users' basic profile)
   - `User.Read` (Sign in and read user profile)
4. Click **Add permissions**.
5. (Recommended for organizations) Click **Grant admin consent**.

### 2.2 Client Credentials
1. Under **Manage → Certificates & secrets**, select the **Client secrets** tab.
2. Click **New client secret**:
   - Description: `ABG Tracker Firebase Auth Provider`
   - Expires: Choose recommended timeframe (e.g., 24 months).
3. Copy the **Value** immediately (it will not be shown again).

---

## 3. Firebase Console Configuration

1. In the [Firebase Console](https://console.firebase.google.com/), open **Authentication → Sign-in method**.
2. Click **Add new provider** and select **Microsoft**.
3. Toggle **Enable**.
4. Enter the values from Microsoft Entra:
   - **Application (client) ID**: Found on the Azure App Registration Overview page.
   - **Application (client) secret**: The secret value generated in step 2.2.
5. Save the configuration.

---

## 4. Current Status & Dependencies

| Requirement | Implementation State | Notes |
|---|---|---|
| **Client Code (`OAuthProvider`)** | **COMPLETE** | In `src/firebase/auth.ts`, `signInWithMicrosoft()` initializes the provider with `openid`, `email`, and `profile` scopes and account prompt. |
| **UI Integration** | **COMPLETE** | In `src/pages/AuthPages.tsx`, Microsoft sign-in button is active with full error reporting. |
| **Backend Verification** | **COMPLETE** | Verified Microsoft identities flow through `verifyFirebaseIdToken()` in `server/app.ts`. |
| **Live Entra Tenant Credentials** | **PENDING CONFIGURATION** | Live enterprise login requires the tenant administrator to complete App Registration in Entra ID and provide the Client ID & Secret in the Firebase Console. |
