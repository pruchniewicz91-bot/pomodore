import { KEY } from '../types'
import type { Category, Session, Settings } from '../types'
import { nowMs, readKey, snapshot, writeKey, writeRaw, type Snapshot } from './storage'

/**
 * Trzecia warstwa trwalosci: plik na dysku.
 * Chmura nie jest wieczna - darmowy plan Supabase usypia projekt po tygodniu
 * bezczynnosci i po dlugim uspieniu moze go skasowac. To niepokojaco dokladne
 * echo siedmiodniowego certyfikatu Apple, ktory zabral wersje 1.0.
 */

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
  localStorage.setItem('pomodore-last-backup', String(nowMs()))
}

export function daysSinceBackup(): number | null {
  const raw = localStorage.getItem('pomodore-last-backup')
  if (!raw) return null
  return Math.floor((nowMs() - Number(raw)) / 86_400_000)
}

export interface RestoreReport {
  sessions: number
  categories: number
  /** Rekordy pominiete, bo lokalnie maja nagrobek - nie wskrzeszamy ich. */
  skippedDeleted: number
  settings: 'zaktualizowane' | 'pominiete-starsze' | 'pominiete-brak-daty' | 'brak'
}

/**
 * Scalanie po id. Ta funkcja odzyskala 29 sesji z kopii iPhone'a i jej rdzen
 * zostaje bez zmian. Doszly dwie rzeczy, ktorych brak byl bledem:
 *
 *  - swiadomosc nagrobkow: rekord skasowany lokalnie nie wraca do zycia
 *    przez wczytanie starszej kopii,
 *  - porownanie czasu dla ustawien: wczytanie kopii sprzed dwoch miesiecy
 *    nie moze cofnac ustawien na wszystkich urzadzeniach. Wczesniej robilo
 *    to bezwarunkowo, mimo komunikatu obiecujacego, ze import nic nie nadpisuje.
 */
export function restoreBackup(json: string): RestoreReport {
  const data = JSON.parse(json) as Partial<Snapshot>
  if (!data || typeof data !== 'object') throw new Error('To nie jest plik kopii Pomodore')

  const report: RestoreReport = {
    sessions: 0, categories: 0, skippedDeleted: 0, settings: 'brak',
  }

  if (Array.isArray(data.sessions)) {
    const existing = readKey<Session[]>(KEY.sessions, [])
    const byId = new Map(existing.map((s) => [s.id, s]))
    for (const s of data.sessions) {
      const mine = byId.get(s.id)
      if (mine?.deletedAt) { report.skippedDeleted++; continue }
      const zPliku = {
        ...s,
        synced: false,
        updatedAt: s.updatedAt ?? s.endedAt ?? s.startedAt ?? 0,
        deletedAt: s.deletedAt ?? null,
      }
      // Rekord istniejacy lokalnie, ale STARSZY, zostaje odtworzony z pliku.
      // Wczesniej kazdy istniejacy byl pomijany, wiec kopia nie potrafila
      // naprawic wpisu uszkodzonego albo pozbawionego refleksji.
      if (mine && zPliku.updatedAt <= (mine.updatedAt ?? 0)) continue
      byId.set(s.id, zPliku)
      report.sessions++
    }
    writeKey(KEY.sessions, [...byId.values()].sort((a, b) => a.startedAt - b.startedAt))
  }

  if (Array.isArray(data.categories)) {
    const box = readKey<{ state: { categories: Category[] }; version: number }>(
      KEY.categories, { state: { categories: [] }, version: 6 }
    )
    const byId = new Map(box.state.categories.map((c) => [c.id, c]))
    for (const c of data.categories) {
      const mine = byId.get(c.id)
      if (mine?.deletedAt) { report.skippedDeleted++; continue }
      const zPliku = {
        ...c,
        synced: false,
        updatedAt: c.updatedAt ?? c.createdAt ?? 0,
        deletedAt: c.deletedAt ?? null,
      }
      if (mine && zPliku.updatedAt <= (mine.updatedAt ?? 0)) continue
      byId.set(c.id, zPliku)
      report.categories++
    }
    // version: 6 celowo na sztywno - to biezacy numer, a import musi przejsc
    // przez te sama sciezke co reszta. Przy podniesieniu wersji zmienic TU.
    writeKey(KEY.categories, { state: { categories: [...byId.values()] }, version: 6 })
  }

  if (data.settings && Object.keys(data.settings).length) {
    const fileAt = data.exportedAt ?? 0
    if (!fileAt) {
      report.settings = 'pominiete-brak-daty'
    } else {
      const currentAt = Number(localStorage.getItem(KEY.settingsUpdatedAt) ?? 0)
      const localBaseline = currentAt || 0
      if (fileAt >= localBaseline) {
        writeKey(KEY.settings, { state: data.settings as Settings, version: 2 })
        writeRaw(KEY.settingsUpdatedAt, String(fileAt))
        report.settings = 'zaktualizowane'
      } else {
        report.settings = 'pominiete-starsze'
      }
    }
  }

  return report
}
