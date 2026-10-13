// Enerblock-language G: massive ribbons, every cut at 45°, clear gaps.
const fs = require('fs')
const C = require('clipper-lib')
const { Resvg } = require('@resvg/resvg-js')
const S = 1000
const sc = (p) => ({ X: Math.round(p[0] * S), Y: Math.round(p[1] * S) })
function stroke(pts, w) {
  const co = new C.ClipperOffset(20, 0.25)
  co.AddPath(pts.map(sc), C.JoinType.jtMiter, C.EndType.etOpenButt)
  const r = new C.Paths(); co.Execute(r, (w / 2) * S); return r
}
function clip(a, b, t) { const c = new C.Clipper(); c.AddPaths(a, C.PolyType.ptSubject, true); c.AddPaths(b, C.PolyType.ptClip, true); const r = new C.Paths(); c.Execute(t, r, C.PolyFillType.pftNonZero, C.PolyFillType.pftNonZero); return r }
const norm = (v) => { const l = Math.hypot(v[0], v[1]); return [v[0] / l, v[1] / l] }
function band(p, d, g, len = 9) { const n = [-d[1], d[0]], h = g / 2; const a = [p[0] - d[0] * len, p[1] - d[1] * len], b = [p[0] + d[0] * len, p[1] + d[1] * len]; return [[a[0] + n[0] * h, a[1] + n[1] * h], [b[0] + n[0] * h, b[1] + n[1] * h], [b[0] - n[0] * h, b[1] - n[1] * h], [a[0] - n[0] * h, a[1] - n[1] * h]].map(sc) }
const toD = (ps) => ps.map((poly) => 'M' + poly.map((p) => `${+(p.X / S).toFixed(2)} ${+(p.Y / S).toFixed(2)}`).join('L') + 'Z').join('')

// centerline of a chamfered G inside 0..48, stroke T
function g({ T, c, cBR, mid, bar, gap, cuts }) {
  const L = T / 2, R = 48 - T / 2, Tp = T / 2, B = 48 - T / 2
  const pts = [[48, Tp], [L + c, Tp], [L, Tp + c], [L, B - c], [L + c, B], [R - cBR, B], [R, B - cBR], [R, mid], [bar, mid]]
  let body = stroke(pts, T)
  const bands = []
  for (const i of cuts) {
    const prev = norm([pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]])
    const next = norm([pts[i + 1][0] - pts[i][0], pts[i + 1][1] - pts[i][1]])
    const diag = Math.abs(prev[0]) > 0.1 && Math.abs(prev[1]) > 0.1 ? prev : next
    bands.push(band(pts[i], [-diag[1], diag[0]], gap))
  }
  body = clip(body, bands, C.ClipType.ctDifference)
  // slanted top terminal (45°)
  body = clip(body, [[[48, 0], [48, T], [48 - T, T]].map(sc)], C.ClipType.ctDifference)
  return toD(body)
}
const V = {
  A: g({ T: 11, c: 12, cBR: 10, mid: 27, bar: 26, gap: 3, cuts: [1, 2, 3, 4, 5, 6] }),
  B: g({ T: 12, c: 14, cBR: 12, mid: 28, bar: 27, gap: 3.4, cuts: [2, 4, 6] }),
  Cc: g({ T: 10, c: 16, cBR: 12, mid: 27, bar: 26, gap: 3, cuts: [1, 2, 3, 4, 5, 6] }),
}
fs.writeFileSync('egen.json', JSON.stringify(V))
const names = Object.keys(V)
let body = ''
names.forEach((k, i) => {
  const x = i * 300
  body += `<rect x="${x}" y="0" width="300" height="300" fill="#F0EFEB"/><g transform="translate(${x + 20} 20) scale(3.4)" fill="#191919"><path d="${V[k]}"/></g>`
  body += `<rect x="${x}" y="300" width="300" height="140" fill="#6F3FF5"/><g transform="translate(${x + 20} 320) scale(0.5)" fill="#fff"><path d="${V[k]}"/></g><g transform="translate(${x + 60} 320) scale(0.75)" fill="#fff"><path d="${V[k]}"/></g><g transform="translate(${x + 110} 320) scale(1.5)" fill="#fff"><path d="${V[k]}"/></g>`
  body += `<text x="${x + 20}" y="430" font-size="16" fill="#fff" font-family="Helvetica">${k}</text>`
})
fs.writeFileSync('esheet.png', new Resvg(`<svg xmlns="http://www.w3.org/2000/svg" width="${names.length * 300}" height="440">${body}</svg>`).render().asPng())
