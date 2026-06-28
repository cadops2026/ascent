// parse-statements — reads an uploaded statement from RLS-locked Storage and
// extracts candidate holdings/liabilities with Claude. Server-side only: the
// ANTHROPIC_API_KEY lives in Supabase secrets; the browser never calls Anthropic
// (invariant #10). Nothing is auto-committed — results land in a review queue.
import { createClient } from 'jsr:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding/base64'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// JSON schema for structured extraction (output_config.format). Respects the
// structured-output limits: additionalProperties:false everywhere, no numeric
// bounds, optional fields simply omitted from `required`.
const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    institution: { type: 'string' },
    account_type: {
      type: 'string',
      description:
        'best guess: taxable | trad_401k | roth_401k | trad_ira | roth_ira | hsa | sep_ira | solo_401k | 529 | cash_balance_db | trust | other',
    },
    statement_date: { type: 'string', description: 'as-of date, yyyy-mm-dd, if shown' },
    holdings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          symbol: { type: 'string' },
          name: { type: 'string' },
          kind: { type: 'string', enum: ['stock', 'etf', 'crypto', 'cash', 'private', 'collectible'] },
          shares: { type: 'number' },
          amount: { type: 'number', description: 'market value USD when shares unknown' },
          cost_basis: { type: 'number' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
          account_label: {
            type: 'string',
            description:
              "sub-account this position sits in on a consolidated statement, e.g. 'Roth IRA', " +
              "'Individual Brokerage', 'Traditional IRA', 'HSA', '529'. Omit if the statement is a " +
              'single account. Do NOT append this to name.',
          },
          account_type: {
            type: 'string',
            description:
              'tax type of THIS position\'s sub-account: taxable | trad_401k | roth_401k | trad_ira | ' +
              'roth_ira | hsa | sep_ira | solo_401k | 529 | cash_balance_db | trust | other',
          },
        },
        required: ['kind', 'confidence'],
      },
    },
    liabilities: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          label: { type: 'string' },
          kind: { type: 'string', enum: ['mortgage', 'other'] },
          balance: { type: 'number' },
          rate: { type: 'number', description: 'annual rate as a fraction' },
          confidence: { type: 'string', enum: ['high', 'medium', 'low'] },
        },
        required: ['kind', 'confidence'],
      },
    },
  },
  required: ['holdings'],
}

const SYSTEM =
  'You extract structured holdings and liabilities from a personal financial statement ' +
  '(brokerage, bank, retirement, or mortgage). Read carefully. Use the ticker when shown. ' +
  'Use shares for share-based positions; use amount (USD market value) for cash or when shares ' +
  "aren't shown. Map account type to the closest enum. Set confidence per row. " +
  'IMPORTANT: many statements are CONSOLIDATED — one document covering several accounts ' +
  '(e.g. an Individual Brokerage AND a Roth IRA, or his/her accounts). For each holding, set ' +
  'account_label and account_type to the sub-account it belongs to, so they can be split correctly. ' +
  'Never disambiguate by appending the account to a holding name — use account_label instead, and ' +
  'keep name as the clean security name. The top-level institution/account_type describe the ' +
  'primary/default account. Do NOT invent positions — only extract what the document shows. Return data only.'

function mediaType(name: string): { kind: 'pdf' | 'image' | 'text'; mime: string } {
  const ext = name.toLowerCase().split('.').pop() ?? ''
  if (ext === 'pdf') return { kind: 'pdf', mime: 'application/pdf' }
  if (['png', 'jpg', 'jpeg', 'gif', 'webp'].includes(ext))
    return { kind: 'image', mime: ext === 'jpg' ? 'image/jpeg' : `image/${ext}` }
  return { kind: 'text', mime: 'text/plain' }
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  // Statement extraction is a structured-output task, not a reasoning one — a fast
  // model keeps a large multi-page PDF inside the Edge Function wall-clock limit
  // (Opus was timing out on big statements). Override with ANTHROPIC_MODEL if needed.
  const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-sonnet-4-6'

  const admin = createClient(SUPABASE_URL, SERVICE_KEY)

  let importId: string | undefined
  try {
    const body = (await req.json()) as { import_id?: string }
    importId = body.import_id
    if (!importId) return json({ error: 'import_id required' }, 400)

    // Verify the caller owns this import (RLS via their JWT).
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: userData } = await userClient.auth.getUser()
    const user = userData.user
    if (!user) return json({ error: 'unauthorized' }, 401)

    const { data: row } = await admin
      .from('statement_imports')
      .select('*')
      .eq('id', importId)
      .single()
    if (!row || row.user_id !== user.id) return json({ error: 'not found' }, 404)

    if (!ANTHROPIC_KEY) {
      await admin.from('statement_imports').update({ status: 'error', error: 'ANTHROPIC_API_KEY not set in Supabase secrets' }).eq('id', importId)
      return json({ error: 'ANTHROPIC_API_KEY not set in Supabase secrets' }, 500)
    }

    await admin.from('statement_imports').update({ status: 'parsing', error: null }).eq('id', importId)

    // Download the raw statement (service role bypasses RLS).
    const { data: file, error: dlErr } = await admin.storage.from('statements').download(row.file_path)
    if (dlErr || !file) throw new Error(`download failed: ${dlErr?.message ?? 'no file'}`)

    const mt = mediaType(row.file_name ?? row.file_path)
    const userContent: unknown[] = []
    if (mt.kind === 'pdf') {
      userContent.push({ type: 'document', source: { type: 'base64', media_type: mt.mime, data: encodeBase64(new Uint8Array(await file.arrayBuffer())) } })
    } else if (mt.kind === 'image') {
      userContent.push({ type: 'image', source: { type: 'base64', media_type: mt.mime, data: encodeBase64(new Uint8Array(await file.arrayBuffer())) } })
    } else {
      userContent.push({ type: 'text', text: `STATEMENT (text/CSV):\n\n${await file.text()}` })
    }
    userContent.push({ type: 'text', text: 'Extract every holding and liability into the structured schema.' })

    // Claude call. No thinking param → runs without thinking on Opus 4.8, which
    // keeps latency within the Edge Function window; the json_schema output
    // constraint already prevents prose. Set ANTHROPIC_MODEL to override.
    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 16000,
        system: SYSTEM,
        messages: [{ role: 'user', content: userContent }],
        output_config: { format: { type: 'json_schema', schema: SCHEMA } },
      }),
    })

    if (!resp.ok) throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}`)
    const data = (await resp.json()) as {
      stop_reason?: string
      content?: { type: string; text?: string }[]
    }
    if (data.stop_reason === 'refusal') throw new Error('extraction refused')

    const text = data.content?.find((b) => b.type === 'text')?.text ?? ''
    let parsed: { institution?: string; account_type?: string; statement_date?: string; holdings?: unknown[]; liabilities?: unknown[] }
    try {
      parsed = JSON.parse(text)
    } catch {
      throw new Error('model returned unparseable JSON')
    }

    const candidates = [
      ...(parsed.holdings ?? []).map((h) => ({ row_type: 'holding', ...(h as object) })),
      ...(parsed.liabilities ?? []).map((l) => ({ row_type: 'liability', ...(l as object) })),
    ]
    const summary = {
      institution: parsed.institution ?? null,
      account_type: parsed.account_type ?? null,
      statement_date: parsed.statement_date ?? null,
    }

    await admin
      .from('statement_imports')
      .update({ status: 'parsed', candidates, summary, error: null })
      .eq('id', importId)

    return json({ status: 'parsed', count: candidates.length })
  } catch (e) {
    const msg = String(e)
    if (importId) await admin.from('statement_imports').update({ status: 'error', error: msg }).eq('id', importId)
    return json({ error: msg }, 500)
  }
})
