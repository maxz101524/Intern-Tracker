import type {
  ApplicationEntry,
  EntryDetails,
  EntryInput,
} from './types'

export function createEntry(_input: EntryInput): ApplicationEntry {
  const input = _input
  if (!Number.isInteger(input.quantity) || input.quantity < 1) {
    throw new Error('Quantity must be a positive whole number.')
  }

  if (!['quick', 'targeted'].includes(input.type)) {
    throw new Error('Application type is not valid.')
  }

  if (Number.isNaN(new Date(input.submittedAt).getTime())) {
    throw new Error('Submission date is not valid.')
  }

  const optionalFields = {
    source: clean(input.source),
    company: clean(input.company),
    title: clean(input.title),
    url: clean(input.url),
    resumeVariant: clean(input.resumeVariant),
    notes: clean(input.notes),
    outcome: input.outcome,
  }

  if (
    input.quantity > 1 &&
    (optionalFields.company ||
      optionalFields.title ||
      optionalFields.url ||
      optionalFields.resumeVariant ||
      optionalFields.notes ||
      optionalFields.outcome)
  ) {
    throw new Error('Batch entries cannot include role details or outcomes.')
  }

  return compact({
    id: input.id ?? crypto.randomUUID(),
    submittedAt: new Date(input.submittedAt).toISOString(),
    quantity: input.quantity,
    type: input.type,
    ...optionalFields,
    updatedAt: input.updatedAt ?? new Date().toISOString(),
  }) as ApplicationEntry
}

export function splitBatchEntry(
  entry: ApplicationEntry,
  details: EntryDetails,
): {
  remainingBatch: ApplicationEntry | null
  detailedEntry: ApplicationEntry
} {
  if (entry.quantity < 1) {
    throw new Error('Only a valid application entry can be promoted.')
  }

  const now = new Date().toISOString()
  const detailedEntry = createEntry({
    submittedAt: entry.submittedAt,
    quantity: 1,
    type: details.type ?? entry.type,
    source: details.source ?? entry.source,
    company: details.company,
    title: details.title,
    url: details.url,
    resumeVariant: details.resumeVariant,
    notes: details.notes,
    outcome: details.outcome,
    updatedAt: now,
  })

  const remainingBatch =
    entry.quantity === 1
      ? null
      : createEntry({
          ...entry,
          quantity: entry.quantity - 1,
          updatedAt: now,
        })

  return { remainingBatch, detailedEntry }
}

function clean(value?: string): string | undefined {
  const trimmed = value?.trim()
  return trimmed || undefined
}

function compact<T extends Record<string, unknown>>(value: T): Partial<T> {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as Partial<T>
}
