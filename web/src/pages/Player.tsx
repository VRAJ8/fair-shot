// The locker room: one player's ledger, projection, comps and availability.
import { useGSAP } from '@gsap/react'
import * as d3 from 'd3'
import { useEffect, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { BriefButton } from '../components/Ask'
import { Counter, Jersey, PlayerSearch, Reveal } from '../components/ui'
import { useSize } from '../chapters/useSize'
import { label, useData } from '../lib/data'
import { heightFt, money, num, pct, signedMoney } from '../lib/format'
import { gsap, reducedMotion, scrollToTop } from '../lib/motion'
import { TipRows, useTooltip } from '../lib/tooltip'

export default function Player() {
  const { id } = useParams()
  const p = useData<any>(id ? `players/${id}.json` : null)
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => { scrollToTop() }, [id])
  useGSAP(() => {
    if (!p || reducedMotion) return
    gsap.from('.locker-head > *', { opacity: 0, y: 30, duration: 0.9, stagger: 0.12, ease: 'power3.out' })
    gsap.from('.scoreboard', { opacity: 0, scale: 0.97, duration: 0.9, delay: 0.3, ease: 'power3.out' })
  }, { scope: ref, dependencies: [p?.id] })
  if (!p) return <div className="wrap locker"><div className="muted" style={{ padding: '30vh 0', textAlign: 'center' }}>Loading the locker room…</div></div>

  const ref_season = p.seasons.find((s: any) => s.season === p.ref_season) ?? p.seasons[p.seasons.length - 1]
  const av = p.availability?.[p.ref_season]
  const surplus = ref_season.surplus
  return (
    <div className="locker" ref={ref}>
      <div className="wrap">
        <div style={{ maxWidth: 360, marginLeft: 'auto' }}><PlayerSearch placeholder="Jump to another player…" /></div>
        <div className="locker-head">
          <Jersey colors={p.colors} number={p.jersey} size={150} name={p.name} />
          <div>
            <div className="kicker">{p.team_name} · {p.pos} · {p.age != null ? `age ${p.age}` : ''}{p.height_in ? ` · ${heightFt(p.height_in)}` : ''}{p.college ? ` · ${p.college}` : ''}</div>
            <h1 className="locker-name display">{p.name}</h1>
            <div className="controls" style={{ marginTop: 10 }}>
              <span className="pill">{ref_season.contract_type}</span>
              {p.draft && <span className="pill">Drafted {p.draft.draft_year} · #{p.draft.draft_pick}</span>}
              <span className={`pill ${surplus > 0 ? 'under' : 'over'}`}>{surplus > 0 ? 'Underpaid' : 'Overpaid'} in {label(p.ref_season)}</span>
            </div>
          </div>
        </div>

        <div className="scoreboard" role="group" aria-label={`${label(p.ref_season)} salary versus fair value`}>
          <div className="sb-side">
            <div className="sb-lbl">Salary · {label(p.ref_season)}</div>
            <div className="sb-val">{money(ref_season.salary)}</div>
            <div className="muted mono" style={{ fontSize: 12 }}>{pct(ref_season.salary_pct_cap)} of the cap</div>
          </div>
          <div className="sb-mid">
            <div className="sb-lbl mono" style={{ fontSize: 10, letterSpacing: '.2em', color: '#8f857b' }}>SURPLUS</div>
            <Counter className="sb-val" value={surplus} format={(v) => signedMoney(v)} />
            <div style={{ color: surplus > 0 ? 'var(--under)' : 'var(--over)', fontSize: 11, letterSpacing: '.12em' }}>{surplus > 0 ? 'VALUE NOT PAID' : 'PAID ABOVE VALUE'}</div>
          </div>
          <div className="sb-side" style={{ textAlign: 'right' }}>
            <div className="sb-lbl">Fair value</div>
            <div className="sb-val" style={{ color: surplus > 0 ? '#ff9a52' : 'var(--led)' }}>{money(ref_season.fair_value)}</div>
            <div className="muted mono" style={{ fontSize: 12 }}>{num(ref_season.war82, 1)} wins over replacement</div>
          </div>
        </div>

        <div className="grid grid-4" style={{ marginTop: 16 }}>
          {[
            ['Games', String(ref_season.games), av ? `of ${av.team_games} team games` : ''],
            ['Minutes / game', num(ref_season.mpg, 1), ''],
            ['Box Plus/Minus', num(ref_season.bpm, 1), 'points per 100 vs. average'],
            ['True shooting', pct(ref_season.ts_pct), `usage ${num(ref_season.usg_pct, 1)}%`],
          ].map(([k, v, s]) => (
            <div className="card" key={k}><div className="kicker">{k}</div><div className="stat-val" style={{ fontSize: 36, marginTop: 6 }}>{v}</div><div className="stat-lbl">{s}</div></div>
          ))}
        </div>

        <section className="panel">
          <h2 className="section-title">Career ledger</h2>
          <p className="dim" style={{ marginTop: 0 }}>Fair value against salary, every season in the data. The gap is shaded: orange where he was underpaid, blue where he was overpaid.</p>
          <CareerChart seasons={p.seasons} />
        </section>

        {p.projection?.length > 0 && (
          <section className="panel">
            <h2 className="section-title">The next three seasons</h2>
            <p className="dim" style={{ marginTop: 0 }}>Projected value (median and 80% range, priced at today's market) against what his contract pays.</p>
            <ProjectionChart projection={p.projection} contract={p.contract} />
          </section>
        )}

        {p.comps?.length > 0 && (
          <section className="panel">
            <h2 className="section-title">Comparables</h2>
            <p className="dim" style={{ marginTop: 0 }}>The historical seasons most like his {label(p.ref_season)}, with what each player earned the following year, translated into today's cap.</p>
            {p.comps[0].similarity < 45 && (
              <div className="card" style={{ marginBottom: 14, borderColor: '#3a2a1c', background: '#18120d' }}>
                <b className="under">A one-of-one season.</b> <span className="dim">Nothing since 2011–12 sits close to this stat profile
                (best similarity {num(p.comps[0].similarity, 0)}/100), so treat these as the nearest neighbours, not true comparables.</span>
              </div>
            )}
            <div className="grid grid-3">
              {p.comps.map((c: any, i: number) => (
                <Reveal key={c.id + c.season} delay={i * 0.05}>
                  <Link to={`/player/${c.id}`} className="comp-card">
                    <div className="kicker">{c.label} · age {c.age}</div>
                    <div style={{ fontWeight: 700, fontSize: 18 }}>{c.name}</div>
                    <div className="sim-bar"><i style={{ width: `${c.similarity}%` }} /></div>
                    <div className="mono" style={{ fontSize: 12, color: 'var(--text-2)' }}>similarity {num(c.similarity, 0)} · {num(c.war82, 1)} WAR · {num(c.mpg, 1)} mpg</div>
                    <div style={{ fontSize: 14, marginTop: 4 }}>
                      {c.next_pct_cap != null
                        ? <>Next season: <b>{pct(c.next_pct_cap)}</b> of the cap · <b className="under">{money(c.in_todays_dollars)}</b> today</>
                        : <span className="muted">No salary on record the following season</span>}
                    </div>
                  </Link>
                </Reveal>
              ))}
            </div>
          </section>
        )}

        {av && (
          <section className="panel">
            <h2 className="section-title">Availability · {label(p.ref_season)}</h2>
            <p className="dim" style={{ marginTop: 0 }}>
              Every game his team played. Filled squares are games he played (brighter = more minutes); outlined squares are games he missed. A dot marks the second night of a back-to-back.
            </p>
            <GameStrip games={av.games} />
            <div className="grid grid-4" style={{ marginTop: 14 }}>
              <div className="card"><div className="stat-val" style={{ fontSize: 32 }}>{av.played}/{av.team_games}</div><div className="stat-lbl">games played</div></div>
              <div className="card"><div className="stat-val" style={{ fontSize: 32 }}>{av.team_games - av.played}</div><div className="stat-lbl">games missed</div></div>
              <div className="card"><div className="stat-val" style={{ fontSize: 32 }}>{av.b2b_played}/{av.b2b_total}</div><div className="stat-lbl">back-to-back second nights played</div></div>
              <div className="card"><div className="stat-val" style={{ fontSize: 32 }}>{Math.round(av.miles / 1000)}k</div><div className="stat-lbl">miles traveled with the team</div></div>
            </div>
          </section>
        )}

        <section className="panel"><BriefButton playerId={p.id} name={p.name} /></section>
      </div>
    </div>
  )
}

function CareerChart({ seasons }: { seasons: any[] }) {
  const [box, { width }] = useSize<HTMLDivElement>()
  const svg = useRef<SVGSVGElement>(null)
  const tip = useTooltip()
  const [hover, setHover] = useState<any>(null)
  const data = seasons.filter((s) => s.salary != null)
  useGSAP(() => {
    if (!svg.current || reducedMotion || !width) return
    gsap.from(svg.current.querySelectorAll('.ln'), { drawSVG: '0%', duration: 1.6, ease: 'power2.inOut', scrollTrigger: { trigger: svg.current, start: 'top 80%' } })
    gsap.from(svg.current.querySelectorAll('.gap'), { opacity: 0, duration: 1, delay: 0.8, scrollTrigger: { trigger: svg.current, start: 'top 80%' } })
  }, { dependencies: [width > 0, data.length], scope: svg })
  if (data.length === 0) return <div className="card muted">No salary history in the data for this player.</div>
  const W = Math.max(0, width - 36), H = 320
  const m = { top: 20, right: 90, bottom: 30, left: 56 }
  const x = d3.scalePoint<number>().domain(data.map((d) => d.season)).range([m.left, W - m.right]).padding(0.3)
  const y = d3.scaleLinear().domain([0, (d3.max(data, (d) => Math.max(d.salary, d.fair_value)) ?? 1) * 1.1]).nice().range([H - m.bottom, m.top])
  const lineS = d3.line<any>().x((d) => x(d.season)!).y((d) => y(d.salary))
  const lineV = d3.line<any>().x((d) => x(d.season)!).y((d) => y(d.fair_value))
  const segs = data.slice(1).map((d, i) => [data[i], d])
  const last = data[data.length - 1]
  return (
    <div className="chart-frame" ref={box}>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span><i style={{ background: 'var(--under)' }} />Fair value</span>
        <span><i style={{ background: 'var(--text)' }} />Salary</span>
      </div>
      {W > 0 && (
        <svg ref={svg} className="chart" width={W} height={H} role="img" aria-label="Career fair value versus salary"
          onPointerMove={(e) => {
            const rect = svg.current!.getBoundingClientRect()
            const px = e.clientX - rect.left
            const d = d3.least(data, (r) => Math.abs(x(r.season)! - px))
            if (!d) return
            setHover(d)
            tip.show(e, <><div className="tt-name">{d.label} · {d.team}</div><div className="tt-sub">age {d.age} · {d.games} games · {d.contract_type}</div>
              <TipRows rows={[['Salary', money(d.salary)], ['Fair value', money(d.fair_value)], ['Surplus', signedMoney(d.surplus)], ['WAR (82 g)', num(d.war82, 1)]]} /></>)
          }}
          onPointerLeave={() => { setHover(null); tip.hide() }}>
          <g className="grid">{y.ticks(4).map((t) => <line key={t} x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />)}</g>
          {y.ticks(4).map((t) => <text key={t} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{money(t, 0)}</text>)}
          {data.map((d, i) => (i % Math.ceil(data.length / 8) === 0 || i === data.length - 1) && <text key={d.season} x={x(d.season)} y={H - 8} textAnchor="middle">{d.label}</text>)}
          {segs.map(([a, b], i) => {
            // shade the gap between the two lines, colored by sign at the segment start
            const pts = `${x(a.season)},${y(a.fair_value)} ${x(b.season)},${y(b.fair_value)} ${x(b.season)},${y(b.salary)} ${x(a.season)},${y(a.salary)}`
            const under = (a.surplus + b.surplus) / 2 > 0
            return <polygon key={i} className="gap" points={pts} fill={under ? 'rgba(232,104,31,.22)' : 'rgba(61,143,232,.22)'} />
          })}
          <path className="ln" d={lineS(data) ?? ''} fill="none" stroke="var(--text)" strokeWidth={2} />
          <path className="ln" d={lineV(data) ?? ''} fill="none" stroke="var(--under)" strokeWidth={2.4} />
          {data.map((d) => <circle key={d.season} cx={x(d.season)} cy={y(d.fair_value)} r={4} fill="var(--under)" stroke="var(--surface)" strokeWidth={2} />)}
          <text x={x(last.season)! + 10} y={y(last.fair_value)} dy="0.32em" className="label-strong" style={{ fill: 'var(--under)' }}>Value {money(last.fair_value, 0)}</text>
          <text x={x(last.season)! + 10} y={y(last.salary) + (Math.abs(y(last.salary) - y(last.fair_value)) < 16 ? 16 : 0)} dy="0.32em" className="label-strong">Pay {money(last.salary, 0)}</text>
          {hover && <line x1={x(hover.season)} x2={x(hover.season)} y1={m.top} y2={H - m.bottom} stroke="var(--text-2)" />}
        </svg>
      )}
    </div>
  )
}

function ProjectionChart({ projection, contract }: { projection: any[]; contract: any[] }) {
  const [box, { width }] = useSize<HTMLDivElement>()
  const tip = useTooltip()
  const W = Math.max(0, width - 36), H = 280
  const m = { top: 20, right: 24, bottom: 30, left: 56 }
  const seasons = projection.map((p) => p.season)
  const x = d3.scalePoint<number>().domain(seasons).range([m.left, W - m.right]).padding(0.4)
  const contractBy = new Map(contract.map((c) => [c.season, c.salary]))
  const ymax = d3.max([...projection.map((p) => p.value_p90), ...contract.map((c) => c.salary)]) ?? 1
  const y = d3.scaleLinear().domain([0, ymax * 1.1]).nice().range([H - m.bottom, m.top])
  const band = d3.area<any>().x((d) => x(d.season)!).y0((d) => y(d.value_p10)).y1((d) => y(d.value_p90)).curve(d3.curveMonotoneX)
  const med = d3.line<any>().x((d) => x(d.season)!).y((d) => y(d.value_p50)).curve(d3.curveMonotoneX)
  const bw = Math.min(46, (W - m.left - m.right) / seasons.length / 3)
  return (
    <div className="chart-frame" ref={box}>
      <div className="legend" style={{ marginBottom: 6 }}>
        <span><i style={{ background: 'var(--under)' }} />Projected value (median)</span>
        <span><i style={{ background: 'rgba(232,104,31,.25)' }} />80% range</span>
        <span><i style={{ background: 'var(--text-2)' }} />Contract salary</span>
      </div>
      {W > 0 && (
        <svg className="chart" width={W} height={H} role="img" aria-label="Projected value versus contract">
          <g className="grid">{y.ticks(4).map((t) => <line key={t} x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />)}</g>
          {y.ticks(4).map((t) => <text key={t} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{money(t, 0)}</text>)}
          {projection.map((p) => <text key={p.season} x={x(p.season)} y={H - 8} textAnchor="middle">{p.label}</text>)}
          {projection.map((p) => contractBy.has(p.season) && (
            <rect key={p.season} x={x(p.season)! - bw / 2} y={y(contractBy.get(p.season)!)} width={bw} height={y(0) - y(contractBy.get(p.season)!)} rx={4} fill="var(--line-2)" />
          ))}
          <path d={band(projection) ?? ''} fill="rgba(232,104,31,.22)" />
          <path d={med(projection) ?? ''} fill="none" stroke="var(--under)" strokeWidth={2.4} />
          {projection.map((p) => (
            <g key={p.season} onPointerMove={(e) => tip.show(e, <><div className="tt-name">{p.label}</div>
              <TipRows rows={[['Projected value', money(p.value_p50)], ['80% range', `${money(p.value_p10, 0)}–${money(p.value_p90, 0)}`], ['Projected WAR', num(p.war_p50, 1)], ['Contract', contractBy.has(p.season) ? money(contractBy.get(p.season)) : 'not under contract']]} /></>)}
              onPointerLeave={tip.hide}>
              <rect x={x(p.season)! - 40} y={m.top} width={80} height={H - m.top - m.bottom} fill="transparent" />
              <circle cx={x(p.season)} cy={y(p.value_p50)} r={5} fill="var(--under)" stroke="var(--surface)" strokeWidth={2} />
            </g>
          ))}
          {projection.length > 0 && <text x={x(projection[0].season)! + 10} y={y(projection[0].value_p50) - 12} className="label-strong">{money(projection[0].value_p50, 0)}</text>}
        </svg>
      )}
      {contract.length === 0 && <div className="muted" style={{ fontSize: 13 }}>No contract on record beyond this season: he would be a free agent.</div>}
    </div>
  )
}

function GameStrip({ games }: { games: any[] }) {
  const tip = useTooltip()
  const maxMin = d3.max(games, (g) => g.minutes ?? 0) || 40
  const shade = d3.scaleLinear<string>().domain([0, maxMin]).range(['#5a3418', '#ff9a52'])
  return (
    <div className="game-strip" role="img" aria-label="Game-by-game availability">
      {games.map((g, i) => (
        <div key={i} className={`game-cell ${g.played ? '' : 'missed'} ${g.is_b2b_second ? 'b2b' : ''}`}
          style={g.played ? { background: shade(g.minutes ?? 0) } : undefined}
          onPointerMove={(e) => tip.show(e, <><div className="tt-name">{new Date(g.game_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · {g.is_home ? 'vs' : '@'} {g.opp}</div>
            <div className="tt-sub">{g.result ?? ''}{g.is_b2b_second ? ' · back-to-back' : ''}</div>
            <TipRows rows={g.played ? [['Minutes', String(g.minutes ?? '—')], ['Points', String(g.pts ?? '—')], ['Reb / Ast', `${g.reb ?? '—'} / ${g.ast ?? '—'}`]] : [['Status', 'Did not play']]} /></>)}
          onPointerLeave={tip.hide} />
      ))}
    </div>
  )
}
