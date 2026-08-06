/**
 * Typed access to the two PUBLIC frontend Supabase values.
 * The anon key is safe in the browser — every table is gated by RLS (auth.uid()).
 * No third-party data-API key is ever read here; those live in Supabase secrets
 * and are only touched by Edge Functions. (Invariant #10.)
 *
 * These are the project's own public values, baked in as defaults so the app works
 * on any host with zero build-time configuration (a hosting env var, if set,
 * overrides them). This is NOT a secret — the anon key ships in the client bundle
 * either way; RLS is what protects the data.
 */
const DEFAULT_SUPABASE_URL = 'https://rhpdjuigivbwfvzoljsa.supabase.co'
const DEFAULT_SUPABASE_ANON_KEY =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InJocGRqdWlnaXZid2Z2em9sanNhIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODIzOTkwNzksImV4cCI6MjA5Nzk3NTA3OX0.2FWT8FoGqCxKRzNTUt0ydnltU9mDltzccbuCWXFdts0'

const url = (import.meta.env.VITE_SUPABASE_URL as string | undefined) || DEFAULT_SUPABASE_URL
const anonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined) || DEFAULT_SUPABASE_ANON_KEY

export const supabaseConfigured = Boolean(url && anonKey)

export const env = {
  supabaseUrl: url,
  supabaseAnonKey: anonKey,
}
