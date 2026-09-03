# Paceboard

A private, local-first internship application tracker built around one rule:
count everything, curate almost nothing.

## What it does

- Tracks a configurable Monday–Sunday application target.
- Logs quick, targeted, individual, and aggregate applications.
- Shows daily progress and an eight-week trend.
- Keeps company, role, resume, notes, and outcomes optional.
- Splits one application from a batch without changing the total.
- Stores data in IndexedDB in the current browser.
- Exports complete JSON backups and spreadsheet-friendly CSV files.

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

After authenticating the Vercel CLI:

```bash
vercel
vercel --prod
```

Vercel uses `npm run build` and publishes `dist/` via `vercel.json`.

## Data and privacy

There is no server, account, cookie, analytics SDK, or external application-data
API. All entries remain in IndexedDB for the exact browser and site origin that
created them. Clearing site data, changing browsers, or changing the production
domain can make that data unavailable. Download a JSON backup regularly; CSV is
intended for analysis, not full restoration.
