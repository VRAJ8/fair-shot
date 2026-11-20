import { useEffect } from 'react'
import { Route, Routes, useLocation } from 'react-router-dom'
import { Nav } from './components/ui'
import { scrollToTop, ScrollTrigger, startSmoothScroll } from './lib/motion'
import { TooltipProvider } from './lib/tooltip'
import AskPage from './pages/AskPage'
import Methods from './pages/Methods'
import Player from './pages/Player'
import Players from './pages/Players'
import Story from './pages/Story'

export default function App() {
  const loc = useLocation()
  useEffect(() => { startSmoothScroll() }, [])
  useEffect(() => {
    scrollToTop()
    const t = setTimeout(() => ScrollTrigger.refresh(), 400)
    return () => clearTimeout(t)
  }, [loc.pathname])
  return (
    <TooltipProvider>
      <Nav />
      <main>
        <Routes>
          <Route path="/" element={<Story />} />
          <Route path="/players" element={<Players />} />
          <Route path="/player/:id" element={<Player />} />
          <Route path="/ask" element={<AskPage />} />
          <Route path="/methods" element={<Methods />} />
          <Route path="*" element={<Story />} />
        </Routes>
      </main>
      <footer className="footer">
        <div className="wrap">
          <div className="display" style={{ fontSize: 34, color: 'var(--text)' }}>Fair Shot</div>
          <p style={{ maxWidth: 680 }}>
            A player-side look at NBA pay: what production is worth, who gets paid for it, and what the schedule and the
            CBA's rules take out of it. Built with Python, SQL (DuckDB), scikit-learn, React, D3, GSAP, Three.js and Claude.
          </p>
          <p className="muted" style={{ fontSize: 12.5 }}>Data: Basketball-Reference.com and ESPN. Independent project, not affiliated with the NBA or NBPA.</p>
        </div>
      </footer>
    </TooltipProvider>
  )
}
