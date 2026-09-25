import type { Mode, Settings } from '../types'

/**
 * Dzwieki syntezowane w Web Audio zamiast plikow mp3.
 * Powod: PWA ma dzialac offline od pierwszego uruchomienia, bez pobierania zasobow.
 */

let ctx: AudioContext | null = null

function context(): AudioContext {
  if (!ctx) ctx = new AudioContext()
  return ctx
}

/**
 * iOS blokuje audio do pierwszego gestu uzytkownika. Wolane przy starcie timera,
 * zeby dzwiek konca sesji mial szanse zabrzmiec.
 */
export function unlockAudio() {
  const c = context()
  if (c.state === 'suspended') void c.resume()
  const b = c.createBuffer(1, 1, 22050)
  const src = c.createBufferSource()
  src.buffer = b
  src.connect(c.destination)
  src.start(0)
}

interface ToneOptions {
  freq: number
  duration: number
  volume: number
  type?: OscillatorType
  delay?: number
  sweepTo?: number
}

function tone({ freq, duration, volume, type = 'sine', delay = 0, sweepTo }: ToneOptions) {
  const c = context()
  const t0 = c.currentTime + delay
  const osc = c.createOscillator()
  const gain = c.createGain()
  osc.type = type
  osc.frequency.setValueAtTime(freq, t0)
  if (sweepTo) osc.frequency.exponentialRampToValueAtTime(sweepTo, t0 + duration)
  // Miekka obwiednia - ostre zakonczenie sesji czytania jest nieprzyjemne.
  gain.gain.setValueAtTime(0.0001, t0)
  gain.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume), t0 + 0.04)
  gain.gain.exponentialRampToValueAtTime(0.0001, t0 + duration)
  osc.connect(gain).connect(c.destination)
  osc.start(t0)
  osc.stop(t0 + duration + 0.05)
}

const SOUNDS: Record<string, (v: number) => void> = {
  chime: (v) => {
    tone({ freq: 880, duration: 1.1, volume: v * 0.5 })
    tone({ freq: 1318.5, duration: 1.4, volume: v * 0.3, delay: 0.12 })
  },
  gong: (v) => {
    tone({ freq: 196, duration: 2.6, volume: v * 0.6, type: 'triangle' })
    tone({ freq: 261.6, duration: 2.2, volume: v * 0.25, delay: 0.05 })
  },
  bell: (v) => {
    tone({ freq: 1046.5, duration: 0.9, volume: v * 0.45 })
    tone({ freq: 1568, duration: 0.7, volume: v * 0.2, delay: 0.08 })
  },
  soft: (v) => tone({ freq: 523.3, duration: 0.8, volume: v * 0.4, type: 'triangle' }),
  none: () => {},
}

export const SOUND_NAMES = Object.keys(SOUNDS)

export function playEndSound(mode: Mode, s: Settings) {
  const name = mode === 'focus' ? s.endSoundFocus : s.endSoundBreak
  try {
    ;(SOUNDS[name] ?? SOUNDS.chime)(s.soundVolume)
  } catch (e) {
    console.warn('[audio] nie udalo sie odtworzyc dzwieku', e)
  }
}

/** Cichy sygnal na N minut przed koncem - zeby moc skonczyc akapit. */
export function warn(s: Settings) {
  try {
    tone({ freq: 660, duration: 0.35, volume: s.soundVolume * 0.18, type: 'triangle' })
  } catch { /* brak audio nie moze przerwac sesji */ }
}
