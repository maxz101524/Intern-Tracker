import { AlertTriangle, Bot, KeyRound, RefreshCw, Unplug } from 'lucide-react'
import { useState, type FormEvent } from 'react'
import type { MuseSyncController } from '../hooks/useMuseSync'

export function MuseSettings({ muse }: { muse: MuseSyncController }) {
  const [key, setKey] = useState('')
  const [connecting, setConnecting] = useState(false)
  const busy = connecting || muse.status === 'syncing'
  const { lastPulledAt, lastLedgerPublishedAt, retentionGap } = muse.data.syncState

  async function connect(event: FormEvent) {
    event.preventDefault()
    setConnecting(true)
    try {
      await muse.connect(key)
      setKey('')
    } catch {
      // The controller exposes a safe user-facing error.
    } finally {
      setConnecting(false)
    }
  }

  return (
    <section className="settings-section muse-settings" aria-busy={busy}>
      <div className="settings-heading"><span className="settings-icon"><Bot size={20} /></span><div><h2>Muse sync</h2><p>Roles Muse submits and status changes it finds arrive here automatically.</p></div></div>

      {!muse.connected ? (
        <form className="muse-connect" onSubmit={connect}>
          <label className="setting-field">Paceboard sync key
            <input type="password" autoComplete="off" spellCheck={false} value={key} onChange={(event) => setKey(event.target.value)} placeholder="Paste PACEBOARD_SYNC_KEY" />
          </label>
          <button type="submit" className="button primary align-start" disabled={busy || !key.trim()}><KeyRound size={16} /> {busy ? 'Connecting…' : 'Connect Muse'}</button>
          <p className="gmail-privacy">The key stays in this browser only. It is never added to backups or exports.</p>
        </form>
      ) : (
        <>
          <div className="gmail-status-row">
            <div>
              <span className={`connection-dot ${muse.status === 'error' ? '' : 'connected'}`} aria-hidden="true" />
              <strong>{muse.status === 'error' ? 'Connected, last pull failed' : 'Connected'}</strong>
              <p>Checks for new batches when Paceboard opens and every 10 minutes while it is open.</p>
            </div>
            <div className="gmail-actions">
              <button type="button" className="button primary" disabled={busy} onClick={() => void muse.pullNow().catch(() => undefined)}><RefreshCw size={16} className={busy ? 'spin' : ''} /> {busy ? 'Pulling…' : 'Pull now'}</button>
              <button type="button" className="button secondary" disabled={busy} onClick={muse.disconnect}><Unplug size={16} /> Disconnect</button>
            </div>
          </div>
          <div className="gmail-sync-summary">
            <span><strong>{muse.pendingItems.length + muse.openDecisions.length}</strong> waiting for you</span>
            <span><strong>Last pull</strong> {lastPulledAt ? new Date(lastPulledAt).toLocaleString() : 'Never'}</span>
            <span><strong>Ledger shared</strong> {lastLedgerPublishedAt ? new Date(lastLedgerPublishedAt).toLocaleString() : 'Not yet'}</span>
          </div>
        </>
      )}

      {retentionGap && <div className="duplicate-warning" role="status"><AlertTriangle size={17} /><span>Paceboard was away long enough that some Muse batches may have expired on the relay. Ask Muse to resend anything from the gap.</span><button type="button" className="button secondary" onClick={() => void muse.acknowledgeRetentionGap()}>Dismiss</button></div>}
      {muse.error && <p className="form-error" role="alert">{muse.error}</p>}
    </section>
  )
}
