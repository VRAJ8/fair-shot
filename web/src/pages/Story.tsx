import { useEffect } from 'react'
import { Link } from 'react-router-dom'
import { AskPanel } from '../components/Ask'
import { ChapterHead, CourtDivider, PlayerSearch } from '../components/ui'
import BigBoard from '../chapters/BigBoard'
import { ContractTypes, MaxCeiling } from '../chapters/Ceiling'
import MiddleClass from '../chapters/MiddleClass'
import { CareerClock, SixtyFive } from '../chapters/Availability'
import { PriceOfAWin, Ticker, Tipoff } from '../chapters/Opening'
import RoadWarriors from '../chapters/RoadWarriors'
import { useData, type BoardRow, type Meta } from '../lib/data'
import { ScrollTrigger } from '../lib/motion'

export default function Story() {
  const meta = useData<Meta>('meta.json')
  const stories = useData<any>('stories.json')
  const board = useData<Record<string, BoardRow[]>>('board.json')
  const ready = meta && stories && board
  // Pinned sections change the page height once data arrives; re-measure.
  useEffect(() => { if (ready) setTimeout(() => ScrollTrigger.refresh(), 300) }, [ready])
  return (
    <>
      <Tipoff />
      {ready && (
        <>
          <Ticker stories={stories} />
          <PriceOfAWin stories={stories} meta={meta} />
          <BigBoard board={board} stories={stories} seasons={{ full: meta.last_full_season, current: meta.current_season }} />
          <CourtDivider />
          <MaxCeiling stories={stories} />
          <ContractTypes stories={stories} />
          <CourtDivider />
          <MiddleClass stories={stories} current={meta.current_season} />
          <CourtDivider />
          <RoadWarriors stories={stories} season={meta.last_full_season} />
          <SixtyFive stories={stories} />
          <CourtDivider />
          <CareerClock stories={stories} />
          <section className="chapter" id="postgame">
            <div className="wrap">
              <ChapterHead quarter="Post-game" title="Your turn on the mic">
                Every player in the league has a page: career ledger, three-season projection, historical comps,
                game-by-game availability, and an AI-written negotiation brief. Or ask the data a question directly.
              </ChapterHead>
              <div className="grid grid-2" style={{ alignItems: 'start', gap: 24 }}>
                <div className="card" style={{ minHeight: 220 }}>
                  <div className="kicker" style={{ marginBottom: 12 }}>Open a player's locker</div>
                  <PlayerSearch />
                  <p className="dim" style={{ fontSize: 14 }}>or browse the <Link to="/players" style={{ textDecoration: 'underline' }}>full league ledger</Link>.</p>
                </div>
                <AskPanel compact />
              </div>
            </div>
          </section>
        </>
      )}
    </>
  )
}
