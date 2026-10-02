import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { KEY, type Category } from '../types'
import { PALETTE } from '../lib/defaults'
import { nowMs, mergeById, registerReloader } from '../lib/storage'
import { scheduleSync } from '../lib/sync'

interface CategoriesStore {
  categories: Category[]
  /** Bez nagrobkow - to jest lista do pokazania uzytkownikowi. */
  active(): Category[]
  add(name: string, color?: string): Category
  update(id: string, patch: Partial<Category>): void
  remove(id: string): void
  /** Zwraca takze skasowane, zeby stara sesja nie stracila etykiety. */
  byId(id: string | null): Category | null
}

export const useCategories = create<CategoriesStore>()(
  persist(
    (set, get) => ({
      categories: [],

      active: () => get().categories.filter((c) => !c.deletedAt),

      add: (name, color) => {
        const list = get().categories
        const now = nowMs()
        const cat: Category = {
          id: crypto.randomUUID(),
          name,
          color: color ?? PALETTE[list.length % PALETTE.length],
          position: list.length,
          createdAt: now,
          synced: false,
          updatedAt: now,
          deletedAt: null,
          focusMin: null,
          shortBreakMin: null,
          longBreakMin: null,
          longBreakEverySessions: null,
          longBreakEveryMinutes: null,
          dailySessionGoal: null,
          weeklyGoalMinutes: null,
        }
        set({ categories: [...list, cat] })
        scheduleSync()
        return cat
      },

      update: (id, patch) => {
        set({
          categories: get().categories.map((c) =>
            c.id === id ? { ...c, ...patch, updatedAt: nowMs(), synced: false } : c
          ),
        })
        scheduleSync()
      },

      /**
       * Nagrobek zamiast usuniecia z tablicy. Bez tego skasowanie kategorii
       * na Macu nigdy nie dotarloby na iPhone'a, a kazdy mechanizm rownania
       * zbiorow zamienilby swiezo zainstalowana aplikacje w kasownik chmury.
       */
      remove: (id) => {
        set({
          categories: get().categories.map((c) =>
            c.id === id ? { ...c, deletedAt: nowMs(), updatedAt: nowMs(), synced: false } : c
          ),
        })
        scheduleSync()
      },

      byId: (id) => (id ? get().categories.find((c) => c.id === id) ?? null : null),
    }),
    {
      name: KEY.categories,
      version: 6,
      /**
       * Ten sam problem co w sessions.ts: persist zapisuje cala tablice
       * z pamieci. Kategoria pobrana z chmury zniknelaby przy pierwszej
       * lokalnej edycji. Dlatego scalamy z zawartoscia dysku przy KAZDYM zapisie.
       */
      storage: createJSONStorage(() => ({
        getItem: (name) => localStorage.getItem(name),
        setItem: (name, value) => {
          let out = value
          try {
            const wchodzi = JSON.parse(value) as { state?: { categories?: Category[] } }
            const naDysku = JSON.parse(localStorage.getItem(name) ?? 'null') as
              { state?: { categories?: Category[] } } | null
            if (naDysku?.state?.categories && wchodzi?.state?.categories) {
              wchodzi.state.categories = mergeById(naDysku.state.categories, wchodzi.state.categories)
                .sort((a, b) => a.position - b.position)
              out = JSON.stringify(wchodzi)
            }
          } catch { /* przy bledzie zapisujemy wersje oryginalna */ }
          localStorage.setItem(name, out)
        },
        removeItem: (name) => localStorage.removeItem(name),
      })),
      partialize: (s) => ({ categories: s.categories }),
      /**
       * Migracja z wersji 4. Bez niej istniejace kategorie wchodza w nowy kod
       * z updatedAt === undefined, co konczy sie albo bledem 23502 na kolumnie
       * not null (rekord brudny na zawsze), albo cichym default now() w bazie -
       * a wtedy dwumiesieczny rekord historyczny wygrywa rozstrzyganie
       * z realna edycja zrobiona wczoraj na drugim urzadzeniu.
       */
      migrate: (persisted, version) => {
        const box = persisted as { categories?: Category[] } | undefined
        const list = box?.categories ?? []
        if (version >= 6) return { categories: list }
        // Z wersji 4 doszly pola synchronizacji, z wersji 5 cel tygodniowy.
        // Brak celu to null, a nie zero - zero znaczyloby "cel wynosi 0 minut".
        return {
          categories: list.map((c) => ({
            ...c,
            updatedAt: c.updatedAt ?? c.createdAt ?? 0,
            deletedAt: c.deletedAt ?? null,
            weeklyGoalMinutes: c.weeklyGoalMinutes ?? null,
            synced: version < 5 ? false : c.synced,
          })),
        }
      },
    }
  )
)

registerReloader(() => { void useCategories.persist.rehydrate() })
