# ABG Tracker public API (v1)

Create a token in the app: **Account → Connections → Create token** (*Read only* or *Read and write*). It is shown once. A token acts as you, with your permissions, and never more.

```
Authorization: Bearer abg_xxxxxxxxxxxx
```
Base address: your server, e.g. `https://tracker.example.com/api/v1`. All bodies are JSON. 120 requests a minute per token. The browser cookie is **not** accepted here, and a token is not accepted anywhere else.

| Method and path | Needs | What it does |
|---|---|---|
| `GET /me` | read | Who the token belongs to |
| `GET /orgs` | read | Your organizations (`slug`, `name`) |
| `GET /orgs/:slug/projects` | read | Projects with their statuses and item types |
| `GET /orgs/:slug/projects/:KEY/issues?status=&assignee=&q=&limit=&offset=` | read | Items (limit up to 200). `assignee` is an email, `status` a status name |
| `GET /orgs/:slug/issues/:ITEM-KEY` | read | One item with its comments |
| `POST /orgs/:slug/projects/:KEY/issues` | write | Create an item |
| `PATCH /orgs/:slug/issues/:ITEM-KEY` | write | Change an item |
| `POST /orgs/:slug/issues/:ITEM-KEY/comments` | write | Add a comment `{ "body": "…" }` |

Create / change fields (all optional except `title` on create): `title`, `description`, `type` (name), `status` (name), `priority` (`critical|high|medium|low`), `assignee` (email, or `null` to clear), `due` / `start` (`2026-12-31`), `labels` (list), `estimate` (number).
Unknown names are errors, never guesses. Workflow rules, required fields and approvals apply exactly as in the app.

Errors: `{ "error": "plain message" }` with 400 (bad input), 401 (token), 403 (not allowed), 404, 429 (slow down).

```bash
curl -H "Authorization: Bearer $TOKEN" https://tracker.example.com/api/v1/orgs/acme/projects/PLT/issues?status=Done
curl -X POST -H "Authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"title":"From a script","priority":"high","assignee":"priya@acme.dev"}' \
  https://tracker.example.com/api/v1/orgs/acme/projects/PLT/issues
```

## Webhooks
**People → Webhooks** (owners and admins): add a public https address and choose events: `issue.created`, `issue.updated`, `issue.deleted`, `comment.created`.
* *Chat message* format posts `{ "text": "PLT-3 updated: Title (link)" }`: works with Slack and Microsoft Teams incoming webhooks.
* *Data (JSON)* format posts `{ event, at, organization, data }` and is **signed**. Headers: `X-ABG-Event`, `X-ABG-Timestamp` (seconds), `X-ABG-Signature: sha256=<hex>` where the hex is `HMAC-SHA256(secret, timestamp + "." + rawBody)`. Reject calls whose timestamp is more than a few minutes old.
* Delivery: 5-second timeout, no redirects, up to 3 tries on server errors, no retry on a 4xx answer. Internal / private addresses are refused.

## Calendar feed
**Account → Connections → Create my calendar link** gives a private `.ics` address for Outlook, Google or Apple Calendar: the due dates of your unfinished assigned work. Anyone with the link can see them; *Make a new link* revokes the old one.
