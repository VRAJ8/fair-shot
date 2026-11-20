// "Ask the Ledger" chat, and the streamed "Make the case" negotiation brief.
// Both talk to agent/server.py through the /api proxy.
import { useEffect, useRef, useState } from 'react'
import Markdown from 'react-markdown'

type Query = { sql: string; columns?: string[]; rows?: any[][]; error?: string; truncated?: boolean }
type Msg = { role: 'user' | 'assistant'; content: string; queries?: Query[]; error?: boolean }

const SUGGESTIONS = [
  'Who were the 5 most underpaid players in 2025-26, and what were they paid?',
  'Which team got the most surplus value from rookie-scale contracts last season?',
  'How has the market price of a win changed since 2011-12?',
  'Which players missed the most games on back-to-backs in 2025-26?',
  'Compare Shai Gilgeous-Alexander and Nikola Jokić: value, pay and projection.',
]

export function useAgentHealth() {
  const [state, setState] = useState<'checking' | 'ready' | 'nokey' | 'offline' | 'paused'>('checking')
  useEffect(() => {
    fetch('/api/health').then((r) => r.ok ? r.json() : Promise.reject())
      .then((d) => setState(d.enabled === false ? 'paused' : d.configured ? 'ready' : 'nokey'))
      .catch(() => setState('offline'))
  }, [])
  return state
}

const isLocal = typeof window !== 'undefined' && ['localhost', '127.0.0.1'].includes(window.location.hostname)

function OfflineNote({ state }: { state: string }) {
  if (state === 'ready' || state === 'checking') return null
  if (!isLocal || state === 'paused') return (
    <div className="card" style={{ borderColor: 'var(--line-2)', fontSize: 14, marginBottom: 14 }}>
      <b>The AI analyst is offline right now.</b>{' '}
      <span className="dim">Every chart, player page and model on the site still works. The AI runs live in local demos.</span>
    </div>
  )
  return (
    <div className="card" style={{ borderColor: 'var(--line-2)', fontSize: 14, marginBottom: 14 }}>
      <b>{state === 'offline' ? 'The AI agent is not running.' : 'The AI agent has no API key.'}</b>{' '}
      <span className="dim">Start it from the project root with</span>{' '}
      <code className="mono" style={{ fontSize: 12.5 }}>ANTHROPIC_API_KEY=… .venv/bin/python -m agent.server</code>
      <span className="dim">, then reload. Everything else on the site works without it.</span>
    </div>
  )
}

export function AskPanel({ compact = false }: { compact?: boolean }) {
  const health = useAgentHealth()
  const [msgs, setMsgs] = useState<Msg[]>([])
  const [q, setQ] = useState('')
  const [busy, setBusy] = useState(false)
  const log = useRef<HTMLDivElement>(null)
  useEffect(() => { log.current?.scrollTo({ top: log.current.scrollHeight, behavior: 'smooth' }) }, [msgs, busy])

  async function send(text: string) {
    const question = text.trim()
    if (!question || busy) return
    const history = msgs.filter((m) => !m.error).map(({ role, content }) => ({ role, content }))
    setMsgs((m) => [...m, { role: 'user', content: question }])
    setQ('')
    setBusy(true)
    try {
      const r = await fetch('/api/ask', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ question, history }) })
      const d = await r.json().catch(() => ({}))
      if (!r.ok) throw new Error(d.detail || `Agent error ${r.status}`)
      setMsgs((m) => [...m, { role: 'assistant', content: d.answer, queries: d.queries }])
    } catch (e: any) {
      setMsgs((m) => [...m, { role: 'assistant', content: e.message || 'Something went wrong.', error: true }])
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="ask">
      <OfflineNote state={health} />
      {msgs.length === 0 && (
        <div style={{ marginBottom: 16 }}>
          <div className="kicker" style={{ marginBottom: 10 }}>Try asking</div>
          <div className="controls">
            {SUGGESTIONS.slice(0, compact ? 3 : 5).map((s) => <button key={s} className="chip" onClick={() => send(s)} disabled={health !== 'ready'}>{s}</button>)}
          </div>
        </div>
      )}
      <div className="ask-log" ref={log} data-lenis-prevent>
        {msgs.map((m, i) => (
          <div key={i} className={`msg ${m.role === 'user' ? 'user' : 'bot'}`} style={m.error ? { borderColor: 'var(--over)' } : undefined}>
            {m.role === 'user' ? m.content : <Markdown>{m.content}</Markdown>}
            {m.queries && m.queries.length > 0 && (
              <details>
                <summary>How I got this: {m.queries.length} SQL quer{m.queries.length === 1 ? 'y' : 'ies'} against the warehouse</summary>
                {m.queries.map((qq, j) => <pre key={j}>{qq.sql}{qq.error ? `\n-- error: ${qq.error}` : `\n-- ${qq.rows?.length ?? 0} rows${qq.truncated ? ' (truncated)' : ''}`}</pre>)}
              </details>
            )}
          </div>
        ))}
        {busy && <div className="msg bot"><span className="thinking"><i /><i /><i /> Running the numbers…</span></div>}
      </div>
      <form className="ask-form" onSubmit={(e) => { e.preventDefault(); send(q) }}>
        <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Ask anything about player pay, value or workload…"
          aria-label="Question for the AI analyst" disabled={health === 'offline'} />
        <button className="btn" disabled={busy || !q.trim() || health !== 'ready'}>Ask</button>
      </form>
    </div>
  )
}

export function BriefButton({ playerId, name }: { playerId: string; name: string }) {
  const health = useAgentHealth()
  const [text, setText] = useState('')
  const [state, setState] = useState<'idle' | 'streaming' | 'done' | 'error'>('idle')
  async function run() {
    setText(''); setState('streaming')
    try {
      const r = await fetch('/api/brief', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ player_id: playerId }) })
      if (!r.ok || !r.body) throw new Error(`Agent error ${r.status}`)
      const reader = r.body.getReader()
      const dec = new TextDecoder()
      let buf = ''
      for (;;) {
        const { value, done } = await reader.read()
        if (done) break
        buf += dec.decode(value, { stream: true })
        const parts = buf.split('\n\n')
        buf = parts.pop() ?? ''
        for (const p of parts) {
          const line = p.replace(/^data: /, '')
          if (line === '[DONE]') continue
          const ev = JSON.parse(line)
          if (ev.error) { setText((t) => t + `\n\n> ${ev.error}`); setState('error'); return }
          if (ev.text) setText((t) => t + ev.text)
        }
      }
      setState('done')
    } catch (e: any) {
      setText(e.message); setState('error')
    }
  }
  return (
    <div className="card" style={{ background: 'linear-gradient(135deg, #1a1410, var(--card))', borderColor: '#3a2a1c' }}>
      <div style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', justifyContent: 'space-between' }}>
        <div>
          <div className="kicker" style={{ color: 'var(--orange)' }}>AI · Claude</div>
          <h3 className="section-title" style={{ fontSize: 30, margin: '4px 0' }}>Make the case for {name}</h3>
          <div className="dim" style={{ fontSize: 14 }}>A one-page negotiation brief from the player's side, written by Claude from this page's numbers only.</div>
        </div>
        <button className="btn" onClick={run} disabled={state === 'streaming' || health !== 'ready'}>
          {state === 'streaming' ? 'Writing…' : state === 'done' ? 'Write it again' : 'Write the brief'}
        </button>
      </div>
      {health !== 'ready' && health !== 'checking' && <div style={{ marginTop: 14 }}><OfflineNote state={health} /></div>}
      {text && <div className="brief" style={{ marginTop: 18, borderTop: '1px solid var(--line)', paddingTop: 8 }}><Markdown>{text}</Markdown></div>}
    </div>
  )
}
