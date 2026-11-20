// The league ledger: sortable, filterable table of every paid player.
import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { ChapterHead, PlayerSearch } from '../components/ui'
import { label, useData, type BoardRow, type Meta } from '../lib/data'
import { money, num, signedMoney } from '../lib/format'

type Key = 'surplus' | 'fair_value' | 'salary' | 'war82' | 'age' | 'games'

export default function Players() {
  const meta = useData<Meta>('meta.json')
  const board = useData<Record<string, BoardRow[]>>('board_all.json')
  const [season, setSeason] = useState<number | null>(null)
  const [sort, setSort] = useState<{ key: Key; dir: 1 | -1 }>({ key: 'surplus', dir: -1 })
  const [team, setTeam] = useState('ALL')
  const nav = useNavigate()
  const s = season ?? meta?.last_full_season ?? 0
  const rows = useMemo(() => {
    const r = (board?.[String(s)] ?? []).filter((d) => team === 'ALL' || d.team === team)
    return [...r].sort((a, b) => ((a[sort.key] ?? 0) - (b[sort.key] ?? 0)) * sort.dir)
  }, [board, s, sort, team])
  const teams = useMemo(() => [...new Set((board?.[String(s)] ?? []).map((d) => d.team))].sort(), [board, s])
  if (!meta || !board) return null
  const seasons = Object.keys(board).map(Number).sort((a, b) => b - a)
  const th = (k: Key, text: string) => (
    <th className="num" style={{ cursor: 'pointer' }} aria-sort={sort.key === k ? (sort.dir === 1 ? 'ascending' : 'descending') : 'none'}
      onClick={() => setSort((p) => ({ key: k, dir: p.key === k ? (p.dir === 1 ? -1 : 1) : -1 }))}>
      {text}{sort.key === k ? (sort.dir === 1 ? ' ↑' : ' ↓') : ''}
    </th>
  )
  return (
    <div className="wrap" style={{ paddingTop: 110 }}>
      <ChapterHead quarter="The league ledger" title="Every contract, priced">
        Fair value, salary and surplus for every player paid in a season. Click a column to sort, click a row to open the player.
      </ChapterHead>
      <div className="controls" style={{ marginBottom: 16 }}>
        <div style={{ flex: '1 1 260px', maxWidth: 360 }}><PlayerSearch /></div>
        <select className="select" value={s} onChange={(e) => setSeason(Number(e.target.value))} aria-label="Season">
          {seasons.map((x) => <option key={x} value={x}>{label(x)}{x === meta.current_season ? ' (in progress)' : ''}</option>)}
        </select>
        <select className="select" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Team">
          <option value="ALL">All teams</option>
          {teams.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <span className="muted" style={{ fontSize: 13 }}>{rows.length} players</span>
      </div>
      <div className="card" style={{ padding: 0, overflowX: 'auto' }}>
        <table className="tbl">
          <thead><tr>
            <th>#</th><th>Player</th><th>Team</th><th>Contract</th>
            {th('age', 'Age')}{th('games', 'G')}{th('war82', 'WAR')}{th('salary', 'Salary')}{th('fair_value', 'Fair value')}{th('surplus', 'Surplus')}
          </tr></thead>
          <tbody>
            {rows.slice(0, 600).map((r, i) => (
              <tr key={r.player_id} onClick={() => nav(`/player/${r.player_id}`)} style={{ cursor: 'pointer' }}>
                <td className="muted mono">{i + 1}</td>
                <td style={{ fontWeight: 600 }}>{r.player_name}</td>
                <td className="mono">{r.team}</td>
                <td><span className="pill">{r.contract_type}</span></td>
                <td className="num">{r.age}</td>
                <td className="num">{r.games}</td>
                <td className="num">{num(r.war82, 1)}</td>
                <td className="num">{money(r.salary)}</td>
                <td className="num">{money(r.fair_value)}</td>
                <td className={`num ${r.surplus > 0 ? 'under' : 'over'}`}>{signedMoney(r.surplus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
