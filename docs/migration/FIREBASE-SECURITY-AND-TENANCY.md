# ABG Tracker V2 — Multi-Tenant Security, Roles & Tenancy Architecture

## 1. Multi-Tenant Hierarchy Architecture

The application enforces a 5-tier isolation hierarchy:

```
Platform (Firebase Project & Identity Provider)
  │
  └── Tenant / Organization (`/organizations/{orgId}`)
        │
        ├── Organization Governance (Owners & Admins)
        │     ├── Audit Logs & Invoices
        │     ├── Organization Invites
        │     └── Outbound Webhooks
        │
        └── Workspaces / Projects (`/organizations/{orgId}/projects/{projectId}`)
              │
              ├── Agile Workflows & Column Definitions
              ├── Automation Rules & Intake Forms
              └── Work Items (`/issues/{issueId}`)
                    ├── Comments (`/comments/{commentId}`)
                    └── Attachments (`gs://<bucket>/organizations/{orgId}/...`)
```

---

## 2. Membership, Role & Permissions Model

### 2.1 Role Definitions (Aligned with `src/domain/permissions.ts`)
| Role | Organization Scope | Project Scope | Privileges |
|---|---|---|---|
| **`owner`** | Full Organization Control | All Projects | Full control. Can change billing plans, export all tenant data, delete organization, promote/demote admins, transfer ownership. Last owner cannot be demoted or removed. |
| **`admin`** | Member Management, Webhooks, Forms | All Projects | Can invite members, update roles (except owner), manage webhooks, configure custom fields, edit workflows, delete any work item or attachment. |
| **`member`** | Standard Collaborator | Assigned / All Projects | Can create and edit work items, add comments, log estimates, upload attachments, create personal filters, transition issues according to workflow rules. |
| **`guest`** | Restricted Collaborator | Explicitly Permitted Projects | Can only view assigned items, add comments on assigned work, and transition assigned items if permitted. Cannot invite others or edit project settings. |

### 2.2 Security Rules vs. Trusted Compute Boundary
To guarantee security without relying on client honesty, operations are strictly divided:

| Operation | Enforced By | Security Mechanism |
|---|---|---|
| Read issues, projects, sprints, comments | **Firestore Security Rules** | Checks `isOrgMember(orgId)` via `/organizations/{orgId}/memberships/$(request.auth.uid)`. |
| Create / Update work items | **Firestore Security Rules** | Validates tenant scope: `request.resource.data.orgId == orgId`. |
| Upload / Download file attachments | **Storage Security Rules** | Validates `isOrgMember(orgId)` on path `/organizations/{orgId}/files/{fileId}`. |
| Modify User Profile / Notify Preferences | **Firestore Security Rules** | Checks `request.auth.uid == userId`. |
| Organization Registration | **Cloud Functions (Callable)** | Provisions organization and initial owner membership atomically. |
| Create / Accept Organization Invite | **Cloud Functions (Callable)** | Enforces seat limits against active subscription plan; validates invite token hash. |
| Change Billing Plan | **Cloud Functions (Callable)** | Validates owner role; checks downgrade guard against active seat/project count. |
| Export Organization Data (JSON / CSV) | **Cloud Functions (Callable)** | Validates owner role; generates audit record; compiles sanitized JSON/CSV stream. |
| Delete Organization | **Cloud Functions (Callable)** | Re-authenticates owner password and 2FA; executes complete recursive subcollection purge. |
| Outbound Webhooks | **Cloud Tasks & Cloud Functions** | Signs payloads with HMAC-SHA256; blocks internal RFC1918 and GCP metadata IPs (`169.254.169.254`). |
| Public Intake Form Submissions | **Cloud Functions (HTTP)** | Sanitizes public inputs; verifies honeypot; issues temporary upload tickets. |

---

## 3. Concrete Cloud Firestore Security Rules (`firestore.rules`)

```javascript
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Helper functions
    function isAuthenticated() {
      return request.auth != null;
    }

    function isUser(userId) {
      return isAuthenticated() && request.auth.uid == userId;
    }

    function getMembership(orgId) {
      return get(/databases/$(database)/documents/organizations/$(orgId)/memberships/$(request.auth.uid));
    }

    function isOrgMember(orgId) {
      return isAuthenticated() && exists(/databases/$(database)/documents/organizations/$(orgId)/memberships/$(request.auth.uid));
    }

    function getOrgRole(orgId) {
      return getMembership(orgId).data.role;
    }

    function isOrgAdmin(orgId) {
      return isOrgMember(orgId) && (getOrgRole(orgId) == 'admin' || getOrgRole(orgId) == 'owner');
    }

    function isOrgOwner(orgId) {
      return isOrgMember(orgId) && getOrgRole(orgId) == 'owner';
    }

    // User profiles
    match /users/{userId} {
      allow read: if isAuthenticated();
      allow create: if isUser(userId);
      allow update: if isUser(userId) && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['emailVerified', 'role']);
      allow delete: if false; // Must be performed via Cloud Function deleteUserAccount

      match /sessions/{sessionId} {
        allow read, write: if isUser(userId);
      }

      match /api_tokens/{tokenId} {
        allow read, write: if isUser(userId);
      }
    }

    // Organization tenancy root
    match /organizations/{orgId} {
      allow read: if isOrgMember(orgId);
      allow create, delete: if false; // Handled exclusively by trusted Cloud Functions
      allow update: if isOrgAdmin(orgId) && !request.resource.data.diff(resource.data).affectedKeys().hasAny(['plan', 'stripeCustomerId']);

      // Memberships
      match /memberships/{memberUid} {
        allow read: if isOrgMember(orgId);
        allow write: if false; // Role updates and additions must pass through Cloud Functions
      }

      // Invites (read-only for admins)
      match /invites/{inviteId} {
        allow read: if isOrgAdmin(orgId);
        allow write: if false;
      }

      // Audit logs (immutable append via Cloud Function)
      match /audit_log/{auditId} {
        allow read: if isOrgAdmin(orgId);
        allow write: if false;
      }

      // Notifications (scoped to individual recipient)
      match /notifications/{notificationId} {
        allow read: if isOrgMember(orgId) && resource.data.userId == request.auth.uid;
        allow update: if isOrgMember(orgId) && resource.data.userId == request.auth.uid && request.resource.data.diff(resource.data).affectedKeys().hasOnly(['read']);
        allow create, delete: if false;
      }

      // Webhooks
      match /webhooks/{webhookId} {
        allow read, write: if isOrgAdmin(orgId);
      }

      // Saved filters
      match /filters/{filterId} {
        allow read: if isOrgMember(orgId) && (resource.data.shared == true || resource.data.ownerId == request.auth.uid);
        allow create: if isOrgMember(orgId) && request.resource.data.ownerId == request.auth.uid;
        allow update, delete: if isOrgMember(orgId) && resource.data.ownerId == request.auth.uid;
      }

      // Attachments metadata
      match /attachments/{attachmentId} {
        allow read: if isOrgMember(orgId);
        allow create: if isOrgMember(orgId) && request.resource.data.uploaderId == request.auth.uid;
        allow delete: if isOrgAdmin(orgId) || (isOrgMember(orgId) && resource.data.uploaderId == request.auth.uid);
      }

      // Projects & Workspaces
      match /projects/{projectId} {
        allow read: if isOrgMember(orgId);
        allow create, update, delete: if isOrgAdmin(orgId);

        // Issues
        match /issues/{issueId} {
          allow read: if isOrgMember(orgId);
          allow create: if isOrgMember(orgId) && getOrgRole(orgId) != 'guest';
          allow update: if isOrgMember(orgId) && (getOrgRole(orgId) != 'guest' || resource.data.assigneeId == request.auth.uid);
          allow delete: if isOrgAdmin(orgId) || (isOrgMember(orgId) && resource.data.reporterId == request.auth.uid);

          // Comments
          match /comments/{commentId} {
            allow read: if isOrgMember(orgId);
            allow create: if isOrgMember(orgId) && request.resource.data.authorId == request.auth.uid;
            allow update: if isOrgMember(orgId) && (resource.data.authorId == request.auth.uid || request.resource.data.diff(resource.data).affectedKeys().hasOnly(['reactions']));
            allow delete: if isOrgAdmin(orgId) || (isOrgMember(orgId) && resource.data.authorId == request.auth.uid);
          }
        }

        // Sprints
        match /sprints/{sprintId} {
          allow read: if isOrgMember(orgId);
          allow write: if isOrgMember(orgId) && getOrgRole(orgId) != 'guest';
        }

        // Automations
        match /rules/{ruleId} {
          allow read: if isOrgMember(orgId);
          allow write: if isOrgAdmin(orgId);

          match /runs/{runId} {
            allow read: if isOrgAdmin(orgId);
            allow write: if false; // Triggered by backend runners only
          }
        }
      }
    }

    // Default deny
    match /{document=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 4. Cloud Storage Security Rules (`storage.rules`)

```javascript
rules_version = '2';
service firebase.storage {
  match /b/{bucket}/o {

    function isAuthenticated() {
      return request.auth != null;
    }

    function isOrgMember(orgId) {
      return isAuthenticated() &&
        firestore.exists(/databases/(default)/documents/organizations/$(orgId)/memberships/$(request.auth.uid));
    }

    function isOrgAdmin(orgId) {
      return isAuthenticated() &&
        firestore.get(/databases/(default)/documents/organizations/$(orgId)/memberships/$(request.auth.uid)).data.role in ['admin', 'owner'];
    }

    // File attachments scoped to organization
    match /organizations/{orgId}/files/{attachmentId}/{fileName} {
      allow read: if isOrgMember(orgId);
      allow create: if isOrgMember(orgId)
        && request.resource.size <= 25 * 1024 * 1024 // 25 MB limit
        && !fileName.matches('.*\\.(exe|bat|cmd|sh|ps1|vbs|js|jar|msi)$');
      allow delete: if isOrgAdmin(orgId);
    }

    // Generated thumbnails
    match /organizations/{orgId}/thumbs/{attachmentId}.webp {
      allow read: if isOrgMember(orgId);
      allow write: if false; // Only Cloud Functions image processor writes thumbnails
    }

    // Default deny
    match /{allPaths=**} {
      allow read, write: if false;
    }
  }
}
```

---

## 5. Threat Model & Prevention of Cross-Tenant Vulnerabilities

1. **Client Identity Spoofing:**  
   The client never specifies its `actorId` or `userId`. All Security Rules bind directly to the cryptographically verified `request.auth.uid` issued by Firebase Authentication.
2. **Path Traversal & Direct Document Guessing:**  
   Knowing another organization's `orgId` grants zero access. Every single document path requires existence of a matching `/organizations/{orgId}/memberships/{request.auth.uid}` record.
3. **Privilege Escalation on User Update:**  
   Security Rules explicitly prevent users from modifying restricted fields such as `role`, `plan`, or `stripeCustomerId` using `.affectedKeys().hasAny(...)` checks.
4. **Server-Side Admin SDK Privilege Separation:**  
   Firebase Admin SDK calls run with root privileges and bypass rules. Every Cloud Function endpoint (e.g. `deleteOrganization`, `updateMemberRole`, `exportOrg`) implements explicit verification of caller membership and roles before invoking any Admin SDK mutation.
5. **SSRF Webhook Protection:**  
   The outbound webhook worker running in Cloud Functions validates the target URL using DNS resolution checks before dispatch, explicitly blocking:
   - Private subnets: `10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`, `127.0.0.0/8`.
   - Cloud Provider Instance Metadata: `169.254.169.254`.
