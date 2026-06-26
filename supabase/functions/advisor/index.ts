// advisor — the grounded AI overlay (spec §2). Narrates the user's OWN exposure
// and answers plan questions, grounded ONLY in the context the client assembles
// from the balance sheet + engines. It explains and quantifies; it never
// forecasts what will outperform (invariant #5) and never overrides the math
// (invariant #8) — the engines are the source of truth, this is the explainer.
// Server-side only: ANTHROPIC_API_KEY lives in Supabase secrets; the browser
// calls Supabase, never Anthropic (invariant #10).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

// The guardrails are in the system prompt, not just the UI: this overlay must
// dampen reactivity (the single biggest risk is a large reactive move), never
// manufacture it.
const SYSTEM = [
  "You are ASCENT's grounded explainer for a self-directed high-net-worth investor.",
  'ASCENT measures exposure, steers toward a target the user chose, and keeps everything else quiet.',
  '',
  'Your job: explain and quantify the user\'s OWN situation using ONLY the numbers in the provided',
  'context (their balance sheet, look-through exposure, projection, and assumptions). Be concise,',
  'plain, and specific to their figures.',
  '',
  'Hard rules:',
  '- NEVER forecast what will outperform, predict prices or markets, or give buy/sell/market-timing',
  '  signals. If asked to, decline plainly and reframe toward exposure and the chosen intent.',
  '- The engines (Monte Carlo, consensus CMA, look-through) are the source of truth. You explain them;',
  '  you never override or invent a competing view. If the math and a hunch conflict, the math wins.',
  '- Use ONLY numbers present in the context. Never invent or estimate a figure that is not given.',
  '- Calm by default: the biggest risk is a large reactive move, not a wrong number. When the user is',
  '  anxious or reaching for a big change, slow it down and point back to exposure vs. target.',
  '- For estate, tax, insurance, or legal specifics, prompt them to confirm with the professional;',
  '  model and flag the exposure, never draft documents or give filing advice.',
  '- No preamble or sign-off. A few tight sentences. Plain language, not jargon.',
].join('\n')

interface Body {
  question?: string
  mode?: 'qa' | 'narrate'
  context?: Record<string, unknown>
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
  const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!
  const ANTHROPIC_KEY = Deno.env.get('ANTHROPIC_API_KEY')
  const MODEL = Deno.env.get('ANTHROPIC_MODEL') ?? 'claude-opus-4-8'

  try {
    // Require an authenticated user so the key can't be burned anonymously.
    const authHeader = req.headers.get('Authorization') ?? ''
    const userClient = createClient(SUPABASE_URL, ANON_KEY, { global: { headers: { Authorization: authHeader } } })
    const { data: userData } = await userClient.auth.getUser()
    if (!userData.user) return json({ error: 'unauthorized' }, 401)

    if (!ANTHROPIC_KEY) return json({ error: 'ANTHROPIC_API_KEY not set in Supabase secrets' }, 503)

    const body = (await req.json()) as Body
    const mode = body.mode ?? 'qa'
    const context = body.context ?? {}
    const question = (body.question ?? '').slice(0, 1000)
    if (mode === 'qa' && !question.trim()) return json({ error: 'question required' }, 400)

    const instruction =
      mode === 'narrate'
        ? 'Explain my current exposure in plain terms — what I am most exposed to, what is concentrated, and what that means for staying calm. Do not recommend trades.'
        : question

    const userText =
      `MY CONTEXT (JSON — the only numbers you may use):\n${JSON.stringify(context, null, 2)}\n\n` +
      `MY REQUEST:\n${instruction}`

    const resp = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'x-api-key': ANTHROPIC_KEY,
        'anthropic-version': '2023-06-01',
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: SYSTEM,
        messages: [{ role: 'user', content: [{ type: 'text', text: userText }] }],
      }),
    })

    if (!resp.ok) return json({ error: `Anthropic ${resp.status}: ${(await resp.text()).slice(0, 300)}` }, 502)
    const data = (await resp.json()) as { stop_reason?: string; content?: { type: string; text?: string }[] }
    if (data.stop_reason === 'refusal') return json({ answer: 'I can only explain your own exposure and plan — I can\'t answer that one.' })

    const answer = data.content?.filter((b) => b.type === 'text').map((b) => b.text).join('').trim()
    return json({ answer: answer || 'No response.' })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
