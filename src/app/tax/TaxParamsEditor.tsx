import { useEffect, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Field, Input, Button } from '../../components/ui'
import { DEFAULT_TAX_PARAMS, paramsToJson, paramsFromJson } from '../../lib/finance/taxparams'
import { useTaxParams } from '../../lib/useTaxParams'
import { useAuth } from '../../auth/AuthProvider'

/**
 * Yearly entry of the statutory tax/estate parameters. The engines read these from
 * the DB (falling back to the built-in 2026 defaults), so the user updates them once
 * a year when the IRS Revenue Procedure publishes — no code change. Power-user JSON
 * editor pre-filled with the active values; a reminder in the digest nudges the update.
 */
export function TaxParamsEditor() {
  const { params, storedYear, usingDefaults, loading, reload } = useTaxParams()
  const { session } = useAuth()
  const [year, setYear] = useState(new Date().getFullYear())
  const [json, setJson] = useState('')
  const [inited, setInited] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [note, setNote] = useState<string | null>(null)
  const [saving, setSaving] = useState(false)

  useEffect(() => {
    if (loading || inited) return
    setJson(paramsToJson(params))
    setYear(Math.max(params.year, new Date().getFullYear()))
    setInited(true)
  }, [loading, params, inited])

  const loadDefaults = () => {
    setJson(paramsToJson(DEFAULT_TAX_PARAMS))
    setErr(null)
    setNote('Loaded built-in defaults — edit the year and any changed figures, then save.')
  }

  const save = async () => {
    setErr(null)
    setNote(null)
    let parsed
    try {
      parsed = paramsFromJson(json)
      parsed.year = year
    } catch (e) {
      setErr(`Invalid parameters JSON: ${e instanceof Error ? e.message : 'parse error'}`)
      return
    }
    if (!session) return
    setSaving(true)
    const { error } = await supabase.from('tax_parameters').upsert(
      { user_id: session.user.id, tax_year: year, params: JSON.parse(paramsToJson(parsed)) },
      { onConflict: 'user_id,tax_year' },
    )
    setSaving(false)
    if (error) {
      setErr(
        error.message.includes('tax_parameters')
          ? 'Save failed — the tax_parameters table isn’t migrated yet (run supabase db push).'
          : error.message,
      )
      return
    }
    setNote(`Saved ${year} parameters — every tax, withdrawal, and estate figure now uses them.`)
    await reload()
  }

  return (
    <Panel
      label="Tax & statutory parameters"
      right={
        <MicroLabel className={usingDefaults ? 'text-amber' : 'text-teal'}>
          {usingDefaults ? 'using built-in defaults' : `stored: ${storedYear}`}
        </MicroLabel>
      }
    >
      <p className="text-sm leading-relaxed text-muted">
        Brackets, standard deduction, LTCG / IRMAA / RMD / NIIT, and the estate exemption — everything that
        changes yearly. The engines read these; update them once a year when the IRS Revenue Procedure
        publishes (the digest reminds you). Approximate figures — confirm with your CPA (invariant #9).
      </p>

      <div className="mt-4 flex items-end gap-3">
        <Field label="Tax year">
          <Input type="number" value={year} onChange={(e) => setYear(Number(e.target.value))} className="w-28" />
        </Field>
        <Button variant="ghost" onClick={loadDefaults}>Load built-in defaults</Button>
      </div>

      <textarea
        value={json}
        onChange={(e) => setJson(e.target.value)}
        spellCheck={false}
        className="mt-3 h-64 w-full rounded-lg border border-line bg-panel-hi p-3 font-mono text-xs text-ink outline-none focus:border-teal/60"
      />

      <div className="mt-3 flex items-center gap-3">
        <Button onClick={save} disabled={saving || !session}>{saving ? 'Saving…' : `Save ${year} parameters`}</Button>
        {note && <span className="text-xs text-teal">{note}</span>}
        {err && <span className="text-xs text-coral">{err}</span>}
      </div>
    </Panel>
  )
}
