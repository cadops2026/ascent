import { supabase } from './supabase'
import type { Database } from './database.types'

type TableName = keyof Database['public']['Tables']

/**
 * Every user-scoped table (RLS = auth.uid() = user_id). Export reads these;
 * delete-all wipes them. Shared reference/cache tables (quote_cache, cma_sources,
 * etc.) are deliberately excluded — they aren't the user's data.
 */
const USER_TABLES = [
  'profiles', 'accounts', 'holdings', 'real_estate', 'liabilities', 'spending_baseline',
  'target_allocation', 'rebalance_bands', 'scenarios', 'phase_plan', 'alert_rules', 'alerts',
  'net_worth_snapshots', 'insurance_policies', 'estate_docs', 'statement_imports',
] as const satisfies readonly TableName[]

const STATEMENTS_BUCKET = 'statements'

/** Fetch every user-scoped row (RLS scopes to the signed-in user) as one object. */
export async function collectUserData(): Promise<Record<string, unknown[]>> {
  const out: Record<string, unknown[]> = {}
  for (const table of USER_TABLES) {
    const { data, error } = await supabase.from(table).select('*')
    if (error) throw new Error(`${table}: ${error.message}`)
    out[table] = data ?? []
  }
  return out
}

/** Export all the user's data as a downloaded JSON file. */
export async function exportUserData(email: string | undefined): Promise<void> {
  const tables = await collectUserData()
  const payload = {
    app: 'ASCENT',
    exported_at: new Date().toISOString(),
    account: email ?? null,
    tables,
  }
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `ascent-export-${new Date().toISOString().slice(0, 10)}.json`
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

/**
 * Permanently delete every user-scoped row + uploaded statement files (RLS lets
 * the owner delete their own rows; invariant #10). The auth login itself isn't
 * removed from the client — that needs a service-role call — so the caller should
 * sign out afterward; signing up again starts fresh.
 */
export async function deleteAllUserData(userId: string): Promise<void> {
  for (const table of USER_TABLES) {
    const { error } = await supabase.from(table).delete().eq('user_id', userId)
    if (error) throw new Error(`${table}: ${error.message}`)
  }
  // Remove uploaded statement files under <uid>/… (best-effort; bucket may be empty).
  const { data: files } = await supabase.storage.from(STATEMENTS_BUCKET).list(userId)
  if (files && files.length > 0) {
    await supabase.storage.from(STATEMENTS_BUCKET).remove(files.map((f) => `${userId}/${f.name}`))
  }
}
