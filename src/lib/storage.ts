import { KEY } from '../types'
import type { Category, Session, Settings } from '../types'

/**
 * Prymitywy zapisu lokalnego i rejestr adaptera chmury.
 * Orkiestracja synchronizacji mieszka w sync.ts, implementacja w remote.ts.
 *
 * Historia, ktora ksztaltuje ten plik: wersja 1.0 trzymala wszystko wylacznie
 * w localStorage wewnatrz natywnej skorupy. Skorupa przestala sie uruchamiac
 * i dane staly sie nieosiagalne az do odzyskania ich z kopii zapasowej iPhone'a.
 *
 * Poprzednia wersja tego pliku miala mine: push(snapshot()) wysylal CALY stan
 * lokalny. Gdyby WebKit wyczyscil localStorage, snapshot() zwrocilby pusta
 * tablice, a pierwsza zmiana danych wyslalaby te pustke na serwer - czyli
 * utrata 1.0 jeszcze raz, tylko zdalnie i nieodwracalnie. Dlatego wysylka jest
 * teraz przyrostowa: ida wylacznie rekordy z synced=false. Pusty magazyn
 * lokalny nie ma czego wyslac. Bezpieczenstwo wynika z konstrukcji, nie
 * z ostroznosci.
 */

export const SCHEMA_VERSION = 6

// --- prymitywy ---------------------------------------------------------

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

/**
 * Zwraca false, gdy zapis sie nie powiodl (brak miejsca, tryb prywatny).
 * Wolajacy MUSI to sprawdzic: cichy blad zapisu przy scalaniu oznaczal, ze
 * kursor przesuwal sie nad rekordami, ktore nigdy nie trafily na dysk.
 */
export function writeKey(key: string, value: unknown): boolean {
  try {
    localStorage.setItem(key, JSON.stringify(value))
    return true
  } catch (e) {
    console.error(`[storage] zapis ${key} nieudany`, e)
    emitSync({ phase: 'error', message: 'Brak miejsca w pamięci przeglądarki — zrób kopię do pliku' })
    return false
  }
}

export function readRaw(key: string): string | null {
  try { return localStorage.getItem(key) } catch { return null }
}

export function writeRaw(key: string, value: string) {
  try { localStorage.setItem(key, value) } catch { /* brak miejsca */ }
}

export function dropKey(key: string) {
  try { localStorage.removeItem(key) } catch { /* nic */ }
}

// --- odczyt calego stanu ----------------------------------------------

export interface Snapshot {
  settings: Settings
  categories: Category[]
  sessions: Session[]
  exportedAt: number
  schema: number
}

export function readSessions(): Session[] {
  const list = readKey<Session[]>(KEY.sessions, [])
  return Array.isArray(list) ? list : []
}

export function readCategories(): Category[] {
  const box = readKey<{ state?: { categories?: Category[] } }>(KEY.categories, {})
  return Array.isArray(box?.state?.categories) ? box.state!.categories! : []
}

export function readSettings(): Settings {
  const box = readKey<{ state?: Settings }>(KEY.settings, {})
  return (box?.state ?? {}) as Settings
}

/** Uzywane WYLACZNIE do eksportu do pliku. Nigdy jako zrodlo wysylki. */
export function snapshot(): Snapshot {
  return {
    settings: readSettings(),
    categories: readCategories(),
    sessions: readSessions(),
    exportedAt: nowMs(),
    schema: SCHEMA_VERSION,
  }
}

/** Jedno zrodlo czasu - ulatwia korekte przy rozjechanym zegarze urzadzenia. */
export function nowMs(): number {
  return Date.now()
}

// --- rekordy do wyslania ----------------------------------------------

export interface Dirty {
  sessions: Session[]
  categories: Category[]
  settings: Settings | null
  settingsUpdatedAt: number
}

/**
 * Rekordy TRWALE odrzucane przez serwer. Pomijamy je w paczce, zeby jeden
 * uszkodzony wiersz nie blokowal pozostalych.
 *
 * Wczesniej byla to plaska lista id, na ktora trafial kazdy rekord, ktorego
 * nie udalo sie wyslac - takze przy zwyklym braku zasiegu. Sesja zapisana poza
 * domem ladowala na niej na zawsze, znikala z licznika i interfejs mowil
 * "Wszystko wyslane". Dlatego teraz: mapa z licznikiem prob, wpis dopiero po
 * trzech nieudanych probach i wylacznie przy bledzie TRWALYM.
 */
export interface PoisonEntry { proby: number; blad: string; ostatnioAt: number }
export type PoisonMap = Record<string, PoisonEntry>

const PROG_ZATRUCIA = 3

export function poisonMap(): PoisonMap {
  const raw = readKey<PoisonMap | string[]>(KEY.poison, {})
  // Zgodnosc ze starym formatem (plaska tablica id) z wczesniejszej wersji.
  if (Array.isArray(raw)) {
    const out: PoisonMap = {}
    for (const id of raw) out[id] = { proby: PROG_ZATRUCIA, blad: 'z poprzedniej wersji', ostatnioAt: 0 }
    return out
  }
  return raw
}

export function poisonIds(): Set<string> {
  return new Set(
    Object.entries(poisonMap())
      .filter(([, e]) => e.proby >= PROG_ZATRUCIA)
      .map(([id]) => id)
  )
}

export function poisonCount(): number {
  return poisonIds().size
}

/** Liczy probe. Zatrucie nastepuje dopiero po PROG_ZATRUCIA nieudanych. */
export function noteFailure(id: string, blad: string) {
  const map = poisonMap()
  const prev = map[id]?.proby ?? 0
  map[id] = { proby: prev + 1, blad, ostatnioAt: nowMs() }
  writeKey(KEY.poison, map)
  if (prev + 1 >= PROG_ZATRUCIA) {
    console.error(`[sync] rekord ${id} pomijany po ${prev + 1} probach: ${blad}`)
  }
}

/** Udany zapis kasuje historie niepowodzen tego rekordu. */
export function noteSuccess(ids: Iterable<string>) {
  const map = poisonMap()
  let zmiana = false
  for (const id of ids) if (map[id]) { delete map[id]; zmiana = true }
  if (zmiana) writeKey(KEY.poison, map)
}

export function clearPoison() {
  dropKey(KEY.poison)
}

// --- klasyfikacja bledow ----------------------------------------------

export type ErrorKind = 'transport' | 'auth' | 'permanent'

/**
 * PostgrestError.code to SQLSTATE albo kod PGRST, NIGDY status HTTP.
 * Poprzednia wersja robila Number(error.code) i porownywala z 401 - kod, ktory
 * nie mogl sie nigdy wykonac. Wygasla sesja byla raportowana jako brak sieci,
 * a wysylka odblokowywana mimo braku uprawnien.
 */
export function classifyError(e: unknown): ErrorKind {
  const err = e as { code?: string; status?: number; message?: string }
  const code = String(err?.code ?? '')
  const msg = String(err?.message ?? '').toLowerCase()

  // Wygasly lub niewazny token, brak uprawnien.
  if (code === 'PGRST301' || code === 'PGRST302' || code === '42501') return 'auth'
  if (err.status === 401 || err.status === 403) return 'auth'
  if (msg.includes('jwt') || msg.includes('not authenticated')) return 'auth'

  // Trwale odrzucenie danych - ponawianie nic nie da.
  // 23502 not null, 23503 klucz obcy, 23505 unikalnosc, 23514 check,
  // 22P02 zly format, 22003 poza zakresem, 42P10 zly onConflict.
  if (/^(23502|23503|23505|23514|22P02|22003|42P10|42703|42804)$/.test(code)) return 'permanent'
  if (err.status !== undefined && err.status >= 400 && err.status < 500 && err.status !== 408 && err.status !== 429) {
    return 'permanent'
  }

  // Wszystko inne to problem transportu: brak sieci, 5xx, limit, timeout.
  return 'transport'
}

// --- scalanie odporne na wyscig z magazynami --------------------------

interface Scalalny { id: string; updatedAt?: number; synced?: boolean }

/**
 * Scala dwie listy po id. Rekord nigdy nie znika - to fundament calego projektu.
 * Wersja "wchodzaca" wygrywa, gdy jest brudna (czeka na wyslanie) albo nowsza.
 */
export function mergeById<T extends Scalalny>(naDysku: T[], wchodzace: T[]): T[] {
  const byId = new Map(naDysku.map((r) => [r.id, r]))
  for (const r of wchodzace) {
    const d = byId.get(r.id)
    if (!d || r.synced === false || (r.updatedAt ?? 0) >= (d.updatedAt ?? 0)) byId.set(r.id, r)
  }
  return [...byId.values()]
}

// --- odswiezanie magazynow --------------------------------------------

/**
 * Magazyny zustand trzymaja wlasna kopie w pamieci. Gdy synchronizacja zapisuje
 * prosto do localStorage, ta kopia sie dezaktualizuje i pierwszy nastepny zapis
 * lokalny wymazuje wszystko, co przyszlo z chmury - a kursor juz to minal.
 *
 * Kazdy magazyn rejestruje tu funkcje przeladowania. storage.ts nie importuje
 * magazynow, wiec nie powstaje cykl.
 */
const reloaders: Array<() => void> = []

export function registerReloader(fn: () => void) { reloaders.push(fn) }

export function reloadStores() {
  for (const fn of reloaders) {
    try { fn() } catch (e) { console.error('[storage] przeladowanie magazynu nieudane', e) }
  }
}

export function collectDirty(): Dirty {
  const skip = poisonIds()
  const settingsAt = Number(readRaw(KEY.settingsUpdatedAt) ?? 0)
  const settingsSynced = readRaw(KEY.lastSync) !== null && settingsAt === 0
  return {
    sessions: readSessions().filter((s) => s.synced === false && !skip.has(s.id)),
    categories: readCategories().filter((c) => c.synced === false && !skip.has(c.id)),
    settings: settingsSynced ? null : readSettings(),
    settingsUpdatedAt: settingsAt || nowMs(),
  }
}

export function dirtyCount(): number {
  const d = collectDirty()
  return d.sessions.length + d.categories.length + (d.settings ? 1 : 0)
}

// --- rejestr adaptera --------------------------------------------------

/** Osobny znacznik na tabele - wspolny gubil wiersze zapisane miedzy skanami. */
export interface Cursor {
  sessions: string | null
  categories: string | null
}

export interface PullPage {
  sessions: Session[]
  categories: Category[]
  settings: Settings | null
  settingsUpdatedAt: number
  /** Nowy kursor; zapisujemy DOPIERO po wszystkich stronach i udanym zapisie. */
  cursor: Cursor | null
}

/** Co serwer faktycznie przyjal, z jego autorytatywnym updatedAt. */
export interface Confirmed {
  /** updated_at_ms po ewentualnym przycieciu zegara przez stamp_row. */
  updatedAt: number
  /** updatedAt wyslany przez nas - sluzy do wykrycia zmiany w trakcie lotu. */
  wyslanoUpdatedAt: number
}

export interface PushOutcome {
  sessions: Map<string, Confirmed>
  categories: Map<string, Confirmed>
  /** Wiersze, ktore wrocily z trescia inna niz wyslana (przegrany spor). */
  overridden: Session[]
  settingsAccepted: boolean
}

export interface RemoteAdapter {
  name: string
  /** `${url}|${userId}` albo null gdy nie zalogowano. */
  ownerId(): string | null
  pull(cursor: Cursor | null): Promise<PullPage>
  push(dirty: Dirty): Promise<PushOutcome>
  /** Liczba nieusunietych sesji po stronie serwera - niezalezna kontrola flag. */
  countSessions(): Promise<number>
}

let remote: RemoteAdapter | null = null

export function setRemote(adapter: RemoteAdapter | null) { remote = adapter }
export function getRemote(): RemoteAdapter | null { return remote }
export function hasRemote() { return remote !== null }
export function remoteName() { return remote?.name ?? null }

// --- zdarzenia dla interfejsu -----------------------------------------

export type SyncPhase = 'idle' | 'pulling' | 'pushing' | 'ok' | 'error' | 'offline'

export interface SyncState {
  phase: SyncPhase
  message: string | null
  lastSyncAt: number | null
  dirty: number
  /** Rekordy pomijane w wysylce - NIE wchodza do dirty, wiec licza sie osobno. */
  poison: number
  /** Rozjazd w dowolna strone; obie sa grozne. */
  mismatch: { local: number; remote: number } | null
  /** null oznacza "kontrola sie nie powiodla", nie "wszystko dobrze". */
  verifiedAt: number | null
}

export const SYNC_EVENT = 'pomodore:sync-state'

export function emitSync(patch: Partial<SyncState>) {
  window.dispatchEvent(new CustomEvent<Partial<SyncState>>(SYNC_EVENT, { detail: patch }))
}
