import { supabase, CLOUD_CONFIGURED, SUPABASE_URL } from './supabase'
import { classifyError, dirtyCount, poisonCount, poisonMap, readSessions } from './storage'
import { syncFlags } from './sync'

/**
 * Diagnostyka w aplikacji zamiast wklejania kodu w konsole przegladarki.
 *
 * Powod jest dwojaki. Po pierwsze Chrome slusznie ostrzega przed wklejaniem
 * kodu, ktorego sie nie rozumie - to realna droga do kradziezy tokenu, wiec
 * proszenie uzytkownika o zignorowanie tego ostrzezenia jest zla praktyka.
 * Po drugie narzedzie wbudowane zostaje na stale i przyda sie przy kazdej
 * kolejnej awarii, takze na telefonie, gdzie konsoli po prostu nie ma.
 *
 * Kazda kontrola odpowiada jednemu zapytaniu, ktore wykonuje aplikacja.
 */

export interface Kontrola {
  nazwa: string
  wynik: 'ok' | 'blad' | 'uwaga'
  szczegoly: string
}

/** Rekord testowy ma od razu nagrobek, wiec nie pojawi sie w historii. */
const TEST_ID = '11111111-1111-1111-1111-111111111111'

export async function diagnostyka(): Promise<Kontrola[]> {
  const out: Kontrola[] = []
  const dodaj = (nazwa: string, wynik: Kontrola['wynik'], szczegoly: string) =>
    out.push({ nazwa, wynik, szczegoly })

  // 1. Konfiguracja
  if (!CLOUD_CONFIGURED) {
    dodaj('Konfiguracja', 'blad', 'Brak adresu albo klucza w paczce aplikacji')
    return out
  }
  dodaj('Konfiguracja', 'ok', SUPABASE_URL.replace('https://', '').split('.')[0])

  const db = supabase()!

  // 2. Sesja
  const { data: sesja, error: bladSesji } = await db.auth.getSession()
  if (bladSesji || !sesja.session) {
    dodaj('Sesja logowania', 'blad', bladSesji?.message ?? 'Brak zalogowanej sesji')
    return out
  }
  const wygasa = sesja.session.expires_at ? new Date(sesja.session.expires_at * 1000) : null
  dodaj('Sesja logowania', 'ok',
    `${sesja.session.user.email ?? '—'}` +
    (wygasa ? `, token ważny do ${wygasa.toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}` : ''))

  // 3. Odczyt sesji - dokladnie to zapytanie, ktore robi pull()
  try {
    const { data, error } = await db.from('sessions').select('*')
      .order('server_updated_at', { ascending: true })
      .order('id', { ascending: true })
      .range(0, 999)
    if (error) throw error
    dodaj('Odczyt sesji z chmury', 'ok', `${data?.length ?? 0} wierszy`)
  } catch (e) {
    const err = e as { message: string; code?: string }
    dodaj('Odczyt sesji z chmury', 'blad', `${err.code ?? ''} ${err.message} [${classifyError(e)}]`.trim())
  }

  // 4. Odczyt ustawien
  try {
    const { data, error } = await db.from('settings').select('*').maybeSingle()
    if (error) throw error
    dodaj('Odczyt ustawień', 'ok', data ? 'wiersz istnieje' : 'brak wiersza (normalne przed pierwszą wysyłką)')
  } catch (e) {
    const err = e as { message: string; code?: string }
    dodaj('Odczyt ustawień', 'blad', `${err.code ?? ''} ${err.message} [${classifyError(e)}]`.trim())
  }

  // 5. Zapis testowy
  try {
    const { data, error } = await db.from('sessions').upsert({
      id: TEST_ID,
      intention: 'TEST DIAGNOSTYCZNY',
      mode: 'focus',
      status: 'completed',
      planned_seconds: 0,
      actual_seconds: 0,
      started_at_ms: 1,
      ended_at_ms: 2,
      updated_at_ms: Date.now(),
      deleted_at_ms: 1,
    }, { onConflict: 'id' }).select()
    if (error) throw error
    dodaj('Zapis do chmury', data?.length ? 'ok' : 'uwaga',
      data?.length ? 'serwer przyjął i zwrócił wiersz' : 'serwer przyjął, ale NIE zwrócił wiersza')
  } catch (e) {
    const err = e as { message: string; code?: string; hint?: string }
    dodaj('Zapis do chmury', 'blad',
      `${err.code ?? ''} ${err.message} [${classifyError(e)}]`.trim() + (err.hint ? ` — ${err.hint}` : ''))
  }

  // 6. Zgodnosc liczb
  try {
    const { count, error } = await db.from('sessions')
      .select('id', { count: 'exact', head: true }).is('deleted_at_ms', null)
    if (error) throw error
    const lokalnie = readSessions().filter((s) => !s.deletedAt).length
    dodaj('Zgodność liczb', count === lokalnie ? 'ok' : 'uwaga',
      `tutaj ${lokalnie}, w chmurze ${count ?? 0}`)
  } catch (e) {
    dodaj('Zgodność liczb', 'blad', (e as Error).message)
  }

  // 7. Stan wewnetrzny - to tu chowala sie przyczyna zaciecia wysylki
  const f = syncFlags()
  dodaj('Wysyłka odblokowana', f.pushBlocked ? 'blad' : 'ok',
    f.pushBlocked ? 'ZABLOKOWANA — push kończy się przedwcześnie' : 'tak')
  dodaj('Stan wewnętrzny', 'ok',
    `w locie: ${f.pushInFlight ? 'tak' : 'nie'}, pętla 60 s: ${f.petlaDziala ? 'działa' : 'NIE DZIAŁA'}, ` +
    `start trwa: ${f.startTrwa ? 'tak' : 'nie'}`)

  const trucizny = Object.keys(poisonMap()).length
  dodaj('Kolejka', dirtyCount() > 0 && f.pushBlocked ? 'uwaga' : 'ok',
    `do wysłania ${dirtyCount()}, pomijanych ${poisonCount()}, z nieudanymi próbami ${trucizny}`)

  return out
}
