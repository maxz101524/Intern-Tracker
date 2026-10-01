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
- Keeps undated actions visible alongside upcoming deadlines, with quick completion
  and snooze controls.
- Automatically displays Applied roles as No response after 21 calendar days while
  leaving the stored status available for future updates.
- Shows weekly pace, daily activity, pipeline distribution, response rates, and
  Quick-versus-Targeted performance.
- Provides a searchable, sortable Applications ledger with direct status edits,
  bulk updates, undo, presets, saved views, and configurable columns.
- Opens any application from workspace search, with keyboard navigation and focus
  restored after closing an edit sheet.
- Connects directly to Gmail in the browser and detects application confirmations,
  assessment invitations, interview invitations, and rejection messages.
- Places detected messages in a review queue with explicit matching, duplicate
  resolution, supporting email links, dismissed-item recovery, and no automatic writes.
- Uses Gmail history checkpoints after a bounded 30-day first scan so later syncs
  inspect only new mailbox activity.
- Receives roles and status changes from Muse, the agent that submits applications,
  through a small keyed relay. Clean updates apply automatically with undo; possible
  duplicates, unmatched updates, and low-confidence items wait in Review.
- Shares a compact ledger (company, title, date, link, source, status history) back
  with Muse so it can skip roles already tracked and target updates by role ID.
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

## Mac workspace shortcuts

The layout is designed for Mac desktop browsers and adapts to resized windows and
Split View. There is no separate phone interface.

| Shortcut | Action |
| --- | --- |
| `⌘K` | Find an application or workspace action from any page |
| `N` | Add an application when not editing a field |
| `/` | Focus ledger search on Applications; open workspace search elsewhere |
| `↑` / `↓`, then `Enter` | Open a workspace search result |
| `⌘Enter` | Validate and save the open application |
| `Escape` | Close search or the application drawer and return focus |

Active filters can be removed individually. Changing the view clears selection;
bulk changes affect only the roles shown. Failed updates stay available to retry,
and application drafts remain on the current device until saved or discarded.

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

## Connect Muse sync

Muse posts batches after each run to `POST /api/muse/batches`; Paceboard pulls them
when it opens, when the tab regains focus, and every 10 minutes while open. The relay
only stores and forwards: applications stay in this browser's IndexedDB.

1. In the Vercel project, open **Storage → Marketplace**, add **Upstash for Redis**
   (free tier), and connect it to this project. It injects the Redis REST env vars.
2. Create two different long random keys, for example with `openssl rand -base64 32`,
   and add them as environment variables: `MUSE_SYNC_KEY` and `PACEBOARD_SYNC_KEY`.
3. Redeploy so the functions see the new variables.
4. In Paceboard, open **Settings & data → Muse sync**, paste the Paceboard key, and
   choose **Connect Muse**. The key stays in this browser's local storage only.
5. Give Muse the Muse key and the contract below.

| Endpoint | Key | Purpose |
| --- | --- | --- |
| `POST /api/muse/batches` | Muse | Append one `paceboard.muse-batch.v1` batch; re-posting a `batchId` is a no-op |
| `GET /api/muse/batches?after=<cursor>` | Paceboard | Read batches after a cursor, 50 per page |
| `GET /api/muse/ledger` | Muse | Read the `paceboard.ledger.v1` snapshot of tracked roles |
| `PUT /api/muse/ledger` | Paceboard | Replace the ledger snapshot |

The batch contract, auto-apply rules, and ledger format are documented in
`docs/superpowers/specs/2026-10-01-muse-sync-design.md` and validated by
`shared/museContract.ts`. Batches are retained for 90 days.

For local development, `npm run dev` does not serve `/api`. Set
`MUSE_RELAY_DEV_TARGET` in `.env.local` to the deployed origin to proxy relay calls, or
run `vercel dev` to serve the functions locally.

## Deploy to Vercel

The production Vercel project is connected to the GitHub repository. Pushing to
`main` runs `npm run build` and publishes `dist/` via `vercel.json`.

## Data and privacy

There is no Paceboard account, cookie, analytics SDK, or application-data backend.
Gmail access goes directly from the current browser to Google's APIs. The optional
Muse relay holds only Muse's incoming batches (90-day retention) and the compact
ledger; notes, next actions, job-description excerpts, and Gmail data never leave the
browser. The Paceboard sync key lives in local storage and is never exported.
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
