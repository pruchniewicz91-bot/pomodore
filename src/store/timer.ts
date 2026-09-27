import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { KEY, type Mode, type Session, type SessionStatus, type TimerState } from '../types'
import { useSettings } from './settings'
import { useCategories } from './categories'
import { useSessions } from './sessions'
import { effective, minutesFor } from '../lib/effective'
import { playEndSound, warn } from '../lib/audio'
import { flushNow } from '../lib/sync'

interface TimerStore extends TimerState {
  elapsedSeconds(): number
  remainingSeconds(): number
  plannedFor(mode: Mode): number
  setIntention(v: string): void
  setCategory(id: string | null): void
  setOverrideMinutes(min: number | null): void
  start(mode?: Mode): void
  pause(): void
  resume(): void
  stop(status?: SessionStatus): void
  complete(): void
  tick(): void
  submitReflection(text: string, mood: number | null): void
  dismissReflection(): void
}

const INITIAL: TimerState = {
  status: 'idle',
  mode: 'focus',
  intention: '',
  categoryId: null,
  startedAt: null,
  pausedAt: null,
  pausedTotalMs: 0,
  plannedSeconds: 0,
  plannedOverrideSeconds: null,
  focusCount: 0,
  focusMinutesSinceLongBreak: 0,
  warningFired: false,
  presenceFired: 0,
  pendingReflection: null,
}

export const useTimer = create<TimerStore>()(
  persist(
    (set, get) => ({
      ...INITIAL,

      plannedFor: (mode) => {
        const s = get()
        if (mode === 'focus' && s.plannedOverrideSeconds) return s.plannedOverrideSeconds
        const cat = useCategories.getState().byId(s.categoryId)
        return Math.round(minutesFor(mode, useSettings.getState(), cat) * 60)
      },

      // Liczone z sygnatur czasowych, nie z licznika tykniec - odporne na uspienie ekranu.
      elapsedSeconds: () => {
        const { startedAt, pausedAt, pausedTotalMs, status } = get()
        if (!startedAt || status === 'idle') return 0
        const end = status === 'paused' && pausedAt ? pausedAt : Date.now()
        return Math.max(0, Math.floor((end - startedAt - pausedTotalMs) / 1000))
      },

      remainingSeconds: () => Math.max(0, get().plannedSeconds - get().elapsedSeconds()),

      setIntention: (v) => set({ intention: v }),
      setCategory: (id) => set({ categoryId: id, plannedOverrideSeconds: null }),
      setOverrideMinutes: (min) =>
        set({ plannedOverrideSeconds: min === null ? null : Math.round(min * 60) }),

      start: (mode) => {
        const m = mode ?? get().mode
        set({
          status: 'running',
          mode: m,
          startedAt: Date.now(),
          pausedAt: null,
          pausedTotalMs: 0,
          plannedSeconds: get().plannedFor(m),
          warningFired: false,
          presenceFired: 0,
        })
      },

      pause: () => {
        if (get().status !== 'running') return
        set({ status: 'paused', pausedAt: Date.now() })
      },

      resume: () => {
        const { status, pausedAt, pausedTotalMs } = get()
        if (status !== 'paused' || !pausedAt) return
        set({ status: 'running', pausedAt: null, pausedTotalMs: pausedTotalMs + (Date.now() - pausedAt) })
      },

      /** Zatrzymanie przed czasem. Zapisuje sesje jako porzucona, zeby nie znikla z historii. */
      stop: (status = 'abandoned') => {
        const s = get()
        if (s.status !== 'idle' && s.startedAt) logSession(s, s.elapsedSeconds(), status)
        set({ ...INITIAL, mode: 'focus', intention: s.intention, categoryId: s.categoryId,
              focusCount: s.focusCount, focusMinutesSinceLongBreak: s.focusMinutesSinceLongBreak })
      },

      complete: () => {
        const s = get()
        if (!s.startedAt) return
        const actual = s.elapsedSeconds()
        const settings = useSettings.getState()
        const cat = useCategories.getState().byId(s.categoryId)

        logSession(s, actual, 'completed')
        if (settings.soundsEnabled) playEndSound(s.mode, settings)

        if (s.mode === 'focus') {
          const count = s.focusCount + 1
          const minutes = s.focusMinutesSinceLongBreak + actual / 60
          const e = effective(settings, cat)

          const bySessions = e.longBreakEverySessions > 0 && count % e.longBreakEverySessions === 0
          const byMinutes = e.longBreakEveryMinutes > 0 && minutes >= e.longBreakEveryMinutes
          const next: Mode = bySessions || byMinutes ? 'longBreak' : 'shortBreak'

          set({
            ...INITIAL,
            mode: next,
            intention: s.intention,
            categoryId: s.categoryId,
            focusCount: count,
            focusMinutesSinceLongBreak: next === 'longBreak' ? 0 : minutes,
            pendingReflection: settings.askReflection ? lastSessionId : null,
          })
          if (settings.autoStartBreak) get().start(next)
        } else {
          set({
            ...INITIAL,
            mode: 'focus',
            intention: s.intention,
            categoryId: s.categoryId,
            focusCount: s.focusCount,
            focusMinutesSinceLongBreak: s.focusMinutesSinceLongBreak,
          })
          if (settings.autoStartFocus) get().start('focus')
        }
      },

      tick: () => {
        const s = get()
        if (s.status !== 'running') return
        const left = s.remainingSeconds()
        const settings = useSettings.getState()

        if (!s.warningFired && settings.warningMinutes > 0 && left <= settings.warningMinutes * 60 && left > 0) {
          set({ warningFired: true })
          if (settings.soundsEnabled) warn(settings)
        }
        if (left <= 0) get().complete()
      },

      submitReflection: (text, mood) => {
        const id = get().pendingReflection
        if (id) useSessions.getState().update(id, { reflection: text || null, mood })
        set({ pendingReflection: null })
        // Refleksja to jedyna tresc w tej aplikacji, ktorej nie da sie odtworzyc.
        flushNow()
      },

      dismissReflection: () => set({ pendingReflection: null }),
    }),
    {
      name: KEY.timer,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ elapsedSeconds: _a, remainingSeconds: _b, plannedFor: _c, setIntention: _d,
                     setCategory: _e, setOverrideMinutes: _f, start: _g, pause: _h, resume: _i,
                     stop: _j, complete: _k, tick: _l, submitReflection: _m, dismissReflection: _n,
                     ...rest }) => rest,
    }
  )
)

let lastSessionId: string | null = null

function logSession(s: TimerState, actualSeconds: number, status: SessionStatus) {
  // Sesje krotsze niz 10 sekund to zwykle pomylka, nie praca.
  if (actualSeconds < 10 && status === 'abandoned') return
  const session: Session = {
    id: crypto.randomUUID(),
    intention: s.intention,
    categoryId: s.categoryId,
    mode: s.mode,
    plannedSeconds: s.plannedSeconds,
    actualSeconds,
    status,
    reflection: null,
    mood: null,
    startedAt: s.startedAt!,
    endedAt: Date.now(),
    synced: false,
    updatedAt: Date.now(),
    deletedAt: null,
  }
  lastSessionId = session.id
  useSessions.getState().add(session)
  // Bez dlawienia: iOS zamraza JS, gdy telefon laduje w kieszeni po sesji,
  // a wtedy timer odroczonej wysylki juz nie wystartuje.
  flushNow()
}
