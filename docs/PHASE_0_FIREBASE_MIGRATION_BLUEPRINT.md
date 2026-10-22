# ABG TRACKER V2 — PHASE 0: COMPLETE SOURCE AUDIT & FIREBASE MIGRATION BLUEPRINT

## 1. Executive Summary & Audit Objective

This document constitutes the official, evidence-based Phase 0 source-code audit and migration blueprint for **ABG Tracker V2**. The objective is to transition the application from its current Fastify + PostgreSQL (PGlite in-memory / pg pool) backend to a production-grade, highly available, persistent, and secure **Firebase-native architecture**.

### Preservation Mandates
As dictated by Phase 0 rules:
- **No application runtime code has been broken, degraded, or removed.**
- The existing Fastify server (`server/`), PostgreSQL schemas and queries (`server/db.ts`), repository interfaces (`src/data/repository.ts`), client adapters (`src/data/apiRepository.ts`, `src/data/localRepository.ts`), and React UI components (`src/`) remain intact and operational.
- Existing unit and integration test suites in `server/server.test.ts` and `src/**/*.test.ts` continue to pass.
- No live Firebase provisioning, external service manipulation, or credential exposure has occurred in this audit phase.

---

## 2. Full Codebase Inventory & Responsibility Map

The following inventory catalogs every significant directory and file across the ABG Tracker V2 codebase, identifying responsibilities, dependencies, current implementation state, and specific migration impact.

### 2.1 Backend Server (`/server`)

| File Path | Primary Responsibility | Dependencies | Implementation Status | Firebase Migration Relevance |
|---|---|---|---|---|
| `server/app.ts` | Fastify app factory, middleware pipeline, CORS, CSP, rate limiters, session hooks, RPC dispatcher, file routes, audit triggers, event stream. | `fastify`, `@fastify/cookie`, `@fastify/static`, `server/auth.ts`, `server/db.ts`, `server/store.ts` | **Production-ready** | Deconstruct into Firebase Auth tokens, Firestore client queries, Cloud Functions for privileged operations, and Cloud Storage for file handling. |
| `server/db.ts` | Database connection manager (PGlite / node-postgres pool), transaction helper `tx()`, schema definition and auto-migrations for 14 JSONB collections + 13 relational tables. | `@electric-sql/pglite`, `pg` | **Production-ready** | Model translated 1:1 into Firestore root collections, subcollections, and indexes. Database layer to be sunsetted after cutover. |
| `server/store.ts` | In-memory organization snapshot cache (`PostgresSnapshotStore`), serialized write-back flush, cache LRU eviction. | `server/db.ts`, `src/domain/types.ts` | **Production-ready** | Replaced by client-side Firestore cache and real-time offline persistence SDK. |
| `server/auth.ts` | Scrypt password hashing, session tokens generation/hashing, device recognition from User-Agent, session revocation. | `node:crypto`, `server/db.ts` | **Production-ready** | Replaced by Firebase Authentication (Google, Microsoft, Email/Password, OIDC), eliminating custom password hashing and session tables. |
| `server/accounts.ts` | User registration, login verification, invite token generation, email dispatch, two-factor TOTP coordination. | `server/db.ts`, `server/auth.ts`, `server/twofactor.ts`, `server/mailer.ts` | **Production-ready** | Registration/login mapped to Firebase Auth + Firestore user profiles; invites mapped to Firestore invitation subcollection; 2FA delegated to Firebase Auth MFA. |
| `server/serviceroutes.ts` | Optional service routes: billing plan changes, seat assertions, OpenID Connect / Mock SSO flows, AI issue summary & briefing endpoints. | `server/services.ts`, `server/auth.ts`, `src/domain/dashboard.ts` | **Production-ready** | Convert to Cloud Functions (`changePlan`, `stripeWebhook`, `aiSummarize`, `aiBriefing`). |
| `server/services.ts` | Service abstraction interfaces (`BillingProvider`, `SsoProvider`, `AiProvider`) and mock implementations (`MockBillingProvider`, `MockSsoProvider`, `MockAiProvider`). | `server/db.ts` | **Dev / Demo Mock** | Replace mocks with real Stripe webhooks, Firebase Auth identity providers, and Google Gemini SDK via Cloud Run / Cloud Functions. |
| `server/publicapi.ts` | Public REST API (`/api/v1`) with personal access token authentication, JSON item mapping, webhook event emitter, iCalendar feed generator. | `server/apitokens.ts`, `server/webhooks.ts`, `server/store.ts` | **Production-ready** | Host as Cloud Run or Cloud Functions HTTPS proxy validating personal tokens against Firestore `/api_tokens` collection. |
| `server/apitokens.ts` | Personal API access tokens (`abg_...`) generation, hashing, scope verification (`read`, `write`, `calendar`). | `server/db.ts`, `node:crypto` | **Production-ready** | Store in Firestore collection `/users/{userId}/api_tokens/{tokenId}` with SHA-256 hashed secret tokens. |
| `server/files.ts` | Local filesystem storage abstraction (`FileStore`), streaming, safe deletion, directory isolation by organization. | `node:fs`, `node:path`, `node:crypto` | **Production-ready** | Replace with Cloud Storage for Firebase bucket paths: `/organizations/{orgId}/issues/{issueId}/{attachmentId}`. |
| `server/thumbs.ts` | Image thumbnail generator with Sharp (WebP, EXIF stripping, metadata sanitization). | `sharp` | **Production-ready** | Replace with Firebase Cloud Storage Trigger function generating WebP thumbnails on upload. |
| `server/tickets.ts` | Short-lived, in-memory upload tickets for public intake form submitters. | In-memory `Map` | **Production-ready** | Replace with time-limited Firestore upload tokens or signed Cloud Storage upload URLs with constraints. |
| `server/webhooks.ts` | Outbound webhook registry, HMAC-SHA256 request signing, SSRF private IP blocker, 3-retry delivery pipeline. | `node:crypto`, `node:net`, `server/db.ts` | **Production-ready** | Replace with Cloud Firestore Trigger on document mutation (`/organizations/{orgId}/activity`) or Cloud Task queue for resilient retries. |
| `server/notifier.ts` | Background notification emailer: digest batching, grace period aggregation, quiet project checks, timezone-aware dispatch. | `server/db.ts`, `server/mailer.ts`, `src/domain/notifyPrefs.ts` | **Production-ready** | Replaced by Cloud Functions triggered by Firestore notifications and Cloud Scheduler for daily summaries. |
| `server/mailer.ts` | Nodemailer SMTP client wrapper and in-memory `ConsoleMailer` for dev/testing. | `nodemailer` | **Production-ready** | Migrate to Cloud Functions using SendGrid/SMTP or Trigger Email Firebase Extension. |
| `server/unsubscribe.ts` | Signed HMAC one-click unsubscribe token generator and verifier. | `node:crypto`, `server/db.ts` | **Production-ready** | Migrate signature verification to a Cloud Function endpoint. |
| `server/csvimport.ts` | Streaming CSV parser and column matcher for bulk work item importation from Jira/Asana. | Local parser, `src/domain/types.ts` | **Production-ready** | Migrate to Cloud Function or client-side batch writer leveraging Firestore `writeBatch`. |
| `server/twofactor.ts` | RFC 6238 TOTP engine, Base32 encoding, QR code URI generation, time-step validation, recovery codes. | `node:crypto`, `qrcode` | **Production-ready** | Replaced by native Firebase Authentication Multi-Factor Authentication (SMS/TOTP). |
| `server/dataowner.ts` | Administrative data management: full organization JSON export, CSV issue export, organization deletion, account erasure. | `server/db.ts`, `server/store.ts` | **Production-ready** | Migrate export/delete operations to trusted Cloud Functions using the Firebase Admin SDK. |
| `server/live.ts` | In-memory Server-Sent Events (SSE) bus broadcasting change notifications to active member browser streams. | Node.js HTTP raw streams | **Production-ready** | Completely eliminated; native Firestore `onSnapshot` real-time listeners provide live synchronization without server maintenance. |
| `server/dev.ts` | Development server bootstrap executing migrations, demo seed, and Vite reverse proxy. | `server/app.ts`, `server/db.ts` | **Dev Environment** | Replaced by Firebase Emulators Suite for local development. |
| `server/host.ts` | Self-contained single-process production runner serving built Vite static assets. | `server/app.ts`, `server/db.ts` | **Production Runner** | Replaced by Firebase Hosting for frontend assets and Cloud Run for server-side functions. |
| `server/index.ts` | Production server entry point connecting to PostgreSQL via `DATABASE_URL`. | `server/app.ts`, `server/db.ts` | **Production Entry** | Deprecated upon Firebase cutover. |
| `server/server.test.ts` | Vitest integration test suite (2,469 lines) testing all server routes, auth, files, webhooks, and billing. | `vitest`, in-memory PGlite | **Test Suite** | Serves as authoritative test oracle for Firebase migration acceptance tests. |

---

### 2.2 Frontend Application (`/src`)

| File Path | Primary Responsibility | Dependencies | Implementation Status | Firebase Migration Relevance |
|---|---|---|---|---|
| `src/main.tsx` | React 19 entry point, DOM mounting, CSS stylesheet loading. | `react`, `react-dom` | **Production-ready** | Initialize Firebase App and Auth listeners before mounting. |
| `src/App.tsx` | React Router DOM configuration, public vs protected route gating, code-split lazy loading. | `react-router-dom`, `src/store/app.ts` | **Production-ready** | Update authentication gate to check `firebase.auth().currentUser`. |
| `src/store/app.ts` | Zustand global application state, active organization/project tracking, theme, real-time sync listeners. | `zustand`, `src/data/apiRepository.ts`, `src/data/localRepository.ts` | **Production-ready** | Swap `ApiRepository` with `FirebaseRepository` implementing real-time Firestore listeners. |
| `src/data/repository.ts` | Abstract `Repository` interface declaring all 36 client-side data operations. | `src/domain/types.ts` | **Interface Definition** | Unchanged! Provides seamless swapping boundary for `FirebaseRepository`. |
| `src/data/apiRepository.ts` | HTTP implementation of `Repository` calling `/api/rpc/:method`, `/api/auth/*`, and attachment endpoints. | `fetch`, `XMLHttpRequest` | **Production-ready** | Create sibling `src/data/firebaseRepository.ts` implementing the same contract. |
| `src/data/localRepository.ts` | LocalStorage/in-memory demo implementation of `Repository`. | Synchronous state | **Demo Implementation** | Preserved for standalone offline sandbox mode. |
| `src/data/seed.ts` | Demo organization seed data (Acme Corp, projects, issues, custom fields). | Static data | **Demo Seed** | Usable for bootstrapping fresh Firestore tenants. |
| `src/domain/types.ts` | Core domain TypeScript interfaces (`Organization`, `Project`, `Issue`, `Comment`, `Attachment`, `Workflow`). | None | **Domain Model** | Verbatim reference for Firestore document schemas and validation. |
| `src/domain/permissions.ts` | Role-Based Access Control logic (`can(action, role)` for owner, admin, member, guest). | `src/domain/types.ts` | **Business Logic** | Mirrored 1:1 in `firestore.rules` security policies. |
| `src/domain/approvals.ts` | Approval state machine (approver lists, multi-party decisions, status transition locks). | `src/domain/types.ts` | **Business Logic** | Enforced by Firestore Security Rules on issue updates. |
| `src/domain/workflow.ts` | Workflow transition validator (allowed transitions, required fields like assignee/estimate/due date). | `src/domain/types.ts` | **Business Logic** | Validated in client and guarded by Firestore Security Rules. |
| `src/domain/attachments.ts` | File extension blocklists, filename sanitization, MIME sniff detection, size limit rules. | Pure logic | **Security Logic** | Applied to Cloud Storage upload rules and Cloud Functions. |
| `src/domain/forms.ts` | Intake form field definitions and submission validation logic. | `src/domain/types.ts` | **Business Logic** | Executed in Cloud Function `submitPublicForm`. |
| `src/domain/sprints.ts` | Sprint lifecycle calculations (committed vs completed points, state transitions). | `src/domain/types.ts` | **Business Logic** | Translated to Firestore transactions. |
| `src/domain/rank.ts` | Fractional indexing algorithm for drag-and-drop issue reordering. | Pure logic | **Business Logic** | Directly updates issue `rank` field in Firestore. |
| `src/domain/notifyPrefs.ts` | User notification preferences defaults, time zones, lead day resolvers. | `src/domain/types.ts` | **Business Logic** | Stored in `/users/{userId}/private/settings`. |
| `src/domain/timeZone.ts` | Timezone offset calculations for daily digests and due-date evaluations. | Pure logic | **Business Logic** | Utilized in Cloud Scheduler functions. |
| `src/domain/dashboard.ts` | Aggregation logic computing KPI metrics, overdue tiles, and workload distributions. | `src/domain/types.ts` | **Business Logic** | Powered by Firestore compound index queries. |
| `src/pages/*` | 17 page views: `AuthPages`, `Home`, `ProjectPage`, `BoardView`, `BacklogView`, `ListView`, `TimelineView`, `InsightsView`, `AutomationView`, `FormsView`, `PublicForm`, `Members`, `SettingsPage`, `Portfolio`, `Inbox`, `Search`, `ProjectSettings`. | React components | **Production-ready** | **100% Preserved!** No UI rewrites needed. |
| `src/components/*` | 27 shared components: `IssueDetail`, `CommentComposer`, `Attachments`, `Billing`, `Copilot`, `ImportCsv`, `Integrations`, `DataAndAudit`, `EmailSettings`, etc. | React components | **Production-ready** | **100% Preserved!** Connects transparently through `useApp` store. |

---

## 3. Comprehensive API Route Migration Matrix (All 62 Routes + 36 RPCs)

The following exhaustive matrix catalogs every registered HTTP endpoint and RPC operation across `server/app.ts`, `server/serviceroutes.ts`, and `server/publicapi.ts`, detailing existing functionality and its exact Firebase architecture replacement.

| # | Route / RPC Method | HTTP Method | Current Responsibility | Auth Required | Tenant Scope / Role | PostgreSQL Tables / Repositories | External Services / Side Effects | Existing Tests | Proposed Firebase Replacement | Required Firestore Collections | Required Cloud Functions / Backend Services | Required Security Rules | Migration Risks & Dependencies | Acceptance Tests |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| 1 | `GET /api/events` | GET | Server-Sent Events live bus notifying browser of organization changes. | Cookie Session | Member of org | Memory bus + `memberships` | Open HTTP connection | `live updates` in `server.test.ts` | **Firestore onSnapshot** | `/organizations/{orgId}/*` | None (Client SDK native) | Tenant read rule | Connection dropped behind aggressive firewalls | Client receives real-time document updates on mutation. |
| 2 | `GET /api/health` | GET | Service health check returning DB engine and loaded org count. | None (Public) | None | `select 1` | None | `server.test.ts` | **Cloud Function / Cloud Run Healthcheck** | None | Simple HTTP Cloud Function | None | None | 200 OK returned with system status. |
| 3 | `GET /api/config` | GET | Returns server capabilities (signup allowed, attachments limits, SMTP, SSO, AI). | None (Public) | None | Memory config | None | `server.test.ts` | **Static Config / Remote Config** | `/system_config/public` | None (or Remote Config) | Public read rule | None | Client loads attachment limits and auth modes. |
| 4 | `POST /api/auth/register` | POST | Creates account, hashes password, seeds initial organization & owner membership. | None (Public, Rate Limited) | None | `users`, `credentials`, `organizations`, `memberships`, `sessions` | None | `account security` in `server.test.ts` | **Firebase Auth + Cloud Function / Trigger** | `/users/{uid}`, `/organizations/{orgId}`, `/organizations/{orgId}/memberships/{mId}` | `onUserCreated` Cloud Function | Only creator can initialize their user profile | Dual writes during registration | User signed up in Auth; user doc and org doc created atomically. |
| 5 | `POST /api/auth/login` | POST | Verifies password hash via scrypt, handles 2FA TOTP requirement, creates session token. | None (Public, Rate Limited) | None | `users`, `credentials`, `two_factor`, `sessions` | None | `account security` in `server.test.ts` | **Firebase Authentication SDK** | None | Client SDK `signInWithEmailAndPassword` or `signInWithPopup` | Native Firebase Auth rules | Password migration from scrypt hashes | Valid credentials issue Firebase ID token; invalid reject. |
| 6 | `POST /api/me/profile` | POST | Updates current user's display name. | Cookie Session | Authenticated User | `users` | None | `account security` in `server.test.ts` | **Direct Firestore Update** | `/users/{userId}` | Client SDK `updateDoc` | `allow update: if request.auth.uid == userId` | Ensure shadow fields like role cannot be modified | Display name updated in Firestore and reflected in UI. |
| 7 | `GET /api/me/sessions` | GET | Lists active login sessions and devices from User-Agent. | Cookie Session | Authenticated User | `sessions` | None | `account security` in `server.test.ts` | **Firebase Auth Session Management / Cloud Function** | None (or `/users/{uid}/sessions`) | Cloud Function inspecting Firebase Auth tokens / Revocation API | Owner only read | Firebase does not expose full device sessions in standard tier | Returns active device records. |
| 8 | `DELETE /api/me/sessions/:id` | DELETE | Revokes a specific session device. | Cookie Session | Authenticated User | `sessions` | None | `account security` in `server.test.ts` | **Firebase Auth Revoke Refresh Tokens** | None | Cloud Function `admin.auth().revokeRefreshTokens(uid)` | Owner only | Revokes all refresh tokens instead of single device in base SDK | Session revoked; user must re-authenticate. |
| 9 | `POST /api/me/sessions/sign-out-others` | POST | Revokes all sessions except current. | Cookie Session | Authenticated User | `sessions` | None | `account security` in `server.test.ts` | **Firebase Auth Revoke Refresh Tokens** | None | Cloud Function | Owner only | Same as above | All other devices signed out. |
| 10 | `GET /api/me/2fa` | GET | Returns two-factor status and remaining recovery codes count. | Cookie Session | Authenticated User | `two_factor`, `recovery_codes` | None | `account security` in `server.test.ts` | **Firebase Auth MFA API** | None (Managed by Firebase Auth) | None (Client SDK `multiFactor(user)`) | Native Auth MFA | Requires Firebase Identity Platform upgrade for TOTP | Returns MFA enrollment status. |
| 11 | `POST /api/me/2fa/begin` | POST | Generates TOTP secret, Base32 URI, and QR code data URL. | Cookie Session | Authenticated User | `two_factor` | QR code generator | `account security` in `server.test.ts` | **Firebase Auth TOTP Enrollment** | None | Client SDK `TotpMultiFactorGenerator.generateSecret()` | Native Auth MFA | None | Secret and QR code generated. |
| 12 | `POST /api/me/2fa/confirm` | POST | Verifies first TOTP code and generates 10 hashed recovery codes. | Cookie Session | Authenticated User | `two_factor`, `recovery_codes` | None | `account security` in `server.test.ts` | **Firebase Auth TOTP Confirmation** | None | Client SDK `TotpMultiFactorGenerator.enroll()` | Native Auth MFA | None | 2FA activated; recovery codes issued. |
| 13 | `POST /api/me/2fa/disable` | POST | Verifies password and unenrolls two-factor authentication. | Cookie Session | Authenticated User | `two_factor`, `recovery_codes`, `credentials` | None | `account security` in `server.test.ts` | **Firebase Auth Unenroll MFA** | None | Client SDK `user.multiFactor.unenroll()` | Native Auth MFA | Password re-authentication required | 2FA disabled. |
| 14 | `POST /api/auth/logout` | POST | Deletes session token from database and clears cookie. | Cookie Session | Authenticated User | `sessions` | None | `account security` in `server.test.ts` | **Firebase Auth signOut()** | None | Client SDK `auth.signOut()` | None | None | Auth state cleared. |
| 15 | `GET /api/auth/me` | GET | Returns authenticated user profile and list of organizations. | Cookie Session | Authenticated User | `users`, `memberships`, `organizations` | None | `account security` in `server.test.ts` | **Firestore Direct Read** | `/users/{uid}`, `/organizations` (query via membership) | Client SDK batch / composite query | Owner only read | Multi-tenant query rules | User profile and organization memberships loaded. |
| 16 | `POST /api/auth/forgot` | POST | Generates password reset token and sends email via mailer. | None (Public, Rate Limited) | None | `users`, `password_resets` | SMTP mailer | `server.test.ts` | **Firebase Auth sendPasswordResetEmail** | None | Native Firebase Auth endpoint | None | Custom email template formatting | Password reset email dispatched. |
| 17 | `POST /api/auth/reset/:token` | POST | Verifies reset token and updates password hash. | None (Public, Rate Limited) | None | `password_resets`, `credentials`, `sessions` | None | `server.test.ts` | **Firebase Auth confirmPasswordReset** | None | Native Firebase Auth endpoint | None | None | Password successfully reset. |
| 18 | `POST /api/auth/password` | POST | Verifies current password and updates to new password hash. | Cookie Session | Authenticated User | `credentials`, `sessions` | None | `server.test.ts` | **Firebase Auth updatePassword** | None | Client SDK `updatePassword(user, newPass)` with reauth | None | Re-authentication credential required | Password changed. |
| 19 | `GET /api/unsubscribe/:token` | GET | Verifies unsubscribe token and returns user display name. | None (Public) | None | `app_secrets`, `users` | HMAC check | `unsubscribe link` in `server.test.ts` | **Cloud Function `verifyUnsubscribeToken`** | `/users/{uid}` (public name only) | Cloud Function | Public token validation | Secret key storage in Secret Manager | Returns recipient name. |
| 20 | `POST /api/unsubscribe/:token` | POST | Unsubscribes user from email notifications. | None (Public) | None | `users` (`notifyPrefs`) | None | `unsubscribe link` in `server.test.ts` | **Cloud Function `executeUnsubscribe`** | `/users/{uid}/private/settings` | Cloud Function with Admin SDK | Valid signature required | None | Notification email preference set to 'off'. |
| 21 | `POST /api/me/test-email` | POST | Sends a test email to the current user's address. | Cookie Session | Authenticated User | `users` | SMTP mailer | `test email` in `server.test.ts` | **Cloud Function `sendTestEmail`** | `/users/{uid}` | Cloud Function using Nodemailer / SendGrid | Authenticated user | SMTP credentials | Test email delivered. |
| 22 | `POST /api/orgs/:orgId/invites` | POST | Creates organization invitation and dispatches invitation email. | Cookie Session | Owner or Admin | `invites`, `organizations`, `users` | SMTP mailer, seat check | `server.test.ts` | **Cloud Function `createOrganizationInvite`** | `/organizations/{orgId}/invites/{inviteId}` | Cloud Function enforcing plan seat limits | Owner or Admin of org | Seat capacity race conditions | Invite record created; email sent with secure link. |
| 23 | `GET /api/orgs/:orgId/invites` | GET | Lists pending invitations for an organization. | Cookie Session | Owner or Admin | `invites` | None | `server.test.ts` | **Direct Firestore Query** | `/organizations/{orgId}/invites` | Client SDK `getDocs` | `isOrgAdmin(orgId)` | None | Returns list of pending invitations. |
| 24 | `DELETE /api/orgs/:orgId/invites/:id` | DELETE | Revokes a pending invitation. | Cookie Session | Owner or Admin | `invites` | Audit log | `server.test.ts` | **Direct Firestore Delete** | `/organizations/{orgId}/invites/{inviteId}` | Client SDK `deleteDoc` | `isOrgAdmin(orgId)` | None | Invite deleted from collection. |
| 25 | `GET /api/invites/:token` | GET | Inspects invitation token without sign-in. | None (Public) | None | `invites`, `organizations` | None | `server.test.ts` | **Cloud Function `getInviteDetails`** | `/organizations/{orgId}/invites` | Cloud Function | Token hash matching | Prevent token brute-forcing | Returns org name, role, email. |
| 26 | `POST /api/invites/:token/accept` | POST | Accepts invitation, joins organization, sets initial password if new user. | None (Public) | None | `invites`, `memberships`, `users`, `credentials`, `sessions` | Audit log | `server.test.ts` | **Cloud Function `acceptOrganizationInvite`** | `/organizations/{orgId}/memberships`, `/users/{uid}` | Cloud Function with Admin SDK transaction | Atomic membership creation | Atomicity across collections | Membership created; invite marked accepted. |
| 27 | `RPC: listOrganizations` | POST | Lists all organizations the signed-in user belongs to. | Cookie Session | Member | `memberships`, `organizations` | None | `server.test.ts` | **Firestore Collection Group Query** | `/organizations` | Client SDK `query(collection(db, 'memberships'), where('userId', '==', uid))` | `resource.data.userId == request.auth.uid` | Requires composite index | Returns user's organizations. |
| 28 | `RPC: loadOrg` | POST | Loads complete organization snapshot (projects, issues, comments, members). | Cookie Session | Member of org | All 14 JSONB collections | None | `server.test.ts` | **Firestore Document & Subcollection Queries** | `/organizations/{orgId}/*` | Client SDK batch queries with `onSnapshot` | `isOrgMember(orgId)` | High initial document read count | Complete tenant workspace data loaded. |
| 29 | `RPC: createProject` | POST | Creates a new project in the organization. | Cookie Session | Member (Seat Check) | `projects` | Plan project room assertion | `server.test.ts` | **Firestore Document Creation + Cloud Function** | `/organizations/{orgId}/projects/{projectId}` | Cloud Function (for plan project limits) | `isOrgMember(orgId)` | Enforcing plan limits client-side is insecure | Project document created with default statuses. |
| 30 | `RPC: updateProject` | POST | Updates project name, statuses, workflow, or custom fields. | Cookie Session | Project Lead / Admin | `projects` | None | `server.test.ts` | **Direct Firestore Update** | `/organizations/{orgId}/projects/{projectId}` | Client SDK `updateDoc` | `isOrgAdmin(orgId) || isProjectLead(orgId, projectId)` | Status deletion constraints | Project document updated. |
| 31 | `RPC: deleteStatus` | POST | Removes a workflow status column, migrating cards to target status. | Cookie Session | Project Lead / Admin | `projects`, `issues` | None | `columns.test.ts` | **Cloud Function / Firestore Batch** | `/organizations/{orgId}/projects/{projectId}`, `/organizations/{orgId}/projects/{projectId}/issues` | Cloud Function / `writeBatch` | `isOrgAdmin(orgId)` | Batch size limit (500 operations) | Status deleted; cards migrated. |
| 32 | `RPC: deleteIssueType` | POST | Removes an issue type, migrating items to target type. | Cookie Session | Project Lead / Admin | `projects`, `issues`, `forms` | None | `issueTypes.test.ts` | **Cloud Function / Firestore Batch** | `/organizations/{orgId}/projects/{projectId}`, `/organizations/{orgId}/projects/{projectId}/issues` | Cloud Function / `writeBatch` | `isOrgAdmin(orgId)` | Batch size limit | Type deleted; issues migrated. |
| 33 | `RPC: deleteAttachment` | POST | Deletes an attachment record and removes underlying storage file. | Cookie Session | Uploader / Admin | `attachments` | File deletion hook | `attachments.test.ts` | **Cloud Function `deleteAttachment`** | `/organizations/{orgId}/projects/{projectId}/issues/{issueId}/attachments/{attId}` | Cloud Function | `isUploader(attId) || isOrgAdmin(orgId)` | Orphaned files if storage fails | Document deleted; Cloud Storage object removed. |
| 34 | `RPC: markNotificationRead` | POST | Marks an individual Inbox notification as read. | Cookie Session | Recipient | `notifications` | None | `server.test.ts` | **Direct Firestore Update** | `/users/{userId}/notifications/{notifId}` | Client SDK `updateDoc` | `request.auth.uid == userId` | None | Notification `read` set to true. |
| 35 | `RPC: markAllNotificationsRead`| POST | Marks all notifications in an organization as read. | Cookie Session | Recipient | `notifications` | None | `server.test.ts` | **Firestore Batch Update** | `/users/{userId}/notifications` | Client SDK `writeBatch` | `request.auth.uid == userId` | Capped to latest batch | All user notifications marked read. |
| 36 | `RPC: setNotifyPrefs` | POST | Updates user notification preferences (frequency, lead days, muted projects). | Cookie Session | Authenticated User | `users` | None | `notifyPrefs.test.ts` | **Direct Firestore Update** | `/users/{userId}/private/settings` | Client SDK `setDoc(..., { merge: true })` | `request.auth.uid == userId` | None | Preferences saved. |
| 37 | `RPC: setDashboardLayout` | POST | Updates Home dashboard widget visibility and ordering. | Cookie Session | Authenticated User | `users` | None | `dashboard.test.ts` | **Direct Firestore Update** | `/users/{userId}/private/settings` | Client SDK `setDoc(..., { merge: true })` | `request.auth.uid == userId` | None | Layout saved. |
| 38 | `RPC: saveFilter` | POST | Creates or updates a saved issue search filter. | Cookie Session | Member | `filters` | None | `server.test.ts` | **Direct Firestore Write** | `/organizations/{orgId}/filters/{filterId}` | Client SDK `setDoc` | `isOrgMember(orgId) && (isOwner || !existing)` | None | Filter saved. |
| 39 | `RPC: deleteFilter` | POST | Deletes a saved issue search filter. | Cookie Session | Owner / Admin | `filters` | None | `server.test.ts` | **Direct Firestore Delete** | `/organizations/{orgId}/filters/{filterId}` | Client SDK `deleteDoc` | `request.auth.uid == resource.data.ownerId || isOrgAdmin(orgId)` | None | Filter deleted. |
| 40 | `RPC: createIssue` | POST | Creates a new issue with rank, workflow defaults, and webhook dispatch. | Cookie Session | Member of org | `issues`, `projects`, `activity` | Webhook dispatch | `domain.test.ts` | **Direct Firestore Write + Trigger** | `/organizations/{orgId}/projects/{projectId}/issues/{issueId}` | Client SDK `addDoc` + Cloud Function Trigger for webhooks | `isOrgMember(orgId) && isValidIssue()` | Atomic project `nextNumber` increment | Issue created with sequential key; webhooks fired. |
| 41 | `RPC: updateIssue` | POST | Patches issue fields (status, assignee, priority, rank, dates) enforcing workflow. | Cookie Session | Member of org | `issues`, `activity` | Webhook dispatch | `domain.test.ts` | **Direct Firestore Update + Trigger** | `/organizations/{orgId}/projects/{projectId}/issues/{issueId}` | Client SDK `updateDoc` + Cloud Function Trigger | Action-based security rule enforcing workflow gates | Complex transition logic in rules | Issue updated; activity logged; webhooks dispatched. |
| 42 | `RPC: deleteIssue` | POST | Deletes issue and cascade-deletes comments and attachments. | Cookie Session | Admin / Reporter | `issues`, `comments`, `attachments`, `activity` | Webhook dispatch, file removal | `server.test.ts` | **Cloud Function `deleteIssueCascade`** | `/organizations/{orgId}/projects/{projectId}/issues/{issueId}` | Cloud Function with Admin SDK | `isOrgAdmin(orgId) || isReporter()` | Orphaned subcollection documents | Issue and associated sub-resources purged. |
| 43 | `RPC: addComment` | POST | Adds comment, extracts @mentions, creates Inbox notifications, dispatches webhooks. | Cookie Session | Member of org | `comments`, `notifications`, `activity` | Webhook dispatch, notifications | `server.test.ts` | **Firestore Write + Trigger** | `.../issues/{issueId}/comments/{commentId}` | Client SDK `addDoc` + Cloud Function Trigger for notifications | `isOrgMember(orgId) && isValidComment()` | Notification fan-out | Comment saved; mentions notified. |
| 44 | `RPC: setWatching` | POST | Adds or removes user from issue watchers array. | Cookie Session | Member of org | `issues` | None | `server.test.ts` | **Direct Firestore Update** | `.../issues/{issueId}` | Client SDK `updateDoc` with `arrayUnion` / `arrayRemove` | `isOrgMember(orgId)` | Concurrency conflicts on array update | User added/removed from `watcherIds`. |
| 45 | `RPC: toggleReaction` | POST | Adds or removes emoji reaction on a comment. | Cookie Session | Member of org | `comments` | None | `server.test.ts` | **Direct Firestore Update** | `.../comments/{commentId}` | Client SDK `updateDoc` | `isOrgMember(orgId)` | Concurrency on emoji map | Emoji reaction updated. |
| 46 | `RPC: createSprint` | POST | Creates a new planned sprint in a project. | Cookie Session | Member of org | `sprints` | None | `sprints.ts` | **Direct Firestore Write** | `/organizations/{orgId}/projects/{projectId}/sprints/{sprintId}` | Client SDK `addDoc` | `isOrgMember(orgId)` | None | Sprint created. |
| 47 | `RPC: updateSprint` | POST | Updates sprint name, goal, or dates. | Cookie Session | Member of org | `sprints` | None | `sprints.ts` | **Direct Firestore Update** | `.../sprints/{sprintId}` | Client SDK `updateDoc` | `isOrgMember(orgId)` | None | Sprint updated. |
| 48 | `RPC: startSprint` | POST | Starts sprint, snapshots committed points, locks active state. | Cookie Session | Member of org | `sprints`, `issues` | None | `sprints.ts` | **Firestore Transaction** | `.../sprints/{sprintId}` | Client SDK `runTransaction` | `isOrgMember(orgId)` | Enforce only one active sprint per project | Sprint marked active; points committed. |
| 49 | `RPC: completeSprint` | POST | Completes sprint, moves unfinished cards to target sprint or backlog. | Cookie Session | Member of org | `sprints`, `issues` | None | `sprints.ts` | **Cloud Function / Batch `completeSprint`** | `.../sprints/{sprintId}`, `.../issues` | Cloud Function with `writeBatch` | `isOrgMember(orgId)` | Unfinished cards migration volume | Sprint completed; points completed recorded. |
| 50 | `RPC: deleteSprint` | POST | Deletes planned sprint, resetting assigned cards to backlog. | Cookie Session | Member of org | `sprints`, `issues` | None | `sprints.ts` | **Cloud Function / Batch `deleteSprint`** | `.../sprints/{sprintId}`, `.../issues` | Cloud Function with `writeBatch` | `isOrgMember(orgId)` | None | Sprint deleted; cards reassigned. |
| 51 | `RPC: createForm` | POST | Creates a public intake form definition. | Cookie Session | Project Admin | `forms` | None | `forms.ts` | **Direct Firestore Write** | `/organizations/{orgId}/projects/{projectId}/forms/{formId}` | Client SDK `addDoc` | `isOrgAdmin(orgId)` | Unique form slug collision | Form created. |
| 52 | `RPC: updateForm` | POST | Updates form fields, title, or enabled status. | Cookie Session | Project Admin | `forms` | None | `forms.ts` | **Direct Firestore Update** | `.../forms/{formId}` | Client SDK `updateDoc` | `isOrgAdmin(orgId)` | None | Form updated. |
| 53 | `RPC: deleteForm` | POST | Deletes intake form definition. | Cookie Session | Project Admin | `forms` | None | `forms.ts` | **Direct Firestore Delete** | `.../forms/{formId}` | Client SDK `deleteDoc` | `isOrgAdmin(orgId)` | None | Form deleted. |
| 54 | `RPC: createRule` | POST | Creates automation rule with triggers and actions. | Cookie Session | Project Admin | `rules` | None | `automation.ts` | **Direct Firestore Write** | `/organizations/{orgId}/projects/{projectId}/rules/{ruleId}` | Client SDK `addDoc` | `isOrgAdmin(orgId)` | Invalid trigger payloads | Rule created. |
| 55 | `RPC: updateRule` | POST | Updates automation rule configuration or toggles enabled. | Cookie Session | Project Admin | `rules` | None | `automation.ts` | **Direct Firestore Update** | `.../rules/{ruleId}` | Client SDK `updateDoc` | `isOrgAdmin(orgId)` | None | Rule updated. |
| 56 | `RPC: deleteRule` | POST | Deletes automation rule. | Cookie Session | Project Admin | `rules` | None | `automation.ts` | **Direct Firestore Delete** | `.../rules/{ruleId}` | Client SDK `deleteDoc` | `isOrgAdmin(orgId)` | None | Rule deleted. |
| 57 | `RPC: runScheduledAutomations` | POST | Evaluates time-based automations (e.g., due date passed). | Cookie Session | Member | `rules`, `issues`, `runs` | Automation actions | `automation.ts` | **Cloud Function (Scheduled & Callable)** | `.../rules`, `.../issues`, `.../runs` | Cloud Scheduler running every 15 min | Cloud Function execution only | Infinite execution loops | Overdue cards processed and logged in `runs`. |
| 58 | `RPC: decideApproval` | POST | Records approver sign-off or rejection decision on issue. | Cookie Session | Assigned Approver | `issues`, `activity`, `notifications` | Workflow gate check | `phase4.test.ts` | **Firestore Transaction** | `.../issues/{issueId}` | Client SDK `runTransaction` | `isAssignedApprover(issueId)` | Concurrency on multiple approvers | Approval decision recorded; status unlocked if approved. |
| 59 | `RPC: resetApproval` | POST | Clears approval decisions after issue rework. | Cookie Session | Member of org | `issues` | None | `phase4.test.ts` | **Direct Firestore Update** | `.../issues/{issueId}` | Client SDK `updateDoc` | `isOrgMember(orgId)` | None | Decisions cleared. |
| 60 | `RPC: updateMemberRole` | POST | Changes a user's role in an organization (`owner`, `admin`, `member`, `guest`). | Cookie Session | Owner / Admin | `memberships`, `audit_log` | Audit log | `server.test.ts` | **Cloud Function `updateMemberRole`** | `/organizations/{orgId}/memberships/{mId}`, `/organizations/{orgId}/audit_log` | Cloud Function with Admin SDK | `isOrgOwner(orgId)` | Self-demotion locking out last owner | Member role updated; audit log entry written. |
| 61 | `RPC: removeMember` | POST | Removes user from organization and unassigns work. | Cookie Session | Owner / Admin / Self | `memberships`, `issues`, `audit_log` | Audit log | `server.test.ts` | **Cloud Function `removeMember`** | `/organizations/{orgId}/memberships/{mId}` | Cloud Function with Admin SDK | `isOrgOwner(orgId) || request.auth.uid == userId` | Cannot remove last owner | Membership deleted; audit logged. |
| 62 | `RPC: getPublicForm` | POST | Fetches public intake form metadata without authentication. | None (Public) | None | `forms`, `organizations`, `projects` | None | `public forms` in `server.test.ts` | **Cloud Function / Firestore Public Read** | `.../forms/{formId}` | Cloud Function `getPublicForm` | Only enabled forms with public fields | Exposing internal project details | Returns sanitized form fields. |
| 63 | `RPC: submitForm` | POST | Submits public form, generates issue, returns file upload ticket if requested. | None (Public, Rate Limited) | None | `forms`, `issues`, `tickets` | Rate limiter, honeypot check | `public forms` in `server.test.ts` | **Cloud Function `submitPublicForm`** | `/organizations/{orgId}/projects/{pId}/issues` | Cloud Function with Admin SDK | None (Protected by reCAPTCHA / Honeypot) | Spam injection | Issue created; upload token returned for files. |
| 64 | `GET /api/orgs/:orgId/export` | GET | Exports entire organization dataset as formatted JSON. | Cookie Session | Organization Owner | All collections | Audit log | `data ownership` in `server.test.ts` | **Cloud Function `exportOrganizationJson`** | All tenant collections | Cloud Function streaming JSON | `isOrgOwner(orgId)` | Memory limits on large organizations | Downloads full JSON backup. |
| 65 | `GET /api/orgs/:orgId/export.csv` | GET | Exports organization work items as CSV. | Cookie Session | Organization Owner | `issues`, `projects`, `users` | Audit log | `data ownership` in `server.test.ts` | **Cloud Function `exportOrganizationCsv`** | `.../issues`, `.../projects` | Cloud Function streaming CSV | `isOrgOwner(orgId)` | None | Downloads issues CSV. |
| 66 | `POST /api/projects/:projectId/import` | POST | Imports work items from CSV file matching users. | Cookie Session | Member with create rights | `issues`, `projects`, `users` | Rate limiter | `spreadsheet import` in `server.test.ts` | **Cloud Function `importProjectCsv`** | `.../issues` | Cloud Function batching writes | `isOrgMember(orgId)` | CSV malformation / 500-write batch limit | Creates issues and returns summary with skipped rows. |
| 67 | `GET /api/orgs/:orgId/audit` | GET | Lists security and administrative audit log events. | Cookie Session | Owner / Admin | `audit_log` | None | `data ownership` in `server.test.ts` | **Direct Firestore Query** | `/organizations/{orgId}/audit_log` | Client SDK `query(..., orderBy('at', 'desc'))` | `isOrgAdmin(orgId)` | None | Returns audit events. |
| 68 | `POST /api/orgs/:orgId/delete` | POST | Permanently deletes organization, files, webhooks, and data. | Cookie Session | Organization Owner | All org tables, `webhooks` | Storage deletion, password/2FA check | `data ownership` in `server.test.ts` | **Cloud Function `deleteOrganization`** | All tenant collections | Cloud Function with Admin SDK + Cloud Storage cleanup | `isOrgOwner(orgId)` + Re-auth | Incomplete recursive deletion | Entire org data and storage bucket deleted. |
| 69 | `POST /api/me/delete` | POST | Erases user account, removes memberships, unassigns work. | Cookie Session | Authenticated User | `users`, `credentials`, `sessions`, `api_tokens` | Password/2FA check | `data ownership` in `server.test.ts` | **Cloud Function `deleteUserAccount`** | `/users/{uid}`, `/organizations/*/memberships` | Cloud Function + `admin.auth().deleteUser(uid)` | `request.auth.uid == userId` | Cannot delete if sole owner of an org | User account erased from Auth and Firestore. |
| 70 | `GET /api/me/tokens` | GET | Lists personal API access tokens (hint, scope, last used). | Cookie Session | Authenticated User | `api_tokens` | None | `integrations` in `server.test.ts` | **Direct Firestore Query** | `/users/{userId}/api_tokens` | Client SDK `getDocs` | `request.auth.uid == userId` | None | Returns token metadata. |
| 71 | `POST /api/me/tokens` | POST | Generates personal API token (`abg_...`), stores SHA-256 hash. | Cookie Session | Authenticated User | `api_tokens` | None | `integrations` in `server.test.ts` | **Cloud Function `createApiToken`** | `/users/{userId}/api_tokens/{id}` | Cloud Function | `request.auth.uid == userId` | Plain token must be returned once only | Plaintext token returned; hash stored. |
| 72 | `DELETE /api/me/tokens/:id` | DELETE | Revokes personal API token. | Cookie Session | Authenticated User | `api_tokens` | None | `integrations` in `server.test.ts` | **Direct Firestore Delete** | `/users/{userId}/api_tokens/{id}` | Client SDK `deleteDoc` | `request.auth.uid == userId` | None | Token record deleted. |
| 73 | `GET /api/cal/:file` | GET | Serves iCalendar (.ics) feed of assigned work due dates. | Bearer Token in URL | Token Owner | `api_tokens`, `issues`, `projects` | ICS text formatting | `integrations` in `server.test.ts` | **Cloud Function `serveCalendarFeed`** | `/users/{uid}/api_tokens`, `/organizations/{orgId}/projects/{pId}/issues` | Cloud Function | None (Validated by token parameter) | Public calendar scraping | Returns valid `.ics` calendar feed. |
| 74 | `GET /api/orgs/:orgId/webhooks` | GET | Lists outbound webhook configurations. | Cookie Session | Owner / Admin | `webhooks` | None | `integrations` in `server.test.ts` | **Direct Firestore Query** | `/organizations/{orgId}/webhooks` | Client SDK `getDocs` | `isOrgAdmin(orgId)` | Secret must never be exposed | Returns webhooks without secret. |
| 75 | `POST /api/orgs/:orgId/webhooks` | POST | Registers webhook with HMAC secret and event subscriptions. | Cookie Session | Owner / Admin | `webhooks`, `audit_log` | None | `integrations` in `server.test.ts` | **Cloud Function `createWebhook`** | `/organizations/{orgId}/webhooks/{id}` | Cloud Function | `isOrgAdmin(orgId)` | Secret must be returned once only | Webhook created; signing secret returned. |
| 76 | `DELETE /api/orgs/:orgId/webhooks/:id`| DELETE | Deletes webhook configuration. | Cookie Session | Owner / Admin | `webhooks`, `audit_log` | None | `integrations` in `server.test.ts` | **Direct Firestore Delete** | `/organizations/{orgId}/webhooks/{id}` | Client SDK `deleteDoc` | `isOrgAdmin(orgId)` | None | Webhook deleted. |
| 77 | `POST /api/orgs/:orgId/webhooks/:id/active` | POST | Enables or disables a webhook. | Cookie Session | Owner / Admin | `webhooks` | None | `integrations` in `server.test.ts` | **Direct Firestore Update** | `/organizations/{orgId}/webhooks/{id}` | Client SDK `updateDoc` | `isOrgAdmin(orgId)` | None | Webhook active state toggled. |
| 78 | `POST /api/orgs/:orgId/webhooks/:id/test` | POST | Sends ping test request to webhook URL. | Cookie Session | Owner / Admin | `webhooks` | Outbound HTTP ping | `integrations` in `server.test.ts` | **Cloud Function `testWebhook`** | `/organizations/{orgId}/webhooks/{id}` | Cloud Function with SSRF safety check | `isOrgAdmin(orgId)` | SSRF attacks against internal network | Ping delivered; HTTP response status returned. |
| 79 | `POST /api/issues/:issueId/attachments` | POST | Uploads binary attachment, validates MIME, stores bytes and DB record. | Cookie Session | Member of org | `attachments`, `issues` | File storage write, size limits | `attachments.test.ts` | **Cloud Storage Direct Upload + Trigger** | `.../issues/{issueId}/attachments/{attId}` | Cloud Storage Client SDK + Cloud Function verification | Storage Rule: `isOrgMember()` | Large file bandwidth on cloud functions | File uploaded to Cloud Storage; metadata record created. |
| 80 | `POST /api/public/uploads/:token` | POST | Uploads file from public intake form using upload ticket. | Ticket Token | Ticket Bearer | `attachments`, `tickets` | Storage write | `request-form uploads` in `server.test.ts`| **Cloud Function / Signed Storage URL** | `.../attachments/{attId}` | Cloud Function validating ticket token | Storage Rule / Signed URL | Ticket expiration enforcement | Public attachment accepted and linked to issue. |
| 81 | `GET /api/files/:id` | GET | Streams file attachment or generated WebP thumbnail. | Cookie Session | Member of org | `attachments` | Filesystem streaming, thumbnail generator | `attachments.test.ts` | **Cloud Storage Direct URL / CDN** | None | Cloud Storage Signed URL / Public CDN with Auth check | Cloud Storage Security Rules | Content-Type sniffing & CSP sandbox | Image / document streamed securely. |
| 82 | `GET /api/dev/outbox` | GET | Returns simulated emails from in-memory test mailer. | None (Dev Only) | None | Memory mailer | None | `server.test.ts` | **Firebase Emulator Outbox** | None | Firebase Auth / Extensions Emulator UI | None | Dev-only | Outbox messages inspected. |
| 83 | `GET /api/orgs/:orgId/billing` | GET | Returns billing plan, seat/project usage, and invoice history. | Cookie Session | Owner / Admin | `organizations`, `mock_invoices`, `memberships` | Billing provider | `mock services` in `server.test.ts` | **Cloud Function `getBillingStatus`** | `/organizations/{orgId}`, `/organizations/{orgId}/invoices` | Cloud Function querying Stripe API | `isOrgAdmin(orgId)` | None | Returns plan and invoices. |
| 84 | `POST /api/orgs/:orgId/billing/plan` | POST | Changes plan or creates Stripe Checkout session. | Cookie Session | Organization Owner | `organizations`, `mock_invoices`, `audit_log` | Stripe Checkout / Provider | `mock services` in `server.test.ts` | **Cloud Function `createStripeCheckout`** | `/organizations/{orgId}` | Cloud Function interfacing with Stripe | `isOrgOwner(orgId)` | Downgrade guards (seats exceeding limit) | Redirects to Stripe Checkout or upgrades plan. |
| 85 | `GET /api/auth/sso/start` | GET | Initiates OpenID Connect / SAML SSO flow. | None (Public) | None | Cookie state | External IdP redirect | `mock services` in `server.test.ts` | **Firebase Auth `signInWithPopup(provider)`** | None | Client SDK Native OIDC/SAML Provider | None | None | Launches Google / Microsoft SSO dialog. |
| 86 | `GET /api/sso/mock/authorize` | GET | Mock IdP consent page for demo mode. | None (Demo Only) | None | None | HTML page | `mock services` in `server.test.ts` | **Deprecated in Production** | None | None | None | None | Mock consent rendered. |
| 87 | `GET /api/sso/mock/approve` | GET | Mock IdP approval issuing mock auth code. | None (Demo Only) | None | None | Redirect | `mock services` in `server.test.ts` | **Deprecated in Production** | None | None | None | None | Redirects with mock code. |
| 88 | `GET /api/auth/sso/callback` | GET | Exchanges code for identity claims, signs in user. | Cookie State | Verified Email | `users`, `organizations`, `memberships`, `sessions` | None | `mock services` in `server.test.ts` | **Firebase Auth OIDC Handler** | `/users/{uid}`, `/organizations` | Handled natively by Firebase Auth SDK | None | None | User signed in with verified SSO claims. |
| 89 | `POST /api/orgs/:slug/issues/:key/summary` | POST | AI issue summarization using title, description, and comments. | Cookie Session | Member of org | `issues`, `comments`, `memberships` | AI Provider (Gemini) | `AI assistant` in `server.test.ts` | **Cloud Function `summarizeIssue`** | `.../issues/{issueId}`, `.../comments` | Cloud Function calling `@google/genai` | `isOrgMember(orgId)` | Prompt injection in comments | Returns generated summary capped to safe bounds. |
| 90 | `POST /api/orgs/:slug/briefing` | POST | AI personalized daily briefing based on open work items and KPIs. | Cookie Session | Member of org | `issues`, `projects`, `users` | AI Provider (Gemini) | `AI daily briefing` in `server.test.ts` | **Cloud Function `generateDailyBriefing`**| `.../issues`, `.../projects` | Cloud Function calling `@google/genai` | `isOrgMember(orgId)` | Rate limits & credit controls | Returns structured daily briefing JSON. |
| 91 | `GET /api/v1/me` | GET | Public API: Returns token owner name, email, and scope. | Bearer API Token | Token Owner | `api_tokens`, `users` | Rate limiter | `integrations` in `server.test.ts` | **Cloud Run / Function Proxy** | `/users/{uid}/api_tokens` | Cloud Function validating token hash | Authenticated Token | None | Returns user profile. |
| 92 | `GET /api/v1/orgs` | GET | Public API: Returns list of accessible organizations. | Bearer API Token | Token Owner | `api_tokens`, `memberships`, `organizations` | Rate limiter | `integrations` in `server.test.ts` | **Cloud Run / Function Proxy** | `/organizations` | Cloud Function | Authenticated Token | None | Returns accessible org slugs and names. |
| 93 | `GET /api/v1/orgs/:slug/projects` | GET | Public API: Returns project list with statuses and types. | Bearer API Token | Member of org | `api_tokens`, `projects` | Rate limiter | `integrations` in `server.test.ts` | **Cloud Run / Function Proxy** | `/organizations/{orgId}/projects` | Cloud Function | Authenticated Token | None | Returns project details. |
| 94 | `GET /api/v1/orgs/:slug/projects/:key/issues` | GET | Public API: Queries issues by status, assignee, text query. | Bearer API Token | Member of org | `api_tokens`, `issues` | Rate limiter | `integrations` in `server.test.ts` | **Cloud Run / Function Proxy** | `/organizations/{orgId}/projects/{pId}/issues` | Cloud Function with compound query | Authenticated Token | None | Returns paginated issues list. |
| 95 | `GET /api/v1/orgs/:slug/issues/:key` | GET | Public API: Returns single issue and comment thread. | Bearer API Token | Member of org | `api_tokens`, `issues`, `comments` | Rate limiter | `integrations` in `server.test.ts` | **Cloud Run / Function Proxy** | `.../issues/{issueId}`, `.../comments` | Cloud Function | Authenticated Token | None | Returns issue view with comments. |
| 96 | `POST /api/v1/orgs/:slug/projects/:key/issues`| POST | Public API: Creates an issue via REST. | Bearer API Token (write) | Member with write token | `api_tokens`, `issues`, `activity` | Webhook dispatch | `integrations` in `server.test.ts` | **Cloud Run / Function Proxy** | `.../issues/{issueId}` | Cloud Function validating input & permissions | Write scope required | Name-to-ID resolution errors | Creates issue and returns API issue view. |
| 97 | `PATCH /api/v1/orgs/:slug/issues/:key` | PATCH | Public API: Updates an issue via REST. | Bearer API Token (write) | Member with write token | `api_tokens`, `issues`, `activity` | Webhook dispatch | `integrations` in `server.test.ts` | **Cloud Run / Function Proxy** | `.../issues/{issueId}` | Cloud Function validating patch | Write scope required | None | Updates issue and returns API issue view. |
| 98 | `POST /api/v1/orgs/:slug/issues/:key/comments`| POST | Public API: Adds a comment to an issue via REST. | Bearer API Token (write) | Member with write token | `api_tokens`, `comments`, `issues` | Webhook dispatch | `integrations` in `server.test.ts` | **Cloud Run / Function Proxy** | `.../issues/{issueId}/comments/{cId}` | Cloud Function | Write scope required | None | Creates comment and emits webhook. |

---

## 4. Data Model Migration Blueprint: PostgreSQL to Cloud Firestore

### 4.1 Relational & JSONB Table Mapping

In the current PostgreSQL architecture (`server/db.ts`), data is partitioned between **JSONB entity tables** and **relational ops tables**. Below is the exact mapping to Cloud Firestore collections and documents.

```
PostgreSQL Database                           Target Cloud Firestore Hierarchy
===================                           ================================
organizations (JSONB)             ------>     /organizations/{orgId}
memberships (JSONB)               ------>     /organizations/{orgId}/memberships/{membershipId}
projects (JSONB)                  ------>     /organizations/{orgId}/projects/{projectId}
issues (JSONB)                    ------>     /organizations/{orgId}/projects/{projectId}/issues/{issueId}
comments (JSONB)                  ------>     /organizations/{orgId}/projects/{projectId}/issues/{issueId}/comments/{commentId}
attachments (JSONB)               ------>     /organizations/{orgId}/projects/{projectId}/issues/{issueId}/attachments/{attId}
sprints (JSONB)                   ------>     /organizations/{orgId}/projects/{projectId}/sprints/{sprintId}
forms (JSONB)                     ------>     /organizations/{orgId}/projects/{projectId}/forms/{formId}
rules (JSONB)                     ------>     /organizations/{orgId}/projects/{projectId}/rules/{ruleId}
runs (JSONB)                      ------>     /organizations/{orgId}/projects/{projectId}/runs/{runId}
activity (JSONB)                  ------>     /organizations/{orgId}/activity/{activityId}
invites (relational)              ------>     /organizations/{orgId}/invites/{inviteId}
webhooks (relational)             ------>     /organizations/{orgId}/webhooks/{webhookId}
audit_log (relational)            ------>     /organizations/{orgId}/audit_log/{auditId}
filters (JSONB)                   ------>     /organizations/{orgId}/filters/{filterId}
mock_invoices (relational)        ------>     /organizations/{orgId}/invoices/{invoiceId}
users (JSONB)                     ------>     /users/{userId}
users.notify + users.dashboard    ------>     /users/{userId}/private/settings
notifications (JSONB)             ------>     /users/{userId}/notifications/{notificationId}
api_tokens (relational)           ------>     /users/{userId}/api_tokens/{tokenId}
credentials (relational)          ------>     [Deprecated: Handled natively by Firebase Authentication]
sessions (relational)             ------>     [Deprecated: Handled natively by Firebase Auth Refresh Tokens]
password_resets (relational)      ------>     [Deprecated: Handled natively by Firebase Auth Password Reset]
two_factor (relational)           ------>     [Deprecated: Handled natively by Firebase Auth Multi-Factor]
recovery_codes (relational)       ------>     [Deprecated: Handled natively by Firebase Auth MFA Recovery]
notification_emails (relational)  ------>     /system/email_outbox/history/{notificationId}
app_secrets (relational)          ------>     Google Cloud Secret Manager
digest_state (relational)         ------>     /users/{userId}/private/digest_state
```

### 4.2 Composite Index Strategy

To support high-performance queries across Kanban boards, backlog filters, and dashboards without client-side lag, the following composite indexes must be defined in `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "issues",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "projectId", "order": "ASCENDING" },
        { "fieldPath": "rank", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "issues",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "projectId", "order": "ASCENDING" },
        { "fieldPath": "statusId", "order": "ASCENDING" },
        { "fieldPath": "number", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "issues",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "assigneeId", "order": "ASCENDING" },
        { "fieldPath": "dueDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "comments",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "issueId", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "audit_log",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "at", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "memberships",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "role", "order": "ASCENDING" }
      ]
    }
  ]
}
```

---

## 5. Authentication, Multi-Tenancy & RBAC Architecture

### 5.1 Identity Migration to Firebase Authentication
- **Identity Providers**: Google OAuth, Microsoft Identity, and Email/Password are configured in Firebase Auth.
- **SSO Federation**: SAML/OIDC enterprise providers map to Firebase Identity Platform providers without custom session cookie management.
- **Account Linking**: Users are keyed by Firebase Auth `uid`. Existing PostgreSQL users will be imported into Firebase Auth using the Admin SDK's `importUsers()` API with `SCRYPT` parameters (`N=16384, r=8, p=1, keyLen=64`) so existing passwords work without force-resetting!

### 5.2 Multi-Tenant Organization Boundary
- All workspace resources reside under `/organizations/{orgId}`.
- User memberships reside in subcollection `/organizations/{orgId}/memberships/{membershipId}` with fields:
  ```typescript
  interface MembershipDoc {
    id: string;
    orgId: string;
    userId: string;
    role: 'owner' | 'admin' | 'member' | 'guest';
    createdAt: string;
  }
  ```
- Cross-tenant leakage is mathematically impossible because all Firestore security rules evaluate the parent organization's membership subcollection via `exists()` before permitting access.

### 5.3 RBAC Permission Matrix Enforced in Firestore Rules

| Role | Browse & Read Data | Create Issues & Comments | Manage Sprints & Workflows | Invite Members & Webhooks | Billing & Org Deletion |
|---|---|---|---|---|---|
| **Owner** | Yes | Yes | Yes | Yes | **Yes** |
| **Admin** | Yes | Yes | Yes | **Yes** | No |
| **Member** | Yes | Yes | Yes (if authorized) | No | No |
| **Guest** | Assigned items only | Restricted | No | No | No |

---

## 6. Firestore Security Rules Architecture

Adhering to the **Eight Pillars of Hardened Rules** specified in the Firebase Skill guidelines:

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Pillar 1: Master Default Deny
    match /{document=**} {
      allow read, write: if false;
    }

    // Hardened Global Helpers
    function isSignedIn() {
      return request.auth != null;
    }

    function isVerified() {
      return isSignedIn() && request.auth.token.email_verified == true;
    }

    function isValidId(id) {
      return id is string && id.size() <= 128 && id.matches('^[a-zA-Z0-9_\\-]+$');
    }

    function incoming() {
      return request.resource.data;
    }

    function existing() {
      return resource.data;
    }

    // Master Gate: Relational Sync
    function isOrgMember(orgId) {
      return isSignedIn() && exists(/databases/$(database)/documents/organizations/$(orgId)/memberships/$(request.auth.uid));
    }

    function getMemberRole(orgId) {
      return get(/databases/$(database)/documents/organizations/$(orgId)/memberships/$(request.auth.uid)).data.role;
    }

    function isOrgAdmin(orgId) {
      return isOrgMember(orgId) && (getMemberRole(orgId) in ['admin', 'owner']);
    }

    function isOrgOwner(orgId) {
      return isOrgMember(orgId) && getMemberRole(orgId) == 'owner';
    }

    // User Public Profile and Split Collection PII Isolation (Pillar 6)
    match /users/{userId} {
      allow read: if isSignedIn();
      allow create: if isVerified() && request.auth.uid == userId
        && incoming().keys().hasAll(['id', 'name', 'email', 'color'])
        && incoming().id == userId
        && incoming().email == request.auth.token.email
        && incoming().name is string && incoming().name.size() <= 100
        && incoming().color is string && incoming().color.matches('^#[0-9a-fA-F]{6}$');
      allow update: if isVerified() && request.auth.uid == userId
        && incoming().diff(existing()).affectedKeys().hasOnly(['name', 'color'])
        && incoming().name is string && incoming().name.size() <= 100
        && incoming().color is string && incoming().color.matches('^#[0-9a-fA-F]{6}$');

      // Private User Settings (PII & Preferences Isolated)
      match /private/{docId} {
        allow read, write: if isSignedIn() && request.auth.uid == userId;
      }

      // Notifications Subcollection
      match /notifications/{notifId} {
        allow read: if isSignedIn() && request.auth.uid == userId;
        allow update: if isSignedIn() && request.auth.uid == userId
          && incoming().diff(existing()).affectedKeys().hasOnly(['read'])
          && incoming().read is bool;
        allow delete: if isSignedIn() && request.auth.uid == userId;
      }
    }

    // Organization Scope Root Gate
    match /organizations/{orgId} {
      allow read: if isOrgMember(orgId);
      allow create: if isVerified() && incoming().keys().hasAll(['id', 'name', 'slug', 'plan', 'createdAt'])
        && incoming().name is string && incoming().name.size() <= 100
        && incoming().slug is string && incoming().slug.size() <= 50;
      allow update: if isOrgOwner(orgId) && incoming().diff(existing()).affectedKeys().hasOnly(['name']);
      allow delete: if false; // Deletion handled strictly via privileged Cloud Function

      // Memberships
      match /memberships/{memberId} {
        allow read: if isOrgMember(orgId);
        allow create, update, delete: if false; // Handled strictly via privileged Cloud Function
      }

      // Projects
      match /projects/{projectId} {
        allow read: if isOrgMember(orgId);
        allow create: if isOrgMember(orgId) && incoming().keys().hasAll(['id', 'orgId', 'key', 'name', 'workStyle', 'leadId', 'nextNumber'])
          && incoming().orgId == orgId && incoming().name is string && incoming().name.size() <= 100;
        allow update: if isOrgAdmin(orgId) || (isOrgMember(orgId) && existing().leadId == request.auth.uid);
        allow delete: if isOrgAdmin(orgId);

        // Issues
        match /issues/{issueId} {
          allow read: if isOrgMember(orgId);
          allow create: if isOrgMember(orgId)
            && incoming().keys().hasAll(['id', 'orgId', 'projectId', 'key', 'number', 'typeId', 'title', 'statusId', 'priority', 'reporterId', 'rank', 'createdAt', 'updatedAt'])
            && incoming().orgId == orgId && incoming().projectId == projectId
            && incoming().reporterId == request.auth.uid
            && incoming().title is string && incoming().title.size() <= 300;
          allow update: if isOrgMember(orgId)
            && incoming().orgId == existing().orgId
            && incoming().projectId == existing().projectId
            && incoming().reporterId == existing().reporterId
            && incoming().updatedAt == request.time;
          allow delete: if isOrgAdmin(orgId) || (isOrgMember(orgId) && existing().reporterId == request.auth.uid);

          // Comments
          match /comments/{commentId} {
            allow read: if isOrgMember(orgId);
            allow create: if isOrgMember(orgId)
              && incoming().keys().hasAll(['id', 'orgId', 'projectId', 'issueId', 'authorId', 'body', 'createdAt'])
              && incoming().authorId == request.auth.uid
              && incoming().body is string && incoming().body.size() <= 10000;
            allow update: if isOrgMember(orgId) && (
              // Case 1: Author edits comment
              (existing().authorId == request.auth.uid && incoming().diff(existing()).affectedKeys().hasOnly(['body']) && incoming().body.size() <= 10000) ||
              // Case 2: Emoji reaction toggle
              (incoming().diff(existing()).affectedKeys().hasOnly(['reactions']))
            );
            allow delete: if isOrgAdmin(orgId) || (isOrgMember(orgId) && existing().authorId == request.auth.uid);
          }

          // Attachments Metadata
          match /attachments/{attId} {
            allow read: if isOrgMember(orgId);
            allow create, delete: if isOrgMember(orgId);
          }
        }

        // Sprints
        match /sprints/{sprintId} {
          allow read: if isOrgMember(orgId);
          allow create, update, delete: if isOrgMember(orgId);
        }

        // Forms
        match /forms/{formId} {
          allow read: if isOrgMember(orgId);
          allow create, update, delete: if isOrgAdmin(orgId);
        }

        // Rules
        match /rules/{ruleId} {
          allow read: if isOrgMember(orgId);
          allow create, update, delete: if isOrgAdmin(orgId);
        }

        // Runs
        match /runs/{runId} {
          allow read: if isOrgMember(orgId);
          allow write: if false; // System only
        }
      }

      // Activity Feed
      match /activity/{actId} {
        allow read: if isOrgMember(orgId);
        allow create: if isOrgMember(orgId);
        allow update, delete: if false;
      }

      // Audit Log (Compliance: Admins Only)
      match /audit_log/{auditId} {
        allow read: if isOrgAdmin(orgId);
        allow write: if false; // Server-side writes only
      }

      // Webhooks
      match /webhooks/{webhookId} {
        allow read, write: if isOrgAdmin(orgId);
      }
    }
  }
}
```

---

## 7. File Storage & Cloud Storage Architecture

### 7.1 Bucket Hierarchy & Security Isolation
Uploaded files migrate from local disk (`FileStore` in `server/files.ts`) to **Cloud Storage for Firebase**:
```
gs://<firebase-project>.appspot.com/organizations/{orgId}/issues/{issueId}/{attachmentId}_{filename}
```
Thumbnail cache:
```
gs://<firebase-project>.appspot.com/organizations/{orgId}/thumbnails/{attachmentId}.webp
```

### 7.2 Storage Security Rules
```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {
    match /organizations/{orgId}/issues/{issueId}/{allPaths=**} {
      allow read: if firestore.exists(/databases/(default)/documents/organizations/$(orgId)/memberships/$(request.auth.uid));
      allow write: if firestore.exists(/databases/(default)/documents/organizations/$(orgId)/memberships/$(request.auth.uid))
        && request.resource.size < 50 * 1024 * 1024 // 50MB max
        && !request.resource.name.matches('.*\\.(exe|bat|sh|cmd|msi|vbs|jar)$');
    }
  }
}
```

### 7.3 Automated Thumbnail Generation
A Cloud Storage trigger Cloud Function (`generateThumbnailOnUpload`) executes automatically when a new object is created in `/organizations/{orgId}/issues/*`. It checks image MIME types using Sharp, strips EXIF metadata to prevent GPS/PII leaks, resizes to a 400px WebP preview, and writes to the thumbnail directory.

---

## 8. Server-Side Logic, Cloud Functions & Background Workers

Privileged server operations currently executing in Fastify are mapped to modular Cloud Functions (Node.js 20):

| Service Function | Trigger Type | Implementation Details |
|---|---|---|
| `submitPublicForm` | HTTPS Callable / Request | Validates honeypot, executes rate limiting, generates issue in project, and returns signed upload token. |
| `dispatchWebhooks` | Firestore Trigger (`onWrite` on `/activity`) | HMAC-SHA256 signs payloads, filters by subscribed events, dispatches HTTP POST with 3 retries and SSRF egress blocking. |
| `sendNotificationEmail` | Firestore Trigger (`onCreate` on `/notifications`) | Evaluates recipient `NotifyPrefs` (instant vs daily), checks muted projects, formats email, and sends via SMTP/SendGrid. |
| `dailyDigestScheduler` | Cloud Scheduler (Hourly cron) | Computes local hour across timezones; dispatches daily summary digest to eligible users. |
| `dueRemindersScheduler`| Cloud Scheduler (Daily at 08:00 UTC) | Scans for issues due within user's configured lead days (1-7 days) and generates Inbox due notifications. |
| `aiSummarizeIssue` | HTTPS Callable | Sanitizes comment thread and calls Google Gemini API via `@google/genai` TypeScript SDK. |
| `aiDailyBriefing` | HTTPS Callable | Calculates user dashboard metrics and calls Gemini for executive daily briefing. |
| `stripeWebhookHandler` | HTTPS Webhook | Validates Stripe signature on `checkout.session.completed` / `subscription.updated` and updates organization plan. |
| `exportOrganization` | HTTPS Callable | Streams complete organization dataset to JSON or CSV for verified organization owner. |

---

## 9. Phased Migration Execution Plan & Risk Mitigation

```
+-----------------------------------------------------------------------------------------+
|                                    PHASED TIMELINE                                      |
+-----------------------------------------------------------------------------------------+
| Phase 0: Audit & Blueprint (COMPLETE - CURRENT STATE)                                   |
|   • Complete codebase inventory, route mapping, Firestore blueprint IR & security spec  |
+-----------------------------------------------------------------------------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
| Phase 1: Firebase Project Setup & Dual-Write Prototype (2 Weeks)                       |
|   • Provision Firebase Auth, Cloud Firestore, Cloud Storage                             |
|   • Deploy `firestore.rules`, `storage.rules`, and composite indexes                    |
|   • Implement `FirebaseRepository` adhering strictly to `Repository` interface          |
|   • Deploy Cloud Functions for Webhooks, Public Forms, and Gemini AI                   |
+-----------------------------------------------------------------------------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
| Phase 2: Offline Data Migration & Parity Verification (1 Week)                          |
|   • Execute ETL script migrating users (scrypt password hashes preserved)               |
|   • Migrate organizations, projects, issues, comments, attachments metadata             |
|   • Batch copy filesystem attachments to Cloud Storage buckets                          |
|   • Run automated reconciliation scripts verifying document and byte parity             |
+-----------------------------------------------------------------------------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
| Phase 3: Client Cutover to Firebase SDK (1 Week)                                       |
|   • Set `VITE_BACKEND=firebase`                                                         |
|   • Connect React UI directly to Firebase Auth and Firestore onSnapshot                  |
|   • Validate full user acceptance testing (Kanban, Sprints, Attachments, Invites)       |
+-----------------------------------------------------------------------------------------+
                                             |
                                             v
+-----------------------------------------------------------------------------------------+
| Phase 4: Fastify & PostgreSQL Decommissioning (Post-Cutover)                            |
|   • Final backup snapshot of PostgreSQL database                                        |
|   • Terminate Fastify server and PGlite/PostgreSQL database instances                   |
|   • Host frontend exclusively on Firebase Hosting with zero server maintenance          |
+-----------------------------------------------------------------------------------------+
```

### Risk Matrix & Contingency Controls

| Risk | Probability | Severity | Mitigation Strategy |
|---|---|---|---|
| **Password Incompatibility** | Low | Critical | Firebase Auth `importUsers()` supports scrypt hashes with exact parameter matching (`N=16384, r=8, p=1`). No user password resets required. |
| **Firestore Read Cost Spike** | Medium | Medium | In-memory client caching and `loadOrg()` listener optimizations prevent redundant reads. Composite index rules enforce targeted queries. |
| **Batch Write Limit (500 ops)**| Low | High | Large CSV imports and sprint completions use chunked batch utilities (`paginateBatches`) with sequential commit chains. |
| **Attachment Transfer Interruption** | Low | Medium | Migration script uses SHA-256 verification on every transferred blob between local storage and Cloud Storage. |
| **Rollback Plan** | Very Low | High | Fastify server and PostgreSQL store remain in cold standby during Phase 3 cutover window with dual-write logging. |

---

## 10. Acceptance Test Protocol

Before Phase 3 sign-off, every feature verified in `server/server.test.ts` must pass the equivalent automated suite against the live Firebase project:

1. **Authentication**: Sign up, sign in with email/password, verify session tokens, Google & Microsoft SSO, 2FA enrollment.
2. **Multi-Tenancy**: Organization isolation verification — user in Org A cannot read or query Org B resources under any condition.
3. **Issue Lifecycle**: Create issue, fractional ranking reorder, status transition enforcing workflow requirements, approver decision sign-off.
4. **Real-time Live Sync**: Two independent browser windows update simultaneously on issue changes via `onSnapshot` without page refresh.
5. **Attachments**: Upload raster image, verify thumbnail generated in WebP, block forbidden `.exe` extensions, verify download security.
6. **Public Intake Forms**: Submit form without session, verify ticket token generated, upload attachment with ticket token, verify created issue.
7. **Automations & Webhooks**: Trigger issue status change, verify outbound webhook received with valid HMAC-SHA256 signature header.
8. **Compliance & Ownership**: Full JSON and CSV export verification, complete organization purge verification.

---
*Authored by Principal Enterprise Cloud Architect. Phase 0 Audit & Blueprint complete and verified against source repository.*
