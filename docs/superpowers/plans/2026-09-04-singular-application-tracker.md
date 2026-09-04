# Paceboard v2 Singular Application Tracker Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace aggregate counting with one named application per role, durable status history, automatic No response, and an Overview/Applications/Analytics interface.

**Architecture:** Keep the React/Vite application local-first and place all business rules in domain modules. Store one `ApplicationEntry` with embedded status events per IndexedDB row, derive display status and analytics in pure functions, and keep UI components focused on one page or workflow.

**Tech Stack:** React 19, TypeScript, Vite, Dexie/IndexedDB, CSS chart primitives, Lucide, Vitest, Testing Library.

**Spec:** `docs/superpowers/specs/2026-09-04-singular-application-tracker-design.md`

## Global Constraints

- Every application has required company, title, and editable `YYYY-MM-DD` submission date.
- Effort is exactly `quick` or `targeted`; source is independent and optional.
- No response is derived after 21 local calendar days only while the stored current status is Applied.
- Status changes append dated events and never erase earlier stages.
- IndexedDB v2 clears v1 entries and preserves settings.
- JSON v2 is authoritative; v1 backup restore is rejected without changing current data.
- The app remains private, backend-free, keyboard accessible, and usable at 360px.

---

### Task 1: Singular application domain model

**Files:**
- Modify: `src/domain/types.ts`
- Replace: `src/domain/entries.ts`
- Replace: `src/domain/entries.test.ts`
- Create: `src/domain/status.ts`
- Create: `src/domain/status.test.ts`

**Interfaces:**
- Produces: `ApplicationEntry`, `ApplicationInput`, `ApplicationStatus`, `StatusEvent`, `DisplayStatus`, `createApplication(input)`, `appendStatus(entry, status, date)`, `getCurrentStatus(entry)`, and `getDisplayStatus(entry, today)`.
- Consumes: browser `crypto.randomUUID()` and ISO date strings only.

- [ ] **Step 1: Write failing domain tests**

```ts
expect(createApplication({
  company: ' Cigna ',
  title: ' AI Intern ',
  submittedDate: '2026-09-03',
  effort: 'quick',
}).statusHistory).toEqual([
  expect.objectContaining({ status: 'applied', date: '2026-09-03' }),
])

expect(() => createApplication({
  company: '', title: 'AI Intern', submittedDate: '2026-09-03', effort: 'quick',
})).toThrow('Company is required.')

expect(getDisplayStatus(entry, '2026-09-23')).toBe('applied')
expect(getDisplayStatus(entry, '2026-09-24')).toBe('no_response')
expect(getDisplayStatus(appendStatus(entry, 'interview', '2026-09-25'), '2026-10-20'))
  .toBe('interview')
```

- [ ] **Step 2: Run the focused tests and confirm the old quantity model fails them**

Run: `npm test -- --run src/domain/entries.test.ts src/domain/status.test.ts`

Expected: failures for missing singular types/functions and the removed quantity behavior.

- [ ] **Step 3: Implement the model and validation**

```ts
export type ApplicationEffort = 'quick' | 'targeted'
export type ApplicationStatus =
  | 'applied' | 'online_assessment' | 'recruiter_screen'
  | 'interview' | 'offer' | 'rejected' | 'withdrawn'
export type DisplayStatus = ApplicationStatus | 'no_response'

export interface StatusEvent { id: string; status: ApplicationStatus; date: string }
export interface ApplicationEntry {
  id: string
  company: string
  title: string
  submittedDate: string
  effort: ApplicationEffort
  source?: string
  url?: string
  resumeVariant?: string
  notes?: string
  statusHistory: StatusEvent[]
  updatedAt: string
}
```

Use strict date-only validation that round-trips year/month/day, trim all text fields, start each record with Applied, and preserve an existing id/history on edits.

- [ ] **Step 4: Implement status derivation and append behavior**

Calculate day differences from local calendar constructors rather than milliseconds so daylight-saving changes do not shift the 21-day boundary. Do not append a status event when it matches the current stored status.

- [ ] **Step 5: Run domain tests**

Run: `npm test -- --run src/domain/entries.test.ts src/domain/status.test.ts`

Expected: all focused tests pass.

### Task 2: Storage, v2 reset migration, backup, and CSV

**Files:**
- Modify: `src/storage/repository.ts`
- Replace: `src/storage/repository.test.ts`
- Replace: `src/domain/backup.ts`
- Replace: `src/domain/backup.test.ts`

**Interfaces:**
- Consumes: domain types/functions from Task 1.
- Produces: repository CRUD without split methods, atomic JSON v2 restore, `buildBackup`, `parseBackup`, and one-row-per-application `entriesToCsv(entries, today)`.

- [ ] **Step 1: Write failing migration and backup tests**

```ts
const old = new Dexie(name)
old.version(1).stores({ entries: 'id, submittedAt, type', settings: 'key' })
await old.table('entries').put({ id: 'batch', submittedAt: now, quantity: 7, type: 'quick' })
await old.table('settings').put({ key: 'app', weeklyTarget: 50, sources: ['LinkedIn'], lastBackupAt: null })
old.close()

const repository = new TrackerRepository(name)
expect(await repository.listEntries()).toEqual([])
expect((await repository.getSettings()).weeklyTarget).toBe(50)
```

Also assert JSON `version: 2`, complete status-history round-trip, v1 rejection, unchanged data after malformed restore, and CSV columns `company,title,submittedDate,effort,source,currentStatus,statusHistory`.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/storage/repository.test.ts src/domain/backup.test.ts`

- [ ] **Step 3: Upgrade Dexie and remove aggregate APIs**

```ts
this.db.version(2).stores({
  entries: 'id, submittedDate, effort, source, company, updatedAt',
  settings: 'key',
}).upgrade(async tx => {
  await tx.table('entries').clear()
})
```

Preserve the settings table. Remove `splitBatch` and all `EntryDetails` imports.

- [ ] **Step 4: Implement version-2 backup validation and CSV export**

Validate every entry through `createApplication`, preserve status event ids/dates, and escape CSV fields according to RFC-style quote doubling. Serialize history as `date:status | date:status`.

- [ ] **Step 5: Run focused tests**

Run: `npm test -- --run src/storage/repository.test.ts src/domain/backup.test.ts`

Expected: migration, round-trip, failure atomicity, and CSV tests pass.

### Task 3: Add/edit drawer and Applications ledger

**Files:**
- Replace: `src/components/EntryDrawer.tsx`
- Replace: `src/components/History.tsx` with `src/components/Applications.tsx`
- Replace: `src/components/EntryRow.tsx` with `src/components/ApplicationTable.tsx`
- Create: `src/components/StatusBadge.tsx`
- Modify: `src/App.tsx`
- Replace: `src/App.test.tsx`

**Interfaces:**
- Consumes: `createApplication`, `appendStatus`, `getDisplayStatus`, repository save/delete, configured sources.
- Produces: global `Add application`, `Save`, `Save & add another`, searchable/filterable ledger, edit/status timeline, and delete with Undo.

- [ ] **Step 1: Write failing interaction tests**

```tsx
await user.click(screen.getByRole('button', { name: /add application/i }))
await user.type(screen.getByLabelText(/company/i), 'Verisk')
await user.type(screen.getByLabelText(/role title/i), 'AI Intern')
await user.clear(screen.getByLabelText(/submitted/i))
await user.type(screen.getByLabelText(/submitted/i), '2026-09-01')
await user.click(screen.getByRole('button', { name: /save & add another/i }))
expect(await screen.findByDisplayValue('')).toHaveFocus()
expect(repository.saveEntry).toHaveBeenCalledWith(expect.objectContaining({
  company: 'Verisk', title: 'AI Intern', submittedDate: '2026-09-01', effort: 'quick',
}))
```

Cover status updates with a backdated status date, history rendering, No response filter, required validation, and delete/undo.

- [ ] **Step 2: Run the app tests and verify failure**

Run: `npm test -- --run src/App.test.tsx`

- [ ] **Step 3: Rebuild app navigation and drawer state**

Use `Page = 'overview' | 'applications' | 'analytics' | 'settings'`. A null entry opens create mode; an existing entry opens edit mode. `Save & add another` keeps the drawer open and retains date/source/effort.

- [ ] **Step 4: Build the Applications ledger**

Desktop columns are Company, Role, Status, Submitted, Effort, and Source. Filters are query, display status, effort, source, from date, and to date. Sort newest submission date first and use `updatedAt` to break ties.

- [ ] **Step 5: Build edit timeline and status update controls**

Render every event in order. The status control excludes No response, and the event date defaults to today's `YYYY-MM-DD`. A later event updates the visible badge immediately.

- [ ] **Step 6: Run app tests**

Run: `npm test -- --run src/App.test.tsx`

Expected: add, repeated add, edit, filter, status history, delete, and undo scenarios pass.

### Task 4: Overview and analytics

**Files:**
- Replace: `src/domain/analytics.ts`
- Replace: `src/domain/analytics.test.ts`
- Replace: `src/components/Dashboard.tsx` with `src/components/Overview.tsx`
- Create: `src/components/Analytics.tsx`
- Delete: `src/components/QuickLog.tsx`

**Interfaces:**
- Consumes: singular entries and status utilities.
- Produces: `getWeekSummary`, `buildDailySeries`, `buildWeeklySeries`, `getPipelineSummary`, `getOutcomeMetrics`, `getEffortPerformance`, and `getSourcePerformance`.

- [ ] **Step 1: Write failing analytics tests**

Assert one record equals one application, Monday/Sunday boundaries remain local, Quick/Targeted splits count entries, derived No response appears at day 21, response rate uses any non-Applied historical event, and Interview rate includes applications later rejected after an interview.

- [ ] **Step 2: Run focused tests and verify failure**

Run: `npm test -- --run src/domain/analytics.test.ts`

- [ ] **Step 3: Implement pure analytics functions**

```ts
const responded = entries.filter(entry =>
  entry.statusHistory.some(event =>
    !['applied', 'withdrawn'].includes(event.status),
  ),
).length

const interviewed = entries.filter(entry =>
  entry.statusHistory.some(event => ['interview', 'offer'].includes(event.status)),
).length
```

Use record counts only; quantity no longer exists.

- [ ] **Step 4: Build Overview**

Keep weekly pace compact, place four search-health metrics beside it, show seven-day effort bars, pipeline distribution, and five recent named roles. Every empty state directs the user to Add application.

- [ ] **Step 5: Build Analytics**

Use lightweight CSS chart primitives for eight-week volume and pipeline distribution. Render effort and source performance in aligned comparison rows with textual values so charts remain accessible.

- [ ] **Step 6: Run analytics and app tests**

Run: `npm test -- --run src/domain/analytics.test.ts src/App.test.tsx`

Expected: all analytics and rendered metric assertions pass.

### Task 5: Settings, visual system, documentation, and full verification

**Files:**
- Modify: `src/components/Settings.tsx`
- Replace: `src/styles.css`
- Modify: `README.md`
- Modify: `.gitignore`

**Interfaces:**
- Consumes: all completed v2 pages and backup utilities.
- Produces: complete responsive product, clear reset behavior, v2 documentation, and ignored `.superpowers/` scratch files.

- [ ] **Step 1: Update settings/data copy and restore preview**

Show the number of singular applications in a backup, explain that status history is included, and report version-1 backups as incompatible without changing current data.

- [ ] **Step 2: Apply the visual token system**

Use the spec palette, Instrument Sans, fine dividers, compact metric strips, one primary blue action, status text plus color, a 500px maximum drawer, and a mobile record-card transformation below 760px. Add visible `:focus-visible` states and reduced-motion rules.

- [ ] **Step 3: Update documentation and ignore design scratch files**

Document the singular application workflow, automatic 21-day No response rule, status history, local storage, backup v2, and commands. Add `.superpowers/` to `.gitignore`.

- [ ] **Step 4: Run all automated verification**

Run:

```bash
npm test -- --run
npm run lint
npm run build
npm audit --audit-level=high
```

Expected: all tests pass, ESLint reports no errors, Vite builds `dist/`, and audit reports zero high-severity vulnerabilities.

- [ ] **Step 5: Perform browser QA**

At desktop and 390px mobile widths, verify onboarding, backdated add, Save & add another, Targeted/source selection, status update with history, automatic No response fixture, filters, analytics, delete/undo, JSON backup, and reload persistence. Inspect screenshots for overflow, clipped labels, weak focus, and unreadable status colors.

- [ ] **Step 6: Publish and verify deployment**

Publish the complete v2 tree to `maxz101524/Intern-Tracker` on `main`, fetch the resulting commit into the local checkout, wait for Vercel's Git integration, and verify the production URL returns HTTP 200 and displays the v2 navigation.
