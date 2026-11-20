// One shared tooltip that follows the pointer. Charts call show()/hide().
import { createContext, useCallback, useContext, useState, type ReactNode } from 'react'

type Tip = { x: number; y: number; content: ReactNode } | null
type Api = { show: (e: { clientX: number; clientY: number }, c: ReactNode) => void; hide: () => void }
const Ctx = createContext<Api>({ show: () => {}, hide: () => {} })

export function TooltipProvider({ children }: { children: ReactNode }) {
  const [tip, setTip] = useState<Tip>(null)
  const [last, setLast] = useState<ReactNode>(null)
  const show = useCallback((e: { clientX: number; clientY: number }, content: ReactNode) => {
    setLast(content)
    setTip({ x: e.clientX, y: e.clientY, content })
  }, [])
  const hide = useCallback(() => setTip(null), [])
  // Keep the box on screen near the right/bottom edges.
  const w = typeof window !== 'undefined' ? window.innerWidth : 1200
  const h = typeof window !== 'undefined' ? window.innerHeight : 800
  const x = tip ? Math.min(tip.x, w - 300) : 0
  const y = tip ? Math.min(tip.y, h - 210) : 0
  return (
    <Ctx.Provider value={{ show, hide }}>
      {children}
      <div className={`tooltip ${tip ? 'show' : ''}`} style={{ left: x, top: y }} role="status" aria-live="polite">
        {tip ? tip.content : last}
      </div>
    </Ctx.Provider>
  )
}

export const useTooltip = () => useContext(Ctx)

export function TipRows({ rows }: { rows: [string, ReactNode][] }) {
  return <>{rows.map(([k, v]) => <div className="tt-row" key={k}><span>{k}</span><span>{v}</span></div>)}</>
}
