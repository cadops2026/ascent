// refresh-crypto — CoinGecko crypto prices → quote_cache (service role write).
// CoinGecko's free tier is keyless; an optional COINGECKO_API_KEY (demo) is used
// if present. Browser → Supabase only (invariant #10).
import { createClient } from 'jsr:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

const TTL_MS = 15 * 60 * 1000

// Common ticker → CoinGecko id. Unknown tickers fall back to the lowercased symbol.
const ID_MAP: Record<string, string> = {
  BTC: 'bitcoin',
  ETH: 'ethereum',
  SOL: 'solana',
  USDC: 'usd-coin',
  USDT: 'tether',
  ADA: 'cardano',
  XRP: 'ripple',
  DOGE: 'dogecoin',
  AVAX: 'avalanche-2',
  LINK: 'chainlink',
  DOT: 'polkadot',
  MATIC: 'matic-network',
  LTC: 'litecoin',
  BCH: 'bitcoin-cash',
  UNI: 'uniswap',
  ATOM: 'cosmos',
  XLM: 'stellar',
  ETC: 'ethereum-classic',
  FIL: 'filecoin',
  APT: 'aptos',
}

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    const { symbols } = (await req.json()) as { symbols?: string[] }
    if (!symbols?.length) return json({ updated: 0 })

    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )

    const uniq = [...new Set(symbols.map((s) => s.toUpperCase()))]
    const { data: existing } = await admin
      .from('quote_cache')
      .select('symbol, updated_at')
      .in('symbol', uniq)
    const fresh = new Set(
      (existing ?? [])
        .filter((r) => Date.now() - new Date(r.updated_at).getTime() < TTL_MS)
        .map((r) => r.symbol),
    )
    const toFetch = uniq.filter((s) => !fresh.has(s))
    if (!toFetch.length) return json({ updated: 0, skipped: fresh.size })

    const idToSym = new Map<string, string>()
    for (const sym of toFetch) idToSym.set(ID_MAP[sym] ?? sym.toLowerCase(), sym)
    const ids = [...idToSym.keys()].join(',')

    const headers: Record<string, string> = {}
    const cgKey = Deno.env.get('COINGECKO_API_KEY')
    if (cgKey) headers['x-cg-demo-api-key'] = cgKey

    const r = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${encodeURIComponent(ids)}&vs_currencies=usd&include_24hr_change=true`,
      { headers },
    )
    if (!r.ok) return json({ error: `CoinGecko ${r.status}` }, 502)

    const data = (await r.json()) as Record<string, { usd?: number; usd_24h_change?: number }>

    let updated = 0
    for (const [id, sym] of idToSym) {
      const price = data[id]?.usd
      if (price == null) continue
      const chg = data[id]?.usd_24h_change ?? 0
      const prevClose = price / (1 + chg / 100)
      const { error } = await admin.from('quote_cache').upsert({
        symbol: sym,
        price,
        prev_close: prevClose,
        updated_at: new Date().toISOString(),
      })
      if (!error) updated++
    }

    return json({ updated, skipped: fresh.size })
  } catch (e) {
    return json({ error: String(e) }, 500)
  }
})
