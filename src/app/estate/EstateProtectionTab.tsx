import { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, MicroLabel, Field, Input, Select, Button } from '../../components/ui'
import { PageHeader } from '../tabs/PhasePlaceholder'
import { computeBalanceSheet, holdingValue } from '../../lib/finance/networth'
import { estateExposure } from '../../lib/finance/estate'
import { liquidityView } from '../../lib/finance/liquidity'
import { insuranceGaps, INSURANCE_KINDS, INSURANCE_LABEL } from '../../lib/finance/insurance'
import type { InsuranceKind } from '../../lib/finance/insurance'
import { disabilityView, OWN_OCC_TIERS, OWN_OCC_LABEL, BENEFIT_TAX_KINDS, BENEFIT_TAX_LABEL } from '../../lib/finance/disability'
import type { DisabilityDetails } from '../../lib/finance/disability'
import { assetProtectionView } from '../../lib/finance/assetprotection'
import type { MalpracticeDetails } from '../../lib/finance/assetprotection'
import { IncomeProtectionPanel, CreditorExposurePanel } from './PhysicianProtectionPanels'
import { ordinaryTax, marginalRate, standardDeduction } from '../../lib/finance/taxtables'
import { buildChecklist, docGapCount, DOC_STATUSES, DOC_STATUS_LABEL } from '../../lib/finance/estatedocs'
import type { DocStatus, EstateDocState } from '../../lib/finance/estatedocs'
import { FILING_STATUSES, FILING_LABEL } from '../../lib/db'
import type { FilingStatus, InsurancePolicy, EstateDoc } from '../../lib/db'
import { ProtectionPanels } from './ProtectionPanels'
import { useBalanceSheet } from '../balance/useBalanceSheet'
import { useAuth } from '../../auth/AuthProvider'
import { useTaxParams } from '../../lib/useTaxParams'

function ageFromDob(dob: string | null | undefined): number | null {
  if (!dob) return null
  return Math.floor((Date.now() - new Date(dob).getTime()) / (365.25 * 24 * 3600 * 1000))
}

export function EstateProtectionTab() {
  const { data, loading, reload } = useBalanceSheet()
  const { session } = useAuth()
  const [filing, setFiling] = useState<FilingStatus>('single')
  const [filingInited, setFilingInited] = useState(false)
  const [policies, setPolicies] = useState<InsurancePolicy[]>([])
  const [docs, setDocs] = useState<EstateDoc[]>([])

  const loadProtection = async () => {
    const [ins, ed] = await Promise.all([
      supabase.from('insurance_policies').select('*'),
      supabase.from('estate_docs').select('*'),
    ])
    setPolicies((ins.data ?? []) as InsurancePolicy[])
    setDocs((ed.data ?? []) as EstateDoc[])
  }
  useEffect(() => {
    void loadProtection()
  }, [])

  useEffect(() => {
    if (filingInited || loading) return
    setFiling((data.profile?.filing_status as FilingStatus | null) ?? 'single')
    setFilingInited(true)
  }, [loading, data.profile, filingInited])

  const bs = useMemo(
    () => computeBalanceSheet(data.holdings, data.realEstate, data.liabilities, data.quotes),
    [data],
  )
  const { params: taxParams } = useTaxParams()
  const exposure = useMemo(() => estateExposure(bs.netWorth, filing, taxParams), [bs.netWorth, filing, taxParams])
  const liquidity = useMemo(
    () => liquidityView(data.holdings, data.accounts, data.quotes, exposure.federalTax),
    [data.holdings, data.accounts, data.quotes, exposure.federalTax],
  )
  const c529 = useMemo(() => {
    const ids529 = new Set(data.accounts.filter((a) => a.tax_type === '529').map((a) => a.id))
    let sum = 0
    for (const h of data.holdings) {
      if (h.account_id && ids529.has(h.account_id)) sum += holdingValue(h, data.quotes) ?? 0
    }
    return sum
  }, [data.accounts, data.holdings, data.quotes])

  const age = ageFromDob(data.profile?.dob)
  const earnedIncome = data.profile?.earned_income ?? 0

  // Creditor exposure — which dollars a claim can actually reach. Feeds the
  // umbrella line below so the two readouts can never disagree (invariant #1).
  const protection = useMemo(
    () => assetProtectionView(data.holdings, data.accounts, data.realEstate, data.quotes, policies, data.profile?.state ?? null),
    [data.holdings, data.accounts, data.realEstate, data.quotes, policies, data.profile],
  )

  // Own-occupation income protection. Tax rates come from the same tables the
  // Tax tab uses (invariant #1); federal ordinary only — see the note in-panel.
  const disability = useMemo(() => {
    const taxable = Math.max(0, earnedIncome - standardDeduction(filing, taxParams))
    const fed = ordinaryTax(taxable, filing, taxParams)
    return disabilityView(policies, {
      annualEarnedIncome: earnedIncome,
      effectiveTaxRate: earnedIncome > 0 ? fed / earnedIncome : 0,
      marginalRate: marginalRate(taxable, filing, taxParams),
      annualSpending: data.spending?.annual_amount ?? 0,
      age,
      retireAge: data.profile?.retire_age ?? 65,
    })
  }, [policies, earnedIncome, filing, taxParams, data.spending, age, data.profile])

  const insuranceLines = useMemo(() => {
    const hasBusinessOrRental =
      data.holdings.some((h) => h.kind === 'private') || data.realEstate.some((p) => p.kind === 'investment')
    return insuranceGaps(policies, {
      netWorth: bs.netWorth,
      liabilities: bs.totalLiabilities,
      annualSpending: data.spending?.annual_amount ?? 0,
      liquidAssets: liquidity.liquidAssets,
      age,
      hasBusinessOrRental,
      reachableAssets: protection.reachable,
      disabilityStatus: disability.status,
    })
  }, [policies, bs.netWorth, bs.totalLiabilities, data.spending, data.holdings, data.realEstate, age, liquidity.liquidAssets, protection.reachable, disability.status])

  const checklist = useMemo(() => {
    const byType: Record<string, EstateDocState> = {}
    for (const d of docs) if (d.doc_type) byType[d.doc_type] = { status: d.status, last_reviewed: d.last_reviewed, file_ref: d.file_ref }
    return buildChecklist(byType)
  }, [docs])
  const docGaps = docGapCount(checklist)

  const onChangeFiling = async (f: FilingStatus) => {
    setFiling(f)
    if (session) await supabase.from('profiles').update({ filing_status: f }).eq('user_id', session.user.id)
  }

  const empty = bs.netWorth === 0 && data.holdings.length === 0 && data.realEstate.length === 0

  return (
    <div className="mx-auto max-w-4xl space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <PageHeader title="Estate & Protection" />
        <Select value={filing} onChange={(e) => void onChangeFiling(e.target.value as FilingStatus)} className="w-auto! py-1! text-xs">
          {FILING_STATUSES.map((f) => (
            <option key={f} value={f}>{FILING_LABEL[f]}</option>
          ))}
        </Select>
      </div>

      {empty ? (
        <Panel>
          <p className="py-8 text-center text-sm text-faint">
            {loading ? 'Loading…' : 'Add assets on the Balance Sheet to model your estate & protection exposure.'}
          </p>
        </Panel>
      ) : (
        <>
          <IncomeProtectionPanel view={disability} hasIncome={earnedIncome > 0} />
          <EarnedIncomeCard
            value={data.profile?.earned_income ?? null}
            userId={session?.user.id}
            filingLabel={FILING_LABEL[filing]}
            onSaved={reload}
          />
          <CreditorExposurePanel view={protection} />

          <ProtectionPanels
            exposure={exposure}
            filingLabel={FILING_LABEL[filing]}
            liquidity={liquidity}
            insuranceLines={insuranceLines}
            c529={c529}
          />

          {/* Estate-doc checklist + vault */}
          <Panel
            label="Estate documents — checklist & vault"
            right={
              <MicroLabel className={docGaps > 0 ? 'text-amber' : 'text-teal'}>
                {docGaps > 0 ? `${docGaps} need attention` : 'all current'}
              </MicroLabel>
            }
          >
            <ul className="space-y-2">
              {checklist.map((row) => (
                <DocRow
                  key={row.def.type}
                  docType={row.def.type}
                  label={row.def.label}
                  why={row.def.why}
                  status={row.status}
                  lastReviewed={row.lastReviewed}
                  stale={row.stale}
                  fileRef={row.fileRef}
                  existingId={docs.find((d) => d.doc_type === row.def.type)?.id}
                  userId={session?.user.id}
                  onSaved={loadProtection}
                />
              ))}
            </ul>
            <p className="mt-4 text-xs leading-relaxed text-faint">
              ASCENT tracks whether these exist and stay current — it never drafts or files them (invariant #9).
              Anything executed but not reviewed in 3+ years is flagged for a refresh. Files live in a private,
              owner-only vault — encrypted at rest, deletable any time (invariant #10).
            </p>
          </Panel>

          {/* Insurance policies editor */}
          <Panel label="Insurance policies">
            {policies.length > 0 ? (
              <ul className="mb-4 space-y-1.5">
                {policies.map((p) => (
                  <PolicyRow key={p.id} policy={p} onChanged={loadProtection} />
                ))}
              </ul>
            ) : (
              <p className="mb-4 text-sm text-faint">No policies yet — add what's in force to read the gaps.</p>
            )}
            <AddPolicy userId={session?.user.id} onAdded={loadProtection} />
          </Panel>
        </>
      )}
    </div>
  )
}

/**
 * Gross earned income — the input the income-protection readout is built on, and
 * the one the app holds nowhere else. Persists to `profiles.earned_income`.
 * Degrades with a clear message if the migration has not been applied yet.
 */
function EarnedIncomeCard({
  value, userId, filingLabel, onSaved,
}: {
  value: number | null; userId: string | undefined; filingLabel: string; onSaved: () => void
}) {
  const [income, setIncome] = useState(value != null ? String(value) : '')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const dirty = (income ? Number(income) : null) !== value

  const save = async () => {
    if (!userId) return
    setBusy(true)
    setErr(null)
    const { error } = await supabase
      .from('profiles')
      .update({ earned_income: income ? Number(income) : null })
      .eq('user_id', userId)
    setBusy(false)
    if (error) {
      setErr(
        /earned_income/.test(error.message)
          ? 'Needs the protection-details migration — run `supabase db push`, then this saves.'
          : error.message,
      )
      return
    }
    onSaved()
  }

  return (
    <Panel label="Income — the asset being insured">
      <div className="grid grid-cols-1 items-end gap-3 sm:grid-cols-[1fr_auto]">
        <Field label="Gross annual earned income" hint="salary + bonus + production, before tax">
          <Input type="number" value={income} onChange={(e) => setIncome(e.target.value)} placeholder="0" />
        </Field>
        <div className="pb-1.5">
          <Button onClick={save} disabled={busy || !dirty || !userId}>{busy ? 'Saving…' : dirty ? 'Save' : 'Saved'}</Button>
        </div>
      </div>
      {err && <p className="mt-2 text-xs text-coral">{err}</p>}
      <p className="mt-3 text-xs leading-relaxed text-faint">
        After-tax income is computed with the same federal tables the Tax tab uses ({filingLabel}, ordinary income
        only). State and payroll tax are not modeled, so after-tax income here reads slightly high — which makes the
        at-risk figure and the replacement gap, if anything, conservative rather than reassuring.
      </p>
    </Panel>
  )
}

const VAULT_BUCKET = 'estate-docs'

function DocRow({
  docType, label, why, status, lastReviewed, stale, fileRef, existingId, userId, onSaved,
}: {
  docType: string; label: string; why: string; status: DocStatus; lastReviewed: string | null
  stale: boolean; fileRef: string | null; existingId: string | undefined; userId: string | undefined
  onSaved: () => void
}) {
  const [st, setSt] = useState<DocStatus>(status)
  const [reviewed, setReviewed] = useState(lastReviewed ?? '')
  const [saving, setSaving] = useState(false)
  const [vaultBusy, setVaultBusy] = useState(false)
  const [vaultErr, setVaultErr] = useState<string | null>(null)
  const dirty = st !== status || reviewed !== (lastReviewed ?? '')
  const fileName = fileRef ? decodeURIComponent(fileRef.split('/').pop() ?? '') : null

  const save = async () => {
    if (!userId) return
    setSaving(true)
    const payload = { user_id: userId, doc_type: docType, status: st, last_reviewed: reviewed || null }
    if (existingId) await supabase.from('estate_docs').update(payload).eq('id', existingId)
    else await supabase.from('estate_docs').insert(payload)
    setSaving(false)
    onSaved()
  }

  // Vault: upload writes to <uid>/<doc_type>/<filename> (owner-only bucket) and
  // records the path on estate_docs.file_ref. Model + store, never draft (#9/#10).
  const upload = async (file: File) => {
    if (!userId) return
    setVaultBusy(true)
    setVaultErr(null)
    try {
      if (fileRef) await supabase.storage.from(VAULT_BUCKET).remove([fileRef]) // replace, no orphan
      const path = `${userId}/${docType}/${file.name}`
      const up = await supabase.storage.from(VAULT_BUCKET).upload(path, file, { upsert: true })
      if (up.error) throw up.error
      if (existingId) await supabase.from('estate_docs').update({ file_ref: path }).eq('id', existingId)
      else await supabase.from('estate_docs').insert({ user_id: userId, doc_type: docType, status: st, last_reviewed: reviewed || null, file_ref: path })
      onSaved()
    } catch (e) {
      setVaultErr(e instanceof Error ? e.message : 'Upload failed')
    } finally {
      setVaultBusy(false)
    }
  }

  const view = async () => {
    if (!fileRef) return
    const { data, error } = await supabase.storage.from(VAULT_BUCKET).createSignedUrl(fileRef, 60)
    if (!error && data) window.open(data.signedUrl, '_blank', 'noopener')
    else setVaultErr(error?.message ?? 'Could not open file')
  }

  const removeFile = async () => {
    if (!fileRef || !existingId) return
    setVaultBusy(true)
    await supabase.storage.from(VAULT_BUCKET).remove([fileRef])
    await supabase.from('estate_docs').update({ file_ref: null }).eq('id', existingId)
    setVaultBusy(false)
    onSaved()
  }

  return (
    <li className="flex flex-wrap items-center gap-3 border-b border-line py-2.5 last:border-0">
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2 text-sm text-ink">
          {label}
          {stale && <span className="micro-label rounded bg-amber/15 px-1.5 py-0.5 text-[0.6rem] text-amber">stale</span>}
        </div>
        <div className="text-xs text-faint">{why}</div>
      </div>
      <Select value={st} onChange={(e) => setSt(e.target.value as DocStatus)} className="w-auto! py-1! text-xs">
        {DOC_STATUSES.map((s) => (
          <option key={s} value={s}>{DOC_STATUS_LABEL[s]}</option>
        ))}
      </Select>
      <Input type="date" value={reviewed} onChange={(e) => setReviewed(e.target.value)} className="w-auto! py-1! text-xs" />

      {/* Vault — upload / view / replace the document file */}
      <div className="flex items-center gap-2">
        {fileRef ? (
          <>
            <button
              type="button"
              onClick={() => void view()}
              title={fileName ?? undefined}
              className="micro-label max-w-32 truncate text-teal hover:underline"
            >
              📎 {fileName}
            </button>
            <button
              type="button"
              onClick={() => void removeFile()}
              disabled={vaultBusy}
              className="micro-label text-faint hover:text-coral"
            >
              {vaultBusy ? '…' : 'Remove'}
            </button>
          </>
        ) : (
          <label className="micro-label cursor-pointer text-faint transition-colors hover:text-muted">
            {vaultBusy ? 'Uploading…' : '↑ Upload'}
            <input
              type="file"
              className="hidden"
              disabled={vaultBusy || !userId}
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) void upload(f)
                e.target.value = ''
              }}
            />
          </label>
        )}
      </div>

      {dirty && (
        <Button onClick={save} disabled={saving} className="py-1! text-xs">
          {saving ? '…' : 'Save'}
        </Button>
      )}
      {vaultErr && <span className="w-full text-xs text-coral">{vaultErr}</span>}
    </li>
  )
}

/** Terms bag as stored on `insurance_policies.details`. */
type PolicyDetails = DisabilityDetails & MalpracticeDetails

function readDetails(p: InsurancePolicy): PolicyDetails {
  const d = (p as { details?: unknown }).details
  return d && typeof d === 'object' && !Array.isArray(d) ? (d as PolicyDetails) : {}
}

function PolicyRow({ policy, onChanged }: { policy: InsurancePolicy; onChanged: () => void }) {
  const [kind, setKind] = useState<InsuranceKind>(policy.kind as InsuranceKind)
  const [carrier, setCarrier] = useState(policy.carrier ?? '')
  const [coverage, setCoverage] = useState(policy.coverage != null ? String(policy.coverage) : '')
  const [premium, setPremium] = useState(policy.premium != null ? String(policy.premium) : '')
  const [details, setDetails] = useState<PolicyDetails>(() => readDetails(policy))
  const [openTerms, setOpenTerms] = useState(false)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)

  const savedDetails = readDetails(policy)
  const hasTerms = kind === 'disability' || kind === 'malpractice'
  const dirty =
    kind !== policy.kind ||
    (carrier || '') !== (policy.carrier ?? '') ||
    (coverage ? Number(coverage) : null) !== (policy.coverage ?? null) ||
    (premium ? Number(premium) : null) !== (policy.premium ?? null) ||
    JSON.stringify(details) !== JSON.stringify(savedDetails)

  const set = <K extends keyof PolicyDetails>(k: K, v: PolicyDetails[K]) =>
    setDetails((d) => {
      const next = { ...d }
      if (v === undefined) delete next[k]
      else next[k] = v
      return next
    })

  const save = async () => {
    setBusy(true)
    setErr(null)
    const { error } = await supabase
      .from('insurance_policies')
      .update({
        kind,
        carrier: carrier || null,
        coverage: coverage ? Number(coverage) : null,
        premium: premium ? Number(premium) : null,
        // Plain JSON-safe bag; the engines own its shape (see the migration note).
        details: details as Record<string, string | number | boolean>,
      })
      .eq('id', policy.id)
    setBusy(false)
    if (error) {
      setErr(
        /details/.test(error.message)
          ? 'Policy terms need the protection-details migration — run `supabase db push`, then this saves.'
          : error.message,
      )
      return
    }
    onChanged()
  }

  const remove = async () => {
    setBusy(true)
    await supabase.from('insurance_policies').delete().eq('id', policy.id)
    setBusy(false)
    onChanged()
  }

  return (
    <li className="border-b border-line py-2.5 last:border-0">
      <div className="grid grid-cols-2 items-end gap-2 sm:grid-cols-[10rem_1fr_7rem_7rem_auto]">
        <Field label="Type">
          <Select value={kind} onChange={(e) => setKind(e.target.value as InsuranceKind)}>
            {INSURANCE_KINDS.map((k) => (
              <option key={k} value={k}>{INSURANCE_LABEL[k]}</option>
            ))}
          </Select>
        </Field>
        <Field label="Carrier">
          <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" />
        </Field>
        <Field label={kind === 'disability' ? 'Benefit / mo' : 'Coverage'}>
          <Input type="number" value={coverage} onChange={(e) => setCoverage(e.target.value)} placeholder="0" />
        </Field>
        <Field label="Premium/yr">
          <Input type="number" value={premium} onChange={(e) => setPremium(e.target.value)} placeholder="0" />
        </Field>
        <div className="flex items-center gap-2 pb-1.5">
          <button
            type="button"
            onClick={save}
            disabled={busy || !dirty}
            className="micro-label text-teal hover:text-ink disabled:cursor-default disabled:text-faint/40"
          >
            {busy ? '…' : dirty ? 'Save' : 'Saved'}
          </button>
          <button type="button" onClick={remove} disabled={busy} className="micro-label text-faint hover:text-coral">
            Remove
          </button>
        </div>
      </div>

      {/* Terms — the fields that decide whether a policy actually pays. Behind a
          disclosure so the common case stays calm (progressive disclosure, §6). */}
      {hasTerms && (
        <div className="mt-2">
          <button
            type="button"
            onClick={() => setOpenTerms((o) => !o)}
            className="micro-label text-faint transition-colors hover:text-muted"
          >
            {openTerms ? '▾' : '▸'} Policy terms
            {!openTerms && Object.keys(details).length === 0 && (
              <span className="ml-2 text-amber">not recorded</span>
            )}
          </button>

          {openTerms && kind === 'disability' && (
            <div className="mt-2 grid grid-cols-2 gap-3 rounded-[var(--radius-panel)] border border-line p-3 sm:grid-cols-3">
              <Field label="Definition">
                <Select
                  value={details.own_occ ?? ''}
                  onChange={(e) => set('own_occ', (e.target.value || undefined) as DisabilityDetails['own_occ'])}
                >
                  <option value="">Not recorded</option>
                  {OWN_OCC_TIERS.filter((t) => t !== 'unknown').map((t) => (
                    <option key={t} value={t}>{OWN_OCC_LABEL[t]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Benefit tax">
                <Select
                  value={details.benefit_tax ?? ''}
                  onChange={(e) => set('benefit_tax', (e.target.value || undefined) as DisabilityDetails['benefit_tax'])}
                >
                  <option value="">Not recorded</option>
                  {BENEFIT_TAX_KINDS.filter((t) => t !== 'unknown').map((t) => (
                    <option key={t} value={t}>{BENEFIT_TAX_LABEL[t]}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Benefits to age" hint="e.g. 65">
                <Input
                  type="number"
                  value={details.benefit_to_age ?? ''}
                  onChange={(e) => set('benefit_to_age', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="—"
                />
              </Field>
              <Field label="Elimination (days)">
                <Input
                  type="number"
                  value={details.elimination_days ?? ''}
                  onChange={(e) => set('elimination_days', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="—"
                />
              </Field>
              <div className="col-span-2 flex flex-wrap items-center gap-4 pb-1.5 sm:col-span-3">
                <Check label="Employer group" checked={details.group === true} onChange={(v) => set('group', v || undefined)} />
                <Check label="Residual rider" checked={details.residual === true} onChange={(v) => set('residual', v)} />
                <Check label="COLA rider" checked={details.cola === true} onChange={(v) => set('cola', v)} />
                <Check label="Non-cancelable" checked={details.non_cancelable === true} onChange={(v) => set('non_cancelable', v || undefined)} />
              </div>
            </div>
          )}

          {openTerms && kind === 'malpractice' && (
            <div className="mt-2 grid grid-cols-2 gap-3 rounded-[var(--radius-panel)] border border-line p-3 sm:grid-cols-3">
              <Field label="Policy form">
                <Select
                  value={details.form ?? ''}
                  onChange={(e) => set('form', (e.target.value || undefined) as MalpracticeDetails['form'])}
                >
                  <option value="">Not recorded</option>
                  <option value="occurrence">Occurrence</option>
                  <option value="claims_made">Claims-made</option>
                </Select>
              </Field>
              <Field label="Per claim">
                <Input
                  type="number"
                  value={details.per_claim ?? ''}
                  onChange={(e) => set('per_claim', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="0"
                />
              </Field>
              <Field label="Aggregate">
                <Input
                  type="number"
                  value={details.aggregate ?? ''}
                  onChange={(e) => set('aggregate', e.target.value ? Number(e.target.value) : undefined)}
                  placeholder="0"
                />
              </Field>
              <div className="col-span-2 flex flex-wrap items-center gap-4 pb-1.5 sm:col-span-3">
                <Check
                  label="Tail (ERP) secured"
                  checked={details.tail_secured === true}
                  onChange={(v) => set('tail_secured', v)}
                />
                <Check
                  label="Employer-provided"
                  checked={details.employer_provided === true}
                  onChange={(v) => set('employer_provided', v || undefined)}
                />
              </div>
            </div>
          )}
        </div>
      )}

      {err && <p className="mt-1 text-xs text-coral">{err}</p>}
    </li>
  )
}

function Check({ label, checked, onChange }: { label: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center gap-2 text-xs text-muted">
      <input
        type="checkbox"
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className="size-3.5 accent-teal"
      />
      {label}
    </label>
  )
}

function AddPolicy({ userId, onAdded }: { userId: string | undefined; onAdded: () => void }) {
  const [kind, setKind] = useState<InsuranceKind>('term_life')
  const [carrier, setCarrier] = useState('')
  const [coverage, setCoverage] = useState('')
  const [busy, setBusy] = useState(false)

  const add = async () => {
    if (!userId) return
    setBusy(true)
    await supabase.from('insurance_policies').insert({
      user_id: userId,
      kind,
      carrier: carrier || null,
      coverage: coverage ? Number(coverage) : null,
    })
    setBusy(false)
    setCarrier('')
    setCoverage('')
    onAdded()
  }

  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      <Field label="Type">
        <Select value={kind} onChange={(e) => setKind(e.target.value as InsuranceKind)}>
          {INSURANCE_KINDS.map((k) => (
            <option key={k} value={k}>{INSURANCE_LABEL[k]}</option>
          ))}
        </Select>
      </Field>
      <Field label="Carrier">
        <Input value={carrier} onChange={(e) => setCarrier(e.target.value)} placeholder="Carrier" />
      </Field>
      <Field label="Coverage">
        <Input type="number" value={coverage} onChange={(e) => setCoverage(e.target.value)} placeholder="0" />
      </Field>
      <div className="flex items-end">
        <Button onClick={add} disabled={busy || !userId}>{busy ? 'Adding…' : 'Add policy'}</Button>
      </div>
    </div>
  )
}
