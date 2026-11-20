// Typed access to the JSON the pipeline exports to /public/data.
import { useEffect, useState } from 'react'

export type BoardRow = {
  player_id: string; player_name: string; team: string; pos: string; age: number; games: number; mpg: number
  war82: number; bpm: number; salary: number; fair_value: number; surplus: number
  salary_pct_cap: number; fair_pct_cap: number; contract_type: string; pts: number; trb: number; ast: number
}
export type IndexRow = {
  id: string; name: string; team: string; pos: string; jersey?: string
  salary: number; fair_value: number; surplus: number; war82: number; season: number
}
export type Meta = {
  last_full_season: number; current_season: number; labels: Record<string, string>
  cap: { season: number; salary_cap: number }[]
  market: { season: number; salary_cap: number; replacement_salary: number; dollars_per_war: number; n_paid_players: number }[]
  projection_metrics: any; counts: Record<string, number>
}
export type Team = { code: string; name: string; city: string; lat: number; lon: number; colors: [string, string] }

const cache = new Map<string, Promise<any>>()

export function load<T = any>(path: string): Promise<T> {
  let p = cache.get(path)
  if (!p) {
    p = fetch(`${import.meta.env.BASE_URL}data/${path}`).then((r) => {
      if (!r.ok) throw new Error(`${path}: ${r.status}`)
      return r.json()
    })
    cache.set(path, p)
  }
  return p as Promise<T>
}

export function useData<T = any>(path: string | null): T | null {
  const [data, setData] = useState<T | null>(null)
  useEffect(() => {
    if (!path) return
    let live = true
    setData(null)
    load<T>(path).then((d) => { if (live) setData(d) }).catch(() => { if (live) setData(null) })
    return () => { live = false }
  }, [path])
  return data
}

export const label = (season: number) => `${season - 1}-${String(season).slice(-2)}`
