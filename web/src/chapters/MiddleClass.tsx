// 3rd quarter: how the league's payroll is split across contract tiers.
import { useGSAP } from '@gsap/react'
import * as d3 from 'd3'
import { useRef, useState } from 'react'
import { ChapterHead, Reveal } from '../components/ui'
import { label } from '../lib/data'
import { int, money, pct } from '../lib/format'
import { gsap, reducedMotion } from '../lib/motion'
import { TipRows, useTooltip } from '../lib/tooltip'
import { useSize } from './useSize'

const TIER_COLORS: Record<string, string> = {
  Minimum: '#6b4424', Rotation: '#94562a', 'Middle class': '#c0652d', 'Near-max': '#e8823f', Max: '#ffb27a',
}
const TIER_RANGE: Record<string, string> = {
  Minimum: '< 2.5% of cap', Rotation: '2.5–7.5%', 'Middle class': '7.5–17.5%', 'Near-max': '17.5–25%', Max: '≥ 25%',
}
const CBA = [{ season: 2018, text: '2017 CBA' }, { season: 2024, text: '2023 CBA · aprons' }]

export default function MiddleClass({ stories, current }: { stories: any; current: number }) {
  const mc = stories?.middle_class
  const [box, { width }] = useSize<HTMLDivElement>()
  const svg = useRef<SVGSVGElement>(null)
  const [hover, setHover] = useState<any>(null)
  const tip = useTooltip()
  useGSAP(() => {
    if (!svg.current || reducedMotion || !width) return
    gsap.fromTo(svg.current.querySelector('.reveal-clip'), { attr: { width: 0 } }, {
      attr: { width: width }, ease: 'none',
      scrollTrigger: { trigger: svg.current, start: 'top 80%', end: 'bottom 35%', scrub: 0.6 },
    })
    gsap.from(svg.current.querySelectorAll('.cba-mark'), {
      opacity: 0, y: -10, stagger: 0.3,
      scrollTrigger: { trigger: svg.current, start: 'top 55%' },
    })
  }, { dependencies: [width > 0], scope: svg })
  if (!mc?.seasons?.length || mc.seasons.length < 3) {
    return (
      <section className="chapter" id="middle">
        <div className="wrap">
          <ChapterHead quarter="3rd Quarter" title="The middle-class squeeze">Salary history is still loading into the warehouse. Run the pipeline to fill this chapter.</ChapterHead>
        </div>
      </section>
    )
  }
  const tiers: string[] = mc.tiers
  const data = mc.seasons.filter((s: any) => s.season <= current)
  const W = Math.max(0, width - 36)
  const H = Math.min(460, Math.max(300, W * 0.48))
  const m = { top: 30, right: W > 700 ? 120 : 16, bottom: 34, left: 44 }
  const x = d3.scaleLinear().domain(d3.extent(data, (d: any) => d.season as number) as [number, number]).range([m.left, W - m.right])
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.bottom, m.top])
  const stack = d3.stack<any>().keys(tiers).value((d, k) => d[`share_${k}`] ?? 0)(data)
  const area = d3.area<any>().x((d) => x(d.data.season)).y0((d) => y(d[0])).y1((d) => y(d[1])).curve(d3.curveMonotoneX)
  const first = data[0], last = data[data.length - 1]
  const lastFull = data.filter((d: any) => d.season < current).at(-1) ?? last

  const onMove = (e: React.PointerEvent) => {
    const rect = svg.current!.getBoundingClientRect()
    const s = Math.round(x.invert(e.clientX - rect.left))
    const d = data.find((r: any) => r.season === s)
    if (!d) return
    setHover(d)
    tip.show(e, <>
      <div className="tt-name">{label(d.season)}{d.season === current ? ' (in progress)' : ''}</div>
      <div className="tt-sub">{int(d.n_players)} contracts · {money(d.payroll, 2)} payroll</div>
      <TipRows rows={[...tiers].reverse().map((t) => [t, `${pct(d[`share_${t}`])} · ${d[`count_${t}`]}`])} />
    </>)
  }

  return (
    <section className="chapter" id="middle">
      <div className="wrap">
        <ChapterHead quarter="3rd Quarter" title="The middle-class squeeze">
          A union bargains for all ~450 players, not just the stars. So the question is not only "how much" but
          <b> "to whom."</b> Here is every dollar of NBA payroll since 2011–12, split by the size of the contract
          (as a share of the cap).
        </ChapterHead>
        <div className="chart-frame" ref={box}>
          <div className="legend" style={{ marginBottom: 8 }}>
            {[...tiers].reverse().map((t) => <span key={t}><i style={{ background: TIER_COLORS[t] }} />{t} <span className="muted">({TIER_RANGE[t]})</span></span>)}
          </div>
          {W > 0 && (
            <svg ref={svg} className="chart" width={W} height={H} onPointerMove={onMove} onPointerLeave={() => { setHover(null); tip.hide() }}
              role="img" aria-label="Stacked area of payroll share by contract tier over seasons">
              <defs><clipPath id="mc-clip"><rect className="reveal-clip" x={0} y={0} width={W} height={H} /></clipPath></defs>
              <g className="grid">{[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />)}</g>
              {[0, 0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{pct(t, 0)}</text>)}
              {data.filter((_: any, i: number) => i % (W < 600 ? 3 : 2) === 0).map((d: any) => (
                <text key={d.season} x={x(d.season)} y={H - 10} textAnchor="middle">{label(d.season)}</text>
              ))}
              <g clipPath="url(#mc-clip)">
                {stack.map((s) => <path key={s.key} d={area(s) ?? ''} fill={TIER_COLORS[s.key]} stroke="var(--surface)" strokeWidth={2} />)}
              </g>
              {W > 700 && stack.map((s) => {
                const lp = s[s.length - 1]
                const mid = (lp[0] + lp[1]) / 2
                return lp[1] - lp[0] > 0.04 ? (
                  <text key={s.key} x={W - m.right + 8} y={y(mid)} dy="0.32em" className="label-strong">{s.key} {pct(lp[1] - lp[0], 0)}</text>
                ) : null
              })}
              {CBA.map((c) => c.season >= first.season && (
                <g className="cba-mark" key={c.season} transform={`translate(${x(c.season - 0.5)} 0)`}>
                  <line y1={m.top - 14} y2={H - m.bottom} stroke="var(--text)" strokeWidth={1.2} opacity={0.75} />
                  <text x={5} y={m.top - 16} className="label-strong" style={{ fontSize: 11 }}>{c.text}</text>
                </g>
              ))}
              {current >= first.season && (
                <rect x={x(current - 0.5)} y={m.top} width={x(current) - x(current - 0.5)} height={H - m.top - m.bottom} fill="var(--surface)" opacity={0.45} />
              )}
              {hover && <line x1={x(hover.season)} x2={x(hover.season)} y1={m.top} y2={H - m.bottom} stroke="var(--text)" strokeWidth={1.5} />}
            </svg>
          )}
        </div>
        <div className="grid grid-3" style={{ marginTop: 24 }}>
          <Reveal><div className="card">
            <div className="kicker">Middle-class share of payroll</div>
            <div className="stat-val" style={{ marginTop: 8 }}>{pct(first['share_Middle class'], 0)} → {pct(lastFull['share_Middle class'], 0)}</div>
            <div className="stat-lbl">{label(first.season)} → {label(lastFull.season)}, contracts of 7.5–17.5% of the cap</div>
          </div></Reveal>
          <Reveal delay={0.1}><div className="card">
            <div className="kicker">Top 10% of contracts take</div>
            <div className="stat-val" style={{ marginTop: 8 }}>{pct(first.top10_share, 0)} → {pct(lastFull.top10_share, 0)}</div>
            <div className="stat-lbl">of all salary dollars</div>
          </div></Reveal>
          <Reveal delay={0.2}><div className="card">
            <div className="kicker">Pay inequality (Gini)</div>
            <div className="stat-val" style={{ marginTop: 8 }}>{first.gini.toFixed(2)} → {lastFull.gini.toFixed(2)}</div>
            <div className="stat-lbl">0 = everyone paid the same, 1 = one player paid everything</div>
          </div></Reveal>
        </div>
      </div>
    </section>
  )
}
