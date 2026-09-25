import { KEY } from '../types'
import type { Category, Session, Settings } from '../types'

/**
 * Jedyne miejsce w aplikacji, ktore dotyka trwalego zapisu.
 *
 * Powod istnienia: wersja 1.0 trzymala wszystko wylacznie w localStorage
 * wewnatrz natywnej skorupy. Skorupa przestala sie uruchamiac i dane staly sie
 * nieosiagalne az do odzyskania ich z kopii zapasowej iPhone'a. Jako PWA jest
 * jeszcze krucej - WebKit potrafi wyczyscic storage strony bez ostrzezenia.
 *
 * Dlatego zapis jest dwutorowy: lokalnie natychmiast (szybko, dziala offline)
 * i zdalnie przez adapter (trwale). Brak adaptera nie psuje aplikacji, ale
 * kazdy rekord zostaje z synced=false, wiec widac go w interfejsie.
 */

export interface Snapshot {
  settings: Settings
  categories: Category[]
  sessions: Session[]
  exportedAt: number
  schema: number
}

export const SCHEMA_VERSION = 5

export interface RemoteAdapter {
  name: string
  pull(): Promise<Snapshot | null>
  push(snapshot: Snapshot): Promise<void>
}

let remote: RemoteAdapter | null = null
let pushTimer: ReturnType<typeof setTimeout> | null = null

export function setRemote(adapter: RemoteAdapter | null) {
  remote = adapter
}

export function hasRemote() {
  return remote !== null
}

export function remoteName() {
  return remote?.name ?? null
}

/** Czyta klucz i zwraca fallback, gdy go nie ma albo jest uszkodzony. */
export function readKey<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key)
    if (raw === null) return fallback
    return JSON.parse(raw) as T
  } catch {
    // Uszkodzony wpis jest gorszy niz jego brak - nie wywracamy aplikacji.
    console.warn(`[storage] nie udalo sie odczytac ${key}, uzywam wartosci domyslnej`)
    return fallback
  }
}

export function writeKey(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value))
  } catch (e) {
    console.error(`[storage] zapis ${key} nieudany`, e)
  }
}

/** Zbiera caly stan w jeden obiekt - uzywane przy eksporcie i wysylce. */
export function snapshot(): Snapshot {
  const settings = readKey<{ state: Settings }>(KEY.settings, { state: {} as Settings }).state
  const categories = readKey<{ state: { categories: Category[] } }>(
    KEY.categories, { state: { categories: [] } }
  ).state.categories
  const sessions = readKey<Session[]>(KEY.sessions, [])
  return { settings, categories, sessions, exportedAt: Date.now(), schema: SCHEMA_VERSION }
}

/**
 * Wysylka do chmury, zdlawiona do jednego zapytania na 3 sekundy.
 * Wolana po kazdej zmianie danych; bez adaptera nie robi nic.
 */
export function scheduleSync() {
  if (!remote) return
  if (pushTimer) clearTimeout(pushTimer)
  pushTimer = setTimeout(async () => {
    try {
      await remote!.push(snapshot())
      window.dispatchEvent(new CustomEvent('pomodore:synced', { detail: { at: Date.now() } }))
    } catch (e) {
      console.error('[storage] synchronizacja nieudana', e)
      window.dispatchEvent(new CustomEvent('pomodore:sync-failed'))
    }
  }, 3000)
}
