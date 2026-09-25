import { KEY } from '../types'
import type { Category, Session, Settings } from '../types'
import { snapshot, writeKey, type Snapshot } from './storage'

/** Zrzut do pliku - ostatnia linia obrony, dziala bez konta i bez internetu. */
export function downloadBackup() {
  const data = snapshot()
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = `pomodore-backup-${stamp}.json`
  a.click()
  URL.revokeObjectURL(url)
  localStorage.setItem('pomodore-last-backup', String(Date.now()))
}

export function daysSinceBackup(): number | null {
  const raw = localStorage.getItem('pomodore-last-backup')
  if (!raw) return null
  return Math.floor((Date.now() - Number(raw)) / 86_400_000)
}

/**
 * Wczytanie zrzutu. Scala po id zamiast nadpisywac, zeby import starej kopii
 * nie skasowal sesji zapisanych po jej wykonaniu.
 */
export function restoreBackup(json: string): { sessions: number; categories: number } {
  const data = JSON.parse(json) as Partial<Snapshot>
  if (!data || typeof data !== 'object') throw new Error('To nie jest plik kopii Pomodore')

  let addedSessions = 0
  let addedCategories = 0

  if (Array.isArray(data.sessions)) {
    const existing = JSON.parse(localStorage.getItem(KEY.sessions) ?? '[]') as Session[]
    const seen = new Set(existing.map((s) => s.id))
    const merged = [...existing]
    for (const s of data.sessions) {
      if (!seen.has(s.id)) { merged.push(s); seen.add(s.id); addedSessions++ }
    }
    merged.sort((a, b) => a.startedAt - b.startedAt)
    writeKey(KEY.sessions, merged)
  }

  if (Array.isArray(data.categories)) {
    const cur = JSON.parse(localStorage.getItem(KEY.categories) ?? 'null') as
      { state: { categories: Category[] }; version: number } | null
    const existing = cur?.state.categories ?? []
    const seen = new Set(existing.map((c) => c.id))
    const merged = [...existing]
    for (const c of data.categories) {
      if (!seen.has(c.id)) { merged.push(c); seen.add(c.id); addedCategories++ }
    }
    merged.sort((a, b) => a.position - b.position)
    writeKey(KEY.categories, { state: { categories: merged }, version: 4 })
  }

  if (data.settings && Object.keys(data.settings).length) {
    writeKey(KEY.settings, { state: data.settings as Settings, version: 2 })
  }

  return { sessions: addedSessions, categories: addedCategories }
}
