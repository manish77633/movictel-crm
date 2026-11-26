# Relay CRM

Relay is an original lead management and WhatsApp workspace. The Next.js frontend talks to a versioned Express API. MongoDB stores CRM data and the job outbox. BullMQ uses Redis to process Meta events, scheduled automation, and outbound messages.

## Try the interactive demo

```powershell
npm.cmd ci
npm.cmd run dev -w frontend
```

Open http://localhost:3000/workspace?demo=1. The demo stores sample data and edits in this browser. In **Integrations**, simulate a Facebook lead. In **Leads**, add a contact or schedule a follow-up. In **Inbox**, open Riya Sharma’s sample conversation and send a simulated reply. The demo makes no provider requests.

## Run the full stack locally

1. Copy `.env.example` to `.env`.
2. Generate separate values for `ACCESS_SECRET` and `CREDENTIAL_KEY` using the command below. Set them in `.env`. Keep the credential key stable to retain access to existing encrypted integration credentials.
3. Run `docker compose up -d --wait` to start MongoDB and Redis. MongoDB must support transactions. The local single-node replica set is for development.
4. Run `npm run dev` and register a workspace at http://localhost:3000/account?mode=register.
5. See `/api/v1/health` for API/database readiness. The worker starts with the API. Set `RUN_WORKER=false` for an API-only development session.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npm run typecheck
npm run lint
npm test
npm run build
```

Email verification can be skipped locally with `LOCAL_SKIP_EMAIL=true`. For verification, reset links, and team invitations, configure a Resend API key and verified sender. Production registration always requires email verification.

Set `TEST_MONGODB_URI` to a disposable **replica-set test instance** before running `npm test` to include the database and HTTP integration suite. The suite creates and drops a temporary database. It uses synthetic lead and WhatsApp data and stubs Graph API responses.

## Architecture

- `frontend/src/app` contains the landing page, account pages, and workspace entry point. Shared workspace components read and mutate data through the typed API client and TanStack Query.
- `backend/src/auth.ts` handles account sessions and workspace creation. `crm.ts` handles leads, notes, follow-ups, team membership, notifications, and reports.
- `integrations.ts` and `facebook-oauth.ts` manage authorized accounts and provider assets. `webhooks.ts` verifies and records Meta callbacks. `incoming.ts` processes leads and message receipts.
- `messaging.ts` handles the inbox, templates, and automation rules. `worker.ts` delivers outbound requests and processes due jobs. Workspace socket events invalidate cached data and carry no customer records.
- Owners can manage membership. Owners and admins can manage integrations, rules, and assignments. Agents can read or update their assigned leads and their related conversations.

See [Meta setup](docs/meta.md) and [deployment](docs/deployment.md).

## Current scope

- The demo is browser-local. Template drafts and automation rules can be configured there. The live worker runs those rules against an authorized workspace.
- WhatsApp drafts support a text body and numbered examples. Templates requiring media headers, dynamic buttons, or authentication components can be managed in WhatsApp Manager. Messages can use links from the configured media origin. Direct file uploads are pending.
- Workspace data controls include scoped CSV exports and lead archiving. Permanent deletion and retention policy tools are pending.
- The pricing section links to the free demo. Billing and paid plans are outside the initial release.
## Local environment variables

Backend credentials and server settings belong in `backend/.env`, copied from
`backend/.env.example`. Frontend settings belong in `frontend/.env.local`, copied
from `frontend/.env.example`. Both local environment files are ignored by Git.
The frontend needs only `API_ORIGIN`, which points to the local backend.

On Render and Vercel, set environment variables in each platform dashboard.
