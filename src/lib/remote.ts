import type { Category, Session, Settings } from '../types'
import type { Confirmed, Cursor, Dirty, PullPage, PushOutcome, RemoteAdapter } from './storage'
import { supabase, SUPABASE_URL, CLOUD_CONFIGURED } from './supabase'

/**
 * Implementacja RemoteAdapter na Supabase.
 *
 * Trzy rzeczy, ktore latwo tu przeoczyc, a kazda konczy sie cicha utrata danych:
 *
 *  1. PostgREST ucina odpowiedz na db-max-rows (domyslnie 1000) i zwraca HTTP 200
 *     BEZ zadnego sygnalu, ze to nie wszystko. Pobieramy wiec stronami, dopoki
 *     strona jest pelna, i nie oddajemy kursora przed ostatnia strona.
 *  2. Kursor chodzi po server_updated_at (zegar serwera, jedyny monotoniczny),
 *     cofnietym o 5 s na wypadek wyscigu transakcji. Powtorne pobranie tego
 *     samego wiersza jest nieszkodliwe, bo scalanie idzie po id.
 *  3. synced=true ustawiamy WYLACZNIE dla identyfikatorow zwroconych przez
 *     serwer w return=representation, nigdy "na wiare" po udanym zapytaniu.
 */

const PAGE = 1000
const CURSOR_SLACK_MS = 5000

/**
 * Przekazuje blad Postgresa dalej BEZ gubienia pola code. Poprzednia wersja
 * robila Number(error.code) i wpisywala to jako status HTTP - a code to
 * SQLSTATE ('42501') albo kod PGRST ('PGRST301'), nigdy liczba HTTP.
 * Skutek: wygasla sesja byla klasyfikowana jako brak sieci.
 */
function podnies(error: { message: string; code?: string; details?: string; hint?: string }): never {
  throw Object.assign(new Error(error.message), {
    code: error.code,
    details: error.details,
    hint: error.hint,
  })
}

// --- mapowanie rekordow -----------------------------------------------

const toRowSession = (s: Session) => ({
  id: s.id,
  intention: s.intention ?? '',
  category_id: s.categoryId,
  mode: s.mode,
  planned_seconds: Math.round(s.plannedSeconds ?? 0),
  actual_seconds: Math.round(s.actualSeconds ?? 0),
  status: s.status,
  reflection: s.reflection,
  mood: s.mood,
  started_at_ms: s.startedAt,
  ended_at_ms: s.endedAt,
  updated_at_ms: s.updatedAt,
  deleted_at_ms: s.deletedAt,
})

const fromRowSession = (r: Record<string, unknown>): Session => ({
  id: r.id as string,
  intention: (r.intention as string) ?? '',
  categoryId: (r.category_id as string) ?? null,
  mode: r.mode as Session['mode'],
  plannedSeconds: (r.planned_seconds as number) ?? 0,
  actualSeconds: (r.actual_seconds as number) ?? 0,
  status: r.status as Session['status'],
  reflection: (r.reflection as string) ?? null,
  mood: (r.mood as number) ?? null,
  startedAt: Number(r.started_at_ms),
  endedAt: Number(r.ended_at_ms),
  updatedAt: Number(r.updated_at_ms),
  deletedAt: r.deleted_at_ms === null || r.deleted_at_ms === undefined ? null : Number(r.deleted_at_ms),
  synced: true,
})

const toRowCategory = (c: Category) => ({
  id: c.id,
  name: c.name,
  color: c.color,
  position: c.position ?? 0,
  created_at_ms: c.createdAt,
  focus_min: c.focusMin,
  short_break_min: c.shortBreakMin,
  long_break_min: c.longBreakMin,
  long_break_every_sessions: c.longBreakEverySessions,
  long_break_every_minutes: c.longBreakEveryMinutes,
  daily_session_goal: c.dailySessionGoal,
  updated_at_ms: c.updatedAt,
  deleted_at_ms: c.deletedAt,
})

const fromRowCategory = (r: Record<string, unknown>): Category => ({
  id: r.id as string,
  name: r.name as string,
  color: (r.color as string) ?? '#1F8A8A',
  position: (r.position as number) ?? 0,
  createdAt: Number(r.created_at_ms),
  focusMin: (r.focus_min as number) ?? null,
  shortBreakMin: (r.short_break_min as number) ?? null,
  longBreakMin: (r.long_break_min as number) ?? null,
  longBreakEverySessions: (r.long_break_every_sessions as number) ?? null,
  longBreakEveryMinutes: (r.long_break_every_minutes as number) ?? null,
  dailySessionGoal: (r.daily_session_goal as number) ?? null,
  updatedAt: Number(r.updated_at_ms),
  deletedAt: r.deleted_at_ms === null || r.deleted_at_ms === undefined ? null : Number(r.deleted_at_ms),
  synced: true,
})

// --- adapter -----------------------------------------------------------

let cachedUserId: string | null = null

export function setCachedUser(id: string | null) { cachedUserId = id }

export const supabaseAdapter: RemoteAdapter = {
  name: 'Supabase',

  ownerId() {
    if (!CLOUD_CONFIGURED || !cachedUserId) return null
    return `${SUPABASE_URL}|${cachedUserId}`
  },

  async pull(cursor: Cursor | null): Promise<PullPage> {
    const db = supabase()
    if (!db) throw new Error('Chmura nieskonfigurowana')

    const sessions: Session[] = []
    const categories: Category[] = []
    const nowy: Cursor = { sessions: cursor?.sessions ?? null, categories: cursor?.categories ?? null }

    for (const table of ['sessions', 'categories'] as const) {
      const od = cursor?.[table]
        ? new Date(new Date(cursor[table]!).getTime() - CURSOR_SLACK_MS).toISOString()
        : null

      let offset = 0
      for (;;) {
        // Porzadek MUSI byc calkowity. Sam server_updated_at nie wystarcza:
        // jeden upsert stempluje wszystkie wiersze identycznym now(), a wtedy
        // stronicowanie po offsecie gubi wiersze wewnatrz bloku remisow.
        let q = db.from(table).select('*')
          .order('server_updated_at', { ascending: true })
          .order('id', { ascending: true })
        if (od) q = q.gt('server_updated_at', od)

        const { data, error } = await q.range(offset, offset + PAGE - 1)
        if (error) podnies(error)
        const rows = data ?? []

        for (const r of rows) {
          const stamp = r.server_updated_at as string
          if (!nowy[table] || stamp > nowy[table]!) nowy[table] = stamp
          if (table === 'sessions') sessions.push(fromRowSession(r))
          else categories.push(fromRowCategory(r))
        }
        // Krotsza strona = koniec. Kursor oddajemy dopiero po tej petli.
        if (rows.length < PAGE) break
        offset += PAGE
      }
    }

    const { data: srow, error: serr } = await db.from('settings').select('*').maybeSingle()
    if (serr) podnies(serr)

    return {
      sessions,
      categories,
      settings: (srow?.data as Settings) ?? null,
      settingsUpdatedAt: srow ? Number(srow.updated_at_ms) : 0,
      cursor: nowy,
    }
  },

  async push(dirty: Dirty): Promise<PushOutcome> {
    const db = supabase()
    if (!db) throw new Error('Chmura nieskonfigurowana')
    const sesje = new Map<string, Confirmed>()
    const kategorie = new Map<string, Confirmed>()
    const overridden: Session[] = []

    if (dirty.sessions.length) {
      const wyslane = new Map(dirty.sessions.map((s) => [s.id, s]))
      const { data, error } = await db
        .from('sessions')
        .upsert(dirty.sessions.map(toRowSession), { onConflict: 'id' })
        .select()
      if (error) podnies(error)

      for (const r of data ?? []) {
        const back = fromRowSession(r)
        const mine = wyslane.get(back.id)
        if (!mine) continue
        // updatedAt z serwera moze byc przyciety przez stamp_row. Lokalny rekord
        // musi przyjac te wartosc, inaczej na stale odrzuca zmiany z drugiego
        // urzadzenia jako "starsze" od swojego zawyzonego znacznika.
        sesje.set(back.id, { updatedAt: back.updatedAt, wyslanoUpdatedAt: mine.updatedAt })
        if (mine.reflection !== back.reflection || mine.intention !== back.intention) {
          overridden.push(mine)
        }
      }
    }

    if (dirty.categories.length) {
      const wyslane = new Map(dirty.categories.map((c) => [c.id, c]))
      const { data, error } = await db
        .from('categories')
        .upsert(dirty.categories.map(toRowCategory), { onConflict: 'id' })
        .select()
      if (error) podnies(error)

      for (const r of data ?? []) {
        const back = fromRowCategory(r)
        const mine = wyslane.get(back.id)
        if (!mine) continue
        kategorie.set(back.id, { updatedAt: back.updatedAt, wyslanoUpdatedAt: mine.updatedAt })
      }
    }

    let settingsAccepted = false
    if (dirty.settings && Object.keys(dirty.settings).length) {
      // settings nie ma kolumny id - kluczem glownym jest user_id.
      const { data, error } = await db
        .from('settings')
        .upsert(
          { data: dirty.settings, updated_at_ms: dirty.settingsUpdatedAt },
          { onConflict: 'user_id' }
        )
        .select('updated_at_ms')
        .maybeSingle()
      if (error) podnies(error)
      // Potwierdzamy dowodem z serwera, nie samym brakiem bledu. Straznik
      // settings_guard moze odrzucic zapis przedawniony i zwrocic starsza wersje.
      settingsAccepted = Boolean(data) && Number(data!.updated_at_ms) >= dirty.settingsUpdatedAt
    }

    return { sessions: sesje, categories: kategorie, overridden, settingsAccepted }
  },

  async countSessions() {
    const db = supabase()
    if (!db) throw new Error('Chmura nieskonfigurowana')
    const { count, error } = await db
      .from('sessions')
      .select('id', { count: 'exact', head: true })
      .is('deleted_at_ms', null)
    if (error) podnies(error)
    return count ?? 0
  },
}
