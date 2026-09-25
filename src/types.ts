// Ksztalt danych odtworzony 1:1 z kopii zapasowej iPhone'a (localstorage.sqlite3).
// Nie zmieniaj pol bez migracji - stare rekordy musza sie wczytac.

export type Mode = 'focus' | 'shortBreak' | 'longBreak'
export type SessionStatus = 'completed' | 'abandoned'
export type TimerStatus = 'idle' | 'running' | 'paused'

export interface Category {
  id: string
  name: string
  color: string
  position: number
  createdAt: number
  synced: boolean
  // Nadpisania ustawien globalnych. null = dziedzicz.
  focusMin: number | null
  shortBreakMin: number | null
  longBreakMin: number | null
  longBreakEverySessions: number | null
  longBreakEveryMinutes: number | null
  dailySessionGoal: number | null
}

export interface Session {
  id: string
  intention: string
  categoryId: string | null
  mode: Mode
  plannedSeconds: number
  actualSeconds: number
  status: SessionStatus
  reflection: string | null
  mood: number | null
  startedAt: number
  endedAt: number
  synced: boolean
}

export interface Settings {
  focusMin: number
  shortBreakMin: number
  longBreakMin: number
  longBreakEveryMinutes: number
  longBreakEverySessions: number
  autoStartBreak: boolean
  autoStartFocus: boolean
  soundsEnabled: boolean
  soundVolume: number
  bgSoundFocus: string
  bgSoundBreak: string
  bgSoundVolume: number
  endSoundFocus: string
  endSoundBreak: string
  warningMinutes: number
  presenceIntervalMin: number
  breathsCount: number
  askReflection: boolean
  defaultMood: number | null
  dialSnapMinutes: number
  keepScreenOn: boolean
  theme: string
  dailyGoalMinutes: number
  dailySessionGoal: number
}

export interface TimerState {
  status: TimerStatus
  mode: Mode
  intention: string
  categoryId: string | null
  startedAt: number | null
  pausedAt: number | null
  pausedTotalMs: number
  plannedSeconds: number
  plannedOverrideSeconds: number | null
  focusCount: number
  focusMinutesSinceLongBreak: number
  warningFired: boolean
  presenceFired: number
  pendingReflection: string | null
}

// Klucze localStorage - identyczne jak w wersji 1.0 na iPhonie.
export const KEY = {
  settings: 'pomodore-settings',
  categories: 'pomodore-categories',
  sessions: 'pomodore-session-log',
  timer: 'pomodore-timer',
} as const
