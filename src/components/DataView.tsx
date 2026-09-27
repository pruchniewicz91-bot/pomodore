import { useEffect, useRef, useState } from 'react'
import { useSessions } from '../store/sessions'
import { useCategories } from '../store/categories'
import { downloadBackup, restoreBackup, daysSinceBackup } from '../lib/backup'
import { dirtyCount, poisonCount, clearPoison, readKey, SYNC_EVENT, type SyncState } from '../lib/storage'
import { flushNow, pull, verifyCount, resendEverything, DATA_CHANGED } from '../lib/sync'
import { useAuth, signIn, signOut, sendCode, verifyCode, changePassword, CLOUD_CONFIGURED } from '../lib/auth'
import type { Session } from '../types'

/**
 * Ekran istniejacy z konkretnego powodu: wersja 1.0 stracila dostep do danych,
 * bo nie bylo zadnej kopii poza telefonem. Tutaj widac stan zabezpieczenia
 * wprost - lacznie z niezalezna kontrola, ktora nie ufa fladze synced.
 */

function Logowanie() {
  const [tryb, setTryb] = useState<'haslo' | 'kod'>('haslo')
  const [email, setEmail] = useState('')
  const [haslo, setHaslo] = useState('')
  const [kod, setKod] = useState('')
  const [kodWyslany, setKodWyslany] = useState(false)
  const [blad, setBlad] = useState<string | null>(null)
  const [pracuje, setPracuje] = useState(false)

  async function zrob(fn: () => Promise<void>) {
    setBlad(null); setPracuje(true)
    try { await fn() } catch (e) { setBlad((e as Error).message) } finally { setPracuje(false) }
  }

  return (
    // Prawdziwy <form> z polem tozsamosci obok pola hasla - bez tego iOS Keychain
    // nie zaproponuje zapisu ani autouzupelniania w trybie standalone, a wtedy
    // jedyna droga wejscia zostaje limitowany SMTP.
    <form
      className="card stack-sm"
      onSubmit={(e) => {
        e.preventDefault()
        if (tryb === 'haslo') void zrob(() => signIn(email.trim(), haslo))
        else if (!kodWyslany) void zrob(async () => { await sendCode(email.trim()); setKodWyslany(true) })
        else void zrob(() => verifyCode(email.trim(), kod.trim()))
      }}
    >
      <h2>Połącz z chmurą</h2>
      <p className="faint" style={{ margin: 0 }}>
        Bez logowania aplikacja działa normalnie, ale dane zostają tylko na tym urządzeniu.
      </p>

      <input
        type="email"
        name="username"
        autoComplete="username"
        inputMode="email"
        autoCapitalize="none"
        placeholder="adres e-mail"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        required
      />

      {tryb === 'haslo' ? (
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          placeholder="hasło"
          value={haslo}
          onChange={(e) => setHaslo(e.target.value)}
          required
        />
      ) : kodWyslany ? (
        <input
          type="text"
          inputMode="numeric"
          autoComplete="one-time-code"
          placeholder="sześciocyfrowy kod z maila"
          value={kod}
          onChange={(e) => setKod(e.target.value)}
          required
        />
      ) : null}

      <button className="btn btn-primary" type="submit" disabled={pracuje}>
        {pracuje ? 'Chwila…' : tryb === 'haslo' ? 'Zaloguj' : kodWyslany ? 'Potwierdź kod' : 'Wyślij kod'}
      </button>

      <button
        type="button"
        className="faint"
        style={{ padding: 6 }}
        onClick={() => { setTryb(tryb === 'haslo' ? 'kod' : 'haslo'); setKodWyslany(false); setBlad(null) }}
      >
        {tryb === 'haslo' ? 'Nie pamiętam hasła — wyślij kod na maila' : 'Wróć do logowania hasłem'}
      </button>

      {blad && <div className="banner warn">{blad}</div>}
    </form>
  )
}

/**
 * Po wejsciu kodem OTP uzytkownik MUSI moc ustawic haslo. Bez tego kazde
 * kolejne logowanie zalezy od wbudowanego SMTP Supabase, ktory ma limit
 * kilku maili na godzinę - czyli dostep do wlasnych danych zalezalby od
 * tego, czy poczta akurat przepusci.
 */
function ZmianaHasla() {
  const [otwarte, setOtwarte] = useState(false)
  const [haslo, setHaslo] = useState('')
  const [info, setInfo] = useState<string | null>(null)

  if (!otwarte) {
    return (
      <button className="btn btn-ghost" onClick={() => setOtwarte(true)}>
        Ustaw nowe hasło
      </button>
    )
  }
  return (
    <form
      className="card stack-sm"
      onSubmit={async (e) => {
        e.preventDefault()
        try { await changePassword(haslo); setInfo('Hasło zmienione. Zapisz je w menedżerze haseł.'); setHaslo('') }
        catch (err) { setInfo((err as Error).message) }
      }}
    >
      <input
        type="password"
        autoComplete="new-password"
        placeholder="nowe hasło, minimum 6 znaków"
        value={haslo}
        onChange={(e) => setHaslo(e.target.value)}
        minLength={6}
        required
      />
      <button className="btn btn-primary" type="submit">Zapisz hasło</button>
      {info && <div className="faint">{info}</div>}
    </form>
  )
}

export default function DataView() {
  const { sessions, reload } = useSessions()
  const allCategories = useCategories((st) => st.categories)
  const categories = allCategories.filter((c) => !c.deletedAt)
  const auth = useAuth()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [sync, setSync] = useState<SyncState>({
    phase: 'idle', message: null, lastSyncAt: null, dirty: 0,
    poison: 0, mismatch: null, verifiedAt: null,
  })

  useEffect(() => {
    const onSync = (e: Event) => setSync((s) => ({ ...s, ...(e as CustomEvent).detail }))
    const onData = () => { reload(); setSync((s) => ({ ...s, dirty: dirtyCount(), poison: poisonCount() })) }
    window.addEventListener(SYNC_EVENT, onSync)
    window.addEventListener(DATA_CHANGED, onData)
    setSync((s) => ({ ...s, dirty: dirtyCount(), poison: poisonCount() }))
    return () => {
      window.removeEventListener(SYNC_EVENT, onSync)
      window.removeEventListener(DATA_CHANGED, onData)
    }
  }, [reload])

  const days = daysSinceBackup()
  const konflikty = readKey<Session[]>('pomodore-conflicts', [])
  const zalogowany = Boolean(auth.userId)

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const r = restoreBackup(String(reader.result))
        reload()
        void useCategories.persist.rehydrate()
        const ust = { 'zaktualizowane': 'ustawienia zaktualizowane', 'pominiete-starsze': 'ustawienia pominięte (kopia starsza)', 'pominiete-brak-daty': 'ustawienia pominięte (brak daty w pliku)', 'brak': 'bez ustawień' }[r.settings]
        setMsg(`Wczytano ${r.sessions} sesji i ${r.categories} kategorii; ${ust}.` +
               (r.skippedDeleted ? ` Pominięto ${r.skippedDeleted} usuniętych.` : ''))
        flushNow()
      } catch (err) {
        setMsg(`Nie udało się wczytać: ${(err as Error).message}`)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="stack">
      {!CLOUD_CONFIGURED ? (
        <div className="banner warn">
          <span aria-hidden>⚠️</span>
          <div>
            <strong>Chmura nieskonfigurowana.</strong> Brakuje <code>VITE_SUPABASE_URL</code> albo{' '}
            <code>VITE_SUPABASE_ANON_KEY</code> w pliku <code>.env.local</code>. Dane są wyłącznie
            na tym urządzeniu i przeglądarka może je usunąć bez ostrzeżenia.
          </div>
        </div>
      ) : !zalogowany ? (
        <div className="banner warn">
          <span aria-hidden>⚠️</span>
          <div>
            <strong>Niezalogowany — dane tylko na tym urządzeniu.</strong> Czeka na wysłanie:{' '}
            {sync.dirty}.
          </div>
        </div>
      ) : (
        <div className="banner">
          <span aria-hidden>{sync.phase === 'error' ? '⛔' : sync.phase === 'offline' ? '📴' : '☁️'}</span>
          <div>
            <strong>Połączono jako {auth.email}.</strong>{' '}
            {sync.message ??
              (sync.dirty > 0
                ? `Czeka na wysłanie: ${sync.dirty}.`
                : sync.poison > 0
                  ? `Pomijanych: ${sync.poison} — reszta wysłana.`
                  : sync.verifiedAt && sync.lastSyncAt
                    ? `Wszystko wysłane i sprawdzone ${new Date(sync.verifiedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}.`
                    : sync.lastSyncAt
                      ? 'Wysłane, ale nie udało się sprawdzić chmury.'
                      : 'Jeszcze nie synchronizowano.')}
          </div>
        </div>
      )}

      {sync.mismatch && (
        <div className="banner warn">
          <span aria-hidden>🚨</span>
          <div>
            <strong>Rozjazd między telefonem a chmurą.</strong> Tutaj {sync.mismatch.local} sesji,
            w chmurze {sync.mismatch.remote}.{' '}
            {sync.mismatch.remote < sync.mismatch.local
              ? 'Chmura nie ma wszystkiego — wyślij ponownie i zrób kopię do pliku.'
              : 'To urządzenie nie ma wszystkiego — pobierz całość z chmury.'}
          </div>
        </div>
      )}

      {days !== null && days >= 7 && (
        <div className="banner warn">
          <span aria-hidden>⏳</span>
          <div>Ostatnia kopia do pliku {days} dni temu.</div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, textAlign: 'center' }}>
          {[
            ['Sesje', sessions.filter((s) => !s.deletedAt).length],
            ['Kategorie', categories.length],
            ['Do wysłania', sync.dirty],
            ['Kopia', days === null ? 'nigdy' : days === 0 ? 'dziś' : `${days} dni`],
          ].map(([l, v]) => (
            <div key={l as string}>
              <div className="mono" style={{ fontSize: 19, fontWeight: 600 }}>{v}</div>
              <div className="faint">{l}</div>
            </div>
          ))}
        </div>
      </div>

      {CLOUD_CONFIGURED && !zalogowany && auth.ready && <Logowanie />}

      {zalogowany && (
        <div className="stack-sm">
          <button className="btn" onClick={() => { void pull(true).then(() => { reload(); verifyCount() }); setMsg('Pobieram całość z chmury…') }}>
            Pobierz wszystko z chmury
          </button>
          <button className="btn" onClick={() => { resendEverything(); setMsg('Oznaczam wszystko jako niewysłane i wysyłam…') }}>
            Wyślij wszystko ponownie
          </button>
          <ZmianaHasla />
          <button className="btn btn-ghost" onClick={() => { void signOut(); setMsg('Wylogowano. Dane lokalne nietknięte.') }}>
            Wyloguj
          </button>
        </div>
      )}

      <div className="stack-sm">
        <button className="btn btn-primary" onClick={() => { downloadBackup(); setMsg('Kopia zapisana w Pobranych.') }}>
          Pobierz kopię do pliku
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Wczytaj kopię z pliku
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="sr" />
        <p className="faint" style={{ margin: '2px 0 0' }}>
          Scala po identyfikatorze. Sesje usunięte nie wracają, a ustawienia zmieniają się tylko wtedy,
          gdy kopia jest nowsza niż bieżące.
        </p>
      </div>

      {konflikty.length > 0 && (
        <div className="banner warn">
          <span aria-hidden>📝</span>
          <div>
            <strong>{konflikty.length} wersji refleksji przegrało rozstrzygnięcie.</strong>{' '}
            Zachowane lokalnie i w tabeli <code>sessions_audit</code>, żeby nic nie przepadło bez śladu.
          </div>
        </div>
      )}

      {sync.poison > 0 && (
        <div className="banner warn">
          <span aria-hidden>☠️</span>
          <div>
            <strong>{sync.poison} rekordów odrzucanych przez serwer.</strong> Są pomijane, żeby nie
            blokowały reszty wysyłki — ale NIE ma ich w chmurze.
            <div style={{ marginTop: 8 }}>
              <button
                className="btn"
                style={{ padding: '7px 14px', fontSize: 14 }}
                onClick={() => { clearPoison(); resendEverything(); setMsg('Ponawiam odrzucone…') }}
              >
                Spróbuj ponownie
              </button>
            </div>
          </div>
        </div>
      )}

      {msg && <div className="banner">{msg}</div>}
    </div>
  )
}
