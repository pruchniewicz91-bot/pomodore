import type { Category, Session } from '../types'

/**
 * Agregacje do widoku podsumowania.
 *
 * Wydzielone z komponentu, bo to czysta logika na danych i chce ja miec
 * testowalna bez renderowania. Wszystkie funkcje pomijaja nagrobki.
 */

export type Okres = 7 | 30 | 0   // 0 = wszystko

export interface Dzien {
  data: Date
  klucz: string
  sekundy: number
  sesje: number
}

export interface UdzialKategorii {
  id: string | null
  nazwa: string
  kolor: string
  sekundy: number
  sesje: number
  udzial: number
}

const DZIEN_MS = 86_400_000

function poczatekDnia(d: Date): Date {
  const k = new Date(d)
  k.setHours(0, 0, 0, 0)
  return k
}

/** Ukonczone sesje skupienia z okresu. Przerwy i porzucone nie licza sie do czasu. */
export function wOkresie(sessions: Session[], okres: Okres, teraz = Date.now()): Session[] {
  const od = okres === 0 ? 0 : poczatekDnia(new Date(teraz - (okres - 1) * DZIEN_MS)).getTime()
  return sessions.filter(
    (s) => !s.deletedAt && s.mode === 'focus' && s.status === 'completed' && s.startedAt >= od
  )
}

/** Jeden wpis na dzien, takze dla dni pustych - inaczej wykres klamie o rytmie. */
export function poDniach(sessions: Session[], okres: Okres, teraz = Date.now()): Dzien[] {
  const dni = okres === 0 ? zakresDni(sessions, teraz) : okres
  const out: Dzien[] = []
  for (let i = dni - 1; i >= 0; i--) {
    const d = poczatekDnia(new Date(teraz - i * DZIEN_MS))
    out.push({ data: d, klucz: d.toDateString(), sekundy: 0, sesje: 0 })
  }
  const wg = new Map(out.map((d) => [d.klucz, d]))
  for (const s of sessions) {
    const k = poczatekDnia(new Date(s.startedAt)).toDateString()
    const d = wg.get(k)
    if (d) { d.sekundy += s.actualSeconds; d.sesje++ }
  }
  return out
}

function zakresDni(sessions: Session[], teraz: number): number {
  if (!sessions.length) return 7
  const naj = Math.min(...sessions.map((s) => s.startedAt))
  return Math.min(365, Math.max(7, Math.ceil((teraz - naj) / DZIEN_MS) + 1))
}

/**
 * Udzialy kategorii. Cztery najwieksze zachowuja wlasny kolor, reszta laczy sie
 * w "Pozostale" - walidator palety pokazal, ze piaty kolor lamie rozroznialnosc
 * przy daltonizmie, wiec pieciu barw po prostu nie wolno tu postawic.
 */
export const MAX_KOLOROW = 4
export const KOLOR_POZOSTALE = 'var(--text-faint)'

export function udzialy(
  sessions: Session[], categories: Category[], limit = MAX_KOLOROW
): UdzialKategorii[] {
  const wg = new Map<string | null, { sekundy: number; sesje: number }>()
  for (const s of sessions) {
    const k = s.categoryId ?? null
    const w = wg.get(k) ?? { sekundy: 0, sesje: 0 }
    w.sekundy += s.actualSeconds; w.sesje++
    wg.set(k, w)
  }

  const suma = [...wg.values()].reduce((a, w) => a + w.sekundy, 0) || 1
  const lista = [...wg.entries()]
    .map(([id, w]) => {
      const c = categories.find((x) => x.id === id)
      return {
        id,
        nazwa: c?.name ?? 'Bez kategorii',
        kolor: c?.color ?? KOLOR_POZOSTALE,
        sekundy: w.sekundy,
        sesje: w.sesje,
        udzial: w.sekundy / suma,
      }
    })
    .sort((a, b) => b.sekundy - a.sekundy)

  if (lista.length <= limit) return lista

  const glowne = lista.slice(0, limit)
  const reszta = lista.slice(limit)
  glowne.push({
    id: null,
    nazwa: `Pozostałe (${reszta.length})`,
    kolor: KOLOR_POZOSTALE,
    sekundy: reszta.reduce((a, r) => a + r.sekundy, 0),
    sesje: reszta.reduce((a, r) => a + r.sesje, 0),
    udzial: reszta.reduce((a, r) => a + r.udzial, 0),
  })
  return glowne
}

/** Poprzedni okres tej samej dlugosci - do porownania "wiecej czy mniej". */
export function poprzedniOkres(sessions: Session[], okres: Okres, teraz = Date.now()) {
  if (okres === 0) return null
  const doKiedy = poczatekDnia(new Date(teraz - (okres - 1) * DZIEN_MS)).getTime()
  const od = doKiedy - okres * DZIEN_MS
  const poprz = sessions.filter(
    (s) => !s.deletedAt && s.mode === 'focus' && s.status === 'completed' &&
           s.startedAt >= od && s.startedAt < doKiedy
  )
  return { sekundy: poprz.reduce((a, s) => a + s.actualSeconds, 0), sesje: poprz.length }
}

export function minuty(sekundy: number): number {
  return Math.round(sekundy / 60)
}

/** Zwiezly zapis do kafelkow - "5h45" zamiast "5 h 45 min", ktore sie lamie. */
export function czytelnyCzasKrotki(sekundy: number): string {
  const m = Math.round(sekundy / 60)
  if (m < 60) return `${m} min`
  const g = Math.floor(m / 60)
  const r = m % 60
  return r ? `${g}h ${r}m` : `${g}h`
}

/** Dni, w ktorych cokolwiek zrobiles. Srednia po nich mowi wiecej niz po kalendarzu. */
export function dniAktywne(sessions: Session[]): number {
  return new Set(sessions.map((s) => new Date(s.startedAt).toDateString())).size
}

export function czytelnyCzas(sekundy: number): string {
  const m = Math.round(sekundy / 60)
  if (m < 60) return `${m} min`
  const g = Math.floor(m / 60)
  const r = m % 60
  return r ? `${g} h ${r} min` : `${g} h`
}
