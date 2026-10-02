// Ekrany startowe dla iOS, tym samym enkoderem PNG co ikony.
//
// Bez nich aplikacja z ekranu glownego pokazuje przy starcie biale pole -
// to jedna z dwoch rzeczy, po ktorych od razu widac, ze to nie jest apka.
// iOS NIE uzywa background_color z manifestu; wymaga apple-touch-startup-image
// w dokladnych rozmiarach urzadzenia.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'splash')
mkdirSync(OUT, { recursive: true })

const CRC = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})
const crc32 = (b) => {
  let c = 0xffffffff
  for (const x of b) c = CRC[(c ^ x) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4); crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function png(w, h, px) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4)
  ihdr[8] = 8; ihdr[9] = 6
  const raw = Buffer.alloc(h * (w * 4 + 1))
  for (let y = 0; y < h; y++) {
    raw[y * (w * 4 + 1)] = 0
    px.copy(raw, y * (w * 4 + 1) + 1, y * w * 4, (y + 1) * w * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr), chunk('IDAT', deflateSync(raw, { level: 9 })), chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [14, 20, 22]
const TEAL = [31, 138, 138]
const LIGHT = [232, 237, 238]
const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/** Ta sama tarcza co w ikonie - start ma byc ciagiem dalszym ikony, nie innym obrazem. */
function rysuj(w, h) {
  const px = Buffer.alloc(w * h * 4)
  const cx = w / 2, cy = h / 2
  const r = Math.min(w, h) * 0.17
  const grubosc = Math.min(w, h) * 0.038
  const KONIEC = Math.PI * 1.5

  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const dx = x + 0.5 - cx, dy = y + 0.5 - cy
      const d = Math.hypot(dx, dy)
      // Poswiata od gory, jak w interfejsie aplikacji.
      const glow = Math.max(0, 1 - Math.hypot(dx, y - h * 0.18) / (Math.max(w, h) * 0.75))
      let col = mix(BG, TEAL, glow * 0.22)

      if (Math.abs(d - r) < grubosc / 2) {
        let a = Math.atan2(dx, -dy); if (a < 0) a += Math.PI * 2
        col = a <= KONIEC ? LIGHT : mix(col, LIGHT, 0.14)
      }
      const kx = cx + r * Math.sin(KONIEC), ky = cy - r * Math.cos(KONIEC)
      if (Math.hypot(x + 0.5 - kx, y + 0.5 - ky) < grubosc * 0.85) col = TEAL

      const o = (y * w + x) * 4
      px[o] = col[0]; px[o + 1] = col[1]; px[o + 2] = col[2]; px[o + 3] = 255
    }
  }
  return px
}

// Rozmiary w pikselach fizycznych. Pokrywaja iPhone'y od X w gore.
const URZADZENIA = [
  [1125, 2436, 375, 812, 3],   // X, XS, 11 Pro
  [1242, 2688, 414, 896, 3],   // XS Max, 11 Pro Max
  [828, 1792, 414, 896, 2],    // XR, 11
  [1170, 2532, 390, 844, 3],   // 12, 13, 14
  [1284, 2778, 428, 926, 3],   // 12/13/14 Pro Max
  [1179, 2556, 393, 852, 3],   // 14 Pro, 15, 16
  [1290, 2796, 430, 932, 3],   // 14/15 Pro Max
  [1206, 2622, 402, 874, 3],   // 16
  [1320, 2868, 440, 956, 3],   // 16 Pro Max
]

const linki = []
for (const [w, h, cssW, cssH, dpr] of URZADZENIA) {
  const nazwa = `splash-${w}x${h}.png`
  writeFileSync(join(OUT, nazwa), png(w, h, rysuj(w, h)))
  linki.push(
    `    <link rel="apple-touch-startup-image" href="./splash/${nazwa}"\n` +
    `          media="(device-width: ${cssW}px) and (device-height: ${cssH}px) and (-webkit-device-pixel-ratio: ${dpr}) and (orientation: portrait)" />`
  )
  console.log(`  ${nazwa}`)
}

console.log('\n--- wklej do index.html ---')
console.log(linki.join('\n'))
