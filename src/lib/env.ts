/**
 * Typed access to the two PUBLIC frontend env vars.
 * The anon key is safe in the browser — every table is gated by RLS (auth.uid()).
 * No third-party data-API key is ever read here; those live in Supabase secrets
 * and are only touched by Edge Functions. (Invariant #10.)
 */
const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const supabaseConfigured = Boolean(url && anonKey)

export const env = {
  supabaseUrl: url ?? '',
  supabaseAnonKey: anonKey ?? '',
}
