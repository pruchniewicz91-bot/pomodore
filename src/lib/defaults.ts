import type { Settings } from '../types'

// Wartosci odzyskane z Twojej instalacji 1.0 - nie sa wymyslone.
export const DEFAULT_SETTINGS: Settings = {
  focusMin: 15,
  shortBreakMin: 5,
  longBreakMin: 15,
  longBreakEveryMinutes: 0,
  longBreakEverySessions: 4,
  autoStartBreak: true,
  autoStartFocus: false,
  soundsEnabled: true,
  soundVolume: 0.74,
  bgSoundFocus: 'none',
  bgSoundBreak: 'none',
  bgSoundVolume: 0.5,
  endSoundFocus: 'chime',
  endSoundBreak: 'gong',
  warningMinutes: 2,
  presenceIntervalMin: 0,
  breathsCount: 0,
  askReflection: true,
  defaultMood: null,
  dialSnapMinutes: 1,
  keepScreenOn: true,
  theme: 'glass',
  dailyGoalMinutes: 120,
  dailySessionGoal: 8,
}

export const PALETTE = [
  '#1F8A8A', '#C2472E', '#D9A521', '#3557D4',
  '#6B4FA8', '#2E8B4A', '#B8456F', '#4A6572',
]
