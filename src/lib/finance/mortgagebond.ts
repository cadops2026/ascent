import type { Liability } from '../db'
import { amortize } from './amortization'

/**
 * Mortgage-as-short-bond. A fixed-rate mortgage is economically a *short* bond
 * position: you owe a stream of fixed payments, so its value moves inversely to
 * rates like a bond you're short. Surfacing this frames the home's leverage
 * honestly — and counsels against reflexively killing a low-rate mortgage
 * (a sub-4% loan is a cheap short bond; paying it off forgoes that, spec §8).
 */
export interface ShortBondPosition {
  label: string
  balance: number
  rate: number
  monthsRemaining: number
  monthlyPayment: number
  /** Macaulay duration (years) of the remaining payment stream. */
  durationYears: number
  annualInterest: number
}

export interface MortgageBondView {
  positions: ShortBondPosition[]
  totalShortBond: number
  /** Balance-weighted average rate across mortgages. */
  weightedRate: number
  /** Balance-weighted average duration (years). */
  weightedDuration: number
}

/** Macaulay duration of the remaining fixed amortizing stream (PV-weighted time). */
function remainingDuration(monthlyRate: number, payment: number, months: number): number {
  if (months <= 0 || payment <= 0) return 0
  if (monthlyRate === 0) {
    // Level principal: average time of equal cashflows.
    let twPV = 0
    for (let m = 1; m <= months; m++) twPV += m * payment
    return twPV / (payment * months) / 12
  }
  let pv = 0
  let timeWeightedPv = 0
  for (let m = 1; m <= months; m++) {
    const df = Math.pow(1 + monthlyRate, -m)
    pv += payment * df
    timeWeightedPv += m * payment * df
  }
  if (pv <= 0) return 0
  return timeWeightedPv / pv / 12 // months → years
}

export function mortgageAsShortBond(liabilities: Liability[], asOf: Date = new Date()): MortgageBondView {
  const positions: ShortBondPosition[] = []
  for (const l of liabilities) {
    if (l.kind !== 'mortgage') continue
    const st = amortize(
      { origBalance: l.orig_balance, annualRate: l.rate, termMonths: l.term_months, startDate: l.start_date },
      asOf,
    )
    const rate = l.rate ?? 0
    const monthlyRate = rate / 12
    const durationYears = st.valid
      ? remainingDuration(monthlyRate, st.monthlyPayment, st.monthsRemaining)
      : 0
    positions.push({
      label: l.label ?? 'Mortgage',
      balance: st.currentBalance,
      rate,
      monthsRemaining: st.monthsRemaining,
      monthlyPayment: st.monthlyPayment,
      durationYears,
      annualInterest: st.currentBalance * rate,
    })
  }

  const totalShortBond = positions.reduce((s, p) => s + p.balance, 0)
  const weightedRate =
    totalShortBond > 0 ? positions.reduce((s, p) => s + p.rate * p.balance, 0) / totalShortBond : 0
  const weightedDuration =
    totalShortBond > 0 ? positions.reduce((s, p) => s + p.durationYears * p.balance, 0) / totalShortBond : 0

  return { positions, totalShortBond, weightedRate, weightedDuration }
}
