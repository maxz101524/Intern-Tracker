# Paceboard

A private, local-first internship application tracker for keeping one useful
record per role without turning the job search into a data-entry project.

## What it does

- Tracks every application as one role with a company, title, and submission date.
- Separates Quick applications from Targeted applications that involved a referral,
  event, tailored resume, cover letter, or other meaningful extra effort.
- Keeps an append-only status history for assessments, screens, interviews, offers,
  rejections, and withdrawals.
- Automatically displays Applied roles as No response after 21 calendar days while
  leaving the stored status available for future updates.
- Shows weekly pace, daily activity, pipeline distribution, response rates, and
  Quick-versus-Targeted performance.
- Provides a searchable Applications ledger and a fast “Save & add another” flow
  for backfilling or high-volume application sessions.
- Stores data in IndexedDB in the current browser.
- Exports complete JSON backups and one-row-per-role CSV files.

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

## Deploy to Vercel

The production Vercel project is connected to the GitHub repository. Pushing to
`main` runs `npm run build` and publishes `dist/` via `vercel.json`.

## Data and privacy

There is no server, account, cookie, analytics SDK, or external application-data
API. All applications remain in IndexedDB for the exact browser and site origin that
created them. Clearing site data, changing browsers, or changing the production
domain can make that data unavailable. Download a JSON backup regularly; CSV is
intended for analysis, not full restoration.

The v2 storage upgrade intentionally clears legacy aggregate entries while
preserving settings. Version 1 backups are not accepted because aggregate rows
cannot be converted into accurate company-and-role records.
