import { create } from 'zustand'
import { KEY, type Session } from '../types'
import { readKey, writeKey, nowMs, mergeById, registerReloader } from '../lib/storage'
import { scheduleSync } from '../lib/sync'

/**
 * Dziennik sesji celowo NIE uzywa middleware persist.
 * Wersja 1.0 zapisywala go jako czysta tablice JSON, nie jako {state, version}.
 * Trzymamy sie tego formatu, zeby odzyskane rekordy wczytywaly sie wprost.
 *
 * Skutek uboczny: tablica nie ma numeru wersji, wiec migracja pol
 * synchronizacji musi sie dziac przy kazdym odczycie.
 */
interface SessionsStore {
  sessions: Session[]
  active(): Session[]
  add(s: Session): void
  update(id: string, patch: Partial<Session>): void
  replaceAll(list: Session[]): void
  reload(): void
}

/**
 * Uzupelnia pola synchronizacji w rekordach sprzed wersji 2.0.
 * updatedAt = endedAt, a nie "teraz": dwumiesieczna sesja historyczna nie moze
 * wygrywac rozstrzygania konfliktu z edycja zrobiona wczoraj gdzie indziej.
 */
// Wersja 1.0 zapisywala tryb z podkresleniem. Typ Mode uzywa wielblada.
// Bez tej mapy 11 z 29 odzyskanych sesji trafiloby do chmury w starej pisowni
// i zostaloby tam na stale, niezgodne z tym, co zapisuje biezacy kod.
const STARE_TRYBY: Record<string, Session['mode']> = {
  short_break: 'shortBreak',
  long_break: 'longBreak',
  shortbreak: 'shortBreak',
  longbreak: 'longBreak',
}

function migrate(list: Session[]): { list: Session[]; changed: boolean } {
  let changed = false
  const out = list.map((s) => {
    const trybDoPoprawy = STARE_TRYBY[s.mode as unknown as string]
    const brakPol = s.updatedAt === undefined || s.deletedAt === undefined
    if (!trybDoPoprawy && !brakPol) return s
    changed = true
    return {
      ...s,
      mode: trybDoPoprawy ?? s.mode,
      updatedAt: s.updatedAt ?? s.endedAt ?? s.startedAt ?? 0,
      deletedAt: s.deletedAt ?? null,
    }
  })
  return { list: out, changed }
}

function load(): Session[] {
  const raw = readKey<Session[]>(KEY.sessions, [])
  if (!Array.isArray(raw)) return []
  const { list, changed } = migrate(raw)
  if (changed) writeKey(KEY.sessions, list)
  return list.slice().sort((a, b) => a.startedAt - b.startedAt)
}

/**
 * Zapis SCALAJACY, nie nadpisujacy. Magazyn trzyma kopie w pamieci od chwili
 * zaladowania modulu; synchronizacja pisze do localStorage bezposrednio.
 * Nadpisanie calej tablicy stanem z pamieci kasowaloby rekordy pobrane z
 * chmury w miedzyczasie - a kursor juz by je minal, wiec nie wrocilyby nigdy.
 */
function save(list: Session[]) {
  const naDysku = readKey<Session[]>(KEY.sessions, [])
  const merged = mergeById(naDysku, list).sort((a, b) => a.startedAt - b.startedAt)
  writeKey(KEY.sessions, merged)
  scheduleSync()
}

export const useSessions = create<SessionsStore>()((set, get) => ({
  sessions: load(),

  active: () => get().sessions.filter((s) => !s.deletedAt),

  add: (s) => {
    const next = [...get().sessions, s].sort((a, b) => a.startedAt - b.startedAt)
    set({ sessions: next })
    save(next)
  },

  update: (id, patch) => {
    const next = get().sessions.map((s) =>
      s.id === id ? { ...s, ...patch, updatedAt: nowMs(), synced: false } : s
    )
    set({ sessions: next })
    save(next)
  },

  replaceAll: (list) => {
    const next = list.slice().sort((a, b) => a.startedAt - b.startedAt)
    set({ sessions: next })
    save(next)
  },

  reload: () => set({ sessions: load() }),
}))

// --- pomocnicze odczyty, uzywane przez widok statystyk ---

export function startOfToday(): number {
  const d = new Date()
  d.setHours(0, 0, 0, 0)
  return d.getTime()
}

export function todaysFocus(sessions: Session[]) {
  const from = startOfToday()
  const today = sessions.filter(
    (s) => !s.deletedAt && s.startedAt >= from && s.mode === 'focus' && s.status === 'completed'
  )
  return {
    count: today.length,
    seconds: today.reduce((sum, s) => sum + s.actualSeconds, 0),
    list: today,
  }
}

/** Liczba kolejnych dni wstecz z co najmniej jedna ukonczona sesja skupienia. */
export function streak(sessions: Session[]): number {
  const days = new Set(
    sessions
      .filter((s) => !s.deletedAt && s.mode === 'focus' && s.status === 'completed')
      .map((s) => new Date(s.startedAt).toDateString())
  )
  let n = 0
  const cursor = new Date()
  // Dzisiaj bez sesji nie zeruje passy - dzien jeszcze trwa.
  if (!days.has(cursor.toDateString())) cursor.setDate(cursor.getDate() - 1)
  while (days.has(cursor.toDateString())) {
    n++
    cursor.setDate(cursor.getDate() - 1)
  }
  return n
}

// Synchronizacja wola to po kazdym zapisie do localStorage.
registerReloader(() => useSessions.getState().reload())
