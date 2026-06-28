import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Field, Input, Button } from '../../components/ui'
import { useAuth } from '../../auth/AuthProvider'

/**
 * Two optional macro overrides on the projection, stored on the profile:
 *  • Expected inflation — a flat rate that replaces the EXPINF/seeded curve.
 *  • Expected real growth — a single blended real portfolio return; when set, the
 *    per-class CMA means are re-centered so the weighted real return equals it
 *    (vol / correlation / dispersion preserved). Blank = use the per-class CMA.
 * Both are real (after-inflation) figures, entered as percents. The per-class
 * detail still lives in the Capital-market assumptions editor above.
 */
export function MacroAssumptionsEditor() {
  const { session } = useAuth()
  const [infl, setInfl] = useState('')
  const [growth, setGrowth] = useState('')
  const [loaded, setLoaded] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const { data } = await supabase
        .from('profiles')
        .select('inflation_override, real_growth_override')
        .maybeSingle()
      if (data?.inflation_override != null) setInfl(String(Math.round(data.inflation_override * 1000) / 10))
      if (data?.real_growth_override != null) setGrowth(String(Math.round(data.real_growth_override * 1000) / 10))
      setLoaded(true)
    })()
  }, [])

  const toFrac = (s: string): number | null => {
    const t = s.trim()
    if (t === '') return null
    const n = Number(t)
    return Number.isFinite(n) ? n / 100 : null
  }

  const save = async () => {
    setErr(null)
    setNote(null)
    if (!session) return
    if ((infl.trim() !== '' && toFrac(infl) == null) || (growth.trim() !== '' && toFrac(growth) == null)) {
      setErr('Enter numbers (percent), or leave blank to use the defaults.')
      return
    }
    setSaving(true)
    const { error } = await supabase.from('profiles').upsert({
      user_id: session.user.id,
      inflation_override: toFrac(infl),
      real_growth_override: toFrac(growth),
    })
    setSaving(false)
    if (error) {
      setErr(
        error.message.includes('inflation_override') || error.message.includes('column')
          ? 'Save failed — run the macro-overrides migration (supabase db push) first.'
          : error.message,
      )
      return
    }
    setNote('Saved — the dashboard, projection, glide-path, and withdrawal planner now use these.')
  }

  return (
    <Panel
      label="Macro assumptions"
      right={<MicroLabel className="text-faint">inflation · real growth</MicroLabel>}
    >
      <p className="text-sm leading-relaxed text-muted">
        Set your own <span className="text-ink">inflation</span> and a single blended{' '}
        <span className="text-ink">real growth</span> rate. Both are real (after-inflation); leave either
        blank to fall back to the live inflation curve and the per-class consensus CMA above. These steer the
        projection — not a forecast (invariant #5).
      </p>

      <div className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2">
        <Field label="Expected inflation %/yr" hint="blank = live EXPINF / seeded curve">
          <Input
            type="number"
            step="0.1"
            value={infl}
            onChange={(e) => setInfl(e.target.value)}
            placeholder="e.g. 2.4"
            disabled={!loaded}
          />
        </Field>
        <Field label="Expected real growth %/yr" hint="blank = per-class CMA blend">
          <Input
            type="number"
            step="0.1"
            value={growth}
            onChange={(e) => setGrowth(e.target.value)}
            placeholder="e.g. 4.0"
            disabled={!loaded}
          />
        </Field>
      </div>

      <div className="mt-4 flex items-center gap-3">
        <Button onClick={save} disabled={saving || !session || !loaded}>
          {saving ? 'Saving…' : 'Save'}
        </Button>
        {note && <span className="text-xs text-teal">{note}</span>}
        {err && <span className="text-xs text-coral">{err}</span>}
      </div>
    </Panel>
  )
}
