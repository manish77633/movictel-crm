# Deploy Relay

## Data services

Create a MongoDB Atlas replica set and a managed Redis instance with a no-eviction policy and persistence. Use TLS, application-specific credentials, and the network rules appropriate to the hosting services. Provide `MONGODB_URI` and `REDIS_URL` to the backend. The API initializes schema indexes during startup.

## Backend

On Railway or Render, install the monorepo with `npm ci`, build with `npm run build -w backend`, and start using `npm run start -w backend`. Set `NODE_ENV=production`, enable `TRUST_PROXY=1` when one trusted platform proxy sits in front of Express, and use `/api/v1/health` as the readiness endpoint. The API process runs one BullMQ worker by default. Start with one API replica, since Socket.IO events are published in process. Configure the admin and Google Sheets variables listed below.

## Frontend

Create a Vercel project rooted at `frontend` and set `API_ORIGIN` to the backend’s HTTPS origin. The Next.js config forwards API and Socket.IO polling requests to the backend. Set `FRONTEND_ORIGIN` and `PUBLIC_API_ORIGIN` on the backend to the browser-facing Vercel or custom domain. Confirm proxied cookies and Socket.IO polling in staging.

## Google Sheets lead intake

Create one workspace per Google Sheet. To provision the first admin, set
`CRM_ADMIN_EMAIL` to a new email address, include it in `GOOGLE_SHEETS_ADMIN_EMAILS`,
and set `CRM_ADMIN_PASSWORD` to a strong password of at least 12 characters. Deploy
and log in with those credentials. After the account is created, remove the two
`CRM_ADMIN_*` bootstrap variables and keep the email in the allowlist.

Enable the Google Sheets API in Google Cloud and create a service account. Put
its email in `GOOGLE_SHEETS_CLIENT_EMAIL` and its PEM private key in
`GOOGLE_SHEETS_PRIVATE_KEY` (literal `\n` line breaks also work). Set
`GOOGLE_SHEETS_ADMIN_EMAILS` to a comma-separated list of verified agency
accounts allowed to connect sheets. Set these values on the API and cron process only.

In the sheet's workspace, open **Admin panel → Google Sheets**. Share the
private spreadsheet with the displayed service account as **Viewer**. Copy the
URL while the leads tab is selected so the link includes its `gid`. A link
without a `gid` uses the first tab. The first row must have a stable ID header
such as `Lead ID` or Meta's `id`, plus a name, phone, or email header. Keep long
lead IDs as plain text to preserve all digits. Supported Meta headers include
`full_name`, `phone_number`, `email`, and `campaign_name`.

Connect the link and click **Sync now** to verify the initial import. Later runs
add new IDs while preserving existing CRM records. Sheet changes and deletions
are not copied into existing CRM leads. Use one spreadsheet per client.

Use **Admin panel → Client access → Create client account** to set the client's
credentials and grant access to the current workspace. Switch to another workspace
and choose **Grant workspace access** to give the same client access to that sheet.
Use **Revoke access** to remove a client from the selected workspace. Send sign-in
details to the client privately. Client account creation and Sheets sync do not
require Resend.

After building the backend, run `npm run sync:sheets -w backend` from the
repository root to test the scheduled command. On a Hostinger VPS, set the
deployment path, Node binary path, and backend environment for cron. Example:

```cron
*/5 * * * * cd /srv/relay && /usr/bin/flock -n /srv/relay/sheets-sync.lock /usr/bin/node backend/dist/sync-sheets.js
```

The command uses the backend MongoDB connection and does not require Redis.
The existing API also runs a persistent BullMQ worker by default for other CRM
features. Use a VPS or another runtime supporting that worker for the full CRM.
