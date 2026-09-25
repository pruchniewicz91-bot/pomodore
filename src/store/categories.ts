import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { KEY, type Category } from '../types'
import { PALETTE } from '../lib/defaults'
import { scheduleSync } from '../lib/storage'

interface CategoriesStore {
  categories: Category[]
  add(name: string, color?: string): Category
  update(id: string, patch: Partial<Category>): void
  remove(id: string): void
  byId(id: string | null): Category | null
}

export const useCategories = create<CategoriesStore>()(
  persist(
    (set, get) => ({
      categories: [],

      add: (name, color) => {
        const list = get().categories
        const cat: Category = {
          id: crypto.randomUUID(),
          name,
          color: color ?? PALETTE[list.length % PALETTE.length],
          position: list.length,
          createdAt: Date.now(),
          synced: false,
          focusMin: null,
          shortBreakMin: null,
          longBreakMin: null,
          longBreakEverySessions: null,
          longBreakEveryMinutes: null,
          dailySessionGoal: null,
        }
        set({ categories: [...list, cat] })
        scheduleSync()
        return cat
      },

      update: (id, patch) => {
        set({
          categories: get().categories.map((c) =>
            c.id === id ? { ...c, ...patch, synced: false } : c
          ),
        })
        scheduleSync()
      },

      remove: (id) => {
        set({
          categories: get().categories
            .filter((c) => c.id !== id)
            .map((c, i) => ({ ...c, position: i })),
        })
        scheduleSync()
      },

      byId: (id) => (id ? get().categories.find((c) => c.id === id) ?? null : null),
    }),
    {
      name: KEY.categories,
      version: 4,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ categories: s.categories }),
    }
  )
)
