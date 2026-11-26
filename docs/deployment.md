# Deploy Relay

## Data services

Create a MongoDB Atlas replica set and a managed Redis instance with a no-eviction policy and persistence. Use TLS, application-specific credentials, and the network rules appropriate to the hosting services. Provide `MONGODB_URI` and `REDIS_URL` to the backend. The API initializes schema indexes during startup.

## Backend

On Railway or Render, install the monorepo with `npm ci`, build with `npm run build -w backend`, and start using `npm run start -w backend`. Set `NODE_ENV=production`, enable `TRUST_PROXY=1` when one trusted platform proxy sits in front of Express, and use `/api/v1/health` as the readiness endpoint. The API process runs one BullMQ worker by default. Start with one API replica, since Socket.IO events are published in process. Configure the admin and Google Sheets variables listed below.

## Frontend

Create a Vercel project rooted at `frontend` and set `API_ORIGIN` to the backend’s HTTPS origin. The Next.js config forwards API and Socket.IO polling requests to the backend. Set `FRONTEND_ORIGIN` and `PUBLIC_API_ORIGIN` on the backend to the browser-facing Vercel or custom domain. Confirm proxied cookies and Socket.IO polling in staging.

## Google Sheets lead intake

Create workspaces for the teams or clients you manage and connect campaign sheets inside them. To provision the first admin, set
`CRM_ADMIN_EMAIL` to a new email address, include it in `GOOGLE_SHEETS_ADMIN_EMAILS`,
and set `CRM_ADMIN_PASSWORD` to a strong password of at least 12 characters. Deploy
and log in with those credentials. After the account is created, remove the two
`CRM_ADMIN_*` bootstrap variables and keep the email in the allowlist.

Enable the Google Sheets API in Google Cloud and create a service account. Put
its email in `GOOGLE_SHEETS_CLIENT_EMAIL` and its PEM private key in
`GOOGLE_SHEETS_PRIVATE_KEY` (literal `\n` line breaks also work). Set
`GOOGLE_SHEETS_ADMIN_EMAILS` to a comma-separated list of verified agency
accounts allowed to connect sheets. Set these values on the API and cron process only.

In the client's workspace, open **Admin panel → Campaign sheets**. Share the
private spreadsheet with the displayed service account as **Viewer**. Copy the
URL while the leads tab is selected so the link includes its `gid`. A link
without a `gid` uses the first tab. The first row must have a stable ID header
such as `Lead ID` or Meta's `id`, plus a name, phone, or email header. Keep long
lead IDs as plain text to preserve all digits. Supported Meta headers include
`full_name`, `phone_number`, `email`, and `campaign_name`.

Give each sheet a campaign name in the CRM. Click **Sync now** for one sheet
or **Sync all** for the workspace. Each connection deduplicates its own Lead IDs.
New rows become leads. Later syncs refresh the original sheet fields in lead details
and retain CRM statuses, notes, assignments, and edited contact fields.

Use **Admin panel → Client access** to create or grant access to multiple client
accounts in each workspace. Select individual campaigns for each client or grant
all current and future campaigns. Change the selection with **Edit campaigns**.
The client's dashboard offers **All campaigns**, individual campaign filters, and
**Refresh leads** for the campaigns they can access. Store phone numbers with their
country code for WhatsApp links.

**Remove access** removes a client from the current workspace. **Delete account**
removes the client everywhere and requires admin access to all of their workspaces.
**Remove sheet** disconnects the spreadsheet and archives its CRM leads. Workspace
owners can delete a workspace from **Manage workspaces**, which stops its sheet syncs
and removes member access while retaining the archived CRM records.

The backend checks for sheets due to sync every 30 seconds while it is running.
Each sheet becomes due five minutes after its last attempt. Manual refresh fetches
immediately when the sheet is available. If your web service sleeps or stops,
use an independent job every five minutes for unattended imports. If you configure
that job, set `SHEETS_AUTO_SYNC=false` on the web service to avoid duplicate reads.
The web service and scheduled command share the same database leases.

After building the backend, run `npm run sync:sheets -w backend` from the
repository root to test the scheduled command. On a Hostinger VPS, set the
deployment path, Node binary path, and backend environment for cron. Example:

```cron
*/5 * * * * cd /srv/relay && /usr/bin/flock -n /srv/relay/sheets-sync.lock /usr/bin/node backend/dist/sync-sheets.js
```

The command uses the backend MongoDB connection and does not require Redis.
The existing API also runs a persistent BullMQ worker by default for other CRM
features. Use a VPS or another runtime supporting that worker for the full CRM.
