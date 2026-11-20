export const money = (v: number | null | undefined, digits = 1): string => {
  if (v == null || Number.isNaN(v)) return '—'
  const a = Math.abs(v)
  const sign = v < 0 ? '−' : ''
  if (a >= 1e9) return `${sign}$${(a / 1e9).toFixed(digits)}B`
  if (a >= 1e6) return `${sign}$${(a / 1e6).toFixed(digits)}M`
  if (a >= 1e3) return `${sign}$${(a / 1e3).toFixed(0)}K`
  return `${sign}$${a.toFixed(0)}`
}
export const signedMoney = (v: number | null | undefined, digits = 1) =>
  v == null ? '—' : (v > 0 ? '+' : '') + money(v, digits)
export const pct = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : `${(v * 100).toFixed(digits)}%`
export const num = (v: number | null | undefined, digits = 1) =>
  v == null || Number.isNaN(v) ? '—' : v.toFixed(digits)
export const int = (v: number | null | undefined) =>
  v == null || Number.isNaN(v) ? '—' : Math.round(v).toLocaleString('en-US')
export const heightFt = (inches?: number | null) =>
  inches ? `${Math.floor(inches / 12)}'${inches % 12}"` : '—'
