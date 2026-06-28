import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Field, Input, Button } from '../../components/ui'
import { buildCma } from '../../lib/finance/cma'
import type { CmaSourceRow, UniverseRow } from '../../lib/finance/cma'
import { useCmaParams } from '../../lib/useCmaParams'
import { useAuth } from '../../auth/AuthProvider'

const CLASS_LABEL: Record<string, string> = {
  us_equity: 'Equities', crypto: 'Crypto', cash: 'Cash',
  private_equity: 'Private', collectibles: 'Collectibles', real_estate: 'Real estate',
}

interface Editable { expectedReturn: number; vol: number; corr: number } // er/vol as %, corr as decimal

/**
 * Yearly entry of the capital-market assumptions (expected return / vol / correlation
 * per asset class). The consensus is seeded in the DB; this stores a per-user override
 * the projection / glide-path / withdrawal engines read. Update when the houses
 * republish (the digest reminds you). Estimates, not advice (invariant #5/#9).
 */
export function CmaParamsEditor() {
  const { params: stored, storedYear, reload } = useCmaParams()
  const { session } = useAuth()
  const [rows, setRows] = useState<{ cma: CmaSourceRow[]; uni: UniverseRow[] } | null>(null)
  const [year, setYear] = useState(new Date().getFullYear())
  const [vals, setVals] = useState<Record<string, Editable>>({})
  const [inited, setInited] = useState(false)
  const [saving, setSaving] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)

  useEffect(() => {
    void (async () => {
      const [c, u] = await Promise.all([
        supabase.from('cma_sources').select('asset_class, house, value'),
        supabase.from('asset_class_universe').select('class, cma_premium, vol, corr_to_us_equity, cost_proxy'),
      ])
      setRows({ cma: (c.data ?? []) as CmaSourceRow[], uni: (u.data ?? []) as UniverseRow[] })
    })()
  }, [])

  const consensus = useMemo(() => (rows ? buildCma(rows.cma, rows.uni) : {}), [rows])

  // Seed the form: stored override if present, else the consensus.
  useEffect(() => {
    if (inited || !rows || Object.keys(consensus).length === 0) return
    const v: Record<string, Editable> = {}
    for (const [cls, c] of Object.entries(consensus)) {
      const o = stored?.classes[cls]
      v[cls] = {
        expectedReturn: Math.round((o?.expectedReturn ?? c.expectedReturn) * 1000) / 10,
        vol: Math.round((o?.vol ?? c.vol) * 1000) / 10,
        corr: Math.round((o?.corr ?? c.corr) * 100) / 100,
      }
    }
    setVals(v)
    if (storedYear) setYear(Math.max(storedYear, new Date().getFullYear()))
    setInited(true)
  }, [rows, consensus, stored, storedYear, inited])

  const resetToConsensus = () => {
    const v: Record<string, Editable> = {}
    for (const [cls, c] of Object.entries(consensus)) {
      v[cls] = { expectedReturn: Math.round(c.expectedReturn * 1000) / 10, vol: Math.round(c.vol * 1000) / 10, corr: Math.round(c.corr * 100) / 100 }
    }
    setVals(v)
    setNote('Reset to the seeded consensus — adjust and save.')
  }

  const save = async () => {
    setErr(null); setNote(null)
    if (!session) return
    const classes: Record<string, { expectedReturn: number; vol: number; corr: number }> = {}
    for (const [cls, e] of Object.entries(vals)) classes[cls] = { expectedReturn: e.expectedReturn / 100, vol: e.vol / 100, corr: e.corr }
    setSaving(true)
    const { error } = await supabase.from('cma_params').upsert(
      { user_id: session.user.id, cma_year: year, params: { year, classes } },
      { onConflict: 'user_id,cma_year' },
    )
    setSaving(false)
    if (error) {
      setErr(error.message.includes('cma_params') ? 'Save failed — the cma_params table isn’t migrated yet (run supabase db push).' : error.message)
      return
    }
    setNote(`Saved ${year} assumptions — projections, glide-path, and withdrawal now use them.`)
    await reload()
  }

  const classes = Object.keys(consensus)

  return (
    <Panel
      label="Capital-market assumptions"
      right={<MicroLabel className={stored ? 'text-teal' : 'text-amber'}>{stored ? `stored: ${storedYear}` : 'using seeded consensus'}</MicroLabel>}
    >
      <p className="text-sm leading-relaxed text-muted">
        Expected <span className="text-ink">real</span> (after-inflation) return, volatility, and
        correlation-to-equities per asset class — the Monte Carlo inputs. The consensus is seeded from the
        major houses; override here when they republish (annually). These steer projections, not a forecast
        of what will outperform (invariant #5).
      </p>

      {classes.length === 0 ? (
        <p className="mt-4 text-sm text-faint">Loading the seeded consensus…</p>
      ) : (
        <>
          <div className="mt-4 grid grid-cols-[1fr_repeat(3,5rem)] items-center gap-x-3 gap-y-2">
            <MicroLabel className="text-faint">Class</MicroLabel>
            <MicroLabel className="text-right text-faint">Real %</MicroLabel>
            <MicroLabel className="text-right text-faint">Vol %</MicroLabel>
            <MicroLabel className="text-right text-faint">Corr</MicroLabel>
            {classes.map((cls) => (
              <Row key={cls} label={CLASS_LABEL[cls] ?? cls} v={vals[cls]} onChange={(nv) => setVals((s) => ({ ...s, [cls]: nv }))} />
            ))}
          </div>

          <div className="mt-5 flex items-end gap-3">
            <Field label="CMA year">
              <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-24" />
            </Field>
            <Button onClick={save} disabled={saving || !session}>{saving ? 'Saving…' : `Save ${year}`}</Button>
            <Button variant="ghost" onClick={resetToConsensus}>Reset to consensus</Button>
            {note && <span className="text-xs text-teal">{note}</span>}
            {err && <span className="text-xs text-coral">{err}</span>}
          </div>
        </>
      )}
    </Panel>
  )
}

function Row({ label, v, onChange }: { label: string; v: Editable | undefined; onChange: (v: Editable) => void }) {
  if (!v) return null
  return (
    <>
      <span className="text-sm text-ink">{label}</span>
      <Input type="number" value={v.expectedReturn} onChange={(e) => onChange({ ...v, expectedReturn: Number(e.target.value) })} className="py-1! text-right text-xs" />
      <Input type="number" value={v.vol} onChange={(e) => onChange({ ...v, vol: Number(e.target.value) })} className="py-1! text-right text-xs" />
      <Input type="number" step="0.05" value={v.corr} onChange={(e) => onChange({ ...v, corr: Number(e.target.value) })} className="py-1! text-right text-xs" />
    </>
  )
}
