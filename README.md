# Paceboard

A private, local-first internship application tracker for keeping one useful
record per role without turning the job search into a data-entry project.

## What it does

- Tracks every application as one role with a company, title, and submission date.
- Separates Quick applications from Targeted applications that involved a referral,
  event, tailored resume, cover letter, or other meaningful extra effort.
- Keeps a correctable status history for assessments, screens, interviews, offers,
  rejections, and withdrawals, with Gmail message IDs used for idempotency.
- Tracks optional next actions and deadlines, surfaced by urgency on Overview.
- Automatically displays Applied roles as No response after 21 calendar days while
  leaving the stored status available for future updates.
- Shows weekly pace, daily activity, pipeline distribution, response rates, and
  Quick-versus-Targeted performance.
- Provides a searchable, sortable Applications ledger with direct status edits,
  bulk updates, undo, presets, saved views, and configurable columns.
- Connects directly to Gmail in the browser and detects application confirmations,
  assessment invitations, interview invitations, and rejection messages.
- Places detected messages in a review queue with explicit matching, duplicate
  resolution, supporting email links, dismissed-item recovery, and no automatic writes.
- Uses Gmail history checkpoints after a bounded 30-day first scan so later syncs
  inspect only new mailbox activity.
- Stores data in IndexedDB in the current browser.
- Exports complete JSON backups, previews merge/replace restores, and produces
  one-row-per-role CSV files.

## Run locally

```bash
npm install
npm run dev
```

Open the local URL printed by Vite. Other useful commands:

```bash
npm test
npm run lint
npm run build
```

The app works without Gmail configuration; manual tracking, analytics, and backup
remain available.

## Configure Gmail import

Paceboard uses a browser-only Google OAuth token and the Gmail read-only scope. It
does not use a client secret or backend.

1. In Google Cloud Console, create or select a project and enable the Gmail API.
2. Configure the Google Auth Platform consent screen. For a private deployment,
   keep the app in testing and add the Gmail address you will connect as a test
   user.
3. Create an OAuth client with application type **Web application**.
4. Add `http://localhost:5173` under Authorized JavaScript origins. Add the exact
   production origin shown by Vercel as another authorized JavaScript origin.
5. Copy `.env.example` to `.env.local` and replace the example value with the Web
   application client ID. Never add a client secret.
6. Restart the development server, open **Settings & data**, and choose
   **Connect Gmail & scan**.

For Vercel, create a project environment variable named
`VITE_GOOGLE_CLIENT_ID` with the same client ID and redeploy. Because
`gmail.readonly` is a restricted Gmail scope, an app made available beyond its
configured test users may require Google's OAuth verification. A personal test
user can encounter Google's unverified-app notice depending on the consent-screen
configuration.

The initial connection scans only the prior 30 days. Later runs use Gmail's
history cursor, and an expired cursor triggers a two-day overlap recovery scan.
Google requires a user gesture to issue a new browser token, so Paceboard syncs
automatically only while its in-memory token remains valid; otherwise it presents
**Reconnect Gmail & sync**.

## Deploy to Vercel

The production Vercel project is connected to the GitHub repository. Pushing to
`main` runs `npm run build` and publishes `dist/` via `vercel.json`.

## Data and privacy

There is no Paceboard server, account, cookie, analytics SDK, or application-data
backend. Gmail access goes directly from the current browser to Google's APIs.
Access tokens stay in memory and never enter IndexedDB or backups. Complete email
bodies are decoded only for local detection and immediately discarded; Paceboard
stores the derived review fields, sender, subject, Gmail identifiers, and sync
checkpoint locally.

All applications and Gmail review records remain in IndexedDB for the exact
browser and site origin that created them. Clearing site data, changing browsers,
or changing the production domain can make that data unavailable. Download a JSON
backup regularly; JSON v4 includes optional actions, saved views, settings, and
non-secret Gmail review/checkpoint data, and it still restores v2/v3 backups. CSV is intended for analysis, not full
restoration.

The v2 storage upgrade intentionally clears legacy aggregate entries while
preserving settings. Version 1 backups are not accepted because aggregate rows
cannot be converted into accurate company-and-role records.
