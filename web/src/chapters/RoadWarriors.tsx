// 4th quarter (part 1): the schedule. Scroll to fly one team's whole season.
import { useGSAP } from '@gsap/react'
import * as d3 from 'd3'
import { useMemo, useRef, useState } from 'react'
import { feature } from 'topojson-client'
import us from 'us-atlas/states-10m.json'
import { ChapterHead } from '../components/ui'
import { label, useData, type Team } from '../lib/data'
import { int, num } from '../lib/format'
import { gsap, reducedMotion, ScrollTrigger } from '../lib/motion'
import { TipRows, useTooltip } from '../lib/tooltip'
import { useSize } from './useSize'

const SKIP = new Set(['02', '15', '60', '66', '69', '72', '78'])
const states = (feature(us as any, (us as any).objects.states) as any).features.filter((f: any) => !SKIP.has(String(f.id)))

type Leg = { game_date: string; opp: string; is_home: boolean; city: string; lat: number; lon: number; travel_miles: number; is_b2b_second: boolean }

export default function RoadWarriors({ stories, season }: { stories: any; season: number }) {
  const travel = useData<Record<string, Leg[]>>('travel.json')
  const teams = useData<Team[]>('teams.json')
  const sched = stories?.schedule
  const teamRows = (sched?.teams_latest ?? []) as any[]
  const [team, setTeam] = useState<string | null>(null)
  const sel = team ?? teamRows[0]?.team ?? 'POR'
  const pin = useRef<HTMLDivElement>(null)
  const [box, { width }] = useSize<HTMLDivElement>()
  const svg = useRef<SVGSVGElement>(null)
  const odo = useRef<HTMLSpanElement>(null)
  const when = useRef<HTMLSpanElement>(null)
  const legs = travel?.[sel] ?? []
  const W = Math.max(0, width)
  const H = Math.max(260, Math.min(560, W * 0.62))
  const projection = useMemo(() => d3.geoAlbers().rotate([96, 0]).center([-0.6, 38.7]).parallels([29.5, 45.5])
    .fitExtent([[10, 10], [W - 10, H - 10]], { type: 'FeatureCollection', features: states } as any), [W, H])
  const path = d3.geoPath(projection)
  const arcs = useMemo(() => {
    const out: { d: string; leg: Leg; miles: number; cum: number }[] = []
    let cum = 0
    for (let i = 0; i < legs.length; i++) {
      const cur = legs[i]
      const prev = i ? legs[i - 1] : null
      const home = teams?.find((t) => t.code === sel)
      const from = prev ? [prev.lon, prev.lat] : home ? [home.lon, home.lat] : [cur.lon, cur.lat]
      const a = projection(from as [number, number]), b = projection([cur.lon, cur.lat])
      cum += cur.travel_miles || 0
      if (!a || !b || (cur.travel_miles ?? 0) < 5) { out.push({ d: '', leg: cur, miles: 0, cum }); continue }
      const mx = (a[0] + b[0]) / 2, my = (a[1] + b[1]) / 2
      const dx = b[0] - a[0], dy = b[1] - a[1]
      const lift = Math.min(90, Math.hypot(dx, dy) * 0.28)
      const nx = -dy / (Math.hypot(dx, dy) || 1), ny = dx / (Math.hypot(dx, dy) || 1)
      out.push({ d: `M${a[0]},${a[1]} Q${mx + nx * lift},${my + ny * lift} ${b[0]},${b[1]}`, leg: cur, miles: cur.travel_miles, cum })
    }
    return out
  }, [legs, projection, teams, sel])

  // Scroll-scrubbed season: arcs draw one by one, the odometer counts miles.
  useGSAP(() => {
    if (!svg.current || !pin.current || !arcs.length) return
    const paths = Array.from(svg.current.querySelectorAll<SVGPathElement>('.leg'))
    const lens = paths.map((p) => p.getTotalLength() || 0)
    paths.forEach((p, i) => { p.style.strokeDasharray = `${lens[i]}`; p.style.strokeDashoffset = reducedMotion ? '0' : `${lens[i]}` })
    const total = arcs.length
    const update = (prog: number) => {
      const f = prog * total
      const n = Math.floor(f)
      paths.forEach((p, i) => {
        const k = i < n ? 1 : i === n ? f - n : 0
        p.style.strokeDashoffset = `${lens[i] * (1 - k)}`
        p.style.opacity = i === n ? '1' : i < n ? '0.38' : '0'
      })
      const leg = arcs[Math.min(total - 1, Math.max(0, n))]
      if (odo.current) odo.current.textContent = int(leg ? leg.cum : 0)
      if (when.current && leg) {
        const d = new Date(leg.leg.game_date)
        when.current.textContent = `${d.toLocaleDateString('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' })} · ${leg.leg.is_home ? 'vs' : '@'} ${leg.leg.opp} · ${leg.leg.city}${leg.leg.is_b2b_second ? ' · back-to-back' : ''}`
      }
    }
    if (reducedMotion) { update(1); return }
    const st = ScrollTrigger.create({
      trigger: pin.current, start: 'top top', end: '+=220%', pin: true, scrub: 0.5,
      onUpdate: (s) => update(s.progress),
    })
    update(st.progress)
    return () => st.kill()
  }, { dependencies: [arcs, W], scope: pin, revertOnUpdate: true })

  const sel_row = teamRows.find((r) => r.team === sel)
  const league = (sched?.league ?? []) as any[]
  return (
    <section className="chapter" id="road">
      <div className="wrap">
        <ChapterHead quarter="4th Quarter" title="Road warriors">
          Value depends on availability, and availability depends on the schedule. Pick a team and <b>scroll to fly its
          entire {label(season)} season</b>, game by game.
        </ChapterHead>
      </div>
      <div ref={pin} style={{ minHeight: '100vh', display: 'flex', alignItems: 'center' }}>
        <div className="wrap" style={{ paddingTop: 70 }}>
          <div className="controls">
            <select className="select" value={sel} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
              {teamRows.map((r) => <option key={r.team} value={r.team}>{teams?.find((t) => t.code === r.team)?.name ?? r.team} · {int(r.miles)} mi</option>)}
            </select>
            <span className="dim" style={{ fontSize: 13 }} ref={when}>Scroll to start the season</span>
          </div>
          <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 3fr) minmax(220px, 1fr)', gap: 20 }}>
            <div className="chart-frame" ref={box} style={{ padding: 0, overflow: 'hidden' }}>
              {W > 0 && (
                <svg ref={svg} className="chart" width={W} height={H} role="img" aria-label={`Flight map of ${sel}'s season`}>
                  <g>{states.map((f: any) => <path key={f.id} d={path(f) ?? ''} fill="#141822" stroke="#262c3a" strokeWidth={0.7} />)}</g>
                  {teams?.map((t) => {
                    const p = projection([t.lon, t.lat])
                    return p && <circle key={t.code} cx={p[0]} cy={p[1]} r={t.code === sel ? 6 : 3} fill={t.code === sel ? 'var(--orange)' : '#5f5b53'} stroke="var(--surface)" strokeWidth={1.5} />
                  })}
                  {arcs.map((a, i) => a.d && <path key={i} className="leg" d={a.d} fill="none" stroke={a.leg.is_b2b_second ? '#ffb27a' : 'var(--orange)'} strokeWidth={a.leg.is_b2b_second ? 2.4 : 1.6} strokeLinecap="round" />)}
                </svg>
              )}
            </div>
            <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
              <div>
                <div className="kicker">Miles flown</div>
                <div style={{ fontFamily: 'var(--font-led)', fontWeight: 900, fontSize: 44, color: 'var(--led)', lineHeight: 1.1 }}><span ref={odo}>0</span></div>
                <div className="muted" style={{ fontSize: 12 }}>of {int(sel_row?.miles)} this season</div>
              </div>
              <div className="grid grid-2" style={{ gap: 10 }}>
                <div><div className="stat-val" style={{ fontSize: 32 }}>{sel_row?.b2b ?? '—'}</div><div className="stat-lbl">back-to-backs</div></div>
                <div><div className="stat-val" style={{ fontSize: 32 }}>{sel_row?.big_tz_jumps ?? '—'}</div><div className="stat-lbl">trips crossing 2+ time zones</div></div>
              </div>
              <div className="legend"><span><i style={{ background: 'var(--orange)' }} />Flight</span><span><i style={{ background: '#ffb27a' }} />Into a back-to-back</span></div>
              <TeamMiles rows={teamRows} sel={sel} onPick={setTeam} />
            </div>
          </div>
        </div>
      </div>
      {league.length > 3 && <div className="wrap" style={{ marginTop: 40 }}><B2BTrend league={league} /></div>}
    </section>
  )
}

function TeamMiles({ rows, sel, onPick }: { rows: any[]; sel: string; onPick: (t: string) => void }) {
  const max = d3.max(rows, (r) => r.miles as number) ?? 1
  return (
    <div style={{ display: 'grid', gap: 3, maxHeight: 260, overflowY: 'auto', paddingRight: 4 }} data-lenis-prevent>
      {rows.map((r) => (
        <button key={r.team} onClick={() => onPick(r.team)} style={{ display: 'grid', gridTemplateColumns: '38px 1fr 58px', gap: 8, alignItems: 'center', border: 0, background: 'none', padding: '2px 0', textAlign: 'left' }}>
          <span className="mono" style={{ fontSize: 11, color: r.team === sel ? 'var(--text)' : 'var(--muted)' }}>{r.team}</span>
          <span style={{ height: 6, borderRadius: 3, background: r.team === sel ? 'var(--orange)' : 'var(--line-2)', width: `${(100 * r.miles) / max}%` }} />
          <span className="mono" style={{ fontSize: 11, textAlign: 'right', color: 'var(--text-2)' }}>{(r.miles / 1000).toFixed(1)}k</span>
        </button>
      ))}
    </div>
  )
}

function B2BTrend({ league }: { league: any[] }) {
  const [box, { width }] = useSize<HTMLDivElement>()
  const tip = useTooltip()
  const W = Math.max(0, width - 36), H = 240
  const m = { top: 20, right: 20, bottom: 30, left: 40 }
  const data = league.filter((d) => d.season !== 2020 && d.season !== 2021 && d.season !== 2012)
  const x = d3.scaleLinear().domain(d3.extent(data, (d) => d.season as number) as [number, number]).range([m.left, W - m.right])
  const y = d3.scaleLinear().domain([0, (d3.max(data, (d) => d.b2b_per_82 as number) ?? 20) * 1.15]).nice().range([H - m.bottom, m.top])
  const line = d3.line<any>().x((d) => x(d.season)).y((d) => y(d.b2b_per_82)).curve(d3.curveMonotoneX)
  return (
    <div className="chart-frame" ref={box}>
      <div className="kicker">Back-to-backs per team, per 82 games (shortened seasons removed)</div>
      {W > 0 && (
        <svg className="chart" width={W} height={H} role="img" aria-label="Back-to-backs per team by season">
          <g className="grid">{y.ticks(4).map((t) => <line key={t} x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />)}</g>
          {y.ticks(4).map((t) => <text key={t} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>)}
          {data.map((d) => <text key={d.season} x={x(d.season)} y={H - 8} textAnchor="middle" style={{ fontSize: 11 }}>{String(d.season - 1).slice(2)}–{String(d.season).slice(2)}</text>)}
          <path d={line(data) ?? ''} fill="none" stroke="var(--orange)" strokeWidth={2} />
          {data.map((d) => (
            <circle key={d.season} cx={x(d.season)} cy={y(d.b2b_per_82)} r={4.5} fill="var(--orange)" stroke="var(--surface)" strokeWidth={2}
              onPointerMove={(e) => tip.show(e, <><div className="tt-name">{label(d.season)}</div><TipRows rows={[['Back-to-backs / team', num(d.b2b_per_82, 1)], ['Miles / team', int(d.miles_per_82)]]} /></>)}
              onPointerLeave={tip.hide} />
          ))}
          <text x={x(data[0].season) + 6} y={y(data[0].b2b_per_82) - 10} className="label-strong">{num(data[0].b2b_per_82, 1)}</text>
          <text x={x(data[data.length - 1].season) - 6} y={y(data[data.length - 1].b2b_per_82) - 10} textAnchor="end" className="label-strong">{num(data[data.length - 1].b2b_per_82, 1)}</text>
        </svg>
      )}
    </div>
  )
}
