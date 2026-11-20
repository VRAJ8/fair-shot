import { useGSAP } from '@gsap/react'
import Fuse from 'fuse.js'
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link, NavLink, useNavigate } from 'react-router-dom'
import { useData, type IndexRow } from '../lib/data'
import { money, signedMoney } from '../lib/format'
import { gsap, reducedMotion, ScrollTrigger, SplitText } from '../lib/motion'

/* ---------------- brand mark ---------------- */
export function BallIcon({ size = 26 }: { size?: number }) {
  return (
    <svg className="brand-ball" width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <circle cx="32" cy="32" r="29" fill="#e8681f" />
      <g fill="none" stroke="#1a0d05" strokeWidth="3">
        <circle cx="32" cy="32" r="29" /><path d="M3 32h58M32 3v58" />
        <path d="M12 11c9 8 9 34 0 42M52 11c-9 8-9 34 0 42" />
      </g>
    </svg>
  )
}

/* ---------------- nav with a 24-second shot clock ---------------- */
export function Nav() {
  const [clock, setClock] = useState(24)
  useEffect(() => {
    const st = ScrollTrigger.create({
      start: 0, end: 'max',
      onUpdate: (self) => setClock(Math.max(0, Math.ceil(24 * (1 - self.progress)))),
    })
    return () => st.kill()
  }, [])
  return (
    <nav className="nav" aria-label="Main">
      <Link to="/" className="brand"><BallIcon /> FAIR SHOT</Link>
      <div className="nav-links">
        <NavLink to="/" end>Story</NavLink>
        <NavLink to="/players">Players</NavLink>
        <NavLink to="/ask" className="hide-sm">Ask AI</NavLink>
        <NavLink to="/methods" className="hide-sm">Methods</NavLink>
        <div className="shotclock" title="Shot clock: counts down as you scroll" aria-hidden>
          <div className="digits">{String(clock).padStart(2, '0')}</div>
          <div className="lbl">SHOT CLOCK</div>
        </div>
      </div>
    </nav>
  )
}

/* ---------------- chapter heading with split-text reveal ---------------- */
export function ChapterHead({ quarter, title, children }: { quarter: string; title: string; children?: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    if (reducedMotion || !ref.current) return
    const h = ref.current.querySelector('.chapter-title') as HTMLElement
    // autoSplit re-splits once web fonts load and on resize, so line breaks
    // are measured on the final layout; onSplit rebuilds the animation.
    const split = SplitText.create(h, {
      type: 'lines,words', mask: 'lines', autoSplit: true,
      onSplit: (self) => gsap.from(self.words, {
        yPercent: 110, duration: 0.9, ease: 'power4.out', stagger: 0.05,
        scrollTrigger: { trigger: h, start: 'top 85%' },
      }),
    })
    gsap.from(ref.current.querySelectorAll('.quarter, .lede'), {
      opacity: 0, y: 18, duration: 0.8, stagger: 0.12, ease: 'power2.out',
      scrollTrigger: { trigger: ref.current, start: 'top 85%' },
    })
    return () => split.revert()
  }, { scope: ref })
  return (
    <header className="chapter-head" ref={ref}>
      <div className="quarter">{quarter}</div>
      <h2 className="chapter-title display">{title}</h2>
      {children && <div className="lede">{children}</div>}
    </header>
  )
}

/* ---------------- count-up number ---------------- */
export function Counter({ value, format, className }: { value: number; format: (v: number) => string; className?: string }) {
  const ref = useRef<HTMLSpanElement>(null)
  useGSAP(() => {
    if (!ref.current) return
    if (reducedMotion) { ref.current.textContent = format(value); return }
    const obj = { v: 0 }
    gsap.to(obj, {
      v: value, duration: 2, ease: 'power3.out',
      scrollTrigger: { trigger: ref.current, start: 'top 92%' },
      onUpdate: () => { if (ref.current) ref.current.textContent = format(obj.v) },
    })
  }, { dependencies: [value], scope: ref })
  return <span ref={ref} className={className}>{format(0)}</span>
}

/* ---------------- reveal-on-scroll for a block ---------------- */
export function Reveal({ children, delay = 0, className = '' }: { children: ReactNode; delay?: number; className?: string }) {
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    if (!ref.current) return
    gsap.to(ref.current, {
      opacity: 1, y: 0, duration: 0.9, delay, ease: 'power3.out',
      scrollTrigger: { trigger: ref.current, start: 'top 88%' },
    })
  }, { scope: ref })
  return <div ref={ref} className={`reveal ${className}`}>{children}</div>
}

/* ---------------- jersey avatar (team colors + number; no photos) ---------------- */
export function Jersey({ colors, number, size = 120, name }: { colors: [string, string]; number?: string | null; size?: number; name?: string }) {
  const [a, b] = colors
  const light = (hex: string) => {
    const n = parseInt(hex.replace('#', ''), 16)
    const r = (n >> 16) & 255, g = (n >> 8) & 255, bl = n & 255
    return 0.299 * r + 0.587 * g + 0.114 * bl > 160
  }
  const ink = light(a) ? '#111' : '#fff'
  const id = useMemo(() => `j${Math.random().toString(36).slice(2, 8)}`, [])
  return (
    <svg width={size} height={size * 1.12} viewBox="0 0 100 112" role="img" aria-label={`${name ?? 'Player'} jersey ${number ?? ''}`}>
      <defs>
        <linearGradient id={id} x1="0" x2="0" y1="0" y2="1">
          <stop offset="0" stopColor={a} /><stop offset="1" stopColor={a} stopOpacity=".82" />
        </linearGradient>
      </defs>
      <path d="M30 6 L40 4 Q50 14 60 4 L70 6 L74 26 Q84 30 88 22 L96 30 Q90 50 78 52 L78 108 L22 108 L22 52 Q10 50 4 30 L12 22 Q16 30 26 26 Z"
        fill={`url(#${id})`} stroke={b} strokeWidth="2.5" />
      <path d="M40 4 Q50 14 60 4" fill="none" stroke={b} strokeWidth="4" />
      <path d="M22 52 L22 108 M78 52 L78 108" stroke={b} strokeWidth="3" />
      <text x="50" y="80" textAnchor="middle" fontFamily="Anton, Impact, sans-serif" fontSize="40" fill={ink}
        stroke={b} strokeWidth="1.2" paintOrder="stroke">{number ?? ''}</text>
    </svg>
  )
}

/* ---------------- player search (fuzzy, accent-insensitive) ---------------- */
const fold = (s: string) => s.normalize('NFKD').replace(/[̀-ͯ]/g, '')

export function PlayerSearch({ placeholder = 'Search any player…', onPick, autoFocus }: {
  placeholder?: string; onPick?: (id: string) => void; autoFocus?: boolean
}) {
  const index = useData<IndexRow[]>('players_index.json')
  const [q, setQ] = useState('')
  const [hl, setHl] = useState(0)
  const nav = useNavigate()
  const fuse = useMemo(() => index && new Fuse(index.map((r) => ({ ...r, folded: fold(r.name) })),
    { keys: ['folded', 'team'], threshold: 0.32 }), [index])
  const results = q && fuse ? fuse.search(fold(q)).slice(0, 7).map((r) => r.item) : []
  const pick = (id: string) => { setQ(''); onPick ? onPick(id) : nav(`/player/${id}`) }
  return (
    <div className="search" role="combobox" aria-expanded={results.length > 0}>
      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input className="input" value={q} placeholder={placeholder} autoFocus={autoFocus} aria-label="Search players"
        onChange={(e) => { setQ(e.target.value); setHl(0) }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowDown') setHl((h) => Math.min(h + 1, results.length - 1))
          if (e.key === 'ArrowUp') setHl((h) => Math.max(h - 1, 0))
          if (e.key === 'Enter' && results[hl]) pick(results[hl].id)
          if (e.key === 'Escape') setQ('')
        }} />
      {results.length > 0 && (
        <div className="search-results">
          {results.map((r, i) => (
            <button key={r.id} className={i === hl ? 'hl' : ''} onMouseEnter={() => setHl(i)} onClick={() => pick(r.id)}>
              <span className="pill">{r.team}</span>
              <span style={{ flex: 1 }}>{r.name}</span>
              <span className="mono muted" style={{ fontSize: 12 }}>{money(r.salary)}</span>
              <span className={`mono ${r.surplus > 0 ? 'under' : 'over'}`} style={{ fontSize: 12, minWidth: 64, textAlign: 'right' }}>
                {signedMoney(r.surplus)}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  )
}

/* ---------------- court-line divider ---------------- */
export function CourtDivider() {
  const ref = useRef<SVGSVGElement>(null)
  useGSAP(() => {
    if (!ref.current || reducedMotion) return
    gsap.from(ref.current.querySelectorAll('path, circle, line'), {
      drawSVG: 0, duration: 1.6, ease: 'power2.inOut', stagger: 0.1,
      scrollTrigger: { trigger: ref.current, start: 'top 90%' },
    })
  }, { scope: ref })
  return (
    <div className="court-divider" aria-hidden>
      <svg ref={ref} viewBox="0 0 1200 120" preserveAspectRatio="none">
        <g fill="none" stroke="#e8681f" strokeWidth="1.5">
          <line x1="0" y1="60" x2="1200" y2="60" />
          <circle cx="600" cy="60" r="46" />
          <circle cx="600" cy="60" r="14" />
          <path d="M0 14 H170 A120 120 0 0 1 170 106 H0" />
          <path d="M1200 14 H1030 A120 120 0 0 0 1030 106 H1200" />
        </g>
      </svg>
    </div>
  )
}
