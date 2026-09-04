# Paceboard v2 Singular Application Tracker Design

## Product goal

Paceboard v2 tracks every internship application as one named role while keeping repeated entry fast enough for a high-volume search. It answers both operational questions (what did I apply to, and what needs updating?) and analytical questions (am I on pace, which channels respond, and does targeted effort improve outcomes?).

## Product principles

- One application record represents exactly one company and one role.
- Company, role title, and submission date are required; submission date defaults to today and remains editable for backfilling.
- Quick and Targeted describe effort, not outcome or source.
- Source remains independent so Career fair, Referral, LinkedIn, Simplify, Handshake, and Company site can be compared.
- Status changes are events, not destructive overwrites.
- No response is derived after 21 calendar days and is never manually stored.
- Daily logging should take only the required fields; optional context stays collapsed.
- The local-first privacy and JSON backup model remain unchanged.

## Information architecture

The primary navigation becomes:

1. **Overview** — weekly pace, application volume, current pipeline, and recent activity.
2. **Applications** — searchable and filterable ledger of every role.
3. **Analytics** — eight-week volume, pipeline, response and interview rates, effort comparison, and source performance.
4. **Settings & data** — weekly target, sources, JSON backup/restore, and CSV export.

The global `Add application` action opens a right-side drawer from Overview or Applications. The drawer keeps the underlying context visible and supports `Save` and `Save & add another`.

## Data model

```ts
type ApplicationEffort = 'quick' | 'targeted'

type ApplicationStatus =
  | 'applied'
  | 'online_assessment'
  | 'recruiter_screen'
  | 'interview'
  | 'offer'
  | 'rejected'
  | 'withdrawn'

interface StatusEvent {
  id: string
  status: ApplicationStatus
  date: string // YYYY-MM-DD in the user's local calendar
}

interface ApplicationEntry {
  id: string
  company: string
  title: string
  submittedDate: string // YYYY-MM-DD
  effort: ApplicationEffort
  source?: string
  url?: string
  resumeVariant?: string
  notes?: string
  statusHistory: StatusEvent[]
  updatedAt: string // ISO instant for deterministic recent-activity ordering
}
```

Invariants:

- `company` and `title` are non-empty after trimming.
- `submittedDate` and every status event date are valid local calendar dates.
- Every record starts with an `applied` status event dated `submittedDate`.
- Status history is ordered by date and then insertion order.
- Adding a new status appends an event; it does not delete earlier events.
- The current stored status is the final status event.
- `no_response` is a display-only status when the current stored status is `applied` and the difference between today and `submittedDate` is at least 21 calendar days.
- Any later status event immediately replaces the derived No response display.

## Status vocabulary

The selectable statuses are Applied, Online assessment, Recruiter screen, Interview, Offer, Rejected, and Withdrawn. No response is shown in filters, badges, and analytics as a derived category but cannot be selected or added to history.

An edit drawer shows the complete status timeline. Changing status requires a status date that defaults to today and may be backdated. Re-selecting the current status does not create a duplicate event.

## Entry workflow

The default add drawer contains:

- Company (required, focused on open)
- Role title (required)
- Submitted date (required, defaults to today)
- Status (defaults to Applied)
- Application effort (defaults to Quick)
- Source (optional)

Job URL, resume variant, and notes sit behind a single `Resume, link, and notes` disclosure. `Save & add another` saves the record, clears the form, retains the submitted date/source/effort from the previous record, and returns focus to Company. This optimizes backfilling and same-session mass applications without reintroducing anonymous batch records.

## Overview

The Overview uses a restrained recruiting-operations layout rather than a large generic hero. It contains:

- A compact weekly pace strip: submitted, target, remaining, required per day, and On pace/Needs a push.
- Four outcome metrics: total applications, active applications, responses, and interviews.
- A seven-day Quick/Targeted volume chart.
- A current pipeline summary including derived No response.
- Five recent applications with company, role, status, and submission date.

The weekly target counts application records submitted Monday through Sunday. Quick and Targeted count equally toward the target.

## Applications ledger

Applications is the operational source of truth. Desktop uses a table with Company, Role, Current status, Submitted, Effort, and Source. Rows open the edit drawer. Search covers company, role, source, notes, and resume variant.

Filters include current display status, effort, source, and submission date range. Default sorting is newest submission date first with `updatedAt` as the tie-breaker. Mobile converts each row to a compact record card while preserving the same fields and filters.

Delete remains available only from the edit drawer and offers immediate Undo through the existing toast pattern.

## Analytics

Analytics is descriptive and avoids arbitrary scoring:

- Eight-week application volume.
- Current pipeline distribution.
- Response rate: applications that ever received any non-Applied event, excluding Withdrawn-only progress, divided by total applications.
- Interview rate: applications that ever reached Interview or Offer, divided by total applications.
- Quick versus Targeted: volume, response rate, and interview rate.
- Source performance: volume, responses, and interviews for each source.

Rejected applications remain credited with earlier assessment/interview events because status history is retained.

## Storage, reset, backup, and restore

IndexedDB advances to schema version 2. During the version-2 upgrade, all version-1 entries are cleared because the user chose to re-enter every role; settings are preserved. There is no synthetic conversion of batch quantities.

JSON backup advances to version 2 and round-trips the entire entry and status history. Version-1 backups are rejected with a clear message because aggregate entries cannot be safely converted into named roles. CSV exports one row per application and includes both current display status and a compact status-history column.

## Visual direction

Paceboard should feel like a calm personal recruiting operations desk rather than a generic SaaS dashboard.

- **Ink** `#152039`: primary text and structural contrast.
- **Night navy** `#17233D`: navigation rail.
- **Signal blue** `#315EFB`: primary actions and weekly pace.
- **Decision teal** `#11998B`: positive progression and Targeted effort.
- **Review amber** `#D58A22`: assessments, pacing warnings, and No response.
- **Paper** `#F7F9FC`: quiet surfaces against the blue-gray workspace.

Instrument Sans remains the sole type family. Dense application data uses tabular numerals and careful alignment rather than a separate monospace face. Rectangular panels and fine dividers encode hierarchy; rounded cards and shadows are limited to the drawer and temporary overlays. Status color always appears with a text label.

## Accessibility and responsive behavior

- Every control has an explicit label and visible keyboard focus.
- The drawer traps focus, closes with Escape, and returns focus to its trigger.
- Status is never communicated by color alone.
- Reduced-motion preferences disable drawer animation.
- Desktop is optimized for 1100px and above; the app remains fully usable down to 360px.
- Table headers, filter labels, live validation, toast messages, and charts expose accessible text equivalents.

## Test requirements

- Validate required company/title, date-only parsing, effort values, initial status, status append behavior, duplicate suppression, and chronological display.
- Verify No response at the 21-day boundary and its removal after a later result.
- Verify weekly totals and daylight-saving boundaries use local calendar dates.
- Verify response/interview rates preserve historical stage attainment.
- Verify the IndexedDB version-2 upgrade clears old entries while preserving settings.
- Verify JSON v2 round-trips status history and v1/malformed imports leave current data unchanged.
- Verify CSV has one row per application with current status and history.
- Verify add, Save & add another, edit status, backdate, filters, delete/undo, and reload persistence.
- Run automated tests, lint, production build, desktop browser QA, and mobile browser QA before publishing.
