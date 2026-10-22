# ABG Tracker v2

Multi-tenant work tracker with three work styles (Agile, Flow, Business) on one engine.

```
npm install
npm run dev         # API (http://127.0.0.1:4000) + web app (http://localhost:3001), with sample data
npm run dev:local   # web app only, offline demo: no server, no sign-in, data stays in this browser
npm test            # domain logic, repository rules, and the HTTP API (about 150 tests)
npm run build       # type-check (web + server) + production build
npm start           # API only, no sample data (production-style)
```

Sample accounts (created on first start when the database is empty), password `demo-password-1`:
`alex@acme.dev` (owner), `priya@acme.dev` (admin), `sam@acme.dev` (member) in **Acme**;
`jordan@northwind.io` (owner), `maya@northwind.io` (guest) in **Northwind**. Or click *Create a workspace* to sign up as a new company.

## Structure
- `src/domain/` — types, work-style templates, permission matrix (`can()`), workflow, query language, forecast, automation, copilot… No UI, no storage.
- `src/data/` — the `Repository` interface and its implementations: `LocalRepository` (holds **all business rules**, runs in the browser for the demo *and* on the server), `ApiRepository` (browser → server).
- `server/` — Fastify API, PostgreSQL storage, accounts, sessions, invitations (see Phase 6).
- `src/store/app.ts` — zustand store: session, organization, optimistic updates, error toasts.
- `src/pages`, `src/components` — screens.

## Demo (offline) mode
`npm run dev:local` uses the sample organizations with **Demo tools → Act as** to preview each role, and **Reset demo data**. Data lives in localStorage under `abg2:db:v5`.

## Phase 1 — foundation
Orgs & roles, work-style templates, issue types & hierarchy, Board (drag & drop), List, issue drawer, filters, deep links, dark mode.

## Phase 2 — workflows, fields, collaboration, search
- **Workflow engine** (Project → Settings): editable statuses with categories, allowed-transition matrix, "required fields to enter a status" gates. Enforced in board, list, detail *and* the repository; blocked moves explain why.
- **Custom fields**: text, number, date, dropdown, multi-select, checkbox, person, link; required flag; scoped to issue types; validated on write.
- **Markdown + @mentions**: Write/Preview editor, safe renderer (no raw HTML), `@Name` autocomplete.
- **Notifications & Inbox**: assigned, mentioned, commented, status changed; unread badge; mark read.
- **Search & saved filters**: query language, e.g. `type = Bug AND priority >= high AND assignee = me ORDER BY due`. Org-wide Search page; project search box accepts the same syntax. Private or shared saved filters.

## Phase 3 — Agile & Business modes, Timeline
- **Sprints & backlog** (Agile projects, new *Backlog* tab): create / edit / start / complete / delete sprints, drag issues between sprints and the backlog, points per sprint, days left, average velocity. Only one active sprint; completing moves unfinished work to the backlog or a planned sprint; sub-tasks follow their parent; completed sprints are locked. The Board defaults to the active sprint (toggle: *All work*).
- **Approvals** (Business mode, any issue): choose approvers; each approves or rejects (rejection needs a reason). All approve → item moves to Done automatically; any rejection → back to a to-do status. Items can't be marked Done before approval. Approvers can be guests. "Waiting for your approval" on Home; notifications; "Request approval again" after rework.
- **Milestones** are container issues (like epics) that group work and appear as diamonds on the timeline.
- **Dependencies**: "blocked by" links with loop detection, "Blocked by n" badge, lock icon on board cards.
- **Timeline** (all projects): bars by start/due date, drag to move, drag edges to resize, zoom (weeks/months/quarters), today line, dependency arrows, red dashed arrows + banner for scheduling conflicts, an *Unscheduled* list with one-click scheduling.
- Query language adds `sprint` (name, active/planned/completed) and `approval` (pending/approved/rejected).

## Phase 4 — Insights, forecast, automation, copilot
- **Insights tab** (every project): burndown, velocity (committed vs completed), throughput, created vs finished, cycle time (median and 85th percentile), workload, status distribution. Dependency-free SVG charts that follow light/dark mode.
- **Delivery forecast**: a Monte Carlo simulation (2,000 runs) over the team's last 8 weeks of finished work. For the active sprint and for each epic/milestone it gives the **chance of hitting the date**, a *likely* date (median) and a *safe-bet* date (85th percentile), and says plainly when there isn't enough history.
- **Automation** (admins, project → Automation): triggers (created, status changed, assignee changed, priority changed, becomes overdue), conditions, and actions (assign, set priority, move status, add label, comment, notify). Rules run inside the repository, so they fire whatever caused the change; they can't push work past required-field or approval gates; chains are capped and a rule fires at most once per issue per chain, so rules can't loop. Everything is logged and shows as "Automation". A **simulator** in the rule editor shows what a rule would have done over the last 30 days. Time-based rules run when an organization is opened.
- **Copilot** (button, bottom right): status updates, risk radar (overdue, blocked deadlines, schedule conflicts, sprint/milestone forecasts, unassigned sprint work, stale items), workload with a rebalancing suggestion, blocked work, natural-language create/assign/move/priority/comment, and "break down PLT-1". It **proposes** changes; nothing happens until you press Apply, and applying goes through the normal permission/workflow checks.
  - It is a local, rule-based assistant working on the data on this device. **No external AI model is connected.** `CopilotProvider` in `src/domain/copilot.ts` is the extension point: a model-backed provider returns the same `{ text, actions }` shape.

## Phase 5 — Intake forms & portfolio
- **Request forms** (project → Forms, admins): build a form from short/long text, dropdown, number, date and email questions; each question is mapped to an issue field (title, description, priority, due date or a custom field). Choose the issue type, default priority and default assignee. Each form has a public link, `/forms/<org>/<form>`, that works **without signing in**. Submissions become normal issues (labelled `intake`, showing "Requested by … via …"), run through automation rules, and notify the project lead and form owner. Open/close a form with one switch.
- **Public-form safety** (enforced in the repository, as a backend must): the public view exposes only the form itself; answers are validated per question and length-capped; a hidden honeypot field silently drops bots; at most 20 submissions per form per hour; closed or unknown forms return the same "not available" message; the form owner's permissions are re-checked on every submission.
- **Portfolio** (sidebar): one table for every project with a health rating (On track / Needs attention / At risk, with the reasons), progress, open/late/blocked counts, 8-week pace and "clear by" forecast date, plus next milestones, at-risk epics and milestones with their probability, and people's workload across all projects. Filter by health.

## Phase 6 — Backend, accounts, tenancy
- **Server** (`server/`, Fastify + TypeScript). Storage is **PostgreSQL**: set `DATABASE_URL` for a real database. Without it, an embedded Postgres (PGlite, a real Postgres engine in WebAssembly) keeps data in `./server-data`, so nothing needs installing. The same SQL runs on both. *The `pg` (real PostgreSQL) path has not been exercised in this environment; only PGlite has.*
- **Accounts**: email + password (scrypt hashes), sign up creates an organization with you as owner, sign in/out, change password (signs out other devices). Sessions are random tokens, stored hashed, in an `HttpOnly`, `SameSite=Lax` cookie (`Secure` in production), 14 days.
- **Invitations**: owners/admins invite by email and role from **People**; the invitee opens a single-use, 7-day link and sets a password (or signs in, if they already have an account). *(Email delivery arrived in Phase 7; without SMTP the admin copies the link and sends it.)*
- **People**: change roles (only owners touch owners; the last owner can't be demoted or removed), remove people (their work is unassigned), or leave.
- **Tenant isolation, enforced on the server**: the browser never says who it is. The signed-in user is taken from the session and appended to every call; extra or spoofed arguments are rejected. Every method re-checks organization membership and role, and references (project, parent, blocker, sprint, assignee) must belong to the same organization. Covered by tests that try every kind of cross-organization read and write.
- **Hardening**: login throttling (per address+email and per address), generic "incorrect email or password" (no account enumeration, constant-time compare), password length rules, request size limit, CSRF header required on every write, security headers, `no-store`, only intentional user-facing errors are returned (database/internal errors become a generic 500 and are logged), failed writes roll memory back from the database, and public endpoints are rate-limited.
- **Public form submissions** work with no account through the same API; they expose only the form.

**Known limits (deliberate for this phase):**
- The server keeps the *active* organizations in memory and writes changes through to Postgres inside one transaction per request (see Phase 8). That keeps one set of tested rules; running several server copies would need shared locking and a shared rate-limit store.
- One server process owns the data (no horizontal scaling yet).
- No SSO, no two-factor authentication, no billing. (Email and password reset arrived in Phase 7.)
- Sign-up is open unless you set `ALLOW_SIGNUP=false` (Phase 7).

## Phase 7 — Production readiness
- **One process in production**: after `npm run build`, the server (`npm start`) also serves the web app (deep links work, hashed assets cached for a year, the page itself never cached). Strict `Content-Security-Policy` (scripts only from this origin, no framing), HSTS when in production, `nosniff`, no referrer.
- **Email**: set `SMTP_URL` and invitations are emailed automatically, and **"Forgot your password?"** works (one-hour, single-use link; always answers the same so it can't reveal who has an account; resetting signs out every device). Without SMTP, links are printed in the log **in development only**; production never logs them (they are credentials) and warns at start-up. *SMTP delivery uses `nodemailer` and has not been tested against a real mail server here.*
- **Closed sign-up**: `ALLOW_SIGNUP=false` makes the server invitation-only (nobody can create a new organization); the sign-in screen hides "Create a workspace".
- **Safe configuration**: in production the server refuses to start, listing every problem, if `PUBLIC_URL` is missing or not https, there is no `DATABASE_URL`, demo data is enabled, or `SMTP_URL` is malformed. `TRUST_PROXY` must be set deliberately (only behind a reverse proxy you control).
- **Graceful shutdown**: on stop it finishes running requests, flushes pending writes and closes the database.
- **Deploy files**: `Dockerfile` (multi-stage, runs as a non-root user, health check), `docker-compose.yml` (app + PostgreSQL), `.env.example`, `.dockerignore`, and a GitHub Actions workflow (`lint`, `test`, `build`, `npm audit`). *These Docker and CI files are written but have not been run here (no Docker on this machine).*

### Deploying
```
cp .env.example .env            # set PUBLIC_URL (https), POSTGRES_PASSWORD, SMTP_URL, ...
docker compose up -d --build    # app on :4000 with PostgreSQL
```
Put an HTTPS reverse proxy (Caddy, nginx, a cloud load balancer) in front of port 4000 and keep `TRUST_PROXY=true`.
Without Docker: `npm ci && npm run build`, set the environment variables from `.env.example`, then `npm start`.

**Backups**: everything lives in PostgreSQL. Back up the database (for example nightly `pg_dump`) and test a restore. Nothing else on the server holds data. With the embedded database (trial only), back up the `DATA_DIR` folder while the server is stopped.

**Still true after this phase** (see Phase 6 limits): the server holds all data in memory (one process, pilot scale), no SSO or two-factor, no billing. (Files arrived in Phase 11.)

## Phase 8 — Scales with active organizations; new look
- **Organizations load on demand.** Only the small shared tables (organizations, users, memberships) are always in memory. Everything inside an organization (projects, issues, comments, activity…) is read from PostgreSQL the first time that organization is used, kept while it is active, and dropped when it has been idle (`ORG_CACHE_IDLE_MINUTES`, default 30) or when more than `ORG_CACHE_MAX` (default 50) are loaded (least recently used goes first). Changes are saved before anything is dropped, so nothing is lost. Memory now follows the number of *active* organizations, not the total. `GET /api/health` reports `loadedOrganizations`.
- Each call tells the server which organization it needs (directly, or via the record it touches), so a request for another company's record id loads that company, is refused (403), and stays isolated. Tests cover start-up with nothing loaded, eviction without data loss (edits, comments and deletions survive), idle eviction, foreign ids against unloaded organizations, and 10 companies under a cap of 3.
- **Limits that remain**: still a single server process (the in-memory working set is per process, so running several copies would need shared locking or a cache layer); a single very large organization is loaded whole; per-request saving compares all loaded rows (fine at pilot scale, to be replaced by targeted writes if an organization grows to hundreds of thousands of records).
- **New look**: teal green brand colour, gray-green page background, white surfaces, orange for highlights/focus (a darker orange is used for orange *text* so it stays readable), and a deep-teal navigation sidebar. Light and dark modes both follow the palette (defined once in `src/index.css`).

## Phase 9 — Columns and fields your team shapes itself
The work-style templates are only a starting point. Teams adjust them where they work, with no settings page to learn:
- **Board columns**: click a column's title for a small menu (admins and owners): rename it, say what its cards *count as* (Not started / In progress / Finished, which drives progress, reports and forecasts), move it left or right, or remove it. Removing a column with cards asks where they should go (nothing is lost, and the move is logged on each card). **+ Add column** at the end of the board adds a new one just before Done. Duplicate names are refused with a plain message; a project always keeps at least two columns and one Finished column.
- **Start your own way**: *Create project* shows the work style's columns as editable chips. Rename, remove or add before creating; "Reset" returns to the template. A team that changes them gets free movement between columns; an unchanged template keeps its built-in rules.
- **Fields**: the **Fields** button above the board/list shows which of the project's custom fields appear on cards and as list columns (a personal view setting, remembered in your browser), and admins can **add a field in two clicks** (text, number, date, dropdown, checkbox or person). New fields are shown straight away and appear in the issue drawer for everyone.
- Everything here is still available in *Settings* for advanced cases (transition rules, required fields, field options per issue type).

## Phase 10 — Issue types your team defines
- **Customize menu** (button above the board/list, for admins and owners): under *Issue types* you can add, edit and remove the project's types. A new type needs only a **name, a colour and an icon** (23 to choose from) and one plain-language choice: **Work item** (appears on the board), **Group of work** (collects other items, like an epic) or **Part of an item** (like a sub-task).
- **Special behaviour is opt-in**: tick *Needs sign-off* (asks for approvers; can't be finished until approved) or *Show as a milestone* (a diamond on the timeline). Any type, including your own, can have these. Projects made before this keep working.
- **Add a type while you work**: *Create issue* has **＋ New type…** at the end of the type list; the type is created and selected in one step.
- **Safe changes**: renaming or recolouring keeps every item. A type with items can't change what kind of item it is. Removing a type that has items (or a request form that creates it) asks which type they should become, moves them, and logs it on each item; automation conditions and field scopes that named the removed type follow. A project always keeps at least one work-item type. Dropping a used type any other way is refused.
- Server rules (names, icons, colours, id characters, minimums) are checked by the same code on the server, with tests for each.

## Phase 11 — File attachments
**For people:** open an item and use **Files**. Drop files on it, click *choose files*, or paste an image. Images appear as thumbnails (click to enlarge); other files are listed with size, who added them and when, with a download button. The uploader (or a project admin) can remove a file. Items show a paperclip with the number of files on board cards, and the history records "attached …" and "removed …". Members and above can add files; everyone in the organization can view and download; guests can't add.

**Limits (all adjustable by the person running the server):** 25 MB per file, 25 files per item, 1 GB per organization. Programs and scripts (exe, msi, bat, cmd, scr, ps1, vbs, js, jar, dll, sh, apk, dmg and similar) are refused, because one careless double-click can run them.

**How it is kept safe (enforced on the server, with tests for each):**
- Who may upload is checked *before* any bytes are written, and anonymous uploads are rejected before the file is even read.
- A file's name is only a label: it is cleaned (no folders, control or text-direction trick characters, limited length) and never used as a path. On disk, files live under random keys inside the organization's own folder.
- The file's real type is decided from its own bytes. Only genuine PNG, JPEG, GIF and WebP images are ever shown inline; SVG, HTML and everything else is always downloaded, with `nosniff`, a `sandbox` content policy, and a safely encoded `Content-Disposition`.
- Other organizations can't download, probe or remove your files: they get "not found". Removing a file (or deleting its item) deletes the stored bytes too, and a failed save never loses or leaves behind a file.
- Responses are never cached across removals (`no-cache`), so a removed file stops working immediately.

**Server settings:** `FILES_DIR` (default `./server-files`), `MAX_FILE_MB`, `ORG_STORAGE_MB`, `MAX_FILES_PER_ISSUE`, `BLOCKED_EXTENSIONS`. **Back up `FILES_DIR` together with the database**; the Docker setup keeps it in its own volume.

**Not included (be aware):** no virus scanning (the blocked-type list reduces risk but is not a scanner); an upload interrupted by a crash can leave an orphan file on disk (harmless, never shown; removed automatically after a day, see Phase 16); the offline demo mode has no file storage.

## Phase 12 — Thumbnails, comment files, request-form files
**For people:**
- **Comments can carry files.** In the comment box, click *Attach files* or paste a screenshot; the files appear under that comment. Only the comment's author can add to it, and the files go when the comment's item is deleted.
- **Request forms can ask for files.** In the form editor, add a question of type *File upload* (one per form). Visitors pick up to 3 files (10 MB each by default) and submit. The files appear on the new item, labelled "Name (via form)", and the history shows them as sent by the request form sender. If a file fails to send, the visitor is told which one, and the request itself is still saved.
- **Thumbnails are real thumbnails.** Pictures are shrunk to a small WebP preview on first view and cached, so boards and long files lists stay fast.

**Safety (tested):** previews are made only from verified images, with a pixel cap (decompression-bomb protection), and strip hidden photo data such as GPS location. A visitor can upload only with a one-time ticket issued by their own form submission: it expires in 15 minutes, allows at most 3 uploads, is tied to the one new item, and is rate-limited per address. Visitor files obey the same blocked-type list and organization quota as everything else.

**Server setting:** `PUBLIC_MAX_FILE_MB` (default 10).

**Not included:** upload tickets live in memory, so a server restart between "submit" and the file upload loses the ticket (the visitor sees a clear message); still no virus scanning.

## Phase 13 — Email notifications
**For people:** Inbox → **Email settings**. Two plain questions: *Email me* (as it happens / once a day / never) and *About* (only what needs me / everything in my Inbox). The default is a prompt email about mentions, assignments, approvals and new requests. Your Inbox in the app always shows everything; these choices only affect email, and apply across all your organizations.

**How it behaves:**
- "As it happens" waits about two minutes, so quick follow-ups travel in one email and anything you already read in the app is skipped. Several items are grouped into one email with a link to each.
- "Once a day" sends one summary at the first check after `DIGEST_HOUR` (default 08:00 in your own time zone, see Phase 15), at most once per 20 hours.
- An item is emailed at most once. Items that happened while email was off, and anything older than two days, are never sent later when you switch it on.
- Emails are plain text only. Titles and names are stripped of line breaks and control characters, so an item title cannot inject mail headers or fake lines.
- Nobody sees anyone else's email choices. Someone removed from an organization stops getting its emails.
- If the mail server is down, the same items are retried after 15 minutes.

**Needs:** `SMTP_URL` (without it, nothing is delivered; in development the messages appear in the server log and `/api/dev/outbox`). **Server settings:** `DIGEST_HOUR`.

**Not included:** single server process only (a second process would not double-send, but would not share retry timers).

## Phase 14 — Quiet projects and due-date reminders
**For people:**
- **Quiet projects:** Inbox → Email settings now lists your projects with a checkbox each. Ticked projects never email you; the Inbox still shows them. Un-ticking does not send what you missed.
- **Due-date reminders:** if you are the assignee of unfinished work, you get an Inbox item (and, per your email settings, an email) once when it is **due tomorrow**, once **due today**, and once when it becomes **overdue**. Moving the due date starts the reminders over; finished or unassigned items get none. Reminders count as "needs me", so they arrive under the default setting.

**How it works:** the server checks every 15 minutes. It looks in the database for items due from three days ago to tomorrow and only loads organizations that have such items, so memory use still follows active organizations. Items overdue by more than three days are never reminded about, so switching this on does not flood people with history.

**Limits:** reminders go to the assignee only (not the reporter or watchers); no custom lead time ("remind me 3 days before") yet.

## Phase 15 — Time zones
**For people:** nothing to learn. The first time you sign in, the app quietly remembers the time zone of your browser. You can change it in Inbox → Email settings → *Your time zone*.

**What it fixes:**
- **Daily summary** arrives at the morning of *your* day (08:00 by default; server setting `DIGEST_HOUR`, now meaning the hour in each person's own zone), not at one server-wide hour.
- **Due-date reminders** use *your* calendar: an item due on the 12th reminds you on the 11th and 12th by your clock, wherever the server is.
- People who have never opened the app (so no zone is known) are treated as UTC.

**Safety:** only real time-zone names are accepted; anything else is refused or ignored. The zone is part of a person's private email settings, so colleagues cannot see it.

**Limits:** the browser's zone is saved once; if you travel, change it by hand. "Overdue" cut-off for old items (about three days) is approximate across zones. Item due dates are plain calendar dates (no time of day).

## Phase 16 — Closing gaps: unsubscribe, a test email, and file clean-up
**Unsubscribe link (the Phase 13 gap).** Every notification email ends with "Stop all of these emails: <link>" and carries the standard `List-Unsubscribe` headers, so Gmail, Outlook and Apple Mail show their own Unsubscribe button. The link opens a page that *asks first* ("Stop these emails?"), so a mail scanner that merely opens links changes nothing; one click then turns that person's email off (everything else in their settings stays). It needs no sign-in, never expires, and can do exactly one thing. It is signed with a secret kept in the database (so links survive restarts); forged, cut-short or borrowed links are refused; and the page never shows an email address.

**"Send me a test email" (the Phase 7 gap).** In Inbox → Email settings. Sends a short message to the signed-in person's *own* address (an address in the request is ignored), at most 3 an hour. If the server has no `SMTP_URL` it says so; if the mail server refuses, the screen shows a plain message and the details go to the server log only. This is how you prove delivery with your real mail server.

**Unused-file clean-up (the Phase 11 gap).** Every 6 hours the server removes stored files (and previews and half-written temp files) that no record refers to, but only if they are more than a day old, and only names this store could have made.

**Housekeeping.** README statements that had gone stale (no email service, no file storage, test count) were corrected.

**Still not proven here:** real SMTP, real PostgreSQL (`DATABASE_URL`), Docker and the CI workflow have never been run on this machine. Use the test email and a staging deploy to close that before going live.

## Phase 17 — Account security
**For people:** sidebar → **Account** (replaces the old *Password* button; password change is still there).
- **Two-factor sign-in:** *Set up…* shows a QR picture for any authenticator app (Microsoft/Google Authenticator, 1Password, Authy…) and a typed key as a fallback. After the first correct code it is on, and you are shown **8 recovery codes once**. From then on, signing in asks for the password, then a 6-digit code (or a recovery code, each usable once). Turning it off asks for the password again.
- **Where you are signed in:** every device or browser (e.g. "Chrome on Windows", with when it signed in), a **Sign out** button on each other one, and **Sign out everywhere else**.
- **Your name:** change it; it updates on your work everywhere.
- A short "Security notice" email is sent when two-factor is turned on or off.

**How it is kept safe (tested):** the secret is stored encrypted (AES-256-GCM; the key is kept apart in the database's secrets table); recovery codes are stored only as hashes; a code can be used once (a stolen code can't be replayed within its 30 seconds); a wrong password never hints at the second step; guessing six-digit codes is capped per *account* (10 per 10 minutes, from any address) on top of the per-address limits; the sign-in session is only created after both steps; device ids shown in the list are short pieces of a fingerprint, never anything that could be used as the cookie; you can only sign out your own other devices.

**Limits:** changing your email address is not offered yet (it needs a confirmation flow); no "new sign-in" alert emails yet (only the two-factor notices); no hardware keys (passkeys/WebAuthn); recovery codes cannot be re-generated without turning two-factor off and on again; organizations cannot *require* two-factor yet.

## Phase 19 — Your data: export, import, audit log, delete
**For people (owners and admins): People page.**
- **Export (owner):** *Everything (JSON)* and *Work items (spreadsheet)*. The export holds the organization's projects, items, comments, history, forms, rules and people (name, email, role). Attached files are listed (name, size, who) but their contents are not included. The spreadsheet is safe to open in Excel: any cell that starts with `=`, `+`, `-` or `@` is stored as text, so an item titled `=HYPERLINK(...)` cannot run as a formula.
- **Import (anyone who can create items):** in a project's board or list, **Import** → choose a CSV (from Excel, Jira, Asana…). Only *Title* is required; Description, Type, Status, Priority, Assignee (email or name), Labels, Estimate, Start and Due are used if present. Up to 500 items at a time; every row goes through the normal create rules and permissions, bad rows are skipped and listed with the row number and reason.
- **Audit log (owner and admin):** who invited, cancelled, joined, left, was removed, had a role changed, or exported data, newest first.
- **Delete the organization (owner):** type its exact name and your password (and your two-factor code if on). Everything in it is removed from the database and from file storage; other organizations are untouched.
- **Delete my account (Account dialog):** removes login, devices, two-factor and settings; your name on other people's old comments and history becomes "Deleted user", your open work is unassigned, and the email address can be used again. The only owner of an organization must hand it over or delete it first.

**Limits:** exports are a one-time download (no scheduled backups); import is CSV only (no direct Jira/Asana login, no attachments, parent/child links or sprints); the audit log covers access and exports, not every edit (item history already records edits); deleting is immediate and permanent (no grace period or undo).

## Phase 22 — Integrations and API
Full reference: [docs/API.md](docs/API.md).
- **Access tokens** (Account → Connections): *read only* or *read and write*, shown once, stored only as hashes, revocable, named, last-used shown. They work **only** on the public API; the browser cookie does **not** work there (so a web page can never drive it), and a token never does more than its owner could. Removing an account revokes its tokens.
- **Public API** (`/api/v1`): organizations, projects, items (filter, page), one item with comments, create / change items, add comments. Names instead of ids, unknown names are errors, every workflow rule and permission applies. 120 requests a minute per token.
- **Webhooks** (People page, owners and admins): item created / changed / deleted, new comment. *Chat message* format works with Slack and Teams incoming webhooks; *Data (JSON)* is signed (HMAC-SHA256 over timestamp + body). Public https addresses only (private networks, localhost, cloud-metadata addresses, credentials in the address are refused, checked again at send time); 5 s timeout, **redirects are never followed**, retries on server errors; the last result is shown and there is a *Test* button. Delivery never slows or breaks the person's own action.
- **Calendar feed** (Account → Connections): a private `.ics` link with the due dates of your unfinished work, for Outlook / Google / Apple Calendar. Calendar text is escaped so an item title cannot add lines or fields to the file; the link shows only your own items and can be replaced at any time.
- **Not included:** Git links, OAuth apps for third parties, per-project tokens, webhook delivery log beyond the last result.

## Phase 23 — Live work
- **Live updates:** screens refresh by themselves when a teammate changes something (a small Server-Sent-Events stream; it says only *"organization X changed"* and carries no data, then the browser re-reads what it is allowed to see the normal way). It catches up after a dropped connection. At most 5 streams per person.
- **Watching:** a *Watch* button on every item. Watchers are told about comments and status changes; **commenting follows the item for you**; anyone can unwatch.
- **Reactions:** 👍 ✅ 🎉 ❤️ 👀 😄 under any comment (one click to add or take back; hover shows who).
- **Reminders:** you choose how far ahead ("the day before" up to 7 days) in Email settings; the person who **asked for** the work, and its watchers, are told when it slips (overdue), once.
- **Limits:** one server process (several copies need a shared channel, see the hand-off guide); no typing indicators or "who is viewing" yet.

## Phase 25 — Polish
- **Faster first load:** secondary screens are fetched when first opened (main bundle 575 kB → 440 kB).
- **Keyboard and screen readers:** a *Skip to main content* link; every dialog now traps Tab, closes with Esc, announces itself as modal, puts focus inside on open and **back on the button that opened it**; messages are read aloud (always-present live region); respects "reduce motion".
- **Getting started:** a short checklist on a new workspace's home page that ticks itself off from what really exists (create a project, add an item, invite a teammate, assign something) and can be hidden.
- **Phone:** checked at 375 px on Home, People, Board and Inbox with no sideways scrolling.
- **Not done:** other languages (all text is in the code, not in translation files: needs a real translation pass and a decision on languages), a full automated accessibility audit with assistive-technology testing, offline use.

## Mock services: payments, single sign-on, AI (Phases 18, 20, 21: built against pretend providers)
No accounts or keys exist yet, so these run against clearly labelled **mocks** behind small interfaces. The dev team swaps in the real service later without touching screens. **Read [docs/INTEGRATION-HANDOFF.md](docs/INTEGRATION-HANDOFF.md).**
- **Plans and billing (real limits, pretend payment):** Free (10 people, 5 projects), Team, Business. Limits are **enforced** for inviting people (pending invitations count) and creating projects. Owners switch plan in People → *Plan and billing*; moving down is refused while the organization is above the smaller plan's limits; every change is in the audit log. The mock charges nobody and shows pretend invoices (labelled so).
- **Single sign-on (full flow, pretend provider):** a "Sign in with Mock SSO" button on the sign-in page → a fake provider page → back with state check, verified-email requirement, one-time signed code, session. Existing people sign in; unknown ones get their own workspace (if sign-up is open) with no password at all. Refuses another browser's attempt, a tampered code, an unverified address, and strangers when sign-up is closed.
- **AI summary (pretend model):** *Summarize* on an item recaps it and its discussion. The route is built the way the real one must be: membership checked, only the item's text sent (never emails or ids), rate limited, output labelled with its source.
- **Safety:** `mock` is refused in production unless `ALLOW_MOCK_SERVICES=1` (the server will not start); `none` hides the feature. Set with `BILLING_PROVIDER`, `SSO_PROVIDER`, `AI_PROVIDER`.

## Settings page
One place for everything you can change: **Settings** in the left sidebar (`/<org>/settings`, deep links like `?tab=notifications` work).
- **My account:** name, password, two-factor, signed-in devices, delete my account.
- **Notifications:** email choices, time zone, due-date reminders, quiet projects, test email.
- **Organization** (owners and admins): link to People, export, audit log, delete the organization.
- **Plan & billing** (owners and admins) · **Integrations:** access tokens, calendar link, and webhooks (admins) · **Projects:** each project with links to its board, workflow & fields, request forms and automation.
Tabs you are not allowed to use are not shown. The sidebar *Account* button, the Inbox *Email settings* button and the People page now lead here.

## Home dashboard
Home is now a dashboard you arrange yourself (**Customize** at its top right).
- **13 widgets:** At a glance (open / overdue / blocked / finished this week / my open / my overdue), My open work, Due soon & overdue (mine), Waiting for my approval, Following, Projects, Project health, Team workload, Created vs finished (6 weeks), Work by stage, Open work by priority, Coming up (everyone, next 14 days), Recent activity.
- **AI touch, "Your day, in brief"** (14th widget, shown only when an AI assistant is connected; the offline demo and servers with `AI_PROVIDER=none` hide it): press **Brief me** for a few plain sentences about your day, a **suggested focus order** (overdue first, then due today, then urgent; blocked work ranks lower) with a one-line reason each linking to the item, and **watch-outs** (approvals waiting, blocked or critical work, nothing finished this week). It only reads; it never changes anything. It runs on request, is remembered for the visit, and has a Refresh button. Today it runs on the **mock** assistant (rules, no model); a real model plugs in behind the same checks (see docs/INTEGRATION-HANDOFF.md): the server decides what the assistant sees (only your own open items), and any item it names must be one it was given.
- **Clickable tiles:** each *At a glance* number is a button: press it to see exactly the items it counted right underneath (each opens the item), press again or *Close* to hide. The number is the length of that list, so they can never disagree. A tile showing 0 is greyed out.
- **Your arrangement:** tick what to show, choose **half or full** width, reorder with the arrows, **Back to the default** to undo. Saved on the server per person (so it follows you between devices); in the offline demo it is saved in the browser. Nobody else can see it.
- **Project filter:** a selector narrows every number to one project (remembered per organization).
- **Sensible defaults:** guests start with only what is about them (my work, due soon, approvals, activity); everyone else gets everything except the three heavier or niche ones (Project health, Following, Priority), which are one tick away. Widgets added in future versions appear at the end of your layout instead of staying hidden.
- **Numbers** are worked out in the browser from what is already loaded (nothing extra to fetch), by the same rules as the reports and Portfolio; "work" means real work items, not epics or sub-tasks. *Project health* runs the forecast for each project, so it takes a moment: that is why it is off by default.
- **Not included yet:** drag-and-drop (arrows are used so it works by keyboard), widgets for a chosen saved filter, sharing a dashboard with a team, and per-widget settings (date range, person).

### Query language
Fields: status, statusCategory, type, assignee, reporter, priority, label, project, key, parent, due, start, created, updated, resolved, estimate, text, and any custom field by name.
Operators: `= != ~ > >= < <=`, `in (a, b)`, `is [not] empty`; combine with `AND / OR / NOT / ( )`; `ORDER BY field [ASC|DESC]`.
Dates: `2025-01-31`, `today`, `tomorrow`, `7d`, `-2w`. People: `me`, a name, or an email.

## Roadmap — what is left to finish the product
17. ~~Account security~~ — done (two-factor, devices list, profile name). Left over: change email, sign-in alerts, passkeys, "require two-factor for my organization".
18. ~~Single sign-on~~ — built against a **mock** provider (full flow, tested). Needs real OpenID Connect / SAML provider, company-domain rules, "require SSO": see docs/INTEGRATION-HANDOFF.md.
19. ~~Data ownership~~ — done (export, CSV import, audit log of access, delete organization / account). Left over: scheduled backups, direct Jira/Asana import, wider audit coverage, delete grace period.
20. ~~Plans and billing~~ — plans and limits are real and enforced; payment is a **mock**. Needs Stripe (or similar), trial/failed-payment rules, real prices: see docs/INTEGRATION-HANDOFF.md.
21. ~~Real AI copilot~~ — "Summarize" built against a **mock** model with the privacy and rate limits in place. Needs a real model, company on/off switch, usage caps, a model-backed Copilot behind the same approve step: see docs/INTEGRATION-HANDOFF.md.
22. ~~Integrations and API~~ — done (tokens, public API, webhooks incl. Slack/Teams format, calendar feed). Left over: Git links, OAuth apps, delivery log.
23. ~~Live work~~ — done (live updates, watchers, reactions, reminder lead time and reporter reminders). Left over: several-server support, typing/presence.
24. **Scale and reliability:** several server copies (shared locks, rate limits, upload tickets), proven PostgreSQL, targeted writes for very large organizations, backup and restore drill, monitoring, load test.
25. ~~Polish~~ — done (lazy loading, keyboard/screen-reader dialogs, getting-started checklist, phone check). Left over: languages, assistive-technology audit.
26. **Launch readiness:** run Docker/CI/SMTP for real, security review and penetration test, terms and privacy pages, status page, support flow.
