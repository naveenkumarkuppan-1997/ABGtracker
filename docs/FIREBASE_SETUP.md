# ABG Tracker V2 — Firebase Setup & Configuration Guide

This guide details how to configure a dedicated Firebase project for **ABG Tracker V2** for Phase 1 Authentication and subsequent database migration.

---

## 1. Firebase Project Initialization

1. Navigate to the [Firebase Console](https://console.firebase.google.com/).
2. Click **Add project** and enter a project name (e.g., `abg-tracker-v2-dev`).
3. (Optional) Disable Google Analytics for development/testing if not required.
4. Once created, click the **Web** icon (`</>`) to add a Web App.
5. Register the app as `ABG Tracker Web` and copy the generated configuration parameters into your `.env` file.

---

## 2. Environment Variables Configuration

Copy the sample configuration from `.env.example` into your local `.env` file:

```bash
# Frontend Web App Configuration (Public client credentials, no secrets)
VITE_FIREBASE_API_KEY="AIzaSy..."
VITE_FIREBASE_AUTH_DOMAIN="abg-tracker-v2-dev.firebaseapp.com"
VITE_FIREBASE_PROJECT_ID="abg-tracker-v2-dev"
VITE_FIREBASE_STORAGE_BUCKET="abg-tracker-v2-dev.appspot.com"
VITE_FIREBASE_MESSAGING_SENDER_ID="123456789012"
VITE_FIREBASE_APP_ID="1:123456789012:web:abcdef123456"

# Backend Firebase Admin SDK Configuration (Server-side only)
FIREBASE_PROJECT_ID="abg-tracker-v2-dev"
# For local service account key:
# GOOGLE_APPLICATION_CREDENTIALS="/path/to/service-account.json"
```

> **Security Rule**: Never prefix backend credentials or service account private keys with `VITE_`.

---

## 3. Configuring Authentication Providers

### 3.1 Email and Password
1. In the Firebase Console, go to **Build → Authentication → Sign-in method**.
2. Click **Email/Password**.
3. Toggle **Enable** on.
4. (Optional) Enable **Email link (passwordless sign-in)** if desired.
5. Click **Save**.

### 3.2 Google Sign-In
1. Under **Sign-in method**, click **Add new provider → Google**.
2. Toggle **Enable** on.
3. Select your support email from the dropdown.
4. Under **Settings → Authorized domains**, verify that your application domain is allowlisted:
   - `localhost`
   - `*.run.app` (for Cloud Run deployments)
   - Your production domain (e.g. `tracker.example.com`)
5. Click **Save**.

### 3.3 Microsoft Sign-In
1. Follow the dedicated instructions in [MICROSOFT_SSO_SETUP.md](./MICROSOFT_SSO_SETUP.md).
2. Under **Sign-in method**, choose **Microsoft**.
3. Provide the **Application (client) ID** and **Client secret** obtained from Microsoft Entra ID.

---

## 4. Local Development with Firebase Emulator Suite

To develop and test without creating live cloud resources:

1. Install Firebase CLI:
   ```bash
   npm install -g firebase-tools
   ```
2. Start the local emulators:
   ```bash
   firebase emulators:start
   ```
3. Set your local `.env`:
   ```bash
   VITE_FIREBASE_AUTH_EMULATOR_URL=http://localhost:9099
   FIREBASE_AUTH_EMULATOR_HOST=localhost:9099
   ```
4. Access the Emulator UI at `http://localhost:4040` to inspect users and authentication tokens.
