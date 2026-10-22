# ABG Tracker V2 — Complete Data Migration Map: PostgreSQL to Cloud Firestore

This document maps every existing PostgreSQL table, JSONB collection, relationship, constraint, and index in ABG Tracker V2 to an optimized, scalable Cloud Firestore document architecture.

---

## 1. Relational to Document Architecture Strategy

### 1.1 Structural Recommendation: Subcollection-First Multi-Tenancy
Rather than flattening everything into root collections with an `orgId` attribute (which complicates Security Rules and collection listing), we recommend a **hierarchical subcollection structure**:

```
/users/{userId}                           (Global user profiles & preferences)
/users/{userId}/private/secrets           (Private user data, recovery codes)
/users/{userId}/api_tokens/{tokenId}      (API access tokens)
/users/{userId}/sessions/{sessionId}      (Device session tracking)

/organizations/{orgId}                    (Tenant boundary & configuration)
  ├── memberships/{userId}                (Membership, role, join date)
  ├── invites/{inviteId}                  (Pending organization invitations)
  ├── audit_log/{auditId}                 (Immutable organization audit trail)
  ├── webhooks/{webhookId}                (Webhook subscriptions & secrets)
  ├── invoices/{invoiceId}                (Billing history & receipts)
  ├── notifications/{notificationId}      (User inbox items scoped to tenant)
  ├── forms/{formId}                      (Intake form definitions)
  ├── filters/{filterId}                  (Saved personal & shared search filters)
  ├── attachments/{attachmentId}          (File metadata records)
  └── projects/{projectId}                (Workspace / Project boundary)
        ├── issues/{issueId}              (Work items, tasks, epics, bugs)
        │     └── comments/{commentId}    (Comment threads & emoji reactions)
        ├── sprints/{sprintId}            (Agile sprint cycles)
        ├── rules/{ruleId}                (Automation rule definitions)
        └── runs/{runId}                  (Automation execution log)
```

### 1.2 Rationale:
1. **Security Rule Simplification:** By nesting data under `/organizations/{orgId}`, Security Rules can evaluate membership once using `get(/databases/$(database)/documents/organizations/$(orgId)/memberships/$(request.auth.uid))` or custom claims, cleanly preventing cross-tenant leakage.
2. **Atomic Organization Purges:** During tenant deletion, Cloud Functions can recursively delete `/organizations/{orgId}` without scanning millions of documents in global collections.
3. **High-Volume Issue & Comment Segregation:** Nesting comments under `/issues/{issueId}/comments` prevents issues from exceeding the 1 MB Firestore document limit when thousands of comments accumulate.

---

## 2. Detailed Entity-by-Entity Mapping

### 2.1 Users & Identity Mapping
| Relational Schema (PostgreSQL) | Target Firestore Schema | Notes & Strategy |
|---|---|---|
| **Table:** `users` (JSONB `data`) + `credentials`<br>- `id` (text PK)<br>- `data->>'email'` (unique text)<br>- `data->>'name'` (text)<br>- `data->>'color'` (hex text)<br>- `data->'notify'` (JSONB)<br>- `data->'dashboard'` (JSONB)<br>- `credentials.password_hash` (scrypt text) | **Collection:** `/users/{uid}`<br>- `uid` (string, matches Firebase Auth UID)<br>- `email` (string, lowercase, indexed)<br>- `name` (string)<br>- `color` (string)<br>- `notify` (map: `{ email, scope, mutedProjects, timeZone, dueLeadDays }`)<br>- `dashboard` (map: `{ widgets: [...] }`)<br>- `createdAt` (timestamp)<br>- `updatedAt` (timestamp) | **Identity Transition:** Password hashes are migrated to Firebase Auth via Firebase CLI Auth Import (`firebase auth:import --hash-algo=SCRYPT`). Client ID matches `request.auth.uid`. |
| **Table:** `sessions`<br>- `token_hash` (text PK)<br>- `user_id` (text)<br>- `created_at` (timestamptz)<br>- `expires_at` (timestamptz)<br>- `user_agent` (text)<br>- `ip` (text) | **Collection:** `/users/{uid}/sessions/{sessionId}`<br>- `sessionId` (string)<br>- `device` (string, parsed device name)<br>- `ip` (string)<br>- `createdAt` (timestamp)<br>- `lastSeenAt` (timestamp) | Firebase Auth natively handles session tokens via refresh tokens. This collection is maintained only for displaying active device lists in account settings. |
| **Table:** `two_factor` + `recovery_codes`<br>- `user_id` (text PK)<br>- `secret_enc` (text)<br>- `enabled` (boolean)<br>- `recovery_codes.code_hash` (text) | **Collection:** `/users/{uid}/private/2fa`<br>- `enabled` (boolean)<br>- `enrolledFactors` (array)<br>- `recoveryCodes` (array of hashed strings) | Replaced natively by Firebase Multi-Factor Authentication (MFA). Legacy recovery codes stored encrypted or regenerated on enrollment. |

### 2.2 Organizations & Memberships
| Relational Schema (PostgreSQL) | Target Firestore Schema | Notes & Strategy |
|---|---|---|
| **Table:** `organizations` (JSONB `data`)<br>- `id` (text PK)<br>- `data->>'name'` (text)<br>- `data->>'slug'` (unique text)<br>- `data->>'plan'` (`free\|team\|business`)<br>- `data->>'createdAt'` (timestamptz) | **Document:** `/organizations/{orgId}`<br>- `id` (string PK, e.g. `org_9a8f2c`)<br>- `name` (string)<br>- `slug` (string, unique lowercase)<br>- `plan` (string: `'free'`, `'team'`, `'business'`)<br>- `stripeCustomerId` (string, optional)<br>- `stripeSubscriptionId` (string, optional)<br>- `createdAt` (timestamp)<br>- `updatedAt` (timestamp) | **Slug Lookup:** To look up orgs by slug without full scans, maintain a lookup document `/slugs/{slug}` pointing to `{ orgId }` with atomic write constraints. |
| **Table:** `memberships` (JSONB `data`)<br>- `id` (text PK)<br>- `org_id` (text)<br>- `data->>'userId'` (text)<br>- `data->>'role'` (`owner\|admin\|member\|guest`) | **Document:** `/organizations/{orgId}/memberships/{uid}`<br>- `userId` (string, matches Auth UID)<br>- `role` (string: `'owner'`, `'admin'`, `'member'`, `'guest'`)<br>- `orgId` (string)<br>- `joinedAt` (timestamp)<br>- `invitedBy` (string) | **Subcollection Keying:** Document ID is set to `uid` (user's ID), enabling instant $O(1)$ membership and permission checks in Security Rules: `get(/databases/$(db)/documents/organizations/$(orgId)/memberships/$(request.auth.uid))`. |
| **Table:** `invites`<br>- `id` (text PK)<br>- `org_id` (text)<br>- `email` (text)<br>- `role` (text)<br>- `token_hash` (text unique)<br>- `invited_by` (text)<br>- `expires_at` (timestamptz)<br>- `accepted_at` (timestamptz) | **Document:** `/organizations/{orgId}/invites/{inviteId}`<br>- `id` (string PK)<br>- `email` (string, lowercase)<br>- `role` (string)<br>- `tokenHash` (string, SHA256 of invite link token)<br>- `invitedBy` (string)<br>- `createdAt` (timestamp)<br>- `expiresAt` (timestamp)<br>- `acceptedAt` (timestamp or null) | Read allowed only for org admins. Accepting an invite is handled via a trusted Cloud Function to guarantee atomic seat verification and membership creation. |

### 2.3 Workspaces, Projects & Sprints
| Relational Schema (PostgreSQL) | Target Firestore Schema | Notes & Strategy |
|---|---|---|
| **Table:** `projects` (JSONB `data`)<br>- `id` (text PK)<br>- `org_id` (text)<br>- `data->>'key'` (text)<br>- `data->>'name'` (text)<br>- `data->>'description'` (text)<br>- `data->>'color'` (text)<br>- `data->>'workStyle'` (`agile\|flow\|business`)<br>- `data->'statuses'` (array of Status objects)<br>- `data->'issueTypes'` (array of IssueType objects)<br>- `data->'workflow'` (Workflow object)<br>- `data->'customFields'` (array of CustomFieldDef)<br>- `data->>'leadId'` (text)<br>- `data->>'nextNumber'` (integer counter)<br>- `data->>'createdAt'` (timestamptz) | **Document:** `/organizations/{orgId}/projects/{projectId}`<br>- `id` (string PK, e.g. `proj_12ab34`)<br>- `orgId` (string)<br>- `key` (string, uppercase, e.g. `'PLT'`)<br>- `name` (string)<br>- `description` (string)<br>- `color` (string)<br>- `workStyle` (string)<br>- `statuses` (array of maps: `[{ id, name, category }]`)<br>- `issueTypes` (array of maps: `[{ id, name, icon, color, level, kind }]`)<br>- `workflow` (map: `{ restrict, transitions, rules }`)<br>- `customFields` (array of maps)<br>- `leadId` (string)<br>- `nextNumber` (integer, atomic counter)<br>- `createdAt` (timestamp)<br>- `updatedAt` (timestamp) | **Embedded vs Separate:** Statuses, issue types, and workflow rules are small, fixed-size definitions embedded directly in the project document to allow single-document read for board rendering. `nextNumber` is updated in a transaction on issue creation. |
| **Table:** `sprints` (JSONB `data`)<br>- `id` (text PK)<br>- `org_id` (text)<br>- `data->>'projectId'` (text)<br>- `data->>'name'` (text)<br>- `data->>'goal'` (text)<br>- `data->>'startDate'` (text)<br>- `data->>'endDate'` (text)<br>- `data->>'state'` (`planned\|active\|completed`)<br>- `data->>'committedPoints'` (number)<br>- `data->>'completedPoints'` (number)<br>- `data->>'startedAt'` (timestamptz)<br>- `data->>'completedAt'` (timestamptz) | **Document:** `/organizations/{orgId}/projects/{projectId}/sprints/{sprintId}`<br>- `id` (string PK)<br>- `orgId` (string)<br>- `projectId` (string)<br>- `name` (string)<br>- `goal` (string)<br>- `startDate` (string or timestamp)<br>- `endDate` (string or timestamp)<br>- `state` (string: `'planned'`, `'active'`, `'completed'`)<br>- `committedPoints` (number)<br>- `completedPoints` (number)<br>- `startedAt` (timestamp)<br>- `completedAt` (timestamp)<br>- `createdAt` (timestamp) | Subcollection under `projects`. Query pattern: `where('state', 'in', ['planned', 'active'])` for backlog and sprint views. |

### 2.4 Work Items (Issues), Comments & Approvals
| Relational Schema (PostgreSQL) | Target Firestore Schema | Notes & Strategy |
|---|---|---|
| **Table:** `issues` (JSONB `data`)<br>- `id` (text PK)<br>- `org_id` (text)<br>- `data->>'projectId'` (text)<br>- `data->>'key'` (text, e.g. `PLT-101`)<br>- `data->>'number'` (integer)<br>- `data->>'typeId'` (text)<br>- `data->>'title'` (text)<br>- `data->>'description'` (text)<br>- `data->>'statusId'` (text)<br>- `data->>'priority'` (enum)<br>- `data->>'assigneeId'` (text null)<br>- `data->>'reporterId'` (text)<br>- `data->>'parentId'` (text null)<br>- `data->'labels'` (array of text)<br>- `data->>'estimate'` (number null)<br>- `data->>'startDate'` (text null)<br>- `data->>'dueDate'` (text null)<br>- `data->'customFields'` (map)<br>- `data->>'sprintId'` (text null)<br>- `data->'blockedBy'` (array of issue IDs)<br>- `data->'approval'` (Approval map)<br>- `data->'source'` (IssueSource map)<br>- `data->'watcherIds'` (array of user IDs)<br>- `data->>'rank'` (float fractional rank)<br>- `data->>'createdAt'` (timestamptz)<br>- `data->>'updatedAt'` (timestamptz)<br>- `data->>'resolvedAt'` (timestamptz null) | **Document:** `/organizations/{orgId}/projects/{projectId}/issues/{issueId}`<br>- Identical schema with Firestore-native timestamps for `createdAt`, `updatedAt`, `resolvedAt`.<br>- Array fields: `labels`, `blockedBy`, `watcherIds`.<br>- Maps: `customFields`, `approval`, `source`.<br>- Numeric fractional ranking: `rank` (double). | **Collection Group Queries:** For cross-project views (e.g. "My Assigned Work", "Due Soon", "All Project Search"), use collection group `issues` with filter: `where('orgId', '==', activeOrgId).where('assigneeId', '==', uid)`. Requires composite indexes. |
| **Table:** `comments` (JSONB `data`)<br>- `id` (text PK)<br>- `org_id` (text)<br>- `data->>'issueId'` (text)<br>- `data->>'authorId'` (text)<br>- `data->>'body'` (text)<br>- `data->'mentions'` (array of user IDs)<br>- `data->'reactions'` (map: emoji -> array of UIDs)<br>- `data->>'createdAt'` (timestamptz) | **Document:** `/organizations/{orgId}/projects/{projectId}/issues/{issueId}/comments/{commentId}`<br>- `id` (string PK)<br>- `issueId` (string)<br>- `authorId` (string)<br>- `body` (string)<br>- `mentions` (array of strings)<br>- `reactions` (map: `{ '👍': ['uid1', 'uid2'] }`)<br>- `createdAt` (timestamp) | Stored as a subcollection under the issue document to prevent document size exhaustion. Real-time updates bound via `onSnapshot` on the subcollection. |

### 2.5 File Attachments & File Metadata
| Relational Schema (PostgreSQL) | Target Firestore & Storage Schema | Notes & Strategy |
|---|---|---|
| **Table:** `attachments` (JSONB `data`)<br>- `id` (text PK)<br>- `org_id` (text)<br>- `data->>'projectId'` (text)<br>- `data->>'issueId'` (text)<br>- `data->>'commentId'` (text null)<br>- `data->>'externalName'` (text null)<br>- `data->>'name'` (text)<br>- `data->>'size'` (integer bytes)<br>- `data->>'mime'` (text)<br>- `data->>'uploaderId'` (text)<br>- `data->>'createdAt'` (timestamptz)<br>- `data->>'storageKey'` (text)<br>- `data->>'sha256'` (text) | **Document:** `/organizations/{orgId}/attachments/{attachmentId}`<br>- Metadata matching domain model.<br>- `storagePath`: `/organizations/{orgId}/files/{attachmentId}/{cleanedName}`<br>- `thumbnailPath`: `/organizations/{orgId}/thumbs/{attachmentId}.webp`<br><br>**Cloud Storage Object:**<br>`gs://<bucket>/organizations/{orgId}/files/{attachmentId}/{name}` | Files stored directly in Cloud Storage for Firebase. Firestore holds verified metadata. Storage Security Rules grant read/write access based on Firestore organization membership. |

### 2.6 Activity, Notifications, Webhooks & System Tables
| Relational Schema (PostgreSQL) | Target Firestore Schema | Notes & Strategy |
|---|---|---|
| **Table:** `activity` (JSONB `data`)<br>- Audit logs of issue updates | **Document:** `/organizations/{orgId}/projects/{projectId}/issues/{issueId}/activity/{activityId}` or `/organizations/{orgId}/activity/{activityId}` | Append-only activity stream. |
| **Table:** `notifications` (JSONB `data`)<br>- In-app Inbox items | **Document:** `/organizations/{orgId}/notifications/{notificationId}`<br>- Indexed on `userId`, `read`, `createdAt` desc. | Scoped to organization; user reads their own notifications: `where('userId', '==', uid)`. |
| **Table:** `audit_log`<br>- Access changes, plan changes, deletions | **Document:** `/organizations/{orgId}/audit_log/{auditId}`<br>- Fields: `actorId`, `action`, `detail`, `at`. | Write restricted to trusted Cloud Functions; read restricted to org Owner/Admin. |
| **Table:** `webhooks`<br>- Webhook endpoints & signing secrets | **Document:** `/organizations/{orgId}/webhooks/{webhookId}`<br>- Fields: `url`, `secret` (encrypted or write-only), `events`, `format`, `active`, `lastStatus`. | Security Rules allow only org admins to read/write. |
| **Table:** `api_tokens`<br>- Personal access tokens | **Document:** `/users/{uid}/api_tokens/{tokenId}`<br>- Fields: `name`, `scope`, `tokenHash`, `hint`, `createdAt`, `lastUsedAt`. | Stored under private user subcollection. |
| **Table:** `forms`<br>- Public intake forms | **Document:** `/organizations/{orgId}/forms/{formId}` | Public read of sanitized schema handled via Cloud Function or public read-only collection. |
| **Table:** `rules` & `runs`<br>- Automations & execution history | **Document:** `/organizations/{orgId}/projects/{projectId}/rules/{ruleId}`<br>- Execution runs in subcollection `.../runs/{runId}`. | Cap run history at 100 entries per rule using automated pruning. |

---

## 3. Required Firestore Composite Indexes

To support all existing filter and sorting queries without runtime indexing errors, the following composite indexes must be defined in `firestore.indexes.json`:

```json
{
  "indexes": [
    {
      "collectionGroup": "issues",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "orgId", "order": "ASCENDING" },
        { "fieldPath": "assigneeId", "order": "ASCENDING" },
        { "fieldPath": "dueDate", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "issues",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "orgId", "order": "ASCENDING" },
        { "fieldPath": "assigneeId", "order": "ASCENDING" },
        { "fieldPath": "statusId", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "issues",
      "queryScope": "COLLECTION_GROUP",
      "fields": [
        { "fieldPath": "orgId", "order": "ASCENDING" },
        { "fieldPath": "projectId", "order": "ASCENDING" },
        { "fieldPath": "rank", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "issues",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "projectId", "order": "ASCENDING" },
        { "fieldPath": "sprintId", "order": "ASCENDING" },
        { "fieldPath": "rank", "order": "ASCENDING" }
      ]
    },
    {
      "collectionGroup": "notifications",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "userId", "order": "ASCENDING" },
        { "fieldPath": "read", "order": "ASCENDING" },
        { "fieldPath": "createdAt", "order": "DESCENDING" }
      ]
    },
    {
      "collectionGroup": "audit_log",
      "queryScope": "COLLECTION",
      "fields": [
        { "fieldPath": "at", "order": "DESCENDING" }
      ]
    }
  ],
  "fieldOverrides": []
}
```

---

## 4. Transactional & Concurrency Considerations

1. **Issue Key Generation (`PLT-101`):**  
   PostgreSQL uses in-memory lock `locked(...)` and updates `project.nextNumber`. In Firestore, this requires an atomic `runTransaction` on `/organizations/{orgId}/projects/{projectId}` to read `nextNumber`, increment it, and create the issue document in a single atomic commit.
2. **Fractional Ranking:**  
   The fractional ranking algorithm in `src/domain/rank.ts` calculates a float value between adjacent items. Firestore handles 64-bit IEEE double floats natively, preserving rank precision without requiring re-indexing locks.
3. **Seat Limit Enforcement:**  
   Before adding a member or creating an invite, a Cloud Function checks the organization plan and queries current active seats (`memberships` count + active unexpired `invites` count) in a transaction.
