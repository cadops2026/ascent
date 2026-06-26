// evaluate-alerts — the scheduled server-side counterpart of the in-app digest.
// Reuses the ONE pure alert engine (invariant #1, vendored under _shared/finance);
// nothing here reads a price delta — alerts are pre-committed, threshold/event-
// driven, low-frequency (invariant #7). It evaluates each opted-in user (anyone
// who set thresholds in the Risk tab → has an alert_rules row), rebuilds their
// balance sheet + look-through from current holdings, and persists the breaching
// set to `alerts` with a calm window-dedupe (won't re-nag a dismissed alert
// within its cadence; auto-resolves alerts that no longer breach).
//
// Browser → Supabase only (invariant #10): this is server-side, service-role,
// and gated by a CRON_SECRET so only the scheduler can invoke it.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { computeBalanceSheet } from '../_shared/finance/networth.ts'
import type { QuoteMap } from '../_shared/finance/networth.ts'
import { buildEtfMap, lookThrough } from '../_shared/finance/lookthrough.ts'
import type { EtfHoldingRow } from '../_shared/finance/lookthrough.ts'
import { amortize } from '../_shared/finance/amortization.ts'
import { evaluateAlerts } from '../_shared/finance/alertengine.ts'
import type { AlertRuleSet, EvaluatedAlert, TargetWeight, BandSpec } from '../_shared/finance/alertengine.ts'
import type { Holding, RealEstate, Liability } from '../_shared/finance/types.ts'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type, x-cron-secret',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })
}

/** How far back a same alert silences a repeat, by digest cadence. */
function dedupeWindowDays(cadence: string): number {
  if (cadence === 'weekly') return 6
  return 28 // monthly (default) and event
}

interface ExistingAlert {
  id: string
  kind: string
  payload: { title?: string } | null
  created_at: string
  dismissed_at: string | null
}

const alertKey = (kind: string, title: string) => `${kind}|${title}`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // Gate: only the scheduler (or an operator holding the secret) may invoke this.
  const secret = Deno.env.get('CRON_SECRET')
  if (!secret) return json({ error: 'CRON_SECRET not set in Supabase secrets' }, 500)
  if (req.headers.get('x-cron-secret') !== secret) return json({ error: 'unauthorized' }, 401)

  try {
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    const now = new Date()
    const currentYear = now.getFullYear()

    // Global reference data (shared cache tables) — fetched once for all users.
    const [{ data: quoteRows }, { data: etfRows }] = await Promise.all([
      admin.from('quote_cache').select('symbol, price'),
      admin.from('etf_holdings').select('etf_symbol, holding_symbol, holding_name, weight'),
    ])
    const quotes: QuoteMap = {}
    for (const q of quoteRows ?? []) if (q.price != null) quotes[String(q.symbol).toUpperCase()] = Number(q.price)
    const etfMap = buildEtfMap((etfRows ?? []) as EtfHoldingRow[])

    // Opted-in users: those who set pre-committed thresholds in the Risk tab.
    const { data: ruleRows, error: ruleErr } = await admin
      .from('alert_rules')
      .select('user_id, rebalance_band_pt, single_name_pct, narrative_pct, tlh_min_loss, cadence')
    if (ruleErr) throw ruleErr

    let evaluated = 0
    let inserted = 0
    let resolved = 0

    for (const row of ruleRows ?? []) {
      const uid = row.user_id as string
      const rules: AlertRuleSet = {
        rebalance_band_pt: row.rebalance_band_pt,
        single_name_pct: row.single_name_pct,
        narrative_pct: row.narrative_pct,
        tlh_min_loss: row.tlh_min_loss,
        cadence: row.cadence ?? 'monthly',
      }

      // Per-user data (service role; scoped by user_id).
      const [holdingsR, reR, liabR, targetR, bandR, taxR, cmaR] = await Promise.all([
        admin.from('holdings').select('symbol, name, kind, entry_mode, shares, manual_amount').eq('user_id', uid),
        admin.from('real_estate').select('kind, market_value').eq('user_id', uid),
        admin.from('liabilities').select('label, kind, orig_balance, rate, term_months, start_date').eq('user_id', uid),
        admin.from('target_allocation').select('asset_class, target_pct').eq('user_id', uid),
        admin.from('rebalance_bands').select('asset_class, abs_pts, rel_pct').eq('user_id', uid),
        admin.from('tax_parameters').select('tax_year').eq('user_id', uid).order('tax_year', { ascending: false }).limit(1),
        admin.from('cma_params').select('cma_year').eq('user_id', uid).order('cma_year', { ascending: false }).limit(1),
      ])

      const holdings = (holdingsR.data ?? []) as Holding[]
      const realEstate = (reR.data ?? []) as RealEstate[]
      const liabilities = (liabR.data ?? []) as Liability[]

      const bs = computeBalanceSheet(holdings, realEstate, liabilities, quotes, now)
      if (bs.investable <= 0) continue // nothing to evaluate yet
      const lt = lookThrough(holdings, realEstate, quotes, etfMap)

      const mortgages = liabilities
        .filter((l) => l.kind === 'mortgage')
        .map((l) => {
          const st = amortize(
            { origBalance: l.orig_balance, annualRate: l.rate, termMonths: l.term_months, startDate: l.start_date },
            now,
          )
          return { label: l.label ?? 'Mortgage', monthsToPayoff: st.valid ? st.monthsRemaining : null }
        })

      const targets: TargetWeight[] = (targetR.data ?? [])
        .filter((t) => t.target_pct != null)
        .map((t) => ({ asset_class: t.asset_class as string, target_pct: Number(t.target_pct) }))
      const bands: BandSpec[] = (bandR.data ?? []).map((b) => ({
        asset_class: b.asset_class as string,
        abs_pts: b.abs_pts,
        rel_pct: b.rel_pct,
      }))
      const taxParamsYear = taxR.data?.[0]?.tax_year ?? null
      const cmaParamsYear = cmaR.data?.[0]?.cma_year ?? null

      const current: EvaluatedAlert[] = evaluateAlerts({
        byClass: bs.byClass,
        investable: bs.investable,
        lookThrough: lt,
        targets,
        bands,
        rules,
        mortgages,
        taxParamsYear,
        cmaParamsYear,
        currentYear,
      })
      evaluated++

      // Reconcile against what's already on record (calm: no re-nagging).
      const windowMs = dedupeWindowDays(rules.cadence) * 24 * 3600 * 1000
      const since = new Date(now.getTime() - windowMs).toISOString()
      const { data: existingRows } = await admin
        .from('alerts')
        .select('id, kind, payload, created_at, dismissed_at')
        .eq('user_id', uid)
        .or(`dismissed_at.is.null,created_at.gte.${since}`)
      const existing = (existingRows ?? []) as ExistingAlert[]

      // Don't re-insert an alert that's already on record: any still-OPEN row
      // (regardless of age — else a long-open alert would duplicate every run
      // once it aged past the window) or any row seen within the dedupe window
      // (which also respects a manual dismiss for the period). `existing` is
      // already exactly (open ∪ created-within-window), so its full key set is
      // the suppression set.
      const recentKeys = new Set(existing.map((e) => alertKey(e.kind, e.payload?.title ?? '')))
      const currentKeys = new Set(current.map((a) => alertKey(a.kind, a.title)))

      const toInsert = current
        .filter((a) => !recentKeys.has(alertKey(a.kind, a.title)))
        .map((a) => ({ user_id: uid, kind: a.kind, payload: { severity: a.severity, title: a.title, detail: a.detail } }))
      if (toInsert.length) {
        const { error } = await admin.from('alerts').insert(toInsert)
        if (!error) inserted += toInsert.length
      }

      // Auto-resolve open alerts that no longer breach — keeps the digest current.
      const stale = existing.filter(
        (e) => e.dismissed_at == null && !currentKeys.has(alertKey(e.kind, e.payload?.title ?? '')),
      )
      if (stale.length) {
        const { error } = await admin
          .from('alerts')
          .update({ dismissed_at: now.toISOString() })
          .in('id', stale.map((e) => e.id))
        if (!error) resolved += stale.length
      }
    }

    return json({ evaluated, inserted, resolved })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
