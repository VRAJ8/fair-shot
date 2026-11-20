// The Ledger: every player as a dot — salary (x) vs fair value (y).
// A scrollytelling sequence walks through the chart, then hands over control.
import { useGSAP } from '@gsap/react'
import * as d3 from 'd3'
import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChapterHead, PlayerSearch } from '../components/ui'
import { label, type BoardRow } from '../lib/data'
import { money, num, signedMoney } from '../lib/format'
import { gsap, reducedMotion, ScrollTrigger } from '../lib/motion'
import { TipRows, useTooltip } from '../lib/tooltip'
import { useSize } from './useSize'

const NEUTRAL = '#6d6a63'
const UNDER = '#e8681f'
const OVER = '#3d8fe8'
export function surplusColor(s: number) {
  const t = Math.max(-1, Math.min(1, s / 35e6))
  return t >= 0 ? d3.interpolateRgb(NEUTRAL, UNDER)(Math.sqrt(t)) : d3.interpolateRgb(NEUTRAL, OVER)(Math.sqrt(-t))
}

type StepKey = 'all' | 'line' | 'under' | 'rookie' | 'max' | 'over' | 'explore'
const TYPES = ['Two-way', 'Minimum', 'Rookie scale', 'Rotation', 'Middle class', 'Near-max', 'Max']

export default function BigBoard({ board, stories, seasons }: { board: Record<string, BoardRow[]>; stories: any; seasons: { full: number; current: number } }) {
  const [step, setStep] = useState<StepKey>('all')
  const [season, setSeason] = useState(seasons.full)
  const [types, setTypes] = useState<Set<string>>(new Set(TYPES))
  const [focus, setFocus] = useState<string | null>(null)
  const steps = useRef<HTMLDivElement>(null)
  const rows = useMemo(() => (board[String(step === 'explore' ? season : seasons.full)] ?? []).filter((r) => r.salary > 0), [board, season, step, seasons.full])
  const maxSalary = stories?.max_ceiling?.max_salary ?? 0.35 * 154647000

  const facts = useMemo(() => {
    const r = board[String(seasons.full)] ?? []
    const under = r.filter((d) => d.surplus > 0)
    const rookie = r.filter((d) => d.contract_type === 'Rookie scale')
    const aboveMax = r.filter((d) => d.fair_value > maxSalary)
    const over = r.filter((d) => d.surplus < -10e6)
    const sum = (a: BoardRow[], f: (d: BoardRow) => number) => a.reduce((s, d) => s + f(d), 0)
    return {
      n: r.length, under: under.length, underSum: sum(under, (d) => d.surplus),
      rookie: rookie.length, rookieSum: sum(rookie, (d) => d.surplus),
      aboveMax: aboveMax.length, aboveMaxSum: sum(aboveMax, (d) => d.fair_value - maxSalary),
      over: over.length, overSum: sum(over, (d) => d.surplus),
    }
  }, [board, seasons.full, maxSalary])

  useGSAP(() => {
    const els = steps.current?.querySelectorAll<HTMLElement>('.step') ?? []
    els.forEach((el) => {
      ScrollTrigger.create({
        trigger: el, start: 'top 62%', end: 'bottom 62%',
        onToggle: (self) => {
          el.classList.toggle('is-active', self.isActive)
          if (self.isActive) setStep(el.dataset.step as StepKey)
        },
      })
    })
  }, { scope: steps })

  const S = seasons.full
  const STEPS: { key: StepKey; title: string; body: React.ReactNode }[] = [
    { key: 'all', title: 'Every dot is a player', body: <>All <b>{facts.n}</b> players who drew an NBA salary in {label(S)}. Left to right: what they were paid. Bottom to top: what their production was worth.</> },
    { key: 'line', title: 'The fair line', body: <>On the diagonal, pay equals value. <b>Above it, the player produced more than he was paid.</b> Below it, the team paid for more than it got.</> },
    { key: 'under', title: 'Underpaid', body: <><b>{facts.under}</b> players sit above the line. Together they produced <b className="under">{money(facts.underSum, 2)}</b> of value they weren't paid for.</> },
    { key: 'rookie', title: 'The rookie-scale discount', body: <>Rookie-scale contracts are fixed by the CBA, not by the market. <b>{facts.rookie}</b> players on them created a net <b className="under">{signedMoney(facts.rookieSum, 2)}</b> of surplus for their teams.</> },
    { key: 'max', title: 'The max wall', body: <>No salary can exceed 35% of the cap (<b>{money(maxSalary)}</b>). <b>{facts.aboveMax}</b> players were worth more than the max allows, <b className="under">{money(facts.aboveMaxSum, 2)}</b> above the ceiling in total.</> },
    { key: 'over', title: 'Below the line', body: <><b>{facts.over}</b> players were paid at least $10M more than their production was worth. Most are not "bad contracts": they are <b>injured players</b> and stars on the decline. Availability is part of value, which is why the 4th quarter is about wear and tear.</> },
    { key: 'explore', title: 'Your turn', body: <>Hover any dot. Search for a player, filter by contract type, or switch to the season in progress. Click a dot to open the player's page.</> },
  ]

  return (
    <section className="chapter" id="ledger">
      <div className="wrap">
        <ChapterHead quarter="1st Quarter · continued" title="The ledger">
          Pay against production for the whole league at once. The diagonal is "fair."
        </ChapterHead>
        <div className="scrolly">
          <div className="scrolly-steps" ref={steps}>
            {STEPS.map((s) => (
              <div className="step" data-step={s.key} key={s.key}>
                <div className="step-card"><h4>{s.title}</h4><p>{s.body}</p></div>
              </div>
            ))}
          </div>
          <div className="scrolly-graphic">
            <div className="chart-frame" style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
              {step === 'explore' && <div className="controls explore-controls">
                <div style={{ flex: '1 1 220px', maxWidth: 300 }}><PlayerSearch placeholder="Find a player on the chart…" onPick={setFocus} /></div>
                {[seasons.full, seasons.current].map((s) => (
                  <button key={s} className={`chip ${season === s ? 'on' : ''}`} onClick={() => setSeason(s)}>
                    {label(s)}{s === seasons.current ? ' (so far)' : ''}
                  </button>
                ))}
                <span style={{ width: 8 }} />
                {TYPES.map((t) => (
                  <button key={t} className={`chip ${types.has(t) ? 'on' : ''}`} aria-pressed={types.has(t)}
                    onClick={() => setTypes((prev) => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n.size ? n : new Set(TYPES) })}>
                    {t}
                  </button>
                ))}
              </div>}
              <div style={{ flex: 1, minHeight: 0 }}>
                <Scatter rows={rows} step={step} types={step === 'explore' ? types : new Set(TYPES)} focus={step === 'explore' ? focus : null} maxSalary={maxSalary} />
              </div>
              <div className="legend" style={{ marginTop: 8 }}>
                <span>Overpaid</span>
                <span className="ramp" style={{ background: `linear-gradient(90deg, ${OVER}, ${NEUTRAL}, ${UNDER})` }} />
                <span>Underpaid</span>
                <span className="muted" style={{ marginLeft: 'auto' }}>Log scales · fair value = min + WAR × $/win</span>
              </div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

function Scatter({ rows, step, types, focus, maxSalary }: { rows: BoardRow[]; step: StepKey; types: Set<string>; focus: string | null; maxSalary: number }) {
  const [box, size] = useSize<HTMLDivElement>()
  const svg = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<BoardRow | null>(null)
  const tip = useTooltip()
  const nav = useNavigate()
  const { width: w, height: h } = size
  const m = { top: 16, right: 18, bottom: 44, left: 62 }
  const x = useMemo(() => d3.scaleLog().domain([3.5e5, 7e7]).range([m.left, Math.max(m.left + 10, w - m.right)]).clamp(true), [w])
  const y = useMemo(() => d3.scaleLog().domain([1e6, 1.8e8]).range([Math.max(m.top + 10, h - m.bottom), m.top]).clamp(true), [h])
  const visible = rows.filter((r) => types.has(r.contract_type))
  const delaunay = useMemo(() => d3.Delaunay.from(visible, (d) => x(d.salary), (d) => y(d.fair_value)), [visible, x, y])

  const emphasis = (r: BoardRow) => {
    switch (step) {
      case 'under': return r.surplus > 0
      case 'rookie': return r.contract_type === 'Rookie scale'
      case 'max': return r.fair_value > maxSalary
      case 'over': return r.surplus < -10e6
      default: return true
    }
  }
  const labelled = useMemo(() => {
    const pick = (arr: BoardRow[], by: (r: BoardRow) => number, n: number) => [...arr].sort((a, b) => by(b) - by(a)).slice(0, n)
    switch (step) {
      case 'under': return pick(rows.filter((r) => r.surplus > 0), (r) => r.surplus, 3)
      case 'rookie': return pick(rows.filter((r) => r.contract_type === 'Rookie scale'), (r) => r.surplus, 3)
      case 'max': return pick(rows.filter((r) => r.fair_value > maxSalary), (r) => r.fair_value, 4)
      case 'over': return pick(rows, (r) => -r.surplus, 3)
      case 'explore': return focus ? rows.filter((r) => r.player_id === focus) : []
      default: return []
    }
  }, [rows, step, focus, maxSalary])

  // Animate the fair line in, and the dots on first reveal.
  useGSAP(() => {
    if (!svg.current || reducedMotion) return
    const line = svg.current.querySelector('.fair-line')
    if (line) gsap.fromTo(line, { drawSVG: '0%' }, { drawSVG: step === 'all' ? '0%' : '100%', duration: 1.2, ease: 'power2.inOut' })
  }, { dependencies: [step === 'all', w], scope: svg })
  useEffect(() => {
    if (!svg.current || reducedMotion || !w) return
    gsap.fromTo(svg.current.querySelectorAll('.dot'), { attr: { r: 0 } }, { attr: { r: 4.5 }, duration: 0.6, stagger: { amount: 1.1, from: 'random' }, ease: 'back.out(2)' })
  }, [w > 0, rows.length])

  if (!w || !h) return <div ref={box} style={{ width: '100%', height: '100%' }} />
  const narrow = w < 560
  const xt = narrow ? [1e6, 5e6, 2e7, 5e7] : [5e5, 1e6, 2e6, 5e6, 1e7, 2e7, 5e7]
  const yt = narrow ? [1e6, 5e6, 2e7, 1e8] : [1e6, 2e6, 5e6, 1e7, 2e7, 5e7, 1e8]
  const colored = step !== 'all'
  const onMove = (e: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect()
    const px = e.clientX - rect.left, py = e.clientY - rect.top
    const i = delaunay.find(px, py)
    const d = visible[i]
    if (!d || Math.hypot(x(d.salary) - px, y(d.fair_value) - py) > 28) { setHover(null); tip.hide(); return }
    setHover(d)
    tip.show(e, <>
      <div className="tt-name">{d.player_name}</div>
      <div className="tt-sub">{d.team} · {d.pos} · age {d.age} · {d.contract_type}</div>
      <TipRows rows={[['Salary', money(d.salary)], ['Fair value', money(d.fair_value)],
        ['Surplus', <span className={d.surplus > 0 ? 'under' : 'over'}>{signedMoney(d.surplus)}</span>],
        ['Wins over repl.', num(d.war82, 1)], ['Games', String(d.games)]]} />
    </>)
  }
  return (
    <div ref={box} style={{ width: '100%', height: '100%' }}>
      <svg ref={svg} className="chart" width={w} height={h} onPointerMove={onMove}
        onPointerLeave={() => { setHover(null); tip.hide() }} onClick={() => hover && nav(`/player/${hover.player_id}`)}
        style={{ cursor: hover ? 'pointer' : 'default' }} role="img" aria-label="Scatter of salary versus fair value for every player">
        <g className="grid">
          {yt.map((t) => <line key={t} x1={m.left} x2={w - m.right} y1={y(t)} y2={y(t)} />)}
          {xt.map((t) => <line key={t} y1={m.top} y2={h - m.bottom} x1={x(t)} x2={x(t)} />)}
        </g>
        {yt.map((t) => <text key={t} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{money(t, 0)}</text>)}
        {xt.map((t) => <text key={t} x={x(t)} y={h - m.bottom + 18} textAnchor="middle">{money(t, t < 1e6 ? 0 : 0)}</text>)}
        <text className="axis-title" x={w - m.right} y={h - 6} textAnchor="end">Actual salary →</text>
        <text className="axis-title" transform={`translate(14 ${m.top}) rotate(-90)`} textAnchor="end">Fair value →</text>

        {/* the max wall */}
        <g style={{ opacity: step === 'max' || step === 'explore' ? 1 : 0, transition: 'opacity .5s' }}>
          <line x1={x(maxSalary)} x2={x(maxSalary)} y1={m.top} y2={h - m.bottom} stroke="var(--text-2)" strokeWidth={1.5} />
          <line x1={m.left} x2={w - m.right} y1={y(maxSalary)} y2={y(maxSalary)} stroke="var(--text-2)" strokeWidth={1} opacity={0.6} />
          <text x={x(maxSalary) - 6} y={m.top + 12} textAnchor="end" className="label-strong">35% max</text>
        </g>
        <line className="fair-line" x1={x(1e6)} y1={y(1e6)} x2={x(7e7)} y2={y(7e7)} stroke="var(--text)" strokeWidth={2} opacity={0.8} />
        <text x={x(4.2e7)} y={y(4.2e7) + 16} textAnchor="middle" style={{ opacity: step === 'all' ? 0 : 1, transition: 'opacity .6s' }} transform={`rotate(-${Math.atan2(y(1e6) - y(7e7), x(7e7) - x(1e6)) * 180 / Math.PI} ${x(4.2e7)} ${y(4.2e7) + 16})`} className="label-strong">fair pay</text>

        <g>
          {visible.map((d) => {
            const on = emphasis(d)
            return (
              <circle key={d.player_id} className="dot" cx={x(d.salary)} cy={y(d.fair_value)} r={4.5}
                fill={colored ? surplusColor(d.surplus) : '#8a8476'}
                stroke="var(--surface)" strokeWidth={1.5}
                style={{ opacity: on ? 0.95 : 0.12, transition: 'opacity .5s, fill .6s' }} />
            )
          })}
        </g>
        {labelled.map((d) => (
          <g key={d.player_id} transform={`translate(${x(d.salary)} ${y(d.fair_value)})`} pointerEvents="none">
            <circle r={9} fill="none" stroke="var(--text)" strokeWidth={1.5} />
            <text x={x(d.salary) > w - 160 ? -14 : 14} y={4} textAnchor={x(d.salary) > w - 160 ? 'end' : 'start'} className="label-strong"
              style={{ paintOrder: 'stroke', stroke: 'var(--surface)', strokeWidth: 4 }}>{d.player_name}</text>
          </g>
        ))}
        {hover && <circle cx={x(hover.salary)} cy={y(hover.fair_value)} r={8} fill="none" stroke="var(--text)" strokeWidth={2} pointerEvents="none" />}
      </svg>
    </div>
  )
}
