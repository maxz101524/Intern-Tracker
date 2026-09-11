import { AlertTriangle, CheckCircle2, Mail, RefreshCw, RotateCcw, Unplug } from 'lucide-react'
import { useState } from 'react'
import type { GmailImportController } from '../hooks/useGmailImport'

export function GmailSettings({ gmail }: { gmail: GmailImportController }) {
  const [confirmReset, setConfirmReset] = useState(false)
  const configured = gmail.authState.status !== 'unconfigured'
  const connected = gmail.authState.status === 'connected'
  const busy = gmail.syncStatus === 'syncing' || gmail.authState.status === 'connecting'
  const lastSync = gmail.gmailData.syncState.lastSuccessfulSyncAt

  async function run(action: () => Promise<void>) {
    try {
      await action()
    } catch {
      // The controller exposes a safe user-facing error.
    }
  }

  return (
    <section className="settings-section gmail-settings" aria-busy={busy}>
      <div className="settings-heading"><span className="settings-icon"><Mail size={20} /></span><div><h2>Gmail import</h2><p>Review confirmations, assessments, interviews, and rejections.</p></div></div>

      {!configured ? (
        <div className="gmail-config-note"><AlertTriangle size={18} /><div><strong>Google OAuth client ID needed</strong><p>Add `VITE_GOOGLE_CLIENT_ID` to enable private, read-only Gmail access. Manual tracking remains fully available.</p></div></div>
      ) : (
        <>
          <div className="gmail-status-row">
            <div>
              <span className={`connection-dot ${connected ? 'connected' : ''}`} aria-hidden="true" />
              <strong>{connected ? 'Connected for this session' : gmail.authState.status === 'expired' ? 'Authorization expired' : 'Ready to connect'}</strong>
              <p>{gmail.gmailData.syncState.accountEmail ?? 'No Gmail account connected yet'}</p>
            </div>
            <div className="gmail-actions">
              <button type="button" className="button primary" disabled={busy} onClick={() => void run(connected ? gmail.syncNow : gmail.connectAndSync)}>
                <RefreshCw size={16} className={busy ? 'spin' : ''} />
                {busy ? 'Syncing…' : connected ? 'Sync now' : gmail.authState.status === 'expired' ? 'Reconnect Gmail & sync' : 'Connect Gmail & scan'}
              </button>
              {connected && <button type="button" className="button secondary" disabled={busy} onClick={() => void run(gmail.disconnect)}><Unplug size={16} /> Disconnect</button>}
            </div>
          </div>
          <div className="gmail-sync-summary">
            <span><strong>{gmail.pendingCandidates.length}</strong> pending review</span>
            <span><strong>Last sync</strong> {lastSync ? new Date(lastSync).toLocaleString() : 'Never'}</span>
            {lastSync && <span className="sync-ok"><CheckCircle2 size={15} /> Incremental sync active</span>}
          </div>
        </>
      )}

      {(gmail.error || gmail.authState.error) && <p className="form-error" role="alert">{gmail.error || gmail.authState.error}</p>}
      <p className="gmail-privacy">Paceboard reads matching recruiting messages in this browser. It stores only review fields, a short supporting excerpt, and Gmail IDs—not access tokens or complete email bodies.</p>

      {gmail.gmailData.syncState.initialSyncCompleted && (
        <div className="gmail-reset">
          {!confirmReset ? (
            <button type="button" className="button danger-text" onClick={() => setConfirmReset(true)}><RotateCcw size={16} /> Reset Gmail import history</button>
          ) : (
            <div className="inline-confirm" role="alert"><p>Previously dismissed messages can return on the next scan.</p><button type="button" className="button secondary" onClick={() => setConfirmReset(false)}>Cancel</button><button type="button" className="button danger" onClick={() => void run(async () => { await gmail.resetHistory(); setConfirmReset(false) })}>Reset history</button></div>
          )}
        </div>
      )}
    </section>
  )
}
