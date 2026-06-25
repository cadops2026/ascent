/**
 * Estate-document checklist + staleness. ASCENT *tracks* whether core documents
 * exist, are current, and where they live — it never drafts or files them
 * (invariant #9). Status + review-staleness sharpen the prompt to see the
 * professional; the math/engine layer doesn't pretend to be the lawyer.
 */
export interface DocDef {
  type: string
  label: string
  why: string
}

export const ESTATE_DOC_CHECKLIST: DocDef[] = [
  { type: 'revocable_trust', label: 'Revocable living trust', why: 'Avoids probate; controls how and when assets pass.' },
  { type: 'will', label: 'Will (pour-over)', why: 'Backstops anything outside the trust; names guardians.' },
  { type: 'financial_poa', label: 'Financial power of attorney', why: 'Someone can act on finances if you cannot.' },
  { type: 'healthcare_directive', label: 'Healthcare directive & POA', why: 'Medical decisions and your stated wishes.' },
  { type: 'guardianship', label: 'Guardianship designation', why: 'Who raises minor children.' },
  { type: 'beneficiary_audit', label: 'Beneficiary & titling audit', why: 'Beneficiary/titling overrides the will — keep it aligned.' },
]

export const DOC_STATUSES = ['missing', 'draft', 'executed', 'needs_review'] as const
export type DocStatus = (typeof DOC_STATUSES)[number]

export const DOC_STATUS_LABEL: Record<DocStatus, string> = {
  missing: 'Missing',
  draft: 'Draft',
  executed: 'Executed',
  needs_review: 'Needs review',
}

const STALE_YEARS = 3

/** Executed but not reviewed within STALE_YEARS (or marked needs_review) ⇒ stale. */
export function isStale(status: DocStatus, lastReviewed: string | null, now: Date = new Date()): boolean {
  if (status === 'needs_review') return true
  if (status !== 'executed') return false
  if (!lastReviewed) return true
  const reviewed = new Date(lastReviewed)
  const years = (now.getTime() - reviewed.getTime()) / (365.25 * 24 * 3600 * 1000)
  return years >= STALE_YEARS
}

export interface DocChecklistRow {
  def: DocDef
  status: DocStatus
  lastReviewed: string | null
  fileRef: string | null
  stale: boolean
}

export interface EstateDocState {
  status?: string
  last_reviewed?: string | null
  file_ref?: string | null
}

/** Merge the fixed checklist with the user's saved estate_docs rows (by doc_type). */
export function buildChecklist(saved: Record<string, EstateDocState>, now: Date = new Date()): DocChecklistRow[] {
  return ESTATE_DOC_CHECKLIST.map((def) => {
    const row = saved[def.type]
    const status = (row?.status as DocStatus) ?? 'missing'
    const lastReviewed = row?.last_reviewed ?? null
    return { def, status, lastReviewed, fileRef: row?.file_ref ?? null, stale: isStale(status, lastReviewed, now) }
  })
}

/** Count of documents that are missing or stale — the headline gap number. */
export function docGapCount(rows: DocChecklistRow[]): number {
  return rows.filter((r) => r.status === 'missing' || r.stale).length
}
