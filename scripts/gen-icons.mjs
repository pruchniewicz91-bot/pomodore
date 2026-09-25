// Generator ikon PWA bez zadnych zaleznosci.
// Na tym Macu nie ma ImageMagick ani Pillow, a iOS wymaga PNG dla apple-touch-icon,
// wiec PNG skladamy recznie: IHDR + IDAT (deflate) + IEND.

import { deflateSync } from 'node:zlib'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const OUT = join(dirname(fileURLToPath(import.meta.url)), '..', 'public', 'icons')
mkdirSync(OUT, { recursive: true })

const CRC_TABLE = Array.from({ length: 256 }, (_, n) => {
  let c = n
  for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
  return c >>> 0
})

function crc32(buf) {
  let c = 0xffffffff
  for (const b of buf) c = CRC_TABLE[(c ^ b) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}

function png(size, pixels) {
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8    // 8 bitow na kanal
  ihdr[9] = 6    // RGBA
  // scanliny z filtrem 0 na poczatku kazdego wiersza
  const raw = Buffer.alloc(size * (size * 4 + 1))
  for (let y = 0; y < size; y++) {
    raw[y * (size * 4 + 1)] = 0
    pixels.copy(raw, y * (size * 4 + 1) + 1, y * size * 4, (y + 1) * size * 4)
  }
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

const BG = [14, 20, 22]
const TEAL = [31, 138, 138]
const LIGHT = [232, 237, 238]

const mix = (a, b, t) => a.map((v, i) => Math.round(v + (b[i] - v) * t))

/** Rysuje tarcze timera: pierscien w 3/4 obrotu, jak sesja w toku. */
function draw(size) {
  const SS = 3 // nadprobkowanie - okrag bez schodkow
  const px = Buffer.alloc(size * size * 4)
  const c = size / 2
  const rOuter = size * 0.33
  const ring = size * 0.075
  const END = Math.PI * 1.5 // 75% obwodu

  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let acc = [0, 0, 0]
      for (let sy = 0; sy < SS; sy++) {
        for (let sx = 0; sx < SS; sx++) {
          const px_ = x + (sx + 0.5) / SS
          const py_ = y + (sy + 0.5) / SS
          const dx = px_ - c
          const dy = py_ - c
          const dist = Math.hypot(dx, dy)

          // Tlo: delikatna poswiata teal od gory, jak w interfejsie.
          const glow = Math.max(0, 1 - Math.hypot(dx, py_ - size * 0.1) / (size * 0.85))
          let col = mix(BG, TEAL, glow * 0.35)

          const inRing = Math.abs(dist - rOuter) < ring / 2
          if (inRing) {
            let ang = Math.atan2(dx, -dy)
            if (ang < 0) ang += Math.PI * 2
            col = ang <= END ? LIGHT : mix(col, LIGHT, 0.14)
          }
          // Kropka wskaznika na koncu luku.
          const kx = c + rOuter * Math.sin(END)
          const ky = c - rOuter * Math.cos(END)
          if (Math.hypot(px_ - kx, py_ - ky) < ring * 0.85) col = TEAL

          acc = acc.map((v, i) => v + col[i])
        }
      }
      const n = SS * SS
      const o = (y * size + x) * 4
      px[o] = Math.round(acc[0] / n)
      px[o + 1] = Math.round(acc[1] / n)
      px[o + 2] = Math.round(acc[2] / n)
      px[o + 3] = 255
    }
  }
  return px
}

for (const size of [180, 192, 512]) {
  writeFileSync(join(OUT, `icon-${size}.png`), png(size, draw(size)))
  console.log(`  icon-${size}.png`)
}
console.log('Ikony zapisane w public/icons/')
