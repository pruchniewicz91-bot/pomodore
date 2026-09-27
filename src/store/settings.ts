import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { KEY, type Settings } from '../types'
import { DEFAULT_SETTINGS } from '../lib/defaults'
import { nowMs, writeRaw, registerReloader } from '../lib/storage'
import { scheduleSync } from '../lib/sync'

interface SettingsStore extends Settings {
  set<K extends keyof Settings>(key: K, value: Settings[K]): void
  resetAll(): void
}

/** Znacznik zmiany ustawien zyje obok, bo persist zapisuje tylko pola Settings. */
function touch() {
  writeRaw(KEY.settingsUpdatedAt, String(nowMs()))
  scheduleSync()
}

export const useSettings = create<SettingsStore>()(
  persist(
    (set) => ({
      ...DEFAULT_SETTINGS,
      set: (key, value) => { set({ [key]: value } as never); touch() },
      resetAll: () => { set({ ...DEFAULT_SETTINGS }); touch() },
    }),
    {
      name: KEY.settings,
      version: 2,
      storage: createJSONStorage(() => localStorage),
      partialize: ({ set: _s, resetAll: _r, ...rest }) => rest,
      // Brakujace pola w starej kopii uzupelniamy domyslnymi, zamiast ja odrzucac.
      merge: (persisted, current) => ({
        ...current,
        ...DEFAULT_SETTINGS,
        ...(persisted as object),
      }),
    }
  )
)

registerReloader(() => { void useSettings.persist.rehydrate() })
