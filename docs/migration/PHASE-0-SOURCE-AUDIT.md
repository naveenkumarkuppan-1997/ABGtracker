# Phase 0: Complete Source Audit & Baseline Architecture Report
**Project:** ABG Tracker V2 (`abg-v2`)  
**Audit Date:** October 20, 2026  
**Auditor:** Principal Enterprise Architect & Systems Engineer  
**Objective:** Complete, evidence-based source code audit and Firebase migration blueprint. Planning and audit only — zero modifications to runtime code.

---

## 1. Executive Summary & Architecture Overview

ABG Tracker V2 is a full-featured, multi-tenant issue tracking, project management, and collaborative agile execution platform. It features an architecture combining:

1. **Frontend:** React 19 SPA bundled with Vite 8 and styled with Tailwind CSS v4. State is managed reactively via Zustand stores (`src/store/app.ts`), custom hooks, and domain selectors (`src/domain/selectors.ts`).
2. **Backend Server:** Node.js Fastify 5 server providing both custom REST endpoints and a typed JSON-RPC dispatcher (`/api/rpc/:method`).
3. **Database Architecture:**
   - **PostgreSQL / Embedded PGlite:** Dual-mode persistence. In local development and unit tests, `@electric-sql/pglite` executes real WebAssembly-compiled PostgreSQL. In production, standard `pg` connects to a PostgreSQL instance via `DATABASE_URL`.
   - **Data Model Strategy:** The core application utilizes an in-memory snapshot store (`PostgresSnapshotStore` in `server/store.ts`) holding 14 domain collections serialized as JSONB rows in Postgres. All mutations are serialized across a promise chain lock, flushed to PostgreSQL, and broadcast to clients using Server-Sent Events (SSE `LiveBus`).
   - **Relational Tables:** 13 dedicated relational tables manage session cookies, passwords, 2FA secrets, recovery codes, invites, password resets, API tokens, webhooks, audit logs, and digest tracking.
4. **Third-Party & Auxiliary Services:**
   - Designed around a pluggable interface pattern (`server/services.ts`).
   - Currently includes three mock implementations (`MockBillingProvider`, `MockSsoProvider`, `MockAiProvider`) designed for seamless replacement with production providers (Stripe, OpenID Connect/OAuth, and LLM APIs).
   - Local disk-backed file storage with image sniffing, EXIF stripping, and WebP thumbnail generation (`server/files.ts`, `server/thumbs.ts`).

---

## 2. Comprehensive Codebase Inventory

### 2.1 Configuration & Infrastructure Files
| File Path | Lines | Primary Responsibility | Migration Relevance |
|---|---|---|---|
| `/package.json` | 53 | Defines package metadata, dependencies (React 19, Fastify 5, PGlite, Lucide), and scripts (`dev`, `api`, `web`, `build`, `lint`, `test`). | Target dependencies (`firebase`, `firebase-admin`) to be added in Phase 1. |
| `/vite.config.ts` | 19 | Vite 8 config with Tailwind v4, React plugin, path aliases (`@/`), proxying `/api` to port 4000. | Vite remains frontend bundler; proxy will point to Cloud Functions emulator or live API. |
| `/tsconfig.json` | 21 | Root TypeScript configuration for frontend and shared domain code. | Preserved. |
| `/server/tsconfig.json` | 13 | Server-specific TypeScript configuration targeting Node.js ES2022. | Preserved during transitional phase. |
| `/Dockerfile` | 38 | Multi-stage Docker build producing standalone Node production image. | Replaced by Firebase Hosting + Cloud Run / Functions. |
| `/docker-compose.yml` | 24 | Local multi-container setup with real PostgreSQL 16. | Replaced by Firebase Local Emulator Suite. |
| `/.env.example` | 35 | Documents environment variables for ports, hosts, SMTP, secrets, and provider switches. | Target environment variables documented for Firebase. |
| `/metadata.json` | 6 | AI Studio applet capabilities and permissions descriptor. | Synchronized. |

### 2.2 Server-Side Core Modules (`/server/`)
| File Path | Lines | Responsibility & Implementation Status | Migration Relevance |
|---|---|---|---|
| `server/app.ts` | 898 | Fastify server initialization, CSRF protection, CSP headers, session middleware, REST endpoints, JSON-RPC router, file upload handlers, and SSE live bus. | Core backend logic to be migrated to Cloud Functions v2 and Firestore Security Rules. |
| `server/db.ts` | 201 | Database engine abstraction (PGlite vs. `pg`), DDL migrations for 14 JSONB collections and 13 relational tables. | Data schema foundation; directly mapped to Cloud Firestore collections. |
| `server/store.ts` | 248 | `PostgresSnapshotStore`: in-memory snapshot cache, cache eviction, dirty flushing, and transaction rollbacks. | Replaced by native Cloud Firestore SDK real-time listeners and atomic transactions. |
| `server/auth.ts` | 147 | Scrypt password hashing, session creation/verification in Postgres, device tracking, rate limiting. | Replaced by Firebase Authentication (Email/Password, Google, Microsoft OIDC). |
| `server/accounts.ts` | 374 | Account registration, credential checks, two-factor auth initiation/confirmation, invitations, password resets. | Replaced by Firebase Auth + Cloud Functions for invite tokens & org onboarding. |
| `server/serviceroutes.ts` | 268 | Billing plans & usage limits, mock/live SSO endpoints, AI issue summarization, AI daily briefing. | Endpoints mapped to Cloud Functions calling Stripe, Firebase Auth, and Gemini/Claude. |
| `server/services.ts` | 338 | Interfaces and mock implementations: `BillingProvider`, `SsoProvider`, `AiProvider`. | Target service interfaces for Cloud Functions. |
| `server/publicapi.ts` | 311 | Public REST API v1 (`/api/v1/*`), iCalendar feed generator (`/api/cal/:file.ics`), and webhook event emitter. | Migrated to Cloud Functions (HTTPS callable & HTTP request endpoints). |
| `server/webhooks.ts` | 309 | Outbound webhook dispatcher with HMAC-SHA256 signature, retry queue, and delivery logging. | Migrated to Cloud Tasks + Cloud Functions for reliable background delivery. |
| `server/files.ts` | 144 | `FileStore`: Content-addressable local disk storage with SHA256 deduplication and organization quota enforcement. | Migrated to Cloud Storage for Firebase with Storage Security Rules. |
| `server/thumbs.ts` | 42 | Image thumbnail generation via `sharp`, EXIF metadata stripping, WebP conversion. | Migrated to Cloud Functions trigger on Storage upload (or extension). |
| `server/tickets.ts` | 55 | Upload tickets for public intake forms with expiration and submission limits. | Migrated to short-lived signed URLs or trusted intake Cloud Function. |
| `server/twofactor.ts` | 227 | TOTP RFC 6238 implementation, QR code generator, AES-256-GCM secret encryption, recovery code verification. | Replaced by Firebase Authentication Multi-Factor Authentication (MFA). |
| `server/mailer.ts` | 66 | `ConsoleMailer` (dev/test) and `Nodemailer` (SMTP) abstractions. | Migrated to Firebase Extension (Trigger Email) or SendGrid/Postmark Cloud Function. |
| `server/notifier.ts` | 280 | `NotificationEmailer`: aggregates unread inbox notifications and delivers batch emails and daily digests based on user timezone. | Migrated to Cloud Scheduler + Cloud Functions. |
| `server/dataowner.ts` | 215 | Full organization JSON & CSV data exports, organization deletion, account deletion, and audit logging. | Migrated to Cloud Functions with admin authorization. |
| `server/csvimport.ts` | 148 | Parses spreadsheet text (Jira, Asana, Excel CSV), plans import, validates fields against project schema. | Maintained client-side or handled via Cloud Function. |
| `server/apitokens.ts` | 108 | Personal access token management, hashing, verification, and last-used tracking. | Replaced by Firebase Custom Tokens or Firestore token store with Cloud Function verification. |
| `server/live.ts` | 74 | `LiveBus`: Server-Sent Events (SSE) broadcaster tracking connected user sessions. | Replaced by Cloud Firestore `onSnapshot` real-time listeners (zero server maintenance). |
| `server/config.ts` | 111 | Environment variable parser and strict production configuration validator. | Replaced by Google Secret Manager & Cloud Functions parameters. |
| `server/errors.ts` | 7 | `HttpError` class. | Preserved for Cloud Functions HTTP error mapping. |
| `server/unsubscribe.ts` | 60 | Signed one-click unsubscribe token generator and verifier. | Cloud Function with HMAC verification. |
| `server/dev.ts` | 7 | Development entry point seeding demo accounts and setting default dev ports. | Maintained for local mock mode. |
| `server/index.ts` | 112 | Main production server entry point. | Replaced by Firebase infrastructure. |
| `server/host.ts` | 14 | Local single-machine demo runner. | Maintained. |

### 2.3 Frontend Core Modules (`/src/`)
| Directory / File | Lines | Responsibility | Migration Relevance |
|---|---|---|---|
| `src/main.tsx` | 13 | React entry point mounting `App` and loading styles. | Preserved 100%. |
| `src/App.tsx` | 128 | React Router configuration, session initialization, real-time SSE listener binding, and route guards. | Update SSE listener to Firestore `onSnapshot`. |
| `src/store/app.ts` | 468 | Zustand global store: active org, active project, optimistic updates, active modals, and data cache. | Seamlessly driven by `Repository` interface. |
| `src/data/repository.ts` | 109 | `Repository` interface defining 35 data-access contracts. UI only talks to this abstraction. | **Core Migration Bridge**: Write `FirebaseRepository` implementing this exact interface. |
| `src/data/apiRepository.ts` | 285 | `ApiRepository`: HTTP/RPC client implementation of `Repository` communicating with Fastify. | Kept during transition; swapped with `FirebaseRepository`. |
| `src/data/localRepository.ts` | 1580 | Full client-side repository implementation with local evaluation of automations, formulas, and queries. | Reference implementation for Firestore client operations. |
| `src/data/seed.ts` | 460 | Initial seed generator for demo organizations (Acme Corp, Northwind Traders) and projects. | Used to build Firestore seed / emulator seed. |
| `src/domain/` (22 files) | ~6,500 | Pure domain logic: permissions (`permissions.ts`), workflow state machines (`workflow.ts`), ranking (`rank.ts`), automations (`automation.ts`), search (`query.ts`), forecasting (`forecast.ts`), reports (`reports.ts`), notifications (`notifyPrefs.ts`), timezones (`timeZone.ts`). | **100% reusable code**. Zero backend framework dependencies. |
| `src/pages/` (17 files) | ~7,200 | Top-level page views: `BoardView`, `ListView`, `TimelineView`, `BacklogView`, `InsightsView`, `FormsView`, `AutomationView`, `SettingsPage`, `Members`, `Inbox`, `Home`, `Portfolio`, `AuthPages`, `PublicForm`. | **100% preserved**. No UI redesign required. |
| `src/components/` (24 files) | ~5,800 | Modular UI components: `IssueDetail`, `CreateIssueModal`, `Dashboard`, `ColumnMenu`, `Copilot`, `Attachments`, `AiSummary`, `Briefing`, `Billing`, `Integrations`, `DataAndAudit`, etc. | **100% preserved**. |

---

## 3. Production, Development, Mock & Demo Analysis

The inspection confirms the following state:

| Component | Current Implementation | Production Reality | Target Firebase Native Equivalent |
|---|---|---|---|
| **Database** | Dual: `@electric-sql/pglite` (dev/test) & `pg` (prod) | In production, requires external PostgreSQL instance (`DATABASE_URL`). Relies on single-process memory lock. | Cloud Firestore (multi-region, automated scaling, zero lock bottlenecks). |
| **Authentication** | Custom Scrypt hashes + `sessions` table + HTTP-only cookies | Real authentication with brute-force rate limiters, but custom-maintained; no MFA hardware keys; no built-in OAuth providers. | Firebase Authentication (Email/Password, Google, Microsoft OIDC, TOTP MFA). |
| **Single Sign-On** | `MockSsoProvider` | **MOCK ONLY**. Refused in production unless `ALLOW_MOCK_SERVICES=1`. Simulates login via `/api/sso/mock/authorize`. | Firebase Authentication with Google and Microsoft OAuth/OIDC providers configured. |
| **Billing & Payments** | `MockBillingProvider` | **MOCK ONLY**. Records pretend charges into `mock_invoices` table. Real plan limits enforced in code. | Stripe integration via Cloud Functions + Stripe Webhook handlers updating Firestore. |
| **AI Summaries & Briefings** | `MockAiProvider` | **MOCK ONLY**. Returns deterministic templated strings; no external LLM called. | Cloud Functions calling Gemini 1.5/2.0 Flash or Claude API with strict server-side validation. |
| **Email Delivery** | `ConsoleMailer` / `Nodemailer` | `ConsoleMailer` logs to terminal in dev. `Nodemailer` requires external SMTP server (`SMTP_URL`). | Firebase Trigger Email extension / Cloud Functions using SendGrid/Postmark. |
| **File Storage** | `FileStore` | Stores raw files on local container filesystem (`server-files/`). Not scalable across multiple instances. | Cloud Storage for Firebase with Storage Security Rules. |
| **Real-time Updates** | `LiveBus` (Server-Sent Events) | In-process memory event bus. Cannot coordinate across multiple server instances without Redis / LISTEN-NOTIFY. | Cloud Firestore real-time snapshots (`onSnapshot`) natively synchronizing all clients. |
| **Job Scheduling** | Node `setInterval` in `server/index.ts` | Runs in-process timers for `remindDue`, `NotificationEmailer`, `files.sweep`, and `purgeExpired`. Vulnerable to server crashes. | Cloud Scheduler invoking authenticated HTTPS Cloud Functions. |

---

## 4. Build and Test Baseline Verification

### 4.1 Type Checking & Linting (`npm run lint`)
- **Command:** `tsc --noEmit && tsc --noEmit -p server`
- **Result:** **PASSED (Exit code 0)**.
- **Evidence:** Both frontend (`tsconfig.json`) and backend (`server/tsconfig.json`) type-check with zero diagnostics.

### 4.2 Production Bundle Build (`npm run build`)
- **Command:** `tsc --noEmit && tsc --noEmit -p server && vite build`
- **Result:** **PASSED (Exit code 0)**.
- **Artifacts:**
  - `dist/index.html` (1.30 kB)
  - `dist/assets/index-BcvrZo86.css` (33.93 kB)
  - `dist/assets/index-BbzlO-1a.js` (688.68 kB)
  - All page and feature chunks successfully emitted.

### 4.3 Automated Test Suite (`npm test`)
- **Unit & Domain Tests (`vitest run src`):**
  - **Result:** **20 test files passed, 214 tests passed (100% pass rate)**.
  - Covers: repository operations, automations, custom fields, dashboard stats, rankings, timezones, approvals, permissions, notify preferences, CSV imports, and attachments.
- **Server Integration Tests (`vitest run server`):**
  - **Result:** 60+ end-to-end integration tests in `server/server.test.ts` pass, testing accounts, session cookies, rate limiting, PGlite transactions, tenant isolation, file uploads, thumbnailing, public forms, webhooks, and mock providers.

---

## 5. Architectural Findings & Migration Impact

1. **Clean Decoupling via `Repository` Interface:**  
   The application was architected around `Repository` (`src/data/repository.ts`). Because the entire React UI only calls this interface and the Zustand store, the frontend can transition to Firebase without touching UI components.
2. **Elimination of Single-Process Lock:**  
   The existing backend relies on a global JavaScript promise chain `locked(...)` to serialize database access because `LocalRepository` in Fastify operates on an in-memory snapshot. Firestore transactions and document-level concurrency will completely eliminate this scalability bottleneck.
3. **Elimination of Custom SSE Bus:**  
   The current `LiveBus` requires open long-lived HTTP connections that do not scale well on serverless containers. Firestore's built-in WebSocket listener protocol handles real-time synchronization out of the box with zero server maintenance.
