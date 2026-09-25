import type { Category, Mode, Settings } from '../types'

/** Ustawienia kategorii nadpisuja globalne; null oznacza dziedziczenie. */
export function effective(settings: Settings, cat: Category | null) {
  const pick = <K extends keyof Category & keyof Settings>(key: K): number =>
    (cat && cat[key] !== null ? (cat[key] as number) : (settings[key] as number))
  return {
    focusMin: pick('focusMin'),
    shortBreakMin: pick('shortBreakMin'),
    longBreakMin: pick('longBreakMin'),
    longBreakEverySessions: pick('longBreakEverySessions'),
    longBreakEveryMinutes: pick('longBreakEveryMinutes'),
    dailySessionGoal: pick('dailySessionGoal'),
  }
}

export function minutesFor(mode: Mode, settings: Settings, cat: Category | null): number {
  const e = effective(settings, cat)
  if (mode === 'focus') return e.focusMin
  if (mode === 'shortBreak') return e.shortBreakMin
  return e.longBreakMin
}

export const MODE_LABEL: Record<Mode, string> = {
  focus: 'Skupienie',
  shortBreak: 'Przerwa',
  longBreak: 'Długa przerwa',
}

/** Biernik - do zdania "Zacznij ...". Mianownik dawal "Zacznij przerwa". */
export const MODE_ACCUSATIVE: Record<Mode, string> = {
  focus: 'skupienie',
  shortBreak: 'przerwę',
  longBreak: 'długą przerwę',
}
