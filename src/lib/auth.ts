import { useEffect, useState } from 'react'
import { KEY } from '../types'
import { supabase, CLOUD_CONFIGURED } from './supabase'
import { setCachedUser, supabaseAdapter } from './remote'
import { dropKey, setRemote, emitSync } from './storage'
import { startSync } from './sync'

/**
 * Logowanie e-mailem i haslem, z kodem OTP jako droga zapasowa.
 *
 * Dlaczego nie magic link ani OAuth: aplikacja dodana do ekranu glownego iOS
 * ma WLASNA partycje storage. Link kliknięty w Mailu otwiera Safari, GoTrue
 * ustanawia sesje w kontenerze Safari, a aplikacja nadal nie ma tokenu.
 * iOS nie ma odpowiednika androidowego WebAPK z intent filterem, wiec nie ma
 * na to obejscia. Haslo i szesciocyfrowy kod przechodza przez granice
 * kontekstow oczami i palcami uzytkownika, a nie nawigacja przegladarki.
 *
 * INICJALIZACJA ZYJE POZA REACTEM. Wczesniej setRemote() i startSync() byly
 * w hooku useAuth, a ten montowal sie tylko razem z zakladka Dane. Typowe
 * uzycie z ekranu glownego - otworz, czytaj, zamknij - nigdy tej zakladki nie
 * dotyka, wiec synchronizacja nie startowala ANI RAZU. Cala warstwa byla
 * martwa, a interfejs nie dawal o tym znac.
 */

export interface AuthState {
  ready: boolean
  email: string | null
  userId: string | null
}

let stan: AuthState = { ready: false, email: null, userId: null }
const sluchacze = new Set<(s: AuthState) => void>()
let zainicjowano = false

function ustaw(next: AuthState) {
  stan = next
  for (const fn of sluchacze) fn(next)
}

/** Wolane RAZ z main.tsx, przed pierwszym renderem. */
export function initCloud() {
  if (zainicjowano) return
  zainicjowano = true

  const db = supabase()
  if (!db) { ustaw({ ready: true, email: null, userId: null }); return }

  setRemote(supabaseAdapter)

  void db.auth.getSession().then(({ data }) => {
    const u = data.session?.user ?? null
    setCachedUser(u?.id ?? null)
    ustaw({ ready: true, email: u?.email ?? null, userId: u?.id ?? null })
    if (u) void startSync()
  })

  // Subskrypcja zyje przez caly czas dzialania aplikacji, nie tylko gdy
  // widoczna jest jakas zakladka. Wygasniecie sesji musi byc zauwazone zawsze.
  db.auth.onAuthStateChange((event, session) => {
    const u = session?.user ?? null
    setCachedUser(u?.id ?? null)
    ustaw({ ready: true, email: u?.email ?? null, userId: u?.id ?? null })
    if (u) void startSync()
    else if (event === 'SIGNED_OUT') emitSync({ phase: 'idle', message: null })
    else if (event === 'TOKEN_REFRESHED') return
  })
}

/** Hook jest juz tylko czytelnikiem gotowego stanu. */
export function useAuth(): AuthState {
  const [s, setS] = useState<AuthState>(stan)
  useEffect(() => {
    sluchacze.add(setS)
    setS(stan)
    return () => { sluchacze.delete(setS) }
  }, [])
  return s
}

export async function signIn(email: string, password: string) {
  const db = supabase()
  if (!db) throw new Error('Chmura nieskonfigurowana')
  const { error } = await db.auth.signInWithPassword({ email, password })
  if (error) throw new Error(tlumacz(error.message))
}

/**
 * Kod OTP jako jedyna droga odzyskania dostepu.
 * shouldCreateUser: false jest obowiazkowe - rejestracja w projekcie jest
 * wylaczona, a bez tej flagi Supabase probuje zalozyc konto i odrzuca zadanie.
 * Awaryjne wejscie przestaloby dzialac dokladnie wtedy, gdy jest potrzebne.
 */
export async function sendCode(email: string) {
  const db = supabase()
  if (!db) throw new Error('Chmura nieskonfigurowana')
  const { error } = await db.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  })
  if (error) throw new Error(tlumacz(error.message))
}

export async function verifyCode(email: string, token: string) {
  const db = supabase()
  if (!db) throw new Error('Chmura nieskonfigurowana')
  const { error } = await db.auth.verifyOtp({ email, token, type: 'email' })
  if (error) throw new Error(tlumacz(error.message))
}

/**
 * Zmiana hasla w juz aktywnej sesji. To JEDYNA droga ustawienia nowego hasla:
 * resetPasswordForEmail wysyla link typu recovery, ktory znow ustanowilby
 * sesje w Safari, a nie w aplikacji. Po wejsciu kodem OTP uzytkownik MUSI
 * moc tu ustawic haslo, inaczej kazde kolejne logowanie zalezy od
 * limitowanego SMTP.
 */
export async function changePassword(password: string) {
  const db = supabase()
  if (!db) throw new Error('Chmura nieskonfigurowana')
  const { error } = await db.auth.updateUser({ password })
  if (error) throw new Error(tlumacz(error.message))
}

/**
 * Wylogowanie NIE dotyka danych lokalnych - aplikacja bez konta dziala normalnie.
 * Kasuje kursor i date synchronizacji, bo odnosza sie do konta, ktorego juz nie
 * ma w sesji. Zostawienie ich oznaczaloby, ze zalogowanie na inne konto robi
 * pobranie przyrostowe z cudzego kursora.
 */
export async function signOut() {
  const db = supabase()
  await db?.auth.signOut({ scope: 'local' })
  dropKey(KEY.cursor)
  dropKey(KEY.lastSync)
  setCachedUser(null)
  emitSync({ phase: 'idle', message: null, lastSyncAt: null })
}

export { CLOUD_CONFIGURED }

function tlumacz(msg: string): string {
  const m = msg.toLowerCase()
  if (m.includes('invalid login credentials')) return 'Błędny e-mail lub hasło'
  if (m.includes('email not confirmed')) return 'Adres e-mail niepotwierdzony'
  if (m.includes('signups not allowed') || m.includes('signup is disabled'))
    return 'To konto nie istnieje w projekcie'
  if (m.includes('token has expired') || m.includes('invalid token'))
    return 'Kod wygasł albo jest błędny'
  if (m.includes('should be at least') || m.includes('password'))
    return 'Hasło za krótkie — minimum 6 znaków'
  if (m.includes('rate limit') || m.includes('too many'))
    return 'Za dużo prób. Wbudowany SMTP Supabase ma limit — poczekaj godzinę'
  if (m.includes('failed to fetch')) return 'Brak połączenia'
  return msg
}
