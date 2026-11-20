// How it's built: the pipeline, the data-quality checks, and model validation.
import { useGSAP } from '@gsap/react'
import { useRef } from 'react'
import { ChapterHead, Reveal } from '../components/ui'
import { useData, type Meta } from '../lib/data'
import { int, num, pct } from '../lib/format'
import { gsap, reducedMotion } from '../lib/motion'

const STAGES = [
  { t: 'Sources', d: 'Basketball-Reference (stats, payrolls, schedules, drafts) + ESPN API (game logs, second source)' },
  { t: 'Raw cache', d: 'Polite, rate-limited downloader; every response cached on disk' },
  { t: 'DuckDB · raw', d: 'Parsers load ~20 raw tables, source column names kept' },
  { t: 'Staging SQL', d: 'Typed, de-duplicated, one grain per table; trades, waivers, neutral sites' },
  { t: 'ID crosswalk', d: 'Fuzzy name + team + games matching joins ESPN to BBRef' },
  { t: 'Models', d: 'Fair value · 3-yr projection · comps · DiD · survival' },
  { t: 'Tests', d: 'Uniqueness, ranges, cross-source reconciliation' },
  { t: 'Site + agent', d: 'JSON export → React/D3/GSAP/Three.js; LLM agent (Gemini or Claude) on the warehouse' },
]

export default function Methods() {
  const meta = useData<Meta>('meta.json')
  const q = useData<any>('quality.json')
  const ref = useRef<HTMLDivElement>(null)
  useGSAP(() => {
    if (reducedMotion) return
    gsap.from('.stage', { opacity: 0, y: 30, stagger: 0.08, duration: 0.7, ease: 'power3.out', scrollTrigger: { trigger: '.pipeline', start: 'top 80%' } })
    gsap.from('.pipe-line', { drawSVG: '0%', duration: 1.6, ease: 'power2.inOut', scrollTrigger: { trigger: '.pipeline', start: 'top 80%' } })
  }, { scope: ref, dependencies: [!!meta] })
  const pm = meta?.projection_metrics?.metrics
  return (
    <div className="wrap" style={{ paddingTop: 110 }} ref={ref}>
      <ChapterHead quarter="Behind the scoreboard" title="How it's built">
        Every number on this site comes from a reproducible pipeline: collected from two independent sources, reconciled,
        tested, modeled and exported. Here is the whole path, and the checks it has to pass.
      </ChapterHead>

      <div className="pipeline" style={{ position: 'relative', marginBottom: 56 }}>
        <svg style={{ position: 'absolute', left: 0, right: 0, top: 48, width: '100%', height: 4 }} preserveAspectRatio="none" viewBox="0 0 100 4" aria-hidden>
          <line className="pipe-line" x1="0" y1="2" x2="100" y2="2" stroke="var(--orange)" strokeWidth="0.6" />
        </svg>
        <div className="grid grid-4" style={{ position: 'relative' }}>
          {STAGES.map((s, i) => (
            <div className="card stage" key={s.t}>
              <div className="kicker" style={{ color: 'var(--orange)' }}>Step {i + 1}</div>
              <div style={{ fontWeight: 700, fontSize: 17, margin: '4px 0' }}>{s.t}</div>
              <div className="dim" style={{ fontSize: 13.5 }}>{s.d}</div>
            </div>
          ))}
        </div>
      </div>

      <h2 className="section-title">The fair-value model</h2>
      <div className="grid grid-2" style={{ marginBottom: 48 }}>
        <div className="card dim" style={{ fontSize: 15 }}>
          <p style={{ marginTop: 0 }}><b style={{ color: 'var(--text)' }}>Wins over replacement (WAR)</b> = 2.7 × VORP, Basketball-Reference's box-score estimate of wins above a freely available player, scaled to 82 games for shortened seasons.</p>
          <p><b style={{ color: 'var(--text)' }}>Replacement price</b> = the rookie-minimum salary, estimated from the data as the most common salary in the 0.6–1.0% of cap band.</p>
          <p><b style={{ color: 'var(--text)' }}>Price of a win</b> = total salary above the minimum ÷ total positive WAR, for every player with both a salary and a stat line that season.</p>
          <p style={{ marginBottom: 0 }}><b style={{ color: 'var(--text)' }}>Fair value</b> = replacement price + WAR × price of a win. It measures production at market prices. It does not include marketing value, playoff performance or defense that box scores miss.</p>
        </div>
        <div className="card">
          <div className="kicker">Market price of one win, by season</div>
          <table className="tbl" style={{ marginTop: 8 }}>
            <thead><tr><th>Season</th><th className="num">Cap</th><th className="num">Minimum</th><th className="num">$ / win</th></tr></thead>
            <tbody>{meta?.market.map((m) => (
              <tr key={m.season}><td>{meta.labels[m.season]}</td><td className="num">${(m.salary_cap / 1e6).toFixed(1)}M</td>
                <td className="num">${(m.replacement_salary / 1e6).toFixed(2)}M</td><td className="num">${(m.dollars_per_war / 1e6).toFixed(2)}M</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>

      {pm && (
        <>
          <h2 className="section-title">Projection model, validated out of time</h2>
          <p className="dim" style={{ marginTop: 0, maxWidth: 820 }}>
            Gradient-boosted quantile regression predicts WAR one, two and three seasons ahead (players who leave the league
            count as zero). Trained on targets through 2021–22, tested on 2022–23 to 2025–26. Intervals are widened with
            conformalized quantile regression so the 80% range holds about 80% of outcomes.
          </p>
          <div className="card" style={{ padding: 0, overflowX: 'auto', marginBottom: 48 }}>
            <table className="tbl">
              <thead><tr><th>Horizon</th><th className="num">Test player-seasons</th><th className="num">MAE: model</th><th className="num">MAE: Marcel-style</th><th className="num">MAE: repeat last season</th><th className="num">R²</th><th className="num">80% interval coverage</th></tr></thead>
              <tbody>{Object.entries(pm).map(([h, m]: any) => (
                <tr key={h}><td>{h.replace('h', '')} season{h === 'h1' ? '' : 's'} ahead</td><td className="num">{int(m.n_test)}</td>
                  <td className="num" style={{ color: 'var(--under)', fontWeight: 700 }}>{num(m.mae_model, 2)}</td><td className="num">{num(m.mae_marcel, 2)}</td>
                  <td className="num">{num(m.mae_last_season, 2)}</td><td className="num">{num(m.r2_model, 2)}</td><td className="num">{pct(m.interval_coverage_80, 0)}</td></tr>
              ))}</tbody>
            </table>
          </div>
        </>
      )}

      <h2 className="section-title">Data-quality checks</h2>
      <p className="dim" style={{ marginTop: 0, maxWidth: 820 }}>Run on every pipeline build. A failed check stops the export.</p>
      {q ? (
        <>
          <div className="grid grid-4" style={{ marginBottom: 16 }}>
            <Reveal><div className="card"><div className="stat-val">{q.summary.passed}/{q.summary.total}</div><div className="stat-lbl">checks passing</div></div></Reveal>
            <Reveal delay={0.05}><div className="card"><div className="stat-val">{pct(q.reconciliation.match_rate, 2)}</div><div className="stat-lbl">ESPN player-seasons matched to a BBRef ID</div></div></Reveal>
            <Reveal delay={0.1}><div className="card"><div className="stat-val">{pct(q.reconciliation.games_agree, 1)}</div><div className="stat-lbl">matched seasons where both sources agree on games played</div></div></Reveal>
            <Reveal delay={0.15}><div className="card"><div className="stat-val">{int(q.reconciliation.salary_rows_resolved)}</div><div className="stat-lbl">duplicate payroll rows resolved (trades, waivers, two-way)</div></div></Reveal>
          </div>
          {q.reconciliation.gamelogs?.rows && (
            <div className="card" style={{ marginBottom: 16 }}>
              <div className="kicker">Reconciling ESPN game logs against the official schedule</div>
              <p className="dim" style={{ margin: '8px 0 10px', fontSize: 14.5 }}>
                ESPN's per-player game logs are labeled "regular season" but also contain games that do not count toward it.
                Each log row is matched to a Basketball-Reference regular-season game by team and US-Eastern date;
                {' '}<b style={{ color: 'var(--text)' }}>{int(q.reconciliation.gamelogs.kept)} of {int(q.reconciliation.gamelogs.rows)}</b> rows match.
                Every row that doesn't is explained:
              </p>
              <div className="controls">
                {Object.entries(q.reconciliation.gamelogs.dropped_by_type).map(([k, v]: any) => {
                  const [season, type] = k.split(':')
                  const labels: Record<string, string> = { 'play-in': 'play-in games', 'cup-final': 'NBA Cup final', 'all-star game': 'All-Star Game', scheduled: 'played after our schedule snapshot' }
                  return <span className="pill" key={k}>{int(v)} · {labels[type] ?? type} ({meta?.labels[season] ?? season})</span>
                })}
              </div>
            </div>
          )}
          <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
            <table className="tbl">
              <thead><tr><th>Check</th><th>Table</th><th className="num">Failing rows</th><th>Status</th></tr></thead>
              <tbody>{q.checks.map((c: any) => (
                <tr key={c.name}><td>{c.name}</td><td className="mono" style={{ fontSize: 12 }}>{c.table}</td><td className="num">{int(c.failing)}</td>
                  <td><span className={`pill ${c.passed ? '' : 'over'}`} style={c.passed ? { color: '#5cd65c' } : undefined}>{c.passed ? '✓ pass' : c.severity === 'warn' ? '! warn' : '✕ fail'}</span></td></tr>
              ))}</tbody>
            </table>
          </div>
          {q.discrepancies?.length > 0 && (
            <>
              <h3 style={{ marginTop: 32 }}>Largest cross-source discrepancies (games played)</h3>
              <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
                <table className="tbl">
                  <thead><tr><th>Player</th><th>Season</th><th className="num">BBRef</th><th className="num">ESPN</th><th>Resolution</th></tr></thead>
                  <tbody>{q.discrepancies.map((d: any, i: number) => (
                    <tr key={i}><td>{d.player_name}</td><td>{meta?.labels[d.season] ?? d.season}</td><td className="num">{d.bbref_games}</td><td className="num">{d.espn_games}</td><td className="dim" style={{ fontSize: 13 }}>{d.resolution}</td></tr>
                  ))}</tbody>
                </table>
              </div>
            </>
          )}
        </>
      ) : <div className="card muted">Run <code className="mono">python -m pipeline.validate</code> to produce the quality report.</div>}

      <h2 className="section-title" style={{ marginTop: 48 }}>Sources & limits</h2>
      <div className="card dim" style={{ fontSize: 14.5 }}>
        Stats, payrolls, schedules and draft data: Basketball-Reference.com (Sports Reference LLC). Game logs and the second
        stats source: ESPN's public API. Salaries are as listed on team payroll pages and can miss incentives, cap holds and
        dead money. Box-score value models undervalue some defensive roles. This is an independent portfolio project, not
        affiliated with the NBA, the NBPA, or any team.
      </div>
    </div>
  )
}
