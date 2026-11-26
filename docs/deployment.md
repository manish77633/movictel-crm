# Deploy Relay

## Data services

Create a MongoDB Atlas replica set and a managed Redis instance with a no-eviction policy and persistence. Use TLS, application-specific credentials, and the network rules appropriate to the hosting services. Provide `MONGODB_URI` and `REDIS_URL` to the backend. The API initializes schema indexes during startup.

## Backend

On Railway or Render, install the monorepo with `npm ci`, build with `npm run build -w backend`, and start using `npm run start -w backend`. Set `NODE_ENV=production`, enable `TRUST_PROXY=1` when one trusted platform proxy sits in front of Express, and use `/api/v1/health` as the readiness endpoint. The API process runs one BullMQ worker by default. Start with one API replica, since Socket.IO events are published in process. Configure the email and Meta secrets from `.env.example` as applicable.

## Frontend

Create a Vercel project rooted at `frontend` and set `API_ORIGIN` to the backend’s HTTPS origin. The Next.js config forwards API and Socket.IO polling requests to the backend. Set `FRONTEND_ORIGIN` and `PUBLIC_API_ORIGIN` on the backend to the browser-facing Vercel or custom domain. Confirm proxied cookies and Socket.IO polling in staging. Register Meta webhook URLs over public HTTPS and configure the Facebook callback on the browser-facing hostname.

Run the staging acceptance checks in [Meta setup](meta.md) before handling real customer records.
## Google Sheets lead intake

Create a workspace for each client using the agency account. The creating account
is the owner and can switch between its client workspaces. Invite client users
with the **Client** role. Invite other agency staff as **Admin** in each workspace
they manage. Client users can view and work with the leads in their workspace.
The Agent role continues to see only assigned leads.

Enable the Google Sheets API in Google Cloud and create a service account. Put
its email in `GOOGLE_SHEETS_CLIENT_EMAIL` and its PEM private key in
`GOOGLE_SHEETS_PRIVATE_KEY` (literal `\n` line breaks also work). Set
`GOOGLE_SHEETS_ADMIN_EMAILS` to a comma-separated list of verified agency
accounts allowed to connect sheets. Set these values on the API and cron process only.

In the client's workspace, open **Integrations → Google Sheets**. Share the
private spreadsheet with the displayed service account as **Viewer**. Copy the
URL while the leads tab is selected so the link includes its `gid`. A link
without a `gid` uses the first tab. The first row must have a stable ID header
such as `Lead ID` or Meta's `id`, plus a name, phone, or email header. Keep long
lead IDs as plain text to preserve all digits. Supported Meta headers include
`full_name`, `phone_number`, `email`, and `campaign_name`.

Connect the link and click **Sync now** to verify the initial import. Later runs
add new IDs while preserving existing CRM records. Sheet changes and deletions
are not copied into existing CRM leads. Use one spreadsheet per client.

After building the backend, run `npm run sync:sheets -w backend` from the
repository root to test the scheduled command. On a Hostinger VPS, set the
deployment path, Node binary path, and backend environment for cron. Example:

```cron
*/5 * * * * cd /srv/relay && /usr/bin/flock -n /srv/relay/sheets-sync.lock /usr/bin/node backend/dist/sync-sheets.js
```

The command uses the backend MongoDB connection and does not require Redis.
The existing API also runs a persistent BullMQ worker by default for other CRM
features. Use a VPS or another runtime supporting that worker for the full CRM.
