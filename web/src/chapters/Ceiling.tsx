// 2nd quarter: who the CBA's rules underpay — max players and rookie-scale players.
import { useGSAP } from '@gsap/react'
import * as d3 from 'd3'
import { useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChapterHead, Counter, Reveal } from '../components/ui'
import { label } from '../lib/data'
import { money, num, signedMoney } from '../lib/format'
import { gsap, reducedMotion } from '../lib/motion'
import { TipRows, useTooltip } from '../lib/tooltip'
import { useSize } from './useSize'

export function MaxCeiling({ stories }: { stories: any }) {
  const mc = stories?.max_ceiling
  const [box, { width }] = useSize<HTMLDivElement>()
  const svg = useRef<SVGSVGElement>(null)
  const tip = useTooltip()
  useGSAP(() => {
    if (!svg.current || reducedMotion || !width) return
    gsap.from(svg.current.querySelectorAll('.bar-grow'), {
      scaleX: 0, transformOrigin: '0 0', duration: 1.1, ease: 'power3.out', stagger: 0.07,
      scrollTrigger: { trigger: svg.current, start: 'top 75%' },
    })
    gsap.from(svg.current.querySelectorAll('.sal-mark'), {
      opacity: 0, duration: 0.4, stagger: 0.07, delay: 0.8,
      scrollTrigger: { trigger: svg.current, start: 'top 75%' },
    })
  }, { dependencies: [width > 0], scope: svg })
  if (!mc) return null
  const top = mc.top.slice(0, 10)
  const m = { top: 28, right: 24, bottom: 32, left: Math.min(190, width * 0.36) }
  const rowH = 40
  const h = m.top + m.bottom + top.length * rowH
  const x = d3.scaleLinear().domain([0, d3.max(top, (d: any) => d.fair_value as number)! * 1.05]).range([m.left, Math.max(m.left + 10, width - m.right)])
  const maxX = x(mc.max_salary)
  return (
    <section className="chapter" id="ceiling">
      <div className="wrap">
        <ChapterHead quarter="2nd Quarter" title="The max ceiling">
          The league's best players are often its most <b>underpaid</b>. The CBA caps a single salary at 35% of the cap.
          The market value of an MVP-level season is far past that line.
        </ChapterHead>
        <div className="grid grid-3" style={{ marginBottom: 28 }}>
          <Reveal><div className="card"><Counter className="stat-val under" value={mc.players_above_max} format={(v) => String(Math.round(v))} /><div className="stat-lbl">players worth more than the max in {label(mc.season)}</div></div></Reveal>
          <Reveal delay={0.1}><div className="card"><Counter className="stat-val under" value={mc.value_above_max_total} format={(v) => money(v, 0)} /><div className="stat-lbl">of production above the ceiling, unpaid by rule</div></div></Reveal>
          <Reveal delay={0.2}><div className="card"><Counter className="stat-val" value={mc.max_salary} format={(v) => money(v, 1)} /><div className="stat-lbl">the most any player could be paid (35% of cap)</div></div></Reveal>
        </div>
        <div className="chart-frame" ref={box}>
          <div className="legend" style={{ marginBottom: 6 }}>
            <span><i style={{ background: 'var(--under)' }} />Fair value</span>
            <span><i style={{ background: 'var(--text)', width: 3, borderRadius: 1 }} />Actual salary</span>
            <span><i style={{ background: 'repeating-linear-gradient(45deg, var(--under) 0 2px, transparent 2px 5px)' }} />Value above the max: cannot be paid under the CBA</span>
          </div>
          {width > 0 && (
            <svg ref={svg} className="chart" width={width - 36} height={h} role="img" aria-label="Top players' fair value compared to the maximum salary">
              <defs>
                <pattern id="hatch" width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
                  <rect width="6" height="6" fill="var(--surface)" /><line x1="0" y1="0" x2="0" y2="6" stroke="#e8681f" strokeWidth="2.4" />
                </pattern>
              </defs>
              <g className="grid">{x.ticks(5).map((t) => <line key={t} x1={x(t)} x2={x(t)} y1={m.top - 8} y2={h - m.bottom} />)}</g>
              {x.ticks(5).map((t) => <text key={t} x={x(t)} y={h - 10} textAnchor="middle">{money(t, 0)}</text>)}
              {top.map((d: any, i: number) => {
                const y0 = m.top + i * rowH
                const capW = Math.min(x(d.fair_value), maxX) - m.left
                return (
                  <g key={d.player_id} transform={`translate(0 ${y0})`}
                    onPointerMove={(e) => tip.show(e, <><div className="tt-name">{d.player_name}</div><div className="tt-sub">{d.team}</div>
                      <TipRows rows={[['Fair value', money(d.fair_value)], ['Salary', money(d.salary)], ['Above the max', money(d.value_above_max)], ['Wins over repl.', num(d.war82, 1)]]} /></>)}
                    onPointerLeave={tip.hide}>
                    <rect x={0} y={0} width={width} height={rowH} fill="transparent" />
                    <Link to={`/player/${d.player_id}`}><text x={m.left - 12} y={rowH / 2} dy="0.35em" textAnchor="end" className="label-strong">{d.player_name}</text></Link>
                    <g className="bar-grow">
                      <rect x={m.left} y={8} width={Math.max(0, capW)} height={rowH - 16} rx={4} fill="var(--under)" />
                      {d.fair_value > mc.max_salary && (
                        <rect x={maxX + 2} y={8} width={Math.max(0, x(d.fair_value) - maxX - 2)} height={rowH - 16} rx={4} fill="url(#hatch)" />
                      )}
                    </g>
                    <rect className="sal-mark" x={x(d.salary) - 1.5} y={4} width={3} height={rowH - 8} rx={1.5} fill="var(--text)" />
                  </g>
                )
              })}
              <line x1={maxX} x2={maxX} y1={m.top - 16} y2={h - m.bottom} stroke="var(--text)" strokeWidth={1.5} />
              <text x={maxX + 6} y={m.top - 8} className="label-strong">35% max · {money(mc.max_salary)}</text>
            </svg>
          )}
        </div>
      </div>
    </section>
  )
}

export function ContractTypes({ stories }: { stories: any }) {
  const ct = stories?.contract_types
  const [box, { width }] = useSize<HTMLDivElement>()
  const tip = useTooltip()
  if (!ct) return null
  const order = ['Two-way', 'Minimum', 'Rookie scale', 'Rotation', 'Middle class', 'Near-max', 'Max']
  const rows = order.map((k) => ct.rows.find((r: any) => r.contract_type === k)).filter(Boolean)
  const by = (k: string) => ct.rows.find((r: any) => r.contract_type === k)?.surplus ?? 0
  const m = { top: 10, right: 30, bottom: 26, left: 120 }
  const rowH = 44
  const h = m.top + m.bottom + rows.length * rowH
  const ext = d3.max(rows, (r: any) => Math.abs(r.surplus) as number) ?? 1
  const x = d3.scaleLinear().domain([-ext, ext]).nice().range([m.left, Math.max(m.left + 10, width - 36 - m.right)])
  return (
    <section className="chapter" style={{ paddingTop: '6vh' }}>
      <div className="wrap">
        <div className="grid grid-2" style={{ alignItems: 'center', gap: 40 }}>
          <div>
            <div className="quarter">2nd Quarter · continued</div>
            <h3 className="display" style={{ fontSize: 'clamp(40px, 6vw, 80px)', margin: '14px 0' }}>Who keeps the surplus</h3>
            <p className="lede">
              Players whose pay is pinned low by formula produce far more than they cost: minimum deals net{' '}
              <b className="under">{signedMoney(by('Minimum'), 0)}</b> and rookie-scale deals{' '}
              <b className="under">{signedMoney(by('Rookie scale'), 0)}</b>. At the top, max contracts net{' '}
              <b className="over">{signedMoney(by('Max'), 0)}</b>: healthy superstars are capped below their value, but a max
              player who misses the season still draws full pay. Mid-size free-agent deals are where teams pay most
              above the production they get back ({signedMoney(by('Middle class'), 0)}).
            </p>
            <p className="dim" style={{ fontSize: 14 }}>
              Total surplus per group, {label(ct.season)}. Positive = value the player produced but did not receive.
            </p>
          </div>
          <div className="chart-frame" ref={box}>
            {width > 0 && (
              <svg className="chart" width={width - 36} height={h} role="img" aria-label="Total surplus by contract type">
                <line x1={x(0)} x2={x(0)} y1={m.top} y2={h - m.bottom} stroke="var(--line-2)" />
                {x.ticks(4).map((t) => <text key={t} x={x(t)} y={h - 6} textAnchor="middle">{signedMoney(t, 0)}</text>)}
                {rows.map((r: any, i: number) => {
                  const y0 = m.top + i * rowH
                  const pos = r.surplus >= 0
                  return (
                    <g key={r.contract_type} onPointerMove={(e) => tip.show(e, <><div className="tt-name">{r.contract_type}</div>
                      <TipRows rows={[['Players', String(r.players)], ['Paid', money(r.salary, 2)], ['Fair value', money(r.value, 2)], ['Surplus', signedMoney(r.surplus, 2)]]} /></>)}
                      onPointerLeave={tip.hide}>
                      <rect x={0} y={y0} width={width} height={rowH} fill="transparent" />
                      <text x={m.left - 12} y={y0 + rowH / 2} dy="0.35em" textAnchor="end" className="label-strong">{r.contract_type}</text>
                      <rect x={pos ? x(0) : x(r.surplus)} y={y0 + 10} width={Math.abs(x(r.surplus) - x(0))} height={rowH - 20} rx={4}
                        fill={pos ? 'var(--under)' : 'var(--over)'} />
                      <text x={pos ? x(r.surplus) + 6 : x(0) + 6} y={y0 + rowH / 2} dy="0.35em" textAnchor="start" style={{ fontFamily: 'var(--font-mono)', fontSize: 11.5 }}>
                        {signedMoney(r.surplus, 0)}
                      </text>
                    </g>
                  )
                })}
              </svg>
            )}
          </div>
        </div>
      </div>
    </section>
  )
}
