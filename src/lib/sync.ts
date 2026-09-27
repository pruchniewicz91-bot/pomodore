import { KEY } from '../types'
import type { Category, Session, Settings } from '../types'
import {
  classifyError, collectDirty, dirtyCount, dropKey, emitSync, getRemote,
  mergeById, noteFailure, noteSuccess, nowMs, poisonCount, readKey, readRaw,
  readSessions, reloadStores, writeKey, writeRaw, type Cursor,
} from './storage'

/**
 * Orkiestracja synchronizacji. Piec regul, ktorych nie wolno zlamac:
 *
 *  1. Nieobecnosc rekordu lokalnie NIGDY nie kasuje go w chmurze.
 *  2. Pull przed pushem przy zimnym starcie; scalanie wylacznie sumujace.
 *  3. Kursor ustawiany dopiero po pobraniu wszystkich stron I po UDANYM
 *     zapisie na dysk. Zapis moze cicho zawiesc przy braku miejsca, a kursor
 *     przesuniety nad rekordami, ktorych nie ma, oznacza ich trwala utrate.
 *  4. Zmiana wlasciciela uniewaznia kursor i przestemplowuje wszystko na
 *     synced=false.
 *  5. Po kazdym zapisie do localStorage przeladowujemy magazyny. Bez tego
 *     zustand nadpisze pobrane dane swoja nieaktualna kopia z pamieci.
 */

export const DATA_CHANGED = 'pomodore:data-changed'

let pushBlocked = true
let pushInFlight = false
let startInFlight: Promise<void> | null = null
let debounce: ReturnType<typeof setTimeout> | null = null
let loop: ReturnType<typeof setInterval> | null = null

function announceData() {
  reloadStores()
  window.dispatchEvent(new Event(DATA_CHANGED))
  emitSync({ dirty: dirtyCount(), poison: poisonCount() })
}

// --- kursor ------------------------------------------------------------

/**
 * Osobny kursor na tabele. Wspolny gubil rekordy: sesja zapisana miedzy
 * koncem skanowania sessions a koncem skanowania categories nie trafialaby
 * do zadnego kolejnego pobrania.
 */
function readCursor(): Cursor | null {
  const raw = readKey<Cursor | string | null>(KEY.cursor, null)
  if (!raw) return null
  if (typeof raw === 'string') return { sessions: raw, categories: raw }
  return raw
}

// --- oznaczanie rekordow ----------------------------------------------

/**
 * Oznacza jako wyslane WYLACZNIE te rekordy, ktore nie zmienily sie w trakcie
 * trwania zapytania. Bez tego refleksja zapisana w sekundzie, w ktorej leci
 * push, dostawala synced=true i nigdy nie byla wysylana.
 *
 * Przyjmuje takze autorytatywne updatedAt zwrocone przez serwer - stamp_row
 * przycina zegar klienta, a lokalny rekord musi o tym wiedziec, inaczej na
 * stale odrzuca aktualizacje z drugiego urzadzenia jako "starsze".
 */
function markSessionsSynced(potwierdzone: Map<string, { updatedAt: number; wyslanoUpdatedAt: number }>) {
  if (!potwierdzone.size) return
  const list = readSessions().map((s) => {
    const p = potwierdzone.get(s.id)
    if (!p) return s
    if (s.updatedAt !== p.wyslanoUpdatedAt) return s   // zmienil sie w locie
    return { ...s, synced: true, updatedAt: p.updatedAt }
  })
  writeKey(KEY.sessions, list)
}

function markCategoriesSynced(potwierdzone: Map<string, { updatedAt: number; wyslanoUpdatedAt: number }>) {
  if (!potwierdzone.size) return
  const box = readKey<{ state: { categories: Category[] }; version: number }>(
    KEY.categories, { state: { categories: [] }, version: 5 }
  )
  box.state.categories = box.state.categories.map((c) => {
    const p = potwierdzone.get(c.id)
    if (!p) return c
    if (c.updatedAt !== p.wyslanoUpdatedAt) return c
    return { ...c, synced: true, updatedAt: p.updatedAt }
  })
  writeKey(KEY.categories, box)
}

/** Po zmianie wlasciciela wszystko musi polecieć na serwer od nowa. */
function resetAllSynced() {
  writeKey(KEY.sessions, readSessions().map((s) => ({ ...s, synced: false })))
  const box = readKey<{ state: { categories: Category[] }; version: number }>(
    KEY.categories, { state: { categories: [] }, version: 5 }
  )
  box.state.categories = box.state.categories.map((c) => ({ ...c, synced: false }))
  writeKey(KEY.categories, box)
  writeRaw(KEY.settingsUpdatedAt, String(nowMs()))
  announceData()
}

/** Uzywane przez przycisk "Wyslij wszystko ponownie" - bez tego wysylal nic. */
export function resendEverything() {
  resetAllSynced()
  flushNow()
}

// --- scalanie przychodzacych ------------------------------------------

function mergeSessions(incoming: Session[]): { changed: number; ok: boolean } {
  if (!incoming.length) return { changed: 0, ok: true }
  const local = readSessions()
  const merged = mergeById(local, incoming.map((r) => ({ ...r, synced: true })))
  merged.sort((a, b) => a.startedAt - b.startedAt)
  return { changed: merged.length - local.length || incoming.length, ok: writeKey(KEY.sessions, merged) }
}

function mergeCategories(incoming: Category[]): { changed: number; ok: boolean } {
  if (!incoming.length) return { changed: 0, ok: true }
  const box = readKey<{ state: { categories: Category[] }; version: number }>(
    KEY.categories, { state: { categories: [] }, version: 5 }
  )
  const merged = mergeById(box.state.categories, incoming.map((r) => ({ ...r, synced: true })))
  merged.sort((a, b) => a.position - b.position)
  const before = box.state.categories.length
  box.state.categories = merged
  return { changed: merged.length - before || incoming.length, ok: writeKey(KEY.categories, box) }
}

// --- pobieranie --------------------------------------------------------

export async function pull(force = false): Promise<{ ok: boolean; changed: number }> {
  const remote = getRemote()
  if (!remote || !remote.ownerId()) return { ok: false, changed: 0 }

  // Pelne pobranie takze wtedy, gdy lokalnie nie ma sesji ALBO kategorii -
  // pusty magazyn to sygnatura wyczyszczonego storage, nie pustej historii.
  const pustoLokalnie =
    readSessions().length === 0 ||
    readKey<{ state?: { categories?: Category[] } }>(KEY.categories, {}).state?.categories?.length === 0
  const cursor = force || pustoLokalnie ? null : readCursor()

  emitSync({ phase: 'pulling', message: cursor ? 'Pobieram zmiany…' : 'Pobieram całość…' })
  try {
    const page = await remote.pull(cursor)
    const s = mergeSessions(page.sessions)
    const c = mergeCategories(page.categories)

    let settingsOk = true
    if (page.settings && Object.keys(page.settings).length) {
      const localAt = Number(readRaw(KEY.settingsUpdatedAt) ?? 0)
      // Lokalne ustawienia brudne maja pierwszenstwo - czekaja na wyslanie.
      if (localAt === 0 && page.settingsUpdatedAt > 0) {
        settingsOk = writeKey(KEY.settings, { state: page.settings as Settings, version: 2 })
      }
    }

    // Kursor TYLKO gdy wszystko faktycznie wyladowalo na dysku.
    if (s.ok && c.ok && settingsOk && page.cursor) {
      writeKey(KEY.cursor, page.cursor)
    } else if (!s.ok || !c.ok || !settingsOk) {
      console.error('[sync] zapis scalonych danych nieudany — kursor nietkniety')
      emitSync({ phase: 'error', message: 'Nie udało się zapisać pobranych danych' })
    }

    pushBlocked = false
    announceData()
    return { ok: true, changed: s.changed + c.changed }
  } catch (e) {
    const kind = classifyError(e)
    const msg = (e as Error).message ?? 'nieznany błąd'
    // Blad transportu: wysylka DOZWOLONA - upsert po id niczego nie kasuje,
    // a zablokowanie oznaczaloby, ze urzadzenie bez sieci przy starcie nie
    // wysle nic przez cala sesje. Kursora nie ruszamy, pobranie wroci.
    pushBlocked = kind === 'auth'
    emitSync({
      phase: kind === 'auth' ? 'error' : 'offline',
      message: kind === 'auth' ? 'Sesja wygasła — zaloguj się ponownie' : `Brak połączenia (${msg})`,
    })
    return { ok: false, changed: 0 }
  }
}

// --- wysylka -----------------------------------------------------------

export async function push(): Promise<boolean> {
  const remote = getRemote()
  if (!remote || !remote.ownerId() || pushBlocked || pushInFlight) return false

  const dirty = collectDirty()
  if (!dirty.sessions.length && !dirty.categories.length && !dirty.settings) {
    emitSync({ phase: 'ok', message: null, dirty: 0, poison: poisonCount() })
    return true
  }

  pushInFlight = true
  emitSync({ phase: 'pushing', message: `Wysyłam ${dirtyCount()}…` })
  try {
    const out = await remote.push(dirty)
    markSessionsSynced(out.sessions)
    markCategoriesSynced(out.categories)
    noteSuccess([...out.sessions.keys(), ...out.categories.keys()])
    if (out.settingsAccepted) dropKey(KEY.settingsUpdatedAt)

    if (out.overridden.length) {
      const prev = readKey<Session[]>('pomodore-conflicts', [])
      writeKey('pomodore-conflicts', [...prev, ...out.overridden].slice(-50))
    }

    writeRaw(KEY.lastSync, String(nowMs()))
    announceData()
    emitSync({ phase: 'ok', message: null, lastSyncAt: nowMs() })
    return true
  } catch (e) {
    const kind = classifyError(e)
    if (kind === 'auth') {
      pushBlocked = true
      emitSync({ phase: 'error', message: 'Sesja wygasła — zaloguj się ponownie' })
      return false
    }
    if (kind === 'transport') {
      // NIE rozbijamy paczki na pojedyncze wiersze przy braku sieci - kazdy
      // z nich zawiodlby tak samo i wszystkie trafilyby na czarna liste.
      emitSync({ phase: 'offline', message: 'Brak połączenia — wyślę później' })
      return false
    }
    // Trwale odrzucenie: rozbijamy paczke, zeby wyizolowac winowajce
    // i przepuscic rekordy, ktore sa poprawne.
    const uratowane = await pushOneByOne(dirty)
    emitSync({
      phase: uratowane > 0 ? 'ok' : 'error',
      message: uratowane > 0 ? null : `Serwer odrzucił dane: ${(e as Error).message}`,
      dirty: dirtyCount(),
      poison: poisonCount(),
    })
    return uratowane > 0
  } finally {
    pushInFlight = false
  }
}

async function pushOneByOne(dirty: ReturnType<typeof collectDirty>): Promise<number> {
  const remote = getRemote()
  if (!remote) return 0
  let ok = 0

  for (const s of dirty.sessions) {
    try {
      const out = await remote.push({ sessions: [s], categories: [], settings: null, settingsUpdatedAt: 0 })
      if (out.sessions.size) { markSessionsSynced(out.sessions); noteSuccess([s.id]); ok++ }
    } catch (e) {
      if (classifyError(e) === 'transport') break   // sieć padła — reszta poczeka
      noteFailure(s.id, (e as Error).message)
    }
  }
  for (const c of dirty.categories) {
    try {
      const out = await remote.push({ sessions: [], categories: [c], settings: null, settingsUpdatedAt: 0 })
      if (out.categories.size) { markCategoriesSynced(out.categories); noteSuccess([c.id]); ok++ }
    } catch (e) {
      if (classifyError(e) === 'transport') break
      noteFailure(c.id, (e as Error).message)
    }
  }
  if (ok) announceData()
  return ok
}

// --- niezalezna kontrola ----------------------------------------------

/**
 * Wszystkie tryby cichej awarii wygladaja tak samo: synced=true przy braku
 * danych w chmurze. To jedyna kontrola, ktora nie ufa fladze synced.
 * Sprawdza OBIE strony - urzadzenie, ktore zgubilo dane chmury, jest rownie
 * grozne jak chmura, ktora zgubila dane urzadzenia.
 */
export async function verifyCount(): Promise<void> {
  const remote = getRemote()
  if (!remote || !remote.ownerId()) return
  try {
    const zdalnie = await remote.countSessions()
    const lokalnie = readSessions().filter((s) => !s.deletedAt).length
    emitSync({
      mismatch: zdalnie === lokalnie ? null : { local: lokalnie, remote: zdalnie },
      verifiedAt: nowMs(),
    })
  } catch (e) {
    // Brak wyniku kontroli to NIE jest dowod poprawnosci - mowimy o tym wprost.
    emitSync({ verifiedAt: null, message: `Nie udało się sprawdzić chmury: ${(e as Error).message}` })
  }
}

// --- wyzwalacze --------------------------------------------------------

/** Natychmiast, bez dlawienia. Do konca sesji i zapisu refleksji. */
export function flushNow() {
  if (debounce) { clearTimeout(debounce); debounce = null }
  void push().then(() => verifyCount())
}

let firstChangeAt = 0

/** Dla suwakow i edycji kategorii. Dlawienie 800 ms z twardym limitem 3 s. */
export function scheduleSync() {
  emitSync({ dirty: dirtyCount(), poison: poisonCount() })
  if (!getRemote()) return
  const now = nowMs()
  if (!firstChangeAt) firstChangeAt = now
  if (debounce) clearTimeout(debounce)
  if (now - firstChangeAt > 3000) { firstChangeAt = 0; flushNow(); return }
  debounce = setTimeout(() => { firstChangeAt = 0; flushNow() }, 800)
}

/** Straznik wspolbieznosci: rownolegle starty przeplatalyby reset z pushem. */
export function startSync(): Promise<void> {
  if (startInFlight) return startInFlight
  startInFlight = (async () => {
    try {
      const remote = getRemote()
      if (!remote) return
      const owner = remote.ownerId()
      if (!owner) { pushBlocked = true; emitSync({ phase: 'idle', dirty: dirtyCount() }); return }

      // Inny projekt Supabase albo inne konto: kursor i flagi synced odnosza sie
      // do nieistniejacych danych. Bez tego resetu synchronizacja umiera cicho,
      // pokazujac zielony stan nad pusta chmura.
      const known = readRaw(KEY.owner)
      const zmiana = known !== owner
      if (zmiana) {
        console.warn('[sync] zmiana właściciela danych — pełne pobranie i ponowna wysyłka')
        dropKey(KEY.cursor)
        dropKey(KEY.lastSync)
        resetAllSynced()
        writeRaw(KEY.owner, owner)
      }

      pushBlocked = true
      const res = await pull(zmiana)
      if (res.ok) await push()
      await verifyCount()

      if (!loop) {
        loop = setInterval(() => { if (dirtyCount() > 0) void push() }, 60_000)
      }
    } finally {
      startInFlight = null
    }
  })()
  return startInFlight
}

export function installTriggers() {
  // iOS zamraza JS, gdy telefon laduje w kieszeni. pagehide to ostatni moment,
  // w ktorym cokolwiek jeszcze sie wykona.
  const flushOnExit = () => { if (dirtyCount() > 0) void push() }
  window.addEventListener('pagehide', flushOnExit)
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushOnExit()
    else void startSync()
  })
  window.addEventListener('online', () => { void startSync() })
}

export function syncBlocked() { return pushBlocked }
