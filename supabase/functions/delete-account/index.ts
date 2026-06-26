// delete-account — full account deletion (invariant #10: data deletion supported).
// The client delete-all wipes user-scoped rows + statement files but can't remove
// the auth login (that needs the service role). This does the complete job: it
// deletes the user's Storage objects in both private buckets, then deletes the
// auth user — which cascades every user_id row (on delete cascade). Auth-gated:
// a user can only delete THEMSELVES. Browser → Supabase only (#10).
import { createClient } from 'jsr:@supabase/supabase-js@2'
// deno-lint-ignore no-explicit-any
type Admin = any

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

/** Recursively remove every object under `prefix` in a bucket (folders have id null). */
async function removeAllUnder(admin: Admin, bucket: string, prefix: string): Promise<void> {
  const { data: entries } = await admin.storage.from(bucket).list(prefix, { limit: 1000 })
  if (!entries || entries.length === 0) return
  const files: string[] = []
  for (const e of entries as { name: string; id: string | null }[]) {
    const path = `${prefix}/${e.name}`
    if (e.id === null) await removeAllUnder(admin, bucket, path) // a folder → recurse
    else files.push(path)
  }
  if (files.length) await admin.storage.from(bucket).remove(files)
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!

  try {
    // Identify the caller from their JWT — they can only delete themselves.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await userClient.auth.getUser()
    const user = userData.user
    if (!user) return json({ error: 'unauthorized' }, 401)

    const admin = createClient(SUPABASE_URL, SERVICE_KEY)

    // Remove the user's private files first (Storage objects aren't FK-cascaded).
    for (const bucket of ['statements', 'estate-docs']) {
      try {
        await removeAllUnder(admin, bucket, user.id)
      } catch {
        /* best-effort; continue to the auth-user delete */
      }
    }

    // Deleting the auth user cascades every user-scoped row (on delete cascade).
    const { error } = await admin.auth.admin.deleteUser(user.id)
    if (error) return json({ error: error.message }, 500)

    return json({ deleted: true })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
