# ABG Tracker V2 — Deployment, Infrastructure & Environment Architecture

## 1. Multi-Environment Infrastructure Strategy

The target deployment operates across three isolated environments:

| Attribute | Development (Local) | Staging | Production |
|---|---|---|---|
| **Purpose** | Local feature development, automated CI tests | Pre-release validation, load tests, penetration testing | Live customer traffic & tenant data |
| **GCP / Firebase Project** | `abg-tracker-dev` (or Local Emulators) | `abg-tracker-staging` | `abg-tracker-prod` |
| **Frontend Hosting** | Vite dev server (`http://localhost:3000`) | Firebase Hosting preview channels | Firebase Hosting (custom domain e.g. `tracker.abg.dev`) |
| **Authentication** | Firebase Auth Local Emulator | Firebase Auth (Staging tenant) | Firebase Auth (Multi-tenant, Google & Microsoft IdPs) |
| **Database** | Cloud Firestore Emulator | Cloud Firestore (`asia-southeast1` or `nam5`) | Cloud Firestore (Multi-region `nam5` / `eur3`) |
| **Storage** | Cloud Storage Emulator | Cloud Storage bucket (`abg-staging-files`) | Cloud Storage bucket (`abg-prod-files`) |
| **Backend Compute** | Cloud Functions Emulator | Cloud Functions v2 (Node 22) | Cloud Functions v2 (Node 22, min instances: 1) |
| **Third-Party Services** | Mock billing, mock AI, console mail | Stripe Test Mode, Gemini sandbox, Mailtrap/SendGrid test | Live Stripe keys, production Gemini API, SendGrid/Postmark |

---

## 2. Component-by-Component Service Blueprint

### 2.1 Frontend: Firebase Hosting
- **Asset Directory:** `dist/` (emitted by `npm run build` using Vite 8).
- **Single Page App Routing:** `firebase.json` configured with rewrite rule:
  ```json
  {
    "hosting": {
      "public": "dist",
      "ignore": ["firebase.json", "**/.*", "**/node_modules/**"],
      "rewrites": [
        { "source": "/api/**", "function": "apiRouter" },
        { "source": "**", "destination": "/index.html" }
      ],
      "headers": [
        {
          "source": "/assets/**",
          "headers": [
            { "key": "Cache-Control", "value": "public, max-age=31536000, immutable" }
          ]
        },
        {
          "source": "**",
          "headers": [
            { "key": "X-Content-Type-Options", "value": "nosniff" },
            { "key": "X-Frame-Options", "value": "DENY" },
            { "key": "Referrer-Policy", "value": "no-referrer" }
          ]
        }
      ]
    }
  }
  ```

### 2.2 Identity & Access: Firebase Authentication
- **Sign-in Providers:**
  1. **Email / Password**: With email verification required for public org creation.
  2. **Google Sign-in**: Standard OAuth 2.0 Web Client configured in Google Cloud Console.
  3. **Microsoft Sign-in**: OpenID Connect / Microsoft Graph provider configured with Azure AD App Registration (tenant: `common` or corporate tenant).
  4. **Multi-Factor Authentication (MFA)**: TOTP / Authenticator App enabled via Identity Platform.

### 2.3 Primary Data: Cloud Firestore
- **Location:** Multi-region (e.g. `nam5` for North America or regional `asia-southeast1` based on customer data residency).
- **Database Mode:** Native mode.
- **Backup & Recovery:** Daily automated Cloud Firestore exports to a dedicated Cloud Storage backup bucket with 30-day lifecycle retention. Point-in-time recovery (PITR) enabled.

### 2.4 Private File Storage: Cloud Storage for Firebase
- **Bucket Configuration:** Uniform bucket-level access enabled.
- **Location:** Paired with Firestore region to reduce egress latency.
- **CORS Configuration:** Restrict `PUT` and `GET` requests strictly to application origins (`https://*.firebaseapp.com`, `https://*.web.app`, and custom domain).

### 2.5 Trusted Server-Side Compute: Cloud Functions v2
Grouped into modular function units:

1. **`apiRouter` (HTTPS Express/Fastify-compatible handler):**  
   Handles external public endpoints:
   - Public API v1 (`/api/v1/*`)
   - Calendar feed (`/api/cal/:file.ics`)
   - Public intake submissions (`/api/public/submit`)
   - Stripe webhooks (`/api/billing/webhook`)
   - Unsubscribe links (`/api/unsubscribe/:token`)
2. **Callable Functions (`https.onCall`):**  
   Privileged tenant actions with automatic token verification:
   - `createOrganizationInvite` / `acceptOrganizationInvite`
   - `deleteOrganization` / `deleteUserAccount`
   - `changeOrganizationPlan`
   - `generateIssueSummary` / `getDailyBriefing`
   - `exportOrganizationData`
3. **Background Event Triggers (`firestore.onDocumentWritten`):**  
   - `onIssueCreated` / `onIssueUpdated`: Generates audit logs, triggers outbound webhooks, evaluates automations.
   - `onCommentCreated`: Parses `@mentions`, creates in-app notification items.
4. **Scheduled Functions (`scheduler.onSchedule`):**  
   - `triggerDueReminders` (Daily, evaluates items due in user timezones).
   - `sendNotificationEmails` (Every 5 minutes, delivers batched notification emails).
   - `pruneOrphanedUploads` (Daily, cleans unattached files older than 24 hours).

---

## 3. Secret Management & Environment Variables

| Variable Name | Storage Location | Sensitivity | Description |
|---|---|---|---|
| `STRIPE_SECRET_KEY` | Google Secret Manager | Critical | Stripe API secret key for payment processing. |
| `STRIPE_WEBHOOK_SECRET` | Google Secret Manager | Critical | Secret for verifying incoming Stripe webhook signatures. |
| `GEMINI_API_KEY` | Google Secret Manager | High | Google AI Studio / Gemini API key for summaries and daily briefings. |
| `SMTP_URL` or `SENDGRID_API_KEY` | Google Secret Manager | High | Credentials for outgoing email delivery. |
| `WEBHOOK_SIGNING_KEY` | Google Secret Manager | High | Master key for signing outbound webhooks. |
| `PUBLIC_URL` | Cloud Function Parameter | Low | Public URL for invitation and calendar links. |

---

## 4. Quotas, Billing & Capacity Planning

1. **Firebase Blaze Plan Requirement:**  
   Cloud Functions v2 and external network egress (Stripe, SendGrid, external webhook endpoints) require the pay-as-you-go **Blaze Plan**.
2. **Firestore Free Tier & Quotas:**  
   - Free tier includes 50k reads, 20k writes, 20k deletes/day and 1 GiB storage.
   - Scalable to millions of documents; rate-limited writes per document (max 1 write/sec per document) require distributed counters for high-velocity metrics.
3. **Cloud Functions Limits:**  
   - Memory allocation: 512 MiB - 1 GiB for image resizing/thumbnail operations.
   - Concurrency: Set to 80 requests per instance for `apiRouter` to optimize cost.
