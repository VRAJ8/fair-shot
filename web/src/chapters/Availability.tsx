// 4th quarter (part 2) and overtime: the 65-game rule, and how long careers last.
import { useGSAP } from '@gsap/react'
import * as d3 from 'd3'
import { useMemo, useRef } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChapterHead, Reveal } from '../components/ui'
import { label } from '../lib/data'
import { num, pct } from '../lib/format'
import { gsap, reducedMotion } from '../lib/motion'
import { TipRows, useTooltip } from '../lib/tooltip'
import { useSize } from './useSize'

export function SixtyFive({ stories }: { stories: any }) {
  const s = stories?.sixty_five
  const [box, { width }] = useSize<HTMLDivElement>()
  const svg = useRef<SVGSVGElement>(null)
  const tip = useTooltip()
  const nav = useNavigate()
  const seasons: number[] = s ? [...s.pre_seasons, ...s.post_seasons] : []
  const W = Math.max(0, width - 36), H = 380
  const m = { top: 24, right: 16, bottom: 34, left: 40 }
  const x = d3.scaleBand<number>().domain(seasons).range([m.left, W - m.right]).padding(0.18)
  const y = d3.scaleLinear().domain([0, 82]).range([H - m.bottom, m.top])
  const dots = useMemo(() => {
    if (!s) return []
    const rnd = d3.randomLcg(7)
    return s.stars.map((d: any) => ({ ...d, jitter: (rnd() - 0.5) * 0.8, post: s.post_seasons.includes(d.season) }))
  }, [s])
  useGSAP(() => {
    if (!svg.current || reducedMotion || !W) return
    gsap.from(svg.current.querySelectorAll('.star'), {
      attr: { cy: y(0) }, opacity: 0, duration: 0.9, ease: 'power3.out', stagger: { amount: 1.2, from: 'start' },
      scrollTrigger: { trigger: svg.current, start: 'top 75%' },
    })
  }, { dependencies: [W > 0], scope: svg })
  if (!s) return null
  const mean = (g: string, p: string, k: string) => s.means.find((r: any) => r.group === g && r.period === p)?.[k]
  const medians = seasons.map((season) => ({ season, med: d3.median(dots.filter((d: any) => d.season === season), (d: any) => d.games as number) ?? 0 }))
  const ci = (a: number[]) => `${(a[0] * 100).toFixed(1)} to ${(a[1] * 100).toFixed(1)} pts`
  return (
    <section className="chapter" id="sixtyfive">
      <div className="wrap">
        <ChapterHead quarter="4th Quarter · continued" title="65 and done?">
          Since 2023–24, the CBA has required <b>65 games</b> to win MVP, All-NBA or most other awards. The goal was to
          get stars on the floor. Did it work? We compare the league's top 40 players (ranked on the prior season)
          against the next tier down, before and after the rule.
        </ChapterHead>
        <div className="chart-frame" ref={box}>
          <div className="legend" style={{ marginBottom: 6 }}>
            <span><i style={{ background: '#8a8476', borderRadius: '50%' }} />Star season, before the rule</span>
            <span><i style={{ background: 'var(--orange)', borderRadius: '50%' }} />Star season, rule in force</span>
            <span><i style={{ background: 'var(--text)', height: 3 }} />Median</span>
          </div>
          {W > 0 && (
            <svg ref={svg} className="chart" width={W} height={H} role="img" aria-label="Games played by top-40 players by season">
              <g className="grid">{[20, 41, 65, 82].map((t) => <line key={t} x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />)}</g>
              {[0, 20, 41, 65, 82].map((t) => <text key={t} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{t}</text>)}
              <line x1={m.left} x2={W - m.right} y1={y(65)} y2={y(65)} stroke="var(--orange)" strokeWidth={1.5} />
              <text x={W - m.right} y={y(65) - 6} textAnchor="end" className="label-strong" style={{ fill: 'var(--orange)' }}>65-game line</text>
              {seasons.map((season) => (
                <text key={season} x={(x(season) ?? 0) + x.bandwidth() / 2} y={H - 10} textAnchor="middle" style={{ fontSize: 11 }}>
                  {W < 640 ? String(season).slice(2) : label(season)}
                </text>
              ))}
              {s.post_seasons.length > 0 && (
                <rect x={(x(s.post_seasons[0]) ?? 0) - 4} y={m.top} width={W - m.right - (x(s.post_seasons[0]) ?? 0) + 4} height={H - m.top - m.bottom} fill="rgba(232,104,31,.06)" />
              )}
              {dots.map((d: any, i: number) => (
                <circle key={i} className="star" cx={(x(d.season) ?? 0) + x.bandwidth() / 2 + d.jitter * x.bandwidth()} cy={y(d.games)} r={4.5}
                  fill={d.post ? 'var(--orange)' : '#8a8476'} stroke="var(--surface)" strokeWidth={1.5} style={{ cursor: 'pointer' }}
                  onPointerMove={(e) => tip.show(e, <><div className="tt-name">{d.player_name}</div><div className="tt-sub">{label(d.season)} · ranked #{Math.round(d.prior_rank)} the season before</div>
                    <TipRows rows={[['Games played', String(d.games)]]} /></>)}
                  onPointerLeave={tip.hide} onClick={() => nav(`/player/${d.player_id}`)} />
              ))}
              {medians.map((md) => <line key={md.season} x1={x(md.season) ?? 0} x2={(x(md.season) ?? 0) + x.bandwidth()} y1={y(md.med)} y2={y(md.med)} stroke="var(--text)" strokeWidth={3} strokeLinecap="round" />)}
            </svg>
          )}
        </div>
        <div className="grid grid-3" style={{ marginTop: 20 }}>
          <Reveal><div className="card"><div className="kicker">Stars · share of games played</div>
            <div className="stat-val" style={{ marginTop: 8 }}>{pct(mean('stars', 'pre', 'games_share'), 0)} → {pct(mean('stars', 'post', 'games_share'), 0)}</div>
            <div className="stat-lbl">before → after the rule</div></div></Reveal>
          <Reveal delay={0.1}><div className="card"><div className="kicker">Next tier (ranks 61–200)</div>
            <div className="stat-val" style={{ marginTop: 8 }}>{pct(mean('control', 'pre', 'games_share'), 0)} → {pct(mean('control', 'post', 'games_share'), 0)}</div>
            <div className="stat-lbl">same seasons, no award at stake</div></div></Reveal>
          <Reveal delay={0.2}><div className="card" style={{ borderColor: 'var(--line-2)' }}><div className="kicker">Effect of the rule (difference-in-differences)</div>
            <div className="stat-val" style={{ marginTop: 8 }}>{s.did_games_share > 0 ? '+' : ''}{num(s.did_games_share * 100, 1)} pts</div>
            <div className="stat-lbl">95% CI {ci(s.did_games_share_ci)}. <b>No detectable effect:</b> availability fell for stars and non-stars alike.</div></div></Reveal>
        </div>
        <p className="dim" style={{ maxWidth: 820, marginTop: 20, fontSize: 14.5 }}>
          Read it from the players' side: if a rule ties awards (and the supermax contracts that depend on them) to games
          played, but games played is driven by injuries rather than effort, the rule mostly <b>penalizes injured
          players</b>. Pre-rule seasons: {s.pre_seasons.map(label).join(', ')} (lockout and COVID seasons excluded).
        </p>
      </div>
    </section>
  )
}

const GROUP_COLORS = ['#c3dcfa', '#8dbcf5', '#5b9cec', '#3d7fd0', '#2f5f9e']

export function CareerClock({ stories }: { stories: any }) {
  const sv = stories?.survival
  const [box, { width }] = useSize<HTMLDivElement>()
  const svg = useRef<SVGSVGElement>(null)
  const tip = useTooltip()
  useGSAP(() => {
    if (!svg.current || reducedMotion || !width) return
    gsap.from(svg.current.querySelectorAll('.km'), {
      drawSVG: '0%', duration: 2.2, ease: 'power2.inOut', stagger: 0.25,
      scrollTrigger: { trigger: svg.current, start: 'top 70%' },
    })
  }, { dependencies: [width > 0, !!sv], scope: svg })
  if (!sv?.groups) return (
    <section className="chapter" id="career"><div className="wrap">
      <ChapterHead quarter="Overtime" title="The career clock">Draft and career data are still loading into the warehouse.</ChapterHead>
    </div></section>
  )
  const W = Math.max(0, width - 36), H = 400
  const m = { top: 20, right: W > 700 ? 150 : 20, bottom: 36, left: 44 }
  const maxT = 16
  const x = d3.scaleLinear().domain([1, maxT]).range([m.left, W - m.right])
  const y = d3.scaleLinear().domain([0, 1]).range([H - m.bottom, m.top])
  const line = d3.line<any>().x((d) => x(d.t)).y((d) => y(d.s)).curve(d3.curveStepAfter)
  // End labels: nudge apart so close curves don't print on top of each other.
  const ends = sv.groups.map((g: any, i: number) => {
    const pts = g.curve.filter((d: any) => d.t <= maxT)
    return { i, y: y(pts[pts.length - 1].s) }
  }).sort((a: any, b: any) => a.y - b.y)
  for (let k = 1; k < ends.length; k++) ends[k].y = Math.max(ends[k].y, ends[k - 1].y + 15)
  const labelY = new Map(ends.map((e: any) => [e.i, e.y]))
  return (
    <section className="chapter" id="career">
      <div className="wrap">
        <ChapterHead quarter="Overtime" title="The career clock">
          Everything above assumes a player gets to cash in. Most don't stay long. Here is the share of players still in the
          league after <i>n</i> seasons, by where they were drafted (Kaplan–Meier survival curves on {sv.n_players.toLocaleString()} players: everyone drafted {sv.first_draft}–{sv.last_draft}, plus undrafted players who debuted in that window; active careers are censored).
        </ChapterHead>
        <div className="chart-frame" ref={box}>
          <div className="legend" style={{ marginBottom: 6 }}>
            {sv.groups.map((g: any, i: number) => <span key={g.name}><i style={{ background: GROUP_COLORS[i] }} />{g.name} · median {g.median ? `${g.median} seasons` : 'n/a'}</span>)}
          </div>
          {W > 0 && (
            <svg ref={svg} className="chart" width={W} height={H} role="img" aria-label="Career survival curves by draft position">
              <g className="grid">{[0.25, 0.5, 0.75, 1].map((t) => <line key={t} x1={m.left} x2={W - m.right} y1={y(t)} y2={y(t)} />)}</g>
              {[0, 0.25, 0.5, 0.75, 1].map((t) => <text key={t} x={m.left - 8} y={y(t)} dy="0.32em" textAnchor="end">{pct(t, 0)}</text>)}
              {[1, 4, 8, 12, 16].map((t) => <text key={t} x={x(t)} y={H - 14} textAnchor="middle">{t}</text>)}
              <text className="axis-title" x={W - m.right} y={H - 0} textAnchor="end">Seasons in the NBA →</text>
              <line x1={m.left} x2={W - m.right} y1={y(0.5)} y2={y(0.5)} stroke="var(--text-2)" strokeWidth={1} />
              {sv.groups.map((g: any, i: number) => {
                const pts = g.curve.filter((d: any) => d.t <= maxT)
                const last = pts[pts.length - 1]
                return (
                  <g key={g.name} onPointerMove={(e) => tip.show(e, <><div className="tt-name">{g.name}</div><div className="tt-sub">{g.n} players</div>
                    <TipRows rows={[4, 8, 12].map((t) => [`After ${t} seasons`, pct(pts.find((d: any) => d.t >= t)?.s ?? last.s, 0)])} /></>)}
                    onPointerLeave={tip.hide}>
                    <path d={line(pts) ?? ''} fill="none" stroke="transparent" strokeWidth={14} />
                    <path className="km" d={line(pts) ?? ''} fill="none" stroke={GROUP_COLORS[i]} strokeWidth={2.2} />
                    {W > 700 && <text x={W - m.right + 8} y={labelY.get(i) as number} dy="0.32em" className="label-strong" style={{ fontSize: 11.5 }}>{g.name}</text>}
                  </g>
                )
              })}
            </svg>
          )}
        </div>
        <p className="dim" style={{ maxWidth: 820, marginTop: 18, fontSize: 14.5 }}>
          Log-rank test across groups: p {sv.logrank_p < 0.001 ? '< 0.001' : `= ${sv.logrank_p.toFixed(3)}`}. For a second-round pick,
          the second contract is the whole ballgame, and that contract is priced by exactly the kind of value model this project builds.
        </p>
      </div>
    </section>
  )
}
