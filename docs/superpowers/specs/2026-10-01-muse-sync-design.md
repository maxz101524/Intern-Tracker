# Muse Sync Design

**Date:** 2026-10-01
**Status:** Approved for implementation on `feat/muse-sync`

## Summary

Muse, Max's personal agent, discovers internships, submits applications, and reads Gmail for outcomes. Today Muse and Paceboard exchange full v4 backups by hand: Max exports, Muse merges, Max restores. This design replaces that loop with an automatic one:

1. After each run, Muse posts a **batch** of new applications and status events to a small relay in the Paceboard Vercel project.
2. Whenever Paceboard is open, it pulls new batches, **auto-applies clean items**, and sends ambiguous ones to Review.
3. Paceboard publishes a compact **ledger** of its roles back to the relay. Muse reads it before each run for deduplication and to target status updates by entry ID.

IndexedDB stays the source of truth. The relay stores and forwards only. It never merges and never sees notes, next actions, or Gmail review data.

## Goals

- Applications submitted by Muse and status changes Muse detects appear in Paceboard without a manual export or import.
- Muse no longer needs Max's backup to deduplicate.
- Max's manual edits are never overwritten. Paceboard only appends status events, creates new roles, and fills blank fields.
- Re-pulling, re-posting, and overlap with Paceboard's own Gmail scan never create duplicates.
- Nothing is lost while Paceboard is closed.

## Non-goals

- Real-time push. Paceboard pulls when open.
- Multi-device sync of Paceboard data. The ledger is a one-way summary for Muse, not a replication channel.
- Accounts or user management. Two static keys protect the relay.
- Changing Paceboard's Gmail detector.

## Architecture

```
Muse (hourly run)
  ├─ GET  /api/muse/ledger              (MUSE_SYNC_KEY)
  └─ POST /api/muse/batches             (MUSE_SYNC_KEY)
                                             │
                Vercel Function (Node) ──────┼──→ Upstash Redis
                                             │      stream muse:batches   (append-only, ~90-day MINID trim)
                                             │      key    muse:batch:<batchId> → stream id (90-day TTL)
Paceboard (browser, when open)               │      key    paceboard:ledger
  ├─ GET  /api/muse/batches?after=<cursor>  (PACEBOARD_SYNC_KEY)
  └─ PUT  /api/muse/ledger                  (PACEBOARD_SYNC_KEY)
```

### Storage choice

The relay uses Upstash Redis, added through the Vercel Marketplace. Vercel Blob was rejected. On Hobby, every `put()` and `list()` counts as an advanced operation, capped at 2,000 a month, and exceeding the cap locks Blob for 30 days. Hourly Muse uploads plus browser polling would hit that limit. A Redis stream gives an append-only log with natural cursors, and the free tier covers this workload (a few hundred commands a day) many times over.

The relay reads `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` and falls back to the `KV_REST_API_URL` / `KV_REST_API_TOKEN` names the Vercel integration injects.

### Authentication

Two random keys are stored as Vercel environment variables:

| Key | Holder | Allowed |
| --- | --- | --- |
| `MUSE_SYNC_KEY` | Muse's credential vault | `POST /batches`, `GET /ledger` |
| `PACEBOARD_SYNC_KEY` | Max pastes it into Paceboard Settings; stored in that browser's `localStorage` | `GET /batches`, `PUT /ledger` |

Keys travel as `Authorization: Bearer <key>` and are compared in constant time over SHA-256 digests. A wrong key returns 401. A missing relay configuration (env or Redis) returns 503 with a setup message. The browser key never enters the bundle, IndexedDB, backups, URLs, logs, or error messages. With separate keys, a key in browser storage cannot inject roles, and Muse's key cannot read the queue.

### Endpoints

**`POST /api/muse/batches`** (Muse key)
- The body is a batch (contract below), at most 256 KB with at most 200 items.
- Shape validation returns 400 with `{ error, issues: [{ path, message }] }` so Muse can correct and resend.
- Re-posting an existing `batchId` returns the original stream ID with `duplicate: true` and stores nothing.
- Success returns 201 with `{ id, duplicate }`.

**`GET /api/muse/batches?after=<id>&limit=<n>`** (Paceboard key)
- Returns batches strictly after `after` (or from the beginning), oldest first, with at most 50 per page. The response is `{ batches: [{ id, receivedAt, batch }], nextCursor, hasMore, oldestId }`.
- When `after` is older than `oldestId`, retention has trimmed batches the browser never saw. Paceboard warns about this.

**`GET /api/muse/ledger`** (Muse key) returns the ledger, or 404 if Paceboard has never published one.

**`PUT /api/muse/ledger`** (Paceboard key) stores the ledger, up to 1 MB.

## Batch contract (`paceboard.muse-batch.v1`)

```json
{
  "schema": "paceboard.muse-batch.v1",
  "batchId": "run-2026-10-01T14:00-0400",
  "generatedAt": "2026-10-01T18:07:12Z",
  "newEntries": [{
    "id": "UUID Muse creates once and keeps forever",
    "company": "Scale AI",
    "title": "ML Research Intern",
    "submittedDate": "2026-10-01",
    "effort": "quick",
    "source": "Company site",
    "url": "https://…",
    "resumeVariant": "ML",
    "notes": "$52/hr · SF",
    "origin": { "provider": "gmail", "messageId": "confirmation email id" }
  }],
  "statusUpdates": [{
    "id": "UUID; becomes the status event id",
    "entryId": "target entry id (preferred)",
    "match": { "company": "…", "title": "…", "submittedDate": "YYYY-MM-DD" },
    "status": "online_assessment",
    "date": "2026-10-03",
    "origin": { "provider": "gmail", "messageId": "…" },
    "confidence": "high",
    "note": "HackerRank",
    "dueDate": "2026-10-08"
  }]
}
```

- `newEntries` use the v4 `ApplicationEntry` shape. `id`, `company`, `title`, `submittedDate` (Eastern date), and `effort` are required. `statusHistory` may be omitted, in which case Paceboard creates the `applied` event. Later statuses always arrive as `statusUpdates`.
- `statusUpdates` require `id`, `status` (any status except `applied`), `date`, and either `entryId` or `match`. `confidence` defaults to `high`. A `low` confidence update always goes to Review.
- `note` appears in Muse activity and on review cards. It is never written into the entry on its own.
- `dueDate` (optional, `YYYY-MM-DD`) marks a deadline for an assessment, screen, interview, or offer. When the role has no open next action, Paceboard creates one, for example "Complete the online assessment — HackerRank" due on that date, so it surfaces under Needs attention. An existing plan is never replaced, and undo removes only the action Muse created.
- Muse should use the source and resume-variant labels published in the ledger's `vocabulary`.

## Paceboard ingest

### Pull cycle

Triggers: application load, tab regaining visibility, every 10 minutes while visible, and **Pull now** in Settings. A single in-flight guard prevents overlapping pulls.

1. Read batches after the stored cursor, following `hasMore`.
2. Expand each batch into items in order: entries first, then status updates.
3. Plan all items against current entries, Muse items, and pending Gmail candidates with a pure function, `planMuseIngest`. Items from earlier in the same pull are visible to later ones, so a new role and its OA in the same batch both apply.
4. Commit entry writes, Muse item records, Gmail candidate resolutions, and the new cursor in **one IndexedDB transaction**. The cursor never advances without the items.
5. Show a toast such as "Muse: 4 roles added, 2 status updates · 1 needs review". Nothing appears when a pull is empty.

### Item rules

An item is keyed `entry:<id>` or `status:<id>`. If that key already exists in the Muse item table, the item is ignored entirely, so dismissed items never come back.

**New entry**
1. Fails `createApplication` validation → **Review** (`invalid`, with the error).
2. An entry with the same `id` exists → **skipped**.
3. The payload's Gmail `origin.messageId` already appears on an entry or status event → **fill blanks** on that entry (`url`, `source`, `resumeVariant`, `notes`, `origin`) → **applied**. If nothing is blank, the item is **skipped**.
4. `findPossibleDuplicate` (the Gmail review's company/title/date similarity) finds a match → **Review** (`possible_duplicate`). The card shows both URLs so separate requisitions can be told apart.
5. Otherwise → **create** the entry with Muse's ID → **applied**.

**Status update**
1. Invalid status or date → **Review** (`invalid`).
2. A status event with the same `id` exists, or its Gmail message ID is already on a status event → **skipped**.
3. Resolve the target:
   - `entryId` if it exists.
   - Otherwise `match`, by exact normalized company + title + submitted date. If that finds exactly one role, use it.
   - Otherwise **Review** (`unmatched`). The card offers ranked suggestions from `matchGmailStatusToApplications`.
4. `confidence: low` → **Review** (`low_confidence`).
5. The target's current status is `rejected` or `withdrawn` and the update differs → **Review** (`closed_application`).
6. The target already has this status, or the date is before submission → **skipped** / **Review** (`invalid`).
7. Otherwise → append the event with Muse's ID and Gmail origin → **applied**.

**Gmail overlap.** When a Muse item is applied, any pending Gmail candidate with the same message ID is marked imported and linked to the target role. Paceboard's Gmail sync already skips message IDs present on entries and status events, so later scans also stay quiet.

### Muse item record

```ts
interface MuseItem {
  key: string                       // 'entry:<id>' | 'status:<id>'
  kind: 'entry' | 'status'
  batchId: string
  streamId: string
  payload: MuseEntryPayload | MuseStatusPayload
  state: 'applied' | 'pending' | 'dismissed' | 'skipped'
  reason?: 'invalid' | 'possible_duplicate' | 'unmatched' | 'low_confidence' | 'closed_application'
  detail?: string                   // validation message
  suggestedEntryIds?: string[]
  result?: { entryId: string; action: 'created' | 'filled' | 'status_added'; filledFields?: string[] }
  receivedAt: string
  reviewedAt?: string
}
```

Sync state (single row `muse`): `cursor`, `lastPulledAt`, `lastLedgerHash`, `lastLedgerPublishedAt`, `retentionGap`.

### Review and undo

- **Review → Muse** lists pending Muse items as cards. Actions depend on the reason:
  - `possible_duplicate`: **Same role (fill blanks)**, **Add separately**, or **Dismiss**.
  - `unmatched`, `low_confidence`, `closed_application`: choose or confirm the role, then **Apply** or **Dismiss**.
  - `invalid`: **Dismiss** only.
- **Review → Muse activity** lists applied items from newest to oldest, with **Undo**:
  - Undo of a created role deletes it.
  - Undo of a status event removes that event.
  - Undo of a fill clears only the fields Muse filled, and only if they still hold Muse's values.
  - An undone item becomes **dismissed**.
- **Review → Dismissed** shows both Gmail and Muse items. Restoring a Muse item returns it to pending.
- The navigation badge counts pending Gmail and Muse items together.

## Ledger (`paceboard.ledger.v1`)

```json
{
  "schema": "paceboard.ledger.v1",
  "generatedAt": "…",
  "museCursor": "last stream id consumed",
  "lastPulledAt": "…",
  "pendingMuseReview": 1,
  "vocabulary": { "sources": ["…"], "resumeVariants": ["…"] },
  "entries": [{
    "id": "…", "company": "…", "title": "…", "submittedDate": "YYYY-MM-DD",
    "url": "…", "source": "…", "status": "rejected",
    "statusHistory": [{ "id": "…", "status": "applied", "date": "YYYY-MM-DD" }]
  }]
}
```

Notes, next actions, job-description excerpts, effort, resume variant, and Gmail data are excluded. Paceboard publishes after a pull or any data change, debounced by a few seconds, and only when a hash of the ledger body (excluding timestamps) differs from the last published hash.

## Settings

A **Muse sync** section appears beside Gmail import:

- **Not connected:** paste the Paceboard sync key → **Connect**, which validates by pulling.
- **Connected:** last pull, last ledger publish, **Pull now**, and **Disconnect** (forgets the key in this browser; keeps data).
- **Relay not configured** (503): explains that the deployment needs Upstash and the keys.
- **Error:** the message plus retry. The cursor and data are untouched.

## Backup

The v4 backup gains an optional `muse` section with `items` and `syncState`. The version number stays at 4 so Muse's existing v4 tooling keeps working. Older backups restore with an empty Muse section. A merge restore unions items by key and keeps the newer cursor. The sync key is never exported.

## Error handling

- **Network failure or 5xx:** keep the cursor and retry on the next trigger.
- **401:** stop polling and show "The sync key was rejected."
- **One malformed item** never blocks a batch. It becomes an `invalid` Review item.
- **Ledger publish failure:** retried on the next change or pull, without a toast.
- **Retention gap:** a persistent notice in Settings.

## Testing

- Relay handlers, run against an in-memory store:
  - auth, both keys, and constant-time comparison
  - validation issues
  - size limits
  - duplicate `batchId`
  - cursor paging
  - retention gap
  - ledger round trip
  - 503 when the relay is unconfigured
- `planMuseIngest`: every rule above, including same-batch entry+status, Gmail overlap, and idempotent re-pull.
- Repository: v4→v5 Dexie migration preserves data; atomic commit; undo and restore.
- Backup: `muse` section round trip; restoring older backups.
- UI: Settings connect/error states; Review Muse cards; activity undo; combined badge.
- Release: `npm test`, `npm run lint`, `npm run build`, and a deployed smoke test with curl against the relay.

## Rollout

1. Merge and deploy (the app works unchanged without the relay configured).
2. Max adds Upstash Redis through the Vercel Marketplace, creates both keys, and redeploys.
3. Max connects Paceboard with the Paceboard key. The first ledger publish happens immediately.
4. Max gives Muse its key and the update prompt. Muse reads the ledger, then posts its first batch.
