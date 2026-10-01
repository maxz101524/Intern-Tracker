// The Paceboard sync key stays in this browser only: never IndexedDB, backups, or URLs.
const STORAGE_KEY = 'paceboard.museSyncKey'

export function getMuseKey(): string | null {
  try {
    return localStorage.getItem(STORAGE_KEY)
  } catch {
    return null
  }
}

export function setMuseKey(key: string): void {
  try {
    localStorage.setItem(STORAGE_KEY, key)
  } catch {
    throw new Error('This browser blocked local storage, so the sync key cannot be saved.')
  }
}

export function clearMuseKey(): void {
  try {
    localStorage.removeItem(STORAGE_KEY)
  } catch {
    // Nothing to clear when storage is unavailable.
  }
}
