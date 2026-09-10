# Gmail Review Queue Design

**Date:** 2026-09-10  
**Status:** Approved in chat; awaiting review of this written specification

## Summary

Paceboard will connect directly to one Gmail account from the browser, detect job-application confirmation emails, and place derived application candidates into a local review queue. It will not create application records without review. The review flow defaults each candidate to Quick, allows correction and Targeted classification, and advances one candidate at a time.

The integration preserves Paceboard's static, local-first architecture. Gmail access tokens and complete email bodies are never stored. Application data, review candidates, processed Gmail message IDs, and synchronization checkpoints remain in IndexedDB and are included in Paceboard's JSON backup where needed for correct restoration.

## Goals

- Reduce application logging to a short review action instead of repeated manual entry.
- Synchronize incrementally instead of rescanning the mailbox on every visit.
- Avoid duplicate candidates and duplicate application records.
- Keep all parsing and derived data in the browser without an application backend or AI service.
- Preserve every existing v2 application and setting during the storage upgrade.
- Recover clearly from expired authorization, expired Gmail history cursors, network failures, and malformed messages.

## Non-goals

- Background synchronization while Paceboard is closed.
- Automatic creation of application records without review.
- Monitoring assessments, interviews, rejections, or other status updates.
- Sending, labeling, modifying, deleting, or archiving Gmail messages.
- Storing refresh tokens, Gmail access tokens, or complete message bodies.
- Supporting multiple Gmail accounts in the first release.
- Using an LLM or external parsing service.

## User Experience

### Settings and authorization

Settings & data gains a Gmail import section with these states:

1. **Not configured:** Explain that the deployment needs a Google OAuth client ID.
2. **Disconnected:** Show `Connect Gmail & scan` and the read-only privacy explanation.
3. **Connected for this browser session:** Show the connected address, last successful sync, `Sync now`, and `Disconnect`.
4. **Authorization expired:** Show `Reconnect Gmail & sync`; no error is treated as data loss.
5. **Synchronizing:** Disable repeat actions and show progress text.
6. **Failed:** Preserve the prior checkpoint and queue, then show a retryable error.

On initial connection, Paceboard scans the prior 30 days for confirmation candidates. On later application loads, Paceboard synchronizes automatically only when it already has a valid access token for the current browser session. Google requires a user gesture to issue a replacement browser token, so an expired or absent token produces the reconnect action rather than a popup on page load.

Disconnecting revokes the current token when possible and removes in-memory authorization. It does not delete applications, candidates, processed-message records, or the Gmail synchronization checkpoint. A separate `Reset Gmail import history` action is required to clear those local records, and it must explain that previously dismissed emails may return.

### Review queue

The primary navigation gains `Review` with a pending-count badge. It is visible even when empty so the import feature remains discoverable.

The page presents one pending candidate at a time with:

- editable company and role title;
- email receipt date as the proposed submission date;
- sender and subject as parsing context;
- Quick selected by default and Targeted available as the alternative;
- an `Open in Gmail` link;
- a warning when an existing application has the same normalized company, role title, and submission date;
- `Add & next`, `Dismiss`, and previous/next navigation when multiple items remain.

`Add & next` creates a normal application whose first status is Applied, marks the candidate imported, and advances. `Dismiss` marks the message processed without creating an application. Invalid or missing company/title fields prevent acceptance but never prevent dismissal.

After synchronization, a toast reports the number of new candidates. It does not force navigation away from the user's current page.

## Architecture

The integration is split into narrow modules:

- `gmail/auth`: loads Google Identity Services, requests the minimum Gmail scope, tracks the short-lived token in memory, exposes token expiry, and revokes access on disconnect.
- `gmail/api`: wraps Gmail REST calls for the profile, message listing, message retrieval, and history listing.
- `gmail/message`: decodes Gmail payloads and extracts normalized headers plus plain text from MIME parts without preserving the raw message.
- `gmail/detector`: decides whether a normalized message is an application confirmation and extracts company/title candidates.
- `gmail/sync`: coordinates initial and incremental synchronization, pagination, bounded recovery, deduplication, and atomic checkpoint updates.
- `domain/gmail`: owns review-candidate validation, duplicate comparison, and transitions between pending, imported, and dismissed.
- `storage/repository`: persists candidates, processed-message records, and Gmail sync state through explicit repository methods.
- `components/GmailReview`: renders the one-at-a-time review workflow.
- `components/GmailSettings`: renders connection, sync, disconnect, and local-history controls.

Google-specific types remain behind the Gmail modules. Existing analytics and application components continue to consume ordinary `ApplicationEntry` values.

## OAuth and Privacy

The frontend loads Google Identity Services and uses a Web application OAuth client ID supplied as `VITE_GOOGLE_CLIENT_ID`. The authorized JavaScript origins must include local development and the production Vercel origin.

The integration requests only `https://www.googleapis.com/auth/gmail.readonly`. This is a Google restricted scope, so the documentation must explain the personal test-user configuration and Google's unverified-app behavior. No client secret is placed in the frontend.

The access token is held in memory and is never written to IndexedDB, local storage, logs, backups, URLs, or error messages. The full decoded email is passed directly to the detector and then discarded. Persisted candidates retain only the fields needed to review and deduplicate them.

## Data Model

### Application origin

`ApplicationEntry` gains an optional origin:

```ts
interface GmailApplicationOrigin {
  provider: 'gmail'
  messageId: string
}
```

Manual and restored v2 entries remain valid without an origin. Gmail acceptance uses the origin message ID as the strongest duplicate key.

### Review candidate

```ts
type GmailCandidateState = 'pending' | 'imported' | 'dismissed'

interface GmailCandidate {
  messageId: string
  threadId: string
  receivedAt: string
  submittedDate: string
  sender: string
  subject: string
  company: string
  title: string
  confidence: 'high' | 'medium'
  matchedRule: string
  state: GmailCandidateState
  createdAt: string
  reviewedAt?: string
}
```

Candidates do not contain raw HTML, complete text bodies, snippets, access tokens, or attachment data.

### Synchronization state

```ts
interface GmailSyncState {
  key: 'gmail'
  accountEmail?: string
  historyId?: string
  lastSuccessfulSyncAt?: string
  initialSyncCompleted: boolean
}
```

The database adds candidate and processed-message tables in version 3 without clearing existing stores. Processed messages keep `messageId`, disposition, and processed timestamp. Candidate state is retained for review history, while the processed table provides a compact permanent deduplication boundary even if reviewed candidates are later pruned.

## Synchronization Algorithm

### Initial sync

1. Obtain a browser access token through an explicit user action.
2. Read the Gmail profile to identify the account and latest history ID.
3. List messages received in the previous 30 days using a conservative Gmail query for application-confirmation language.
4. Retrieve matching messages with pagination and a bounded concurrency limit.
5. Skip message IDs already represented by processed records, candidates, or imported application origins.
6. Normalize and parse each message, persist high- or medium-confidence confirmation candidates, and mark non-confirmations processed.
7. Only after all pages finish successfully, atomically save the newest profile history ID and `lastSuccessfulSyncAt`.

If any page fails, successfully written deduplication records may remain, but the history checkpoint does not advance. Retrying is safe because every message ID is idempotent.

### Incremental sync

1. Request Gmail history newer than the stored `historyId`, following all pages.
2. Collect newly added message IDs and deduplicate them before retrieval.
3. Parse and persist results through the same initial-sync pipeline.
4. Atomically advance the history ID only after successful completion.

Gmail can return HTTP 404 when a stored history ID is outside its available range. In that case, Paceboard performs a bounded recovery scan beginning two days before `lastSuccessfulSyncAt`, using message IDs for deduplication, then establishes a fresh profile history ID. It never performs an unbounded mailbox scan.

### Automatic behavior

On application startup, synchronization begins only if a non-expired in-memory token is available and no sync is already running. A missing or expired token changes the Settings action to `Reconnect Gmail & sync`; Paceboard does not trigger an unsolicited OAuth popup.

## Detection and Parsing

The Gmail query reduces the candidate set but is not treated as proof. Detection runs locally using normalized subject, sender, and decoded text.

The first release includes named rule adapters for common recruiting systems and a generic confirmation rule. Adapters may recognize Workday, Greenhouse, Lever, Ashby, SmartRecruiters, and iCIMS patterns. A message must contain application-submission confirmation evidence; job alerts, saved-job notices, recruiter outreach, assessment invitations, interview scheduling, and status updates are excluded.

Extraction precedence is:

1. explicit structured role/company phrases in the message;
2. subject patterns;
3. sender display name and domain as a company fallback.

High confidence requires both a confirmation marker and credible company/title fields. Medium confidence may have a fallback-derived field but still requires confirmation evidence. Low-confidence messages are marked processed without entering the queue. Synthetic fixtures cover each rule; no real email content is committed.

## Duplicate Handling

Deduplication uses layered checks:

1. exact Gmail message ID across processed records, candidates, and imported application origins;
2. normalized company, title, and submission date against existing entries;
3. normalized company and title within a three-day window as a visible possible-duplicate warning.

Layer 1 suppresses the candidate. Layers 2 and 3 preserve the candidate but warn the user, because forwarded confirmations, corrected receipts, and multiple requisitions can look similar. The user may still add the role.

## Backup and Migration

The IndexedDB v3 migration only adds stores and indexes; it does not clear or rewrite v2 application data.

JSON backup version 3 includes applications, settings, review candidates, processed Gmail message records, and non-secret sync state. Restore accepts both v2 and v3:

- v2 restores applications and settings, with empty Gmail tables and a fresh sync state;
- v3 validates all records before atomically replacing the corresponding local data;
- OAuth tokens are never exported or restored.

CSV remains one row per accepted application. It adds a Gmail origin/message-ID column only when present; pending and dismissed candidates are not included.

## Error Handling

- A 401 response expires the in-memory authorization and requests reconnection without advancing the checkpoint.
- A history 404 triggers the bounded recovery scan.
- A Gmail rate-limit or transient server response surfaces a retryable message and preserves the checkpoint.
- One malformed MIME message is marked with a safe processing error and does not fail the entire sync; retry is available from the review page.
- Offline startup leaves existing data fully usable and reports that Gmail sync was skipped.
- Parsing and API errors never include an access token or full message content.

## Testing and Verification

Automated coverage includes:

- base64url and multipart MIME normalization;
- supported ATS and generic detection fixtures;
- exclusion fixtures for alerts and later-stage status messages;
- initial sync pagination and 30-day boundary;
- incremental history sync and history-404 recovery;
- exact-message idempotency and possible-duplicate warnings;
- atomic checkpoint behavior on partial failure;
- v2-to-v3 IndexedDB migration without data loss;
- v2 and v3 backup restoration;
- review editing, Quick/Targeted selection, acceptance, dismissal, and navigation;
- authorization-expiry and network-error UI states;
- regression coverage for existing manual entry, status history, analytics, backup, and mobile behavior.

Release verification runs the full test suite, lint, production build, `git diff --check`, and manual browser QA at desktop and 360-pixel widths. Gmail API calls in tests are mocked. Live OAuth verification uses the configured test account only after the Google Cloud client ID has been supplied.

## Configuration and Delivery

The repository will include `.env.example` and setup documentation covering Gmail API enablement, OAuth consent-screen configuration, test-user access, authorized JavaScript origins, local development, and the matching Vercel environment variable. The implementation must render a usable configuration state when the client ID is absent, so builds and tests do not depend on private credentials.

Deployment is a separate final step after local verification and after confirming that a valid OAuth client ID is available for the production origin. No credential or client secret is committed.
