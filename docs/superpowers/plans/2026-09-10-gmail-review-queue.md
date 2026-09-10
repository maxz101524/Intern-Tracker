# Gmail Review Queue Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a private browser-only Gmail confirmation importer that incrementally synchronizes messages into a one-at-a-time application review queue.

**Architecture:** Google Identity Services supplies a short-lived Gmail read-only token to focused auth/API adapters. A pure message normalizer and deterministic detector turn Gmail payloads into minimal candidates, while a sync coordinator persists idempotency records and advances Gmail history checkpoints only after successful work. Dexie v3 stores candidates and sync metadata alongside existing applications, and React pages expose connection status plus the review workflow.

**Tech Stack:** React 19, TypeScript 5.7, Vite 6, Dexie 4/IndexedDB, Google Identity Services, Gmail REST API, Lucide, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-10-gmail-review-queue-design.md`

## Global Constraints

- The app remains a static Vite deployment with no backend, refresh-token store, or client secret.
- Request only `https://www.googleapis.com/auth/gmail.readonly`.
- Access tokens live in memory only and never enter IndexedDB, local storage, logs, URLs, backups, or error messages.
- Never persist complete email bodies, raw HTML, snippets, or attachments.
- Every detected confirmation enters review; no Gmail message creates an application automatically.
- Quick is preselected, and the reviewer can edit company, title, and submission date or choose Targeted.
- Initial synchronization is limited to 30 days; later synchronization uses Gmail history with a two-day bounded recovery overlap.
- Exact Gmail message IDs are idempotent, while semantic matches produce visible warnings without blocking acceptance.
- IndexedDB v3 must retain every v2 application and setting.
- JSON restore accepts versions 2 and 3 atomically; no OAuth credential is backed up.
- The completed UI remains keyboard accessible and usable at 360px.

---

### Task 1: Gmail domain records and backup version 3

**Files:**
- Modify: `src/domain/types.ts`
- Create: `src/domain/gmail.ts`
- Create: `src/domain/gmail.test.ts`
- Modify: `src/domain/entries.ts`
- Modify: `src/domain/entries.test.ts`
- Modify: `src/domain/backup.ts`
- Modify: `src/domain/backup.test.ts`

**Interfaces:**
- Produces: `ApplicationOrigin`, `GmailCandidate`, `GmailCandidateState`, `ProcessedGmailMessage`, `GmailSyncState`, `GmailImportData`, `createGmailCandidate(input)`, `findPossibleDuplicate(candidate, entries)`, and backup version 3.
- Consumes: existing `ApplicationEntry`, `ApplicationInput`, `AppSettings`, `createApplication`, and date-only validation.

- [ ] **Step 1: Write failing Gmail-domain tests**

```ts
const candidate = createGmailCandidate({
  messageId: 'gmail-1',
  threadId: 'thread-1',
  receivedAt: '2026-09-10T13:30:00.000Z',
  submittedDate: '2026-09-10',
  sender: 'Acme Recruiting <jobs@acme.com>',
  subject: 'Application received — Data Science Intern',
  company: ' Acme ',
  title: ' Data Science Intern ',
  confidence: 'high',
  matchedRule: 'generic-confirmation',
})
expect(candidate).toMatchObject({ company: 'Acme', title: 'Data Science Intern', state: 'pending' })

expect(findPossibleDuplicate(candidate, [existing])).toEqual({ kind: 'exact' })
expect(findPossibleDuplicate({ ...candidate, submittedDate: '2026-09-12' }, [existing]))
  .toEqual({ kind: 'near', entryId: existing.id })
```

Assert required IDs/text, ISO timestamps, valid date-only values, allowed confidence/state values, exact normalized matches, near matches within three calendar days, and no match outside that window.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/domain/gmail.test.ts src/domain/entries.test.ts`

Expected: FAIL because Gmail domain types and functions do not exist.

- [ ] **Step 3: Add Gmail domain types and pure validation**

```ts
export interface ApplicationOrigin { provider: 'gmail'; messageId: string }
export type GmailCandidateState = 'pending' | 'imported' | 'dismissed'
export interface GmailCandidate {
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
export interface ProcessedGmailMessage {
  messageId: string
  disposition: 'candidate' | 'ignored' | 'imported' | 'dismissed' | 'error'
  processedAt: string
}
export interface GmailSyncState {
  key: 'gmail'
  accountEmail?: string
  historyId?: string
  lastSuccessfulSyncAt?: string
  initialSyncCompleted: boolean
}
```

Add optional `origin?: ApplicationOrigin` to `ApplicationEntry` and let `createApplication` validate/preserve only the Gmail provider with a non-empty message ID.

- [ ] **Step 4: Run Gmail and entry tests**

Run: `npm test -- --run src/domain/gmail.test.ts src/domain/entries.test.ts`

Expected: PASS.

- [ ] **Step 5: Write failing backup-v3 tests**

```ts
const backup = buildBackup([application], settings, gmailImportData, exportedAt)
expect(backup).toMatchObject({
  version: 3,
  gmail: { candidates: [candidate], processedMessages: [processed], syncState },
})
expect(parseBackup(JSON.stringify(backup))).toEqual(backup)

const restoredV2 = parseBackup(JSON.stringify(v2Backup))
expect(restoredV2.gmail).toEqual({
  candidates: [],
  processedMessages: [],
  syncState: { key: 'gmail', initialSyncCompleted: false },
})
```

Also assert malformed Gmail records reject the entire backup and CSV includes `originProvider,originMessageId` columns.

- [ ] **Step 6: Implement backup version 3 with v2 compatibility**

```ts
export interface TrackerBackup {
  version: 3
  exportedAt: string
  entries: ApplicationEntry[]
  settings: AppSettings
  gmail: GmailImportData
}
```

`parseBackup` returns the normalized v3 shape for both input versions. `buildBackup` requires Gmail import data, and CSV emits blank origin cells for manual applications.

- [ ] **Step 7: Run focused tests and commit**

Run: `npm test -- --run src/domain/gmail.test.ts src/domain/entries.test.ts src/domain/backup.test.ts`

Expected: PASS.

```bash
git add src/domain/types.ts src/domain/gmail.ts src/domain/gmail.test.ts src/domain/entries.ts src/domain/entries.test.ts src/domain/backup.ts src/domain/backup.test.ts
git commit -m "feat: add Gmail import domain model"
```

### Task 2: Non-destructive IndexedDB v3 persistence

**Files:**
- Modify: `src/storage/repository.ts`
- Modify: `src/storage/repository.test.ts`

**Interfaces:**
- Consumes: Gmail domain records and normalized backup data from Task 1.
- Produces: `listGmailCandidates(state?)`, `saveGmailCandidate(candidate)`, `getGmailCandidate(messageId)`, `markGmailCandidate(messageId, state, reviewedAt)`, `listProcessedGmailMessages()`, `hasProcessedGmailMessage(messageId)`, `saveProcessedGmailMessage(record)`, `getGmailSyncState()`, `saveGmailSyncState(state)`, `getGmailImportData()`, `commitGmailSync(result)`, `resetGmailImportHistory()`, and v3 atomic restore.

- [ ] **Step 1: Write failing v3 migration and repository tests**

```ts
const v2 = new Dexie(name)
v2.version(2).stores({
  entries: 'id, submittedDate, effort, source, company, updatedAt',
  settings: 'key',
})
await v2.table('entries').put(existingApplication)
v2.close()

repository = new TrackerRepository(name)
expect(await repository.listEntries()).toEqual([existingApplication])
expect(await repository.listGmailCandidates('pending')).toEqual([])
expect(await repository.getGmailSyncState()).toEqual({ key: 'gmail', initialSyncCompleted: false })
```

Cover idempotent candidate upserts, processed-message lookups, atomic candidate/process/checkpoint commits, candidate state transitions, Gmail-only reset, and v2/v3 restore behavior.

- [ ] **Step 2: Run the repository tests and verify failure**

Run: `npm test -- --run src/storage/repository.test.ts`

Expected: FAIL for missing v3 stores and methods.

- [ ] **Step 3: Add v3 stores without an upgrade callback that changes existing data**

```ts
this.db.version(3).stores({
  entries: 'id, submittedDate, effort, source, company, updatedAt, origin.messageId',
  settings: 'key',
  gmailCandidates: 'messageId, state, submittedDate, createdAt',
  processedGmailMessages: 'messageId, disposition, processedAt',
  gmailSync: 'key',
})
```

Add typed `EntityTable` properties for the three Gmail stores and return a fresh default state when no sync row exists.

- [ ] **Step 4: Implement Gmail persistence and atomic sync commit**

```ts
async commitGmailSync(result: {
  candidates: GmailCandidate[]
  processedMessages: ProcessedGmailMessage[]
  syncState: GmailSyncState
}): Promise<void> {
  await this.db.transaction(
    'rw',
    this.db.gmailCandidates,
    this.db.processedGmailMessages,
    this.db.gmailSync,
    async () => {
      await this.db.gmailCandidates.bulkPut(result.candidates)
      await this.db.processedGmailMessages.bulkPut(result.processedMessages)
      await this.db.gmailSync.put(result.syncState)
    },
  )
}
```

Candidate review must update the candidate and processed disposition in one transaction. Restore validates before opening a transaction and replaces every backed-up store together.

- [ ] **Step 5: Run repository tests and commit**

Run: `npm test -- --run src/storage/repository.test.ts src/domain/backup.test.ts`

Expected: PASS.

```bash
git add src/storage/repository.ts src/storage/repository.test.ts
git commit -m "feat: persist Gmail review state"
```

### Task 3: Gmail MIME normalization and deterministic detection

**Files:**
- Create: `src/gmail/types.ts`
- Create: `src/gmail/message.ts`
- Create: `src/gmail/message.test.ts`
- Create: `src/gmail/detector.ts`
- Create: `src/gmail/detector.test.ts`

**Interfaces:**
- Produces: `GmailApiMessage`, `NormalizedGmailMessage`, `normalizeGmailMessage(message)`, `DetectionResult`, and `detectApplicationConfirmation(message)`.
- Consumes: browser `TextDecoder`; no storage, network, React, or application repository.

- [ ] **Step 1: Write failing MIME normalization tests**

```ts
expect(normalizeGmailMessage({
  id: 'm1',
  threadId: 't1',
  internalDate: '1789047000000',
  payload: {
    headers: [
      { name: 'From', value: 'Acme Recruiting <jobs@acme.com>' },
      { name: 'Subject', value: 'Application received' },
      { name: 'Date', value: 'Thu, 10 Sep 2026 09:30:00 -0400' },
    ],
    mimeType: 'multipart/alternative',
    parts: [
      { mimeType: 'text/plain', body: { data: encode('Thank you for applying to Data Science Intern at Acme.') } },
      { mimeType: 'text/html', body: { data: encode('<p>ignored duplicate</p>') } },
    ],
  },
})).toMatchObject({ id: 'm1', threadId: 't1', subject: 'Application received', text: 'Thank you for applying to Data Science Intern at Acme.' })
```

Cover URL-safe base64 padding, nested multiparts, HTML-only fallback with tag removal/entity decoding, missing headers, and malformed payload rejection without exposing body content in the error.

- [ ] **Step 2: Implement message normalization and run its tests**

Run before implementation: `npm test -- --run src/gmail/message.test.ts`

Expected: FAIL because the module is missing.

Run after implementation: `npm test -- --run src/gmail/message.test.ts`

Expected: PASS.

- [ ] **Step 3: Write failing detector fixtures**

```ts
expect(detectApplicationConfirmation(message({
  from: 'Acme Recruiting <jobs@acme.com>',
  subject: 'Thank you for applying to Data Science Intern at Acme',
  text: 'We received your application for the Data Science Intern position at Acme.',
}))).toEqual(expect.objectContaining({
  company: 'Acme', title: 'Data Science Intern', confidence: 'high', matchedRule: 'generic-confirmation',
}))

expect(detectApplicationConfirmation(message({
  subject: 'New Data Science Intern jobs near you',
  text: 'Your weekly job alert',
}))).toBeNull()
```

Add synthetic positive fixtures for Workday, Greenhouse, Lever, Ashby, SmartRecruiters, and iCIMS, plus exclusions for alerts, saved jobs, recruiter outreach, assessments, interviews, rejections, and incomplete low-confidence text.

- [ ] **Step 4: Implement ordered detectors and extraction fallbacks**

```ts
type DetectorRule = {
  id: string
  matches(message: NormalizedGmailMessage): boolean
  extract(message: NormalizedGmailMessage): Pick<DetectionResult, 'company' | 'title'> | null
}

export function detectApplicationConfirmation(message: NormalizedGmailMessage): DetectionResult | null
```

Run exclusion markers before confirmation markers. Prefer explicit body phrases, then subject phrases, then a cleaned sender display name/domain for company only. Never create a result with a blank company or title.

- [ ] **Step 5: Run parser/detector tests and commit**

Run: `npm test -- --run src/gmail/message.test.ts src/gmail/detector.test.ts`

Expected: PASS.

```bash
git add src/gmail/types.ts src/gmail/message.ts src/gmail/message.test.ts src/gmail/detector.ts src/gmail/detector.test.ts
git commit -m "feat: detect application confirmation emails"
```

### Task 4: Browser authorization and Gmail REST client

**Files:**
- Create: `src/vite-env.d.ts`
- Create: `src/gmail/auth.ts`
- Create: `src/gmail/auth.test.ts`
- Create: `src/gmail/api.ts`
- Create: `src/gmail/api.test.ts`

**Interfaces:**
- Produces: `GmailAuthClient`, `createGmailAuthClient(clientId)`, `GmailApiClient`, `createGmailApiClient(getAccessToken, fetchImpl?)`, `GmailApiError`, `GmailProfile`, `listInitialMessageIds(afterEpochSeconds)`, `listHistoryMessageIds(startHistoryId)`, and `getMessage(id)`.
- Consumes: `window.google.accounts.oauth2`, `fetch`, Gmail types from Task 3, and `import.meta.env.VITE_GOOGLE_CLIENT_ID`.

- [ ] **Step 1: Write failing authorization lifecycle tests**

```ts
const auth = createGmailAuthClient('client-id', fakeGoogle)
await expect(auth.requestToken()).resolves.toMatchObject({ accessToken: 'token', expiresAt: expect.any(Number) })
expect(auth.getValidToken()).toBe('token')
clock.advanceTimersByTime(3_600_001)
expect(auth.getValidToken()).toBeNull()
await auth.disconnect()
expect(fakeGoogle.accounts.oauth2.revoke).toHaveBeenCalledWith('token', expect.any(Function))
```

Cover script loading, popup cancellation timeout, OAuth errors, missing client ID, token expiry, disconnect, and exactly one active request.

- [ ] **Step 2: Implement in-memory Google Identity Services authorization**

```ts
export interface GmailAuthClient {
  requestToken(): Promise<string>
  getValidToken(): string | null
  disconnect(): Promise<void>
  subscribe(listener: (state: GmailAuthState) => void): () => void
}
```

Load `https://accounts.google.com/gsi/client` once, request only Gmail readonly, calculate expiry from `expires_in`, and convert provider errors into safe user-facing messages.

- [ ] **Step 3: Write failing Gmail API tests**

Mock paginated responses and assert:

```ts
expect(fetchMock).toHaveBeenCalledWith(
  expect.stringContaining('/gmail/v1/users/me/messages?'),
  expect.objectContaining({ headers: { Authorization: 'Bearer token' } }),
)
expect(await api.listHistoryMessageIds('123')).toEqual({ messageIds: ['m1', 'm2'], historyId: '130' })
```

Cover initial queries, history pagination, duplicate history IDs, message retrieval with `format=full`, 401 classification, history 404 classification, rate-limit errors, and safe messages that omit response bodies.

- [ ] **Step 4: Implement Gmail REST wrappers**

Use `URL`/`URLSearchParams`, bearer headers, and a common request method. The initial query must be bounded by `after:<epoch>` and include application-confirmation phrases. History results must collect only `messagesAdded[].message.id`.

- [ ] **Step 5: Run auth/API tests and commit**

Run: `npm test -- --run src/gmail/auth.test.ts src/gmail/api.test.ts`

Expected: PASS.

```bash
git add src/vite-env.d.ts src/gmail/auth.ts src/gmail/auth.test.ts src/gmail/api.ts src/gmail/api.test.ts
git commit -m "feat: connect to the Gmail API"
```

### Task 5: Idempotent initial, incremental, and recovery synchronization

**Files:**
- Create: `src/gmail/sync.ts`
- Create: `src/gmail/sync.test.ts`

**Interfaces:**
- Consumes: `GmailApiClient`, `normalizeGmailMessage`, `detectApplicationConfirmation`, Gmail domain constructors, and the Gmail repository methods from Task 2.
- Produces: `syncGmail({ api, repository, now? }): Promise<GmailSyncResult>` with `{ newCandidates, inspectedMessages, mode, syncedAt }`.

- [ ] **Step 1: Write failing initial-sync tests**

```ts
const result = await syncGmail({ api, repository, now: new Date('2026-09-10T14:00:00Z') })
expect(api.listInitialMessageIds).toHaveBeenCalledWith(1786456800)
expect(result).toMatchObject({ newCandidates: 1, inspectedMessages: 2, mode: 'initial' })
expect(await repository.getGmailSyncState()).toMatchObject({
  accountEmail: 'max@example.com', historyId: '500', initialSyncCompleted: true,
})
```

Cover 30-day epoch calculation, concurrency capped at five messages, ignored-message dispositions, malformed-message error dispositions, and checkpoint writes only after all retrievable messages complete.

- [ ] **Step 2: Implement the initial pipeline and run focused tests**

Run before implementation: `npm test -- --run src/gmail/sync.test.ts`

Expected: FAIL because `syncGmail` is missing.

Implement an internal `mapWithConcurrency(items, 5, worker)` and build all persistence rows before calling `commitGmailSync` once.

Run after implementation: `npm test -- --run src/gmail/sync.test.ts`

Expected: initial-mode tests PASS.

- [ ] **Step 3: Add failing incremental and recovery tests**

```ts
await repository.saveGmailSyncState({ key: 'gmail', historyId: '500', lastSuccessfulSyncAt: '2026-09-09T12:00:00Z', initialSyncCompleted: true })
expect((await syncGmail({ api, repository })).mode).toBe('incremental')
expect(api.listHistoryMessageIds).toHaveBeenCalledWith('500')

api.listHistoryMessageIds.mockRejectedValue(new GmailApiError('history-expired', 404))
expect((await syncGmail({ api, repository, now })).mode).toBe('recovery')
expect(api.listInitialMessageIds).toHaveBeenCalledWith(epochFor('2026-09-07T12:00:00Z'))
```

Also cover exact-ID skipping across processed rows, candidates, and application origins; retries after a failed checkpoint; and no checkpoint advance on rate limiting.

- [ ] **Step 4: Implement incremental and bounded recovery modes**

History success uses the returned newest history ID. History 404 subtracts exactly 48 hours from `lastSuccessfulSyncAt`, reuses the initial listing pipeline, and establishes the profile's current history ID. Other API errors propagate without storage mutation.

- [ ] **Step 5: Run sync plus storage tests and commit**

Run: `npm test -- --run src/gmail/sync.test.ts src/storage/repository.test.ts`

Expected: PASS.

```bash
git add src/gmail/sync.ts src/gmail/sync.test.ts
git commit -m "feat: synchronize Gmail incrementally"
```

### Task 6: Gmail connection state and one-at-a-time review UI

**Files:**
- Create: `src/hooks/useGmailImport.ts`
- Create: `src/components/GmailReview.tsx`
- Create: `src/components/GmailSettings.tsx`
- Modify: `src/components/Settings.tsx`
- Modify: `src/App.tsx`
- Modify: `src/App.test.tsx`

**Interfaces:**
- Consumes: auth, API, sync, Gmail domain helpers, repository Gmail methods, `createApplication`, and existing toast/navigation patterns.
- Produces: `useGmailImport(repository)`, Review navigation badge/page, connection settings, sync feedback, and atomic accept/dismiss actions.

- [ ] **Step 1: Write failing review-flow interaction tests**

```tsx
await repository.saveGmailCandidate(candidate)
render(<App repository={repository} gmailAuth={fakeAuth} gmailApiFactory={fakeApiFactory} />)

expect(await screen.findByRole('button', { name: 'Review, 1 pending' })).toBeVisible()
await user.click(screen.getByRole('button', { name: 'Review, 1 pending' }))
expect(screen.getByLabelText('Application effort', { selector: 'fieldset' })).toHaveTextContent('Quick')
await user.click(screen.getByRole('button', { name: 'Add & next' }))
expect((await repository.listEntries())[0]).toMatchObject({
  company: candidate.company,
  effort: 'quick',
  origin: { provider: 'gmail', messageId: candidate.messageId },
})
```

Cover editing fields, choosing Targeted, invalid acceptance, dismissal, previous/next navigation, empty state, Gmail deep link, exact and near duplicate warnings, and focus movement after review.

- [ ] **Step 2: Implement `GmailReview` and repository review transaction**

```ts
async reviewGmailCandidate(args: {
  candidate: GmailCandidate
  disposition: 'imported' | 'dismissed'
  application?: ApplicationEntry
}): Promise<void>
```

When imported, save the application, update candidate state/reviewedAt, and update processed disposition in one Dexie transaction. Dismiss does the same without an application.

- [ ] **Step 3: Write failing connection/settings tests**

Assert not-configured, disconnected, syncing, connected, expired, failed, and offline states. Clicking connect must request a token and synchronize; startup must synchronize only when `getValidToken()` returns a token. Reset import history requires an explicit confirmation inside the component.

- [ ] **Step 4: Implement the Gmail import controller and settings section**

```ts
export interface GmailImportController {
  authState: GmailAuthState
  syncState: GmailSyncState
  pendingCandidates: GmailCandidate[]
  syncStatus: 'idle' | 'syncing' | 'error'
  error: string
  connectAndSync(): Promise<void>
  syncNow(): Promise<void>
  disconnect(): Promise<void>
  resetHistory(): Promise<void>
  refreshCandidates(): Promise<void>
}
```

Guard simultaneous syncs, refresh queue/sync state after writes, show a new-candidate toast, and never force page navigation. Inject auth/API dependencies into `App` for deterministic tests.

- [ ] **Step 5: Integrate Review navigation and settings**

Extend `Page` with `review`, add the badge's accessible name, pass Gmail state/actions into `Settings`, and keep all manual tracking pages functional when Gmail is unconfigured or offline.

- [ ] **Step 6: Run UI tests and commit**

Run: `npm test -- --run src/App.test.tsx`

Expected: all Gmail and existing interaction tests PASS.

```bash
git add src/hooks/useGmailImport.ts src/components/GmailReview.tsx src/components/GmailSettings.tsx src/components/Settings.tsx src/App.tsx src/App.test.tsx src/storage/repository.ts
git commit -m "feat: add Gmail application review queue"
```

### Task 7: Backup UI, responsive polish, and setup documentation

**Files:**
- Modify: `src/components/Settings.tsx`
- Modify: `src/styles.css`
- Modify: `README.md`
- Modify: `.gitignore`
- Create: `.env.example`

**Interfaces:**
- Consumes: completed Gmail workflow and backup v3 utilities.
- Produces: complete v3 export/restore UI, mobile review layout, focus/error/loading styles, and reproducible Google/Vercel setup instructions.

- [ ] **Step 1: Wire Gmail data into JSON export and restore preview**

Fetch `repository.getGmailImportData()` before `buildBackup`. The restore preview displays application and pending-review counts. Copy states that version 2 remains supported and Gmail authorization is never included.

- [ ] **Step 2: Add focused visual improvements**

Add styles for:

```css
.nav-count { min-width: 1.35rem; border-radius: 999px; font-variant-numeric: tabular-nums; }
.review-card { max-width: 48rem; display: grid; gap: 1rem; }
.sync-state[aria-busy='true'] { opacity: .78; }
@media (max-width: 760px) {
  .review-actions { align-items: stretch; flex-direction: column-reverse; }
  .review-actions .button { width: 100%; }
}
@media (prefers-reduced-motion: reduce) {
  .review-card, .sync-state { transition: none; }
}
```

Preserve the existing Paceboard palette and typography. Improve only touched shared states: visible focus, disabled/loading clarity, responsive navigation badge, and non-color error/status cues.

- [ ] **Step 3: Document OAuth setup and privacy limits**

`.env.example` contains only:

```dotenv
VITE_GOOGLE_CLIENT_ID=your-web-application-client-id.apps.googleusercontent.com
```

README steps: enable Gmail API, configure an OAuth consent screen, add the Gmail account as a test user, create a Web application client, authorize `http://localhost:5173` and the production origin, set the local/Vercel environment variable, and rebuild. Explain restricted-scope/unverified test-user behavior, one-click reconnection, 30-day initial scan, incremental history sync, and local derived-data storage.

- [ ] **Step 4: Run focused backup/UI tests and commit**

Run: `npm test -- --run src/domain/backup.test.ts src/storage/repository.test.ts src/App.test.tsx`

Expected: PASS.

```bash
git add src/components/Settings.tsx src/styles.css README.md .gitignore .env.example
git commit -m "docs: finish Gmail import setup and polish"
```

### Task 8: Full verification and browser QA

**Files:**
- Modify only files required by verification findings.

**Interfaces:**
- Consumes: the complete implementation.
- Produces: a clean, locally verified branch ready for credential configuration and optional deployment.

- [ ] **Step 1: Run the complete automated checks**

```bash
npm test -- --run
npm run lint
npm run build
git diff --check
```

Expected: every command exits 0. The build may show the documented Gmail-not-configured state at runtime but must not require an environment value to compile.

- [ ] **Step 2: Run manual desktop QA**

Start the app with `npm run dev -- --host 127.0.0.1`. At desktop width, verify manual application CRUD, all navigation pages, Gmail unconfigured/disconnected states, review editing/accept/dismiss, duplicate warnings, JSON export/restore, and keyboard-only focus order. Use mocked/local repository candidates when a live OAuth client ID is unavailable.

- [ ] **Step 3: Run manual 360px QA**

At 360px width, verify the navigation badge does not clip, review context remains readable, all fields fit without horizontal scrolling, actions remain reachable, focus indicators remain visible, and existing Applications/Settings layouts still work.

- [ ] **Step 4: Inspect repository state and commit verification fixes**

Run:

```bash
git status --short
git diff --stat
git diff --check
```

If verification required changes, rerun the affected focused test plus the full check suite, then stage each changed source or test path explicitly after inspecting `git status --short`. Commit only verified fixes:

```bash
git commit -m "fix: harden Gmail import workflow"
```

Do not push or deploy until the user explicitly authorizes publication and a production OAuth client ID has been configured.
