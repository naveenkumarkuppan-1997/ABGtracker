# Integration hand-off: what is mocked, and what the dev team swaps in

Three outside services are **pretend** today so the whole product can be built, demoed and tested without accounts or keys.
Each sits behind a small interface in [`server/services.ts`](../server/services.ts); screens, rules and tests only talk to the interface.
Going live = write one class per service, choose it with an environment variable. No screen changes.

| Service | Interface | Mock today | Real one to add | Switch |
|---|---|---|---|---|
| Payments / plans | `BillingProvider` | `MockBillingProvider` (charges nobody, writes pretend invoices to `mock_invoices`) | Stripe (or similar) | `BILLING_PROVIDER` |
| Single sign-on | `SsoProvider` | `MockSsoProvider` + a built-in fake login page | OpenID Connect: Google, Microsoft, company IdP (SAML later) | `SSO_PROVIDER` |
| AI assistant | `AiProvider` | `MockAiProvider` (deterministic recap, no model) | A language model (e.g. Claude) | `AI_PROVIDER` |

## Safety rule for the mocks
`mock` is **refused in production** (the server will not start) unless `ALLOW_MOCK_SERVICES=1`, because the mock sign-in lets anyone in as anyone and mock billing upgrades for free.
`npm run host` sets `ALLOW_MOCK_SERVICES=1` for the local demo only. Real deployments must leave it unset and set each provider to a real value (or `none`).
`none` hides the feature entirely (no button, no route).

## 1. Payments (`BillingProvider`)
Today: plans and limits are real and enforced (see `PLANS` in `server/services.ts` and `assertSeat` / `assertProjectRoom` in `server/serviceroutes.ts`); only the *payment* is pretend.
To do:
1. Implement `changePlan(org, plan, actorId)`. Return `{ redirectTo: <Stripe Checkout URL> }` to send the owner to pay, or `{ done: true }` when the change is immediate. (The screen already follows `redirectTo`.)
2. Implement `invoices(orgId)` from Stripe.
3. **Stripe webhooks are the source of truth**: add a route that verifies Stripe's signature and, on `checkout.session.completed` / `customer.subscription.updated|deleted` / `invoice.payment_failed`, sets `organization.plan` (the same one-line change the mock route makes inside `transact`) and writes an audit event (`owner.audit(...)`). Do not trust the browser coming back from Checkout.
4. Decide: real prices (`PLANS[*].priceUsdPerMonth` are placeholders), trial length, what happens on failed payment (suggested: grace period, then read-only, never delete data), tax/VAT, and invoices/receipts.
5. Keep the downgrade guard (refuse while usage exceeds the smaller plan). Store the Stripe customer id on the organization (new column/table, not in the browser-visible `Organization`).

## 2. Single sign-on (`SsoProvider`)
Flow already built and tested end to end with the mock: `/api/auth/sso/start` (sets a short-lived state cookie, redirects) → provider → `/api/auth/sso/callback` (checks state, exchanges the code, requires a **verified** email, signs in or creates the account, sets the normal session cookie).
To do for OpenID Connect:
1. Implement `authorizeUrl(state, redirectUri)` (use the provider's discovery document; also send a `nonce` and PKCE `code_challenge`; store nonce/verifier alongside the state cookie).
2. Implement `exchange(code, redirectUri)`: POST to the token endpoint, **validate the ID token** (signature via JWKS, `iss`, `aud`, `exp`, `nonce`), return `{ email, name, emailVerified }` from its claims. Never trust unsigned data.
3. Register the redirect address `PUBLIC_URL + /api/auth/sso/callback` with the provider; set client id/secret as environment variables (never in the repo).
4. Decide the account rules: today an unknown, verified email gets its **own new workspace** (only if `ALLOW_SIGNUP`); a company will probably want "people from @company.com join *that* organization" (add a per-organization allowed-domain setting and an org role default) and "require SSO for this organization" (disable password sign-in for its members). Both need a design decision.
5. Two-factor: SSO sign-ins currently skip the app's own two-factor step (the identity provider is expected to enforce MFA). Confirm this is acceptable.
6. SAML (large customers) is a separate provider implementing the same interface, usually via a library.

## 3. AI assistant (`AiProvider`)
Today: two features. **"Summarize"** on an item (`POST /api/orgs/:slug/issues/:key/summary`) and **"Your day, in brief"** on the Home dashboard (`POST /api/orgs/:slug/briefing`, `provider.brief(input)`). The briefing route is the model for how any new AI feature should be built: the *server* works out the facts from the person's own data (nothing the browser sends is trusted), the assistant receives only counts and a short list of that person's own open items (key, title, status, priority, days to due, blocked), and the **reply is checked before it reaches the screen**: it may only point at items it was given, every field is length-limited, and provider errors become a plain "could not answer" message (never the vendor's error text). For a real model, return JSON in the `BriefOutput` shape (`summary`, `focus[{key, why}]`, `watchouts[]`), and keep item titles in the prompt clearly marked as data, never as instructions.
Original summary notes: The route already does the privacy work: membership and visibility are checked, it sends only the item's own text (title, description, last 30 comments, truncated), never emails, ids, files or other items, and it is rate limited per person.
To do:
1. Implement `summarize(input)` against the model API (key from an environment variable, server-side only). Use a fixed system prompt that treats item text as **data, not instructions** (people can write anything in a comment); keep output length capped; time out and map failures to a plain message.
2. Decide company controls: an organization-level on/off switch (default off), a monthly usage cap and cost tracking, which model, data-retention terms with the vendor, and a notice in the privacy policy. Add the switch before enabling for customers.
3. The existing rule-based Copilot (`src/domain/copilot.ts`) proposes changes that need an Apply click. A model-backed version should use the same `{ text, actions }` shape and the same approval step; never let a model change data directly.

## Other things that need real accounts or hosting (not in the code yet)
* **Email**: set `SMTP_URL` and run the in-app *Send me a test email*.
* **Database**: run the full test suite against a real PostgreSQL (`DATABASE_URL`) once; only the embedded engine has been exercised.
* **Docker / CI**: `Dockerfile`, `docker-compose.yml`, `.github/workflows` are written but never run.
* **Several server copies**: live updates, rate limits, upload tickets and webhook retries are in-process. Behind more than one instance they need a shared channel (Redis or Postgres `LISTEN/NOTIFY`) and shared limiters.
* **Webhook egress**: outgoing calls are restricted to public https addresses, but DNS can change between check and send. In production route them through an egress proxy that enforces the same rule.
* **Security review / penetration test** and legal pages (terms, privacy) before launch.

## How to prove a new provider works
Each mock has tests in `server/server.test.ts` ("mock services…"). Copy them for the real provider with a fake HTTP layer (the webhook tests show how to inject `fetch`), then do one manual run in a staging environment with real test-mode credentials.
