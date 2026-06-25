/**
 * Mortgage amortization. Pure function: given the original terms and an as-of
 * date, returns the current balance, payment, payoff date, and principal/interest
 * paid to date. Standard fixed-rate amortization (rate 0 handled).
 */
export interface MortgageTerms {
  origBalance: number
  /** Annual interest rate as a fraction (e.g. 0.0625 for 6.25%). */
  annualRate: number | null
  termMonths: number | null
  /** ISO date string (yyyy-mm-dd). */
  startDate: string | null
}

export interface MortgageState {
  monthlyPayment: number
  currentBalance: number
  monthsElapsed: number
  monthsRemaining: number
  paidOff: boolean
  payoffDate: string | null
  principalPaidToDate: number
  interestPaidToDate: number
  /** False when terms are insufficient to amortize (balance falls back to orig). */
  valid: boolean
}

export function monthsBetween(start: Date, end: Date): number {
  return (
    (end.getFullYear() - start.getFullYear()) * 12 + (end.getMonth() - start.getMonth())
  )
}

export function amortize(terms: MortgageTerms, asOf: Date = new Date()): MortgageState {
  const { origBalance, annualRate, termMonths, startDate } = terms

  if (!termMonths || termMonths <= 0 || !startDate || annualRate == null) {
    return {
      monthlyPayment: 0,
      currentBalance: origBalance,
      monthsElapsed: 0,
      monthsRemaining: termMonths ?? 0,
      paidOff: false,
      payoffDate: null,
      principalPaidToDate: 0,
      interestPaidToDate: 0,
      valid: false,
    }
  }

  const r = annualRate / 12
  const n = termMonths
  const P = origBalance
  const payment = r === 0 ? P / n : (P * r) / (1 - Math.pow(1 + r, -n))

  const start = new Date(startDate)
  const elapsed = Math.max(0, Math.min(monthsBetween(start, asOf), n))

  let bal = P
  let interestPaid = 0
  let principalPaid = 0
  for (let i = 0; i < elapsed; i++) {
    const interest = bal * r
    const principal = Math.min(payment - interest, bal)
    bal -= principal
    interestPaid += interest
    principalPaid += principal
  }

  const payoff = new Date(start)
  payoff.setMonth(payoff.getMonth() + n)

  return {
    monthlyPayment: payment,
    currentBalance: Math.max(0, bal),
    monthsElapsed: elapsed,
    monthsRemaining: Math.max(0, n - elapsed),
    paidOff: elapsed >= n || bal <= 0.01,
    payoffDate: payoff.toISOString().slice(0, 10),
    principalPaidToDate: principalPaid,
    interestPaidToDate: interestPaid,
    valid: true,
  }
}
