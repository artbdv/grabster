// Builds Grabster's favicon set and link-preview image (G mark + wordmark, light palette, purple accent).
// Usage: node brand.cjs <outDir>
const fs = require('fs')
const path = require('path')
const opentype = require('opentype.js')
const { Resvg } = require('@resvg/resvg-js')

const out = process.argv[2] || './out'
fs.mkdirSync(out, { recursive: true })

const fontDir = (pkg) => path.join(__dirname, 'node_modules/@fontsource', pkg, 'files')
const load = (pkg, file) => {
  const buf = fs.readFileSync(path.join(fontDir(pkg), file))
  return opentype.parse(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength))
}
const sans500 = load('archivo', 'archivo-latin-500-normal.woff')
const sans600 = load('archivo', 'archivo-latin-700-normal.woff')
// G mark, 48×48 (src/components/GMark.vue; geometry from gen-g.cjs)
const G = 'M48 32.48L47.45 33.04L36.84 22.43L34.43 24.84L45.04 35.45L32.48 48L17.52 48L16.96 47.45L27.57 36.84L26.73 36L27.51 36L29.51 34L27 34L27 22L48 22ZM11.16 27.57L12.61 26.12L22.49 36L23.6 36L14.56 45.04L0 30.48L0 17.52L0.56 16.96ZM12 22.49L12 23.6L2.96 14.56L17.52 0L48 0L36 12L22.49 12Z'

const BG = '#F0EFEB'
const INK = '#191919'
const MUTED = '#62625E'
const LINE = '#B9B8B1'
const PURPLE = '#6F3FF5'

/** Outlined text with tracking (em). Returns { d, width }. */
function textPath(font, text, size, x, y, tracking = 0) {
  let cx = x
  let d = ''
  const glyphs = font.stringToGlyphs(text)
  glyphs.forEach((g, i) => {
    d += g.getPath(cx, y, size).toPathData(2)
    let adv = (g.advanceWidth / font.unitsPerEm) * size
    if (i < glyphs.length - 1) adv += (font.getKerningValue(g, glyphs[i + 1]) / font.unitsPerEm) * size
    cx += adv + tracking * size
  })
  return { d, width: cx - x - tracking * size }
}

const svg = (w, h, body) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${w}" height="${h}">${body}</svg>\n`
const write = (name, data) => fs.writeFileSync(path.join(out, name), data)
const png = (text, width) => new Resvg(text, { fitTo: { mode: 'width', value: width } }).render().asPng()

// --- favicon: the G in white on the purple square ---
function tile(size) {
  const pad = size * 0.16
  const k = (size - pad * 2) / 48
  return svg(size, size, `<rect width="${size}" height="${size}" fill="${PURPLE}"/><path fill="#FFFFFF" transform="translate(${pad} ${pad}) scale(${k})" d="${G}"/>`)
}
const fav = tile(32)
write('favicon.svg', fav.replace(' width="32" height="32"', ''))
const fav16 = png(fav, 16)
const fav32 = png(fav, 32)
write('apple-touch-icon.png', png(tile(180), 180))

function ico(images) {
  const header = Buffer.alloc(6)
  header.writeUInt16LE(0, 0)
  header.writeUInt16LE(1, 2)
  header.writeUInt16LE(images.length, 4)
  const dir = Buffer.alloc(16 * images.length)
  let offset = 6 + dir.length
  images.forEach(([size, data], i) => {
    const o = i * 16
    dir.writeUInt8(size, o)
    dir.writeUInt8(size, o + 1)
    dir.writeUInt16LE(1, o + 4)
    dir.writeUInt16LE(32, o + 6)
    dir.writeUInt32LE(data.length, o + 8)
    dir.writeUInt32LE(offset, o + 12)
    offset += data.length
  })
  return Buffer.concat([header, dir, ...images.map(([, d]) => d)])
}
write('favicon.ico', ico([[16, fav16], [32, fav32]]))

// --- link preview 1200×630: two halves split by a rule, like the home page ---
function og() {
  const W = 1200, H = 630, M = 40
  const p = [`<rect width="${W}" height="${H}" fill="${BG}"/>`]
  p.push(`<path fill="${INK}" transform="translate(${M} ${M}) scale(0.9)" d="${G}"/>`)
  p.push(`<path fill="${INK}" d="${textPath(sans600, 'Grabster', 40, M + 54, M + 36, -0.045).d}"/>`)
  p.push(`<rect x="${W / 2}" y="0" width="1" height="${H}" fill="${LINE}"/>`)
  p.push(`<path fill="${INK}" d="${textPath(sans600, 'Get your', 112, M - 4, 300, -0.04).d}"/>`)
  p.push(`<path fill="${INK}" d="${textPath(sans600, 'SOL back.', 112, M - 4, 404, -0.04).d}"/>`)
  p.push(`<path fill="${INK}" d="${textPath(sans500, 'Recover SOL from unused token accounts —', 26, M, 470, -0.01).d}"/>`)
  p.push(`<path fill="${INK}" d="${textPath(sans500, 'from one wallet or a whole list.', 26, M, 504, -0.01).d}"/>`)
  // right half: 2×2 tiles, the first one purple
  const tiles = ['Batch cleanup', 'API', 'MCP', 'Local HTML']
  tiles.forEach((t, i) => {
    const x = W / 2 + (i % 2) * (W / 4), y = i < 2 ? 0 : H / 2
    if (i === 0) p.push(`<rect x="${x}" y="${y}" width="${W / 4}" height="${H / 2}" fill="${PURPLE}"/>`)
    p.push(`<rect x="${x}" y="${y + H / 2 - 1}" width="${W / 4}" height="1" fill="${i === 0 ? '#FFFFFF' : LINE}"/>`)
    if (i % 2 === 0) p.push(`<rect x="${x + W / 4}" y="${y}" width="1" height="${H / 2}" fill="${LINE}"/>`)
    p.push(`<path fill="${i === 0 ? '#FFFFFF' : INK}" d="${textPath(sans600, t, 40, x + 24, y + 62, -0.035).d}"/>`)
    const ax = x + W / 4 - 56, ay = y + H / 2 - 38
    p.push(`<path fill="none" stroke="${i === 0 ? '#FFFFFF' : INK}" stroke-width="2.5" d="M${ax} ${ay}h26M${ax + 16} ${ay - 10}l10 10-10 10"/>`)
  })
  p.push(`<rect x="0" y="${H - 64}" width="${W / 2}" height="1" fill="${LINE}"/>`)
  p.push(`<path fill="${INK}" d="${textPath(sans500, '1% service fee to support the project', 22, M, H - 24, -0.01).d}"/>`)
  return svg(W, H, p.join(''))
}
const ogSvg = og()
write('og-image.png', png(ogSvg, 1200))
console.log('brand files written to', out)
