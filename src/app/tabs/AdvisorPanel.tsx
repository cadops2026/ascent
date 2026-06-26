import { useState } from 'react'
import { supabase } from '../../lib/supabase'
import { Panel, Button, Input, MicroLabel } from '../../components/ui'

/**
 * The grounded AI overlay (spec §2). Sends a compact, client-assembled context
 * (the user's OWN balance sheet + engine outputs) plus a question to the `advisor`
 * Edge Function → Claude. It explains and quantifies; it never forecasts (#5) or
 * overrides the math (#8). Calm by default — sized to dampen reactivity, not feed
 * it. Degrades gracefully when the Anthropic key isn't set.
 */
export function AdvisorPanel({ context }: { context: Record<string, unknown> | null }) {
  const [question, setQuestion] = useState('')
  const [answer, setAnswer] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const ask = async (mode: 'qa' | 'narrate') => {
    if (!context) return
    if (mode === 'qa' && !question.trim()) return
    setLoading(true)
    setError(null)
    setAnswer(null)
    try {
      const { data, error: invErr } = await supabase.functions.invoke('advisor', {
        body: { mode, question, context },
      })
      if (invErr) {
        let msg = invErr.message
        try {
          const j = await (invErr as { context?: Response }).context?.json()
          if (j?.error) msg = j.error
        } catch {
          /* keep the generic message */
        }
        setError(msg)
        return
      }
      setAnswer((data as { answer?: string })?.answer ?? 'No response.')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Request failed')
    } finally {
      setLoading(false)
    }
  }

  if (!context) return null
  return (
    <AdvisorView
      question={question}
      onQuestion={setQuestion}
      onAsk={ask}
      loading={loading}
      answer={answer}
      error={error}
    />
  )
}

/** Presentational (pure props) so every state render-tests in isolation. */
export function AdvisorView({
  question,
  onQuestion,
  onAsk,
  loading,
  answer,
  error,
}: {
  question: string
  onQuestion: (v: string) => void
  onAsk: (mode: 'qa' | 'narrate') => void
  loading: boolean
  answer: string | null
  error: string | null
}) {
  return (
    <Panel
      className="mt-5"
      label="Ask about your plan"
      right={<MicroLabel className="text-faint">grounded · explains, never forecasts</MicroLabel>}
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={question}
          onChange={(e) => onQuestion(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') onAsk('qa')
          }}
          placeholder="e.g. How concentrated am I, and does it threaten my plan?"
          className="min-w-0 flex-1"
        />
        <Button onClick={() => onAsk('qa')} disabled={loading || !question.trim()}>
          {loading ? 'Thinking…' : 'Ask'}
        </Button>
        <Button onClick={() => onAsk('narrate')} disabled={loading} className="bg-panel-hi! text-muted!">
          Explain my exposure
        </Button>
      </div>

      {error && (
        <p className="mt-4 text-sm text-amber">
          {error.includes('ANTHROPIC_API_KEY')
            ? 'The AI overlay needs the Anthropic key in Supabase secrets (it runs server-side — the browser never calls Anthropic). Until then, the deterministic exposure read above covers the essentials.'
            : error}
        </p>
      )}

      {answer && (
        <div className="mt-4 whitespace-pre-wrap rounded-[var(--radius-panel)] border border-line bg-panel-hi px-4 py-3 text-sm leading-relaxed text-ink">
          {answer}
        </div>
      )}

      <p className="mt-4 text-xs leading-relaxed text-faint">
        Grounded only in your own balance sheet + engines. It explains and quantifies your exposure; it never
        forecasts what will outperform (#5) and never overrides the math (#8). For tax/estate/legal specifics it
        points you to the professional (#9).
      </p>
    </Panel>
  )
}
