import { createClient } from '@supabase/supabase-js'
import type { Database } from './database.types'
import { env, supabaseConfigured } from './env'

/**
 * The single Supabase client. The browser talks to Supabase ONLY — never a
 * third-party data API directly (invariant #10). When env vars are absent we
 * still construct a client against a placeholder so the app can render the
 * "connect Supabase" state instead of crashing at import time.
 */
export const supabase = createClient<Database>(
  supabaseConfigured ? env.supabaseUrl : 'http://localhost:54321',
  supabaseConfigured ? env.supabaseAnonKey : 'public-anon-key-placeholder',
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
    },
  },
)
