// Procedural textures (no image assets): a pebbled basketball and a hardwood
// court with painted lines, both drawn on canvases at runtime.
import * as THREE from 'three'

function seamPoints(center: THREE.Vector3, radius: number, n = 720): THREE.Vector3[] {
  const c = center.clone().normalize()
  const a = new THREE.Vector3(0, 1, 0).cross(c)
  if (a.lengthSq() < 1e-6) a.set(1, 0, 0)
  a.normalize()
  const b = c.clone().cross(a).normalize()
  const pts: THREE.Vector3[] = []
  for (let i = 0; i <= n; i++) {
    const t = (i / n) * Math.PI * 2
    pts.push(c.clone().multiplyScalar(Math.cos(radius))
      .add(a.clone().multiplyScalar(Math.sin(radius) * Math.cos(t)))
      .add(b.clone().multiplyScalar(Math.sin(radius) * Math.sin(t))))
  }
  return pts
}

// Map a point on the unit sphere to equirectangular canvas coordinates,
// matching three.js SphereGeometry's UV layout.
function toUV(p: THREE.Vector3, w: number, h: number): [number, number] {
  const u = 0.5 + Math.atan2(p.z, -p.x) / (2 * Math.PI)
  const v = Math.acos(THREE.MathUtils.clamp(p.y, -1, 1)) / Math.PI
  return [u * w, v * h]
}

function strokeCurve(ctx: CanvasRenderingContext2D, pts: THREE.Vector3[], w: number, h: number) {
  ctx.beginPath()
  let prev: [number, number] | null = null
  for (const p of pts) {
    const [x, y] = toUV(p, w, h)
    if (!prev || Math.abs(x - prev[0]) > w / 2) ctx.moveTo(x, y)
    else ctx.lineTo(x, y)
    prev = [x, y]
  }
  ctx.stroke()
}

export function basketballTextures() {
  const w = 2048, h = 1024
  const color = document.createElement('canvas')
  color.width = w; color.height = h
  const ctx = color.getContext('2d')!
  const g = ctx.createLinearGradient(0, 0, 0, h)
  g.addColorStop(0, '#d9611c'); g.addColorStop(0.5, '#e46c22'); g.addColorStop(1, '#c95618')
  ctx.fillStyle = g
  ctx.fillRect(0, 0, w, h)
  // leather pebbles
  const bump = document.createElement('canvas')
  bump.width = w; bump.height = h
  const bctx = bump.getContext('2d')!
  bctx.fillStyle = '#808080'
  bctx.fillRect(0, 0, w, h)
  for (let i = 0; i < 90000; i++) {
    const x = Math.random() * w, y = Math.random() * h, r = 1 + Math.random() * 2.2
    bctx.fillStyle = `rgba(255,255,255,${0.25 + Math.random() * 0.3})`
    bctx.beginPath(); bctx.arc(x, y, r, 0, Math.PI * 2); bctx.fill()
    if (i % 3 === 0) {
      ctx.fillStyle = `rgba(0,0,0,${Math.random() * 0.05})`
      ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
    }
  }
  // seams: equator, one great circle through the poles, two curved seams
  const seams = [
    seamPoints(new THREE.Vector3(0, 1, 0), Math.PI / 2),
    seamPoints(new THREE.Vector3(1, 0, 0), Math.PI / 2),
    seamPoints(new THREE.Vector3(0, 0, 1), 0.92),
    seamPoints(new THREE.Vector3(0, 0, -1), 0.92),
  ]
  for (const [c2d, style, width] of [[ctx, '#1a0c05', 10], [bctx, '#000000', 16]] as const) {
    c2d.strokeStyle = style
    c2d.lineWidth = width
    c2d.lineCap = 'round'
    for (const s of seams) strokeCurve(c2d, s, w, h)
  }
  const map = new THREE.CanvasTexture(color)
  map.colorSpace = THREE.SRGBColorSpace
  map.anisotropy = 8
  const bumpMap = new THREE.CanvasTexture(bump)
  return { map, bumpMap }
}

export function courtTexture() {
  const w = 2048, h = 1092 // ~94 x 50 ft
  const c = document.createElement('canvas')
  c.width = w; c.height = h
  const ctx = c.getContext('2d')!
  // maple planks
  const plank = 26
  for (let y = 0; y < h; y += plank) {
    let x = -Math.random() * 400
    while (x < w) {
      const len = 260 + Math.random() * 520
      const tone = 0.86 + Math.random() * 0.22
      const r = Math.min(255, 196 * tone), gg = Math.min(255, 137 * tone), b = Math.min(255, 79 * tone)
      ctx.fillStyle = `rgb(${r},${gg},${b})`
      ctx.fillRect(x, y, len, plank)
      // grain
      ctx.strokeStyle = `rgba(90,50,20,${0.05 + Math.random() * 0.06})`
      ctx.lineWidth = 1
      for (let k = 0; k < 4; k++) {
        ctx.beginPath()
        const gy = y + 3 + Math.random() * (plank - 6)
        ctx.moveTo(x, gy)
        ctx.bezierCurveTo(x + len * 0.3, gy + 2, x + len * 0.6, gy - 2, x + len, gy)
        ctx.stroke()
      }
      ctx.fillStyle = 'rgba(60,30,10,.35)'
      ctx.fillRect(x + len - 1, y, 1.5, plank)
      x += len
    }
    ctx.fillStyle = 'rgba(60,30,10,.28)'
    ctx.fillRect(0, y, w, 1)
  }
  const ft = w / 94
  const cx = w / 2, cy = h / 2
  // painted keys (team color wash) + lines
  ctx.fillStyle = 'rgba(232,104,31,.55)'
  ctx.fillRect(0, cy - 8 * ft, 19 * ft, 16 * ft)
  ctx.fillRect(w - 19 * ft, cy - 8 * ft, 19 * ft, 16 * ft)
  ctx.beginPath(); ctx.arc(cx, cy, 6 * ft, 0, Math.PI * 2); ctx.fill()
  ctx.strokeStyle = 'rgba(255,255,255,.92)'
  ctx.lineWidth = 6
  ctx.strokeRect(3, 3, w - 6, h - 6)
  ctx.beginPath(); ctx.moveTo(cx, 0); ctx.lineTo(cx, h); ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, cy, 6 * ft, 0, Math.PI * 2); ctx.stroke()
  ctx.beginPath(); ctx.arc(cx, cy, 2 * ft, 0, Math.PI * 2); ctx.stroke()
  for (const side of [0, 1]) {
    const bx = side ? w - 5.25 * ft : 5.25 * ft
    const dir = side ? -1 : 1
    ctx.strokeRect(side ? w - 19 * ft : 0, cy - 8 * ft, 19 * ft, 16 * ft)
    ctx.beginPath(); ctx.arc(side ? w - 19 * ft : 19 * ft, cy, 6 * ft, -Math.PI / 2, Math.PI / 2, !!side); ctx.stroke()
    // three-point line: corners + arc
    const r3 = 23.75 * ft, corner = 22 * ft
    const yc = Math.sqrt(r3 * r3 - corner * corner)
    ctx.beginPath()
    ctx.moveTo(side ? w : 0, cy - corner)
    ctx.lineTo(bx + dir * yc, cy - corner)
    const a = Math.atan2(corner, yc)
    if (side) ctx.arc(bx, cy, r3, Math.PI + a, Math.PI - a, true)
    else ctx.arc(bx, cy, r3, -a, a)
    ctx.lineTo(side ? w : 0, cy + corner)
    ctx.stroke()
    ctx.beginPath(); ctx.arc(bx, cy, 4 * ft, -Math.PI / 2, Math.PI / 2, !!side); ctx.stroke()
  }
  // center logo text
  ctx.save()
  ctx.translate(cx, cy)
  ctx.fillStyle = 'rgba(20,10,4,.55)'
  ctx.font = `${3.1 * ft}px Anton, Impact, sans-serif`
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText('FAIR SHOT', 0, 0)
  ctx.restore()
  const tex = new THREE.CanvasTexture(c)
  tex.colorSpace = THREE.SRGBColorSpace
  tex.anisotropy = 16
  return tex
}
