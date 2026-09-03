import { useState, type FormEvent } from 'react'
import { ArrowRight, Check } from 'lucide-react'

interface OnboardingProps {
  onSave: (weeklyTarget: number) => Promise<void>
}

export function Onboarding({ onSave }: OnboardingProps) {
  const [target, setTarget] = useState('35')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  async function submit(event: FormEvent) {
    event.preventDefault()
    const value = Number(target)
    if (!Number.isInteger(value) || value < 1 || value > 500) {
      setError('Choose a whole number between 1 and 500.')
      return
    }
    setSaving(true)
    try {
      await onSave(value)
    } catch {
      setError('Your weekly target could not be saved. Try again.')
      setSaving(false)
    }
  }

  return (
    <main className="onboarding-shell">
      <section className="onboarding-panel" aria-labelledby="onboarding-title">
        <div className="brand-lockup onboarding-brand">
          <span className="brand-mark" aria-hidden="true">P</span>
          <span>Paceboard</span>
        </div>
        <div className="onboarding-copy">
          <p className="context-label">Your application week starts here</p>
          <h1 id="onboarding-title">Set your weekly pace</h1>
          <p>
            Pick a realistic target. You can change it any time—this is a guide,
            not a grade.
          </p>
        </div>
        <form onSubmit={submit} className="target-form">
          <label htmlFor="weekly-target">Applications per week</label>
          <div className="target-input-row">
            <input
              id="weekly-target"
              type="number"
              min="1"
              max="500"
              value={target}
              onChange={(event) => setTarget(event.target.value)}
              autoFocus
            />
            <span>per week</span>
          </div>
          {error && <p className="form-error" role="alert">{error}</p>}
          <button className="button primary wide" disabled={saving}>
            {saving ? 'Saving…' : 'Start tracking'}
            {!saving && <ArrowRight size={18} aria-hidden="true" />}
          </button>
        </form>
        <ul className="onboarding-promises">
          <li><Check size={16} /> No account</li>
          <li><Check size={16} /> Data stays in this browser</li>
          <li><Check size={16} /> Export any time</li>
        </ul>
      </section>
      <aside className="onboarding-visual" aria-label="Example weekly pace">
        <div className="sample-week">
          <div>
            <span>This week</span>
            <strong>27 / 35</strong>
          </div>
          <p>Eight applications to go. You need 2.0 per day.</p>
          <div className="sample-bars" aria-hidden="true">
            {[48, 72, 42, 86, 62, 26, 12].map((height, index) => (
              <span key={index} style={{ height: `${height}%` }} />
            ))}
          </div>
          <div className="sample-days" aria-hidden="true">
            <span>M</span><span>T</span><span>W</span><span>T</span><span>F</span><span>S</span><span>S</span>
          </div>
        </div>
      </aside>
    </main>
  )
}
