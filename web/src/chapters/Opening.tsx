import { useGSAP } from '@gsap/react'
import { lazy, Suspense, useRef } from 'react'
import { Link } from 'react-router-dom'
import { ChapterHead, Counter } from '../components/ui'
import { label } from '../lib/data'
import { money, num } from '../lib/format'
import { gsap, reducedMotion, ScrollTrigger, SplitText } from '../lib/motion'

const Hero3D = lazy(() => import('../components/Hero3D'))

export function Tipoff() {
  const progress = useRef(0)
  const ref = useRef<HTMLElement>(null)
  useGSAP(() => {
    ScrollTrigger.create({
      trigger: ref.current, start: 'top top', end: 'bottom bottom', scrub: true,
      onUpdate: (s) => { progress.current = s.progress },
    })
    if (reducedMotion) return
    const split = SplitText.create('.hero-title', {
      type: 'chars', charsClass: 'char', autoSplit: true,
      onSplit: (self) => gsap.from(self.chars, { yPercent: 120, rotate: 6, opacity: 0, stagger: 0.045, duration: 1.1, ease: 'back.out(1.6)', delay: 1.5 }),
    })
    gsap.from('.hero-sub, .hero-kicker', { opacity: 0, y: 24, duration: 1, delay: 2.1, stagger: 0.15, ease: 'power3.out' })
    gsap.to('.hero-copy', {
      opacity: 0, y: -80, ease: 'none',
      scrollTrigger: { trigger: ref.current, start: 'top top', end: '35% top', scrub: true },
    })
    return () => split.revert()
  }, { scope: ref })
  return (
    <section className="hero" ref={ref} aria-label="Fair Shot">
      <div className="hero-sticky">
        <div className="hero-canvas">
          <Suspense fallback={null}><Hero3D progress={progress} /></Suspense>
        </div>
        <div className="hero-vignette" />
        <div className="hero-copy">
          <div className="kicker hero-kicker" style={{ marginBottom: 14 }}>A player-side data story · NBA 2011–12 → 2026–27</div>
          <h1 className="hero-title display">Fair Shot</h1>
          <p className="hero-sub">
            Every NBA player. <b>What they produce. What they're paid.</b> And who keeps the difference.
          </p>
        </div>
        <div className="scroll-cue">Scroll to tip off</div>
      </div>
    </section>
  )
}

export function Ticker({ stories }: { stories: any }) {
  const h = stories?.headline
  if (!h) return null
  const cells = [
    { v: h.dollars_per_war, f: (x: number) => money(x, 2), l: `Market price of one win, ${label(h.season)}` },
    { v: h.underpaid, f: (x: number) => String(Math.round(x)), l: `players produced more than they were paid (of ${h.players})` },
    { v: h.total_surplus_underpaid, f: (x: number) => money(x, 2), l: 'of value those players created and did not get paid for' },
    { v: h.payroll, f: (x: number) => money(x, 2), l: 'total player payroll we priced' },
  ]
  return (
    <div className="ticker" role="region" aria-label="Headline numbers">
      <div className="wrap ticker-row" style={{ padding: 0 }}>
        {cells.map((c) => (
          <div className="ticker-cell" key={c.l}>
            <Counter className="ticker-val" value={c.v} format={c.f} />
            <div className="ticker-lbl">{c.l}</div>
          </div>
        ))}
      </div>
    </div>
  )
}

/* ---------------- 1st quarter: the price of a win (pinned, scrubbed) ---------------- */
export function PriceOfAWin({ stories, meta }: { stories: any; meta: any }) {
  const ref = useRef<HTMLDivElement>(null)
  const h = stories?.headline
  const star = stories?.max_ceiling?.top?.[0]
  const mk = meta?.market?.find((m: any) => m.season === h?.season)
  useGSAP(() => {
    if (!ref.current || !h || reducedMotion) return
    const tl = gsap.timeline({
      scrollTrigger: { trigger: ref.current, start: 'top top', end: '+=260%', scrub: 0.8, pin: true },
    })
    gsap.set('.pw-formula, .pw-example', { autoAlpha: 0 })
    tl.from('.pw-beat-1', { opacity: 0, y: 60, duration: 1 })
      .to('.pw-beat-1', { autoAlpha: 0, y: -50, duration: 0.8 }, '+=0.8')
      .set('.pw-formula', { autoAlpha: 1 })
      .from('.pw-term', { opacity: 0, y: 40, stagger: 0.3, duration: 0.9 })
      .to('.pw-formula', { autoAlpha: 0, y: -50, duration: 0.8 }, '+=0.8')
      .to('.pw-example', { autoAlpha: 1, duration: 0.01 })
      .from('.pw-example', { opacity: 0, y: 50, duration: 1 }, '<')
      .from('.pw-bar-val', { scaleX: 0, transformOrigin: 'left center', duration: 1.2 }, '<0.3')
      .from('.pw-bar-sal', { scaleX: 0, transformOrigin: 'left center', duration: 1.2 }, '<0.2')
  }, { scope: ref, dependencies: [h?.season] })
  if (!h || !mk) return null
  const value = star?.fair_value ?? 0
  const maxV = Math.max(value, star?.salary ?? 0)
  return (
    <section className="chapter" id="price">
      <div className="wrap">
        <ChapterHead quarter="1st Quarter" title="The price of a win">
          Teams pay for wins. So we can ask a simple question of every contract: <b>if a player's production were
          bought on the open market, what would it cost?</b>
        </ChapterHead>
      </div>
      <div ref={ref} style={{ height: '100vh', display: 'flex', alignItems: 'center' }}>
        <div className="wrap" style={{ position: 'relative', minHeight: 520 }}>
          <div className="pw-beat-1" style={{ position: 'absolute', inset: 0 }}>
            <div className="kicker">In {label(h.season)}, NBA teams paid</div>
            <div style={{ fontSize: 'clamp(80px, 13vw, 190px)', color: 'var(--led)', fontFamily: 'var(--font-led)', fontWeight: 900, lineHeight: 1.05, textShadow: '0 0 30px rgba(255,179,71,.35)', margin: '10px 0' }}>
              {money(mk.dollars_per_war, 2)}
            </div>
            <div className="lede" style={{ marginTop: 6 }}>for every win a player added above a freely available replacement.</div>
          </div>
          <div className="pw-formula" style={{ position: 'absolute', inset: 0, display: 'flex', flexWrap: 'wrap', gap: 18, alignItems: 'center', alignContent: 'center' }}>
            {[
              ['Fair value', 'what the market would pay'],
              ['=', ''],
              [money(mk.replacement_salary, 2), 'league minimum: the price of a replacement player'],
              ['+', ''],
              ['Wins over replacement', '2.7 × VORP, scaled to 82 games'],
              ['×', ''],
              [`${money(mk.dollars_per_war, 2)}`, 'the market price of a win'],
            ].map(([t, s], i) => (
              <div className="pw-term" key={i} style={{ textAlign: 'left' }}>
                <div className="display" style={{ fontSize: s ? 'clamp(28px, 4vw, 56px)' : 'clamp(40px, 5vw, 70px)', color: s ? 'var(--text)' : 'var(--orange)' }}>{t}</div>
                {s && <div className="muted" style={{ fontSize: 13, maxWidth: 220 }}>{s}</div>}
              </div>
            ))}
          </div>
          {star && (
            <div className="pw-example" style={{ position: 'absolute', inset: 0, display: 'flex', flexDirection: 'column', justifyContent: 'center' }}>
              <div className="kicker">Example: the most valuable player-season of {label(h.season)}</div>
              <div className="display" style={{ fontSize: 'clamp(44px, 7vw, 96px)', marginTop: 8 }}>
                <Link to={`/player/${star.player_id}`}>{star.player_name}</Link>
              </div>
              <div className="dim" style={{ marginTop: 8 }}>
                {num(star.war82, 1)} wins × {money(mk.dollars_per_war, 2)} + {money(mk.replacement_salary, 2)} =
                <b style={{ color: 'var(--under)' }}> {money(value)} of production</b>
              </div>
              <div style={{ marginTop: 28, display: 'grid', gap: 12, maxWidth: 900 }}>
                <div>
                  <div className="kicker" style={{ marginBottom: 6 }}>Fair value {money(value)}</div>
                  <div className="pw-bar-val" style={{ height: 22, borderRadius: 4, background: 'var(--under)', width: `${(100 * value) / maxV}%` }} />
                </div>
                <div>
                  <div className="kicker" style={{ marginBottom: 6 }}>Actual salary {money(star.salary)}</div>
                  <div className="pw-bar-sal" style={{ height: 22, borderRadius: 4, background: 'var(--text-2)', width: `${(100 * star.salary) / maxV}%` }} />
                </div>
              </div>
              <div className="lede">
                The CBA caps any one salary at 35% of the cap ({money(stories.max_ceiling.max_salary)}).
                {' '}For the very best players, <b>the market value is higher than the rules allow them to be paid.</b>
              </div>
            </div>
          )}
        </div>
      </div>
    </section>
  )
}
