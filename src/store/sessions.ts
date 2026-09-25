import { create } from 'zustand'
import { KEY, type Session } from '../types'
import { readKey, writeKey, scheduleSync } from '../lib/storage'

/**
 * Dziennik sesji celowo NIE uzywa middleware persist.
 * Wersja 1.0 zapisywala go jako czysta tablice JSON, nie jako {state, version}.
 * Trzymamy sie tego formatu, zeby odzyskane rekordy wczytywaly sie wprost.
 */
interface SessionsStore {
  sessions: Session[]
  add(s: Session): void
  update(id: string, patch: Partial<Session>): void
  replaceAll(list: Session[]): void
  reload(): void
}

function load(): Session[] {
  const raw = readKey<Session[]>(KEY.sessions, [])
  return Array.isArray(raw) ? raw.slice().sort((a, b) => a.startedAt - b.startedAt) : []
}

function save(list: Session[]) {
  writeKey(KEY.sessions, list)
  scheduleSync()
}

export const useSessions = create<SessionsStore>()((set, get) => ({
  sessions: load(),

  add: (s) => {
    const next = [...get().sessions, s].sort((a, b) => a.startedAt - b.startedAt)
    set({ sessions: next })
    save(next)
  },

  update: (id, patch) => {
    const next = get().sessions.map((s) => (s.id === id ? { ...s, ...patch, synced: false } : s))
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
    (s) => s.startedAt >= from && s.mode === 'focus' && s.status === 'completed'
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
      .filter((s) => s.mode === 'focus' && s.status === 'completed')
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
