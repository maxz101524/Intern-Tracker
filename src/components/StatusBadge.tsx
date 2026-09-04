import { statusLabel } from '../domain/status'
import type { DisplayStatus } from '../domain/types'

export function StatusBadge({ status }: { status: DisplayStatus }) {
  return <span className={`status-badge status-${status}`}>{statusLabel(status)}</span>
}
