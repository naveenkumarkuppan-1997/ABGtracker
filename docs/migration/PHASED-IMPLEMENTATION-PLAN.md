# ABG Tracker V2 — Phased Implementation Plan & Rollback Strategy

## 1. Migration Phasing Overview

```
Phase 0: Complete Audit & Migration Blueprint (Current)
   │
   ▼
Phase 1: Firebase Project Setup, Auth & Security Rules Foundations
   │
   ▼
Phase 2: Client Repository Adapter (FirebaseRepository Implementation)
   │
   ▼
Phase 3: Cloud Functions & Trusted Backend Services
   │
   ▼
Phase 4: Dual-Run Data Migration, Verification & Backfill
   │
   ▼
Phase 5: Production Cutover, Fastify/PostgreSQL Decommissioning
```

---

## 2. Phase-by-Phase Roadmap

### Phase 1: Firebase Project Setup & Identity Foundations
- **Prerequisites:** Approval of Phase 0 audit deliverables.
- **Tasks:**
  1. Provision staging and production Firebase projects with Blaze plan enabled.
  2. Configure Firebase Authentication: Enable Email/Password, Google Sign-in, and Microsoft OpenID Connect provider with Azure AD tenant settings.
  3. Deploy initial `firestore.rules` and `storage.rules` to emulator and staging project.
  4. Create Cloud Storage buckets with uniform bucket-level access and CORS policies.
  5. Install client Firebase SDK (`firebase`) and server SDK (`firebase-admin`).
- **Acceptance Criteria:**
  - Able to sign in and sign up via Email, Google, and Microsoft in Firebase Authentication Emulator.
  - Security Rules unit tests pass against `@firebase/rules-unit-testing`.

### Phase 2: Client Repository Adapter (`FirebaseRepository`)
- **Prerequisites:** Phase 1 complete.
- **Tasks:**
  1. Create `src/data/firebaseRepository.ts` implementing the full `Repository` interface (`src/data/repository.ts`).
  2. Map all 35 data-access methods to Firestore document/subcollection reads, writes, and transactions.
  3. Replace Server-Sent Events (`LiveBus`) subscription with Firestore `onSnapshot` listeners in `src/App.tsx`.
  4. Add feature toggle `VITE_DATA_BACKEND=firebase|api` to switch between `ApiRepository` and `FirebaseRepository` without code regressions.
- **Acceptance Criteria:**
  - Running frontend with `VITE_DATA_BACKEND=firebase` passes all 214 tests in `vitest run src`.
  - Boards, backlogs, timelines, custom fields, and issue details update reactively across multiple browser tabs.

### Phase 3: Cloud Functions & Trusted Backend Services
- **Prerequisites:** Phase 2 complete.
- **Tasks:**
  1. Implement Callable Cloud Functions for privileged operations:
     - `createOrganizationInvite` / `acceptOrganizationInvite`
     - `deleteOrganization` / `deleteUserAccount`
     - `changeOrganizationPlan`
  2. Implement Background Event Handlers:
     - Storage upload trigger for EXIF stripping and WebP thumbnail generation.
     - Outbound webhook dispatcher with Cloud Tasks retries.
  3. Implement Public API and Feed Endpoints:
     - Public API v1 handler (`/api/v1/*`)
     - Calendar feed handler (`/api/cal/:file.ics`)
     - Public intake form submission handler (`/api/public/submit`)
     - Stripe Webhook handler (`/api/billing/webhook`)
  4. Implement Cloud Scheduler tasks for due-date reminders and notification email batching.
- **Acceptance Criteria:**
  - Outbound webhooks deliver with valid HMAC-SHA256 signature.
  - Public intake forms submit without authentication and issue valid upload tickets.
  - Calendar feeds export valid `.ics` calendars accepted by Google Calendar.

### Phase 4: Dual-Run Data Migration, Verification & Backfill
- **Prerequisites:** Phase 3 complete.
- **Tasks:**
  1. Develop data export/import script (`scripts/migrate-pg-to-firestore.ts`) reading existing PostgreSQL / PGlite databases and writing to Firestore.
  2. Export Scrypt password hashes from `credentials` table and import to Firebase Auth using `firebase auth:import`.
  3. Migrate local attachments from `server-files/` to Cloud Storage.
  4. Perform test migration on staging environment; verify record counts, relationships, and user ownerships.
- **Acceptance Criteria:**
  - 100% parity of existing organization, project, issue, sprint, comment, and attachment counts.
  - Existing demo users (`alex@acme.dev`, `priya@acme.dev`, `jordan@northwind.io`) can sign in with their existing passwords.

### Phase 5: Production Cutover & Fastify/PostgreSQL Decommissioning
- **Prerequisites:** Phase 4 validated with zero discrepancies.
- **Tasks:**
  1. Freeze writes on legacy Fastify/Postgres instance.
  2. Run final differential synchronization of database records.
  3. Update DNS / Firebase Hosting custom domain to point to production Firebase project.
  4. Monitor Cloud Logging and Error Reporting for 72 hours.
  5. Archive PostgreSQL database snapshot to Cloud Storage coldline bucket.
  6. Safely remove legacy Fastify server code (`server/`) and dependencies (`pg`, `@electric-sql/pglite`, `fastify`).
- **Acceptance Criteria:**
  - Zero downtime observed during cutover.
  - All web, mobile, and API clients successfully operate on pure Firebase infrastructure.

---

## 3. Rollback & Contingency Strategy

1. **Dual-Backend Switch (`VITE_DATA_BACKEND`):**  
   The application UI retains both `ApiRepository` and `FirebaseRepository` until Phase 5. If a critical issue is discovered in staging or production, switching the frontend environment variable immediately reverts to Fastify/Postgres.
2. **Reverse Synchronization During Transition:**  
   During Phase 4 staging, Firestore writes can be piped back to PostgreSQL via a Firestore event trigger to ensure the relational database remains in sync should rollback be triggered.
3. **Database Snapshot Retention:**  
   The final PostgreSQL dump is stored in encrypted Cloud Storage with object versioning and 90-day retention lock.

---

## 4. Key Migration Risks & Mitigation Matrix

| Risk | Impact | Likelihood | Mitigation Strategy |
|---|---|---|---|
| **Scrypt Hash Incompatibility** | High | Low | Validate Firebase CLI Scrypt parameters (`N=16384, r=8, p=1`) in staging prior to cutover; support email-based password reset fallback. |
| **Concurrent Issue Key Allocation** | Medium | Medium | Wrap issue creation in Firestore atomic transactions on `/projects/{projectId}` counter document. |
| **Firestore 1 MB Document Limit** | High | Low | Segregate issue comments and activity into subcollections; store large file attachments in Cloud Storage. |
| **Security Rule Leakage** | Critical | Low | Comprehensive automated testing suite using `@firebase/rules-unit-testing` validating cross-tenant denial. |
| **Webhook SSRF Vulnerability** | High | Low | Enforce strict DNS validation and IP egress firewall blocking private and metadata IP ranges. |
