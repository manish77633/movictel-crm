# Relay CRM

Relay imports leads from Google Sheets into workspaces for pipeline management, notes, and follow-ups. CRM admins manage sheet connections and client access.

## Try the interactive demo

```powershell
npm.cmd ci
npm.cmd run dev -w frontend
```

Open http://localhost:3000/workspace?demo=1. The demo stores sample data and edits in this browser. In **Integrations**, simulate a Facebook lead. In **Leads**, add a contact or schedule a follow-up. In **Inbox**, open Riya Sharma’s sample conversation and send a simulated reply. The demo makes no provider requests.

## Run the full stack locally

1. Copy the frontend and backend environment templates as described below.
2. Generate `ACCESS_SECRET` with the command below. Set it in `backend/.env`.
3. Run `docker compose up -d --wait` to start MongoDB and Redis. MongoDB must support transactions. The local single-node replica set is for development.
4. Set the admin bootstrap variables in `backend/.env`, run `npm run dev`, and sign in at http://localhost:3000/account.
5. See `/api/v1/health` for API/database readiness. The worker starts with the API. Set `RUN_WORKER=false` for an API-only development session.

```sh
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
npm run typecheck
npm run lint
npm test
npm run build
```

Production accounts are managed by the CRM admin. Set `CRM_ADMIN_EMAIL`, `CRM_ADMIN_PASSWORD`, and include the admin email in `GOOGLE_SHEETS_ADMIN_EMAILS` to provision the first admin on startup. Log in and use **Admin panel** to connect sheets and create client accounts. This flow works without Resend.

Set `TEST_MONGODB_URI` to a disposable **replica-set test instance** before running `npm test` to include the database and HTTP integration suite. The suite creates and drops a temporary database. It uses synthetic lead and WhatsApp data and stubs Graph API responses.

## Architecture

- `frontend/src/app` contains the landing page, account pages, and workspace entry point. Shared workspace components read and mutate data through the typed API client and TanStack Query.
- `backend/src/auth.ts` handles account sessions and workspace creation. `crm.ts` handles leads, notes, follow-ups, team membership, notifications, and reports.
- `sheet-sources.ts` connects sheets to workspaces and imports new leads. MongoDB membership checks limit client data to the workspaces the admin grants them.
- `worker.ts` handles scheduled jobs. Workspace socket events invalidate cached data.

See [deployment](docs/deployment.md) for Google Sheets credentials and client access setup.

## Local environment variables

Backend credentials and server settings belong in `backend/.env`, copied from
`backend/.env.example`. Frontend settings belong in `frontend/.env.local`, copied
from `frontend/.env.example`. Both local environment files are ignored by Git.
The frontend needs only `API_ORIGIN`, which points to the local backend.

On Render and Vercel, set environment variables in each platform dashboard.
