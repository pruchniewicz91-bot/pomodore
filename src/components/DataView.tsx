import { useRef, useState } from 'react'
import { useSessions } from '../store/sessions'
import { useCategories } from '../store/categories'
import { downloadBackup, restoreBackup, daysSinceBackup } from '../lib/backup'
import { hasRemote, remoteName } from '../lib/storage'

/**
 * Ekran istniejacy z konkretnego powodu: wersja 1.0 stracila dostep do danych,
 * bo nie bylo zadnej kopii poza telefonem. Tutaj widac stan zabezpieczenia
 * wprost, zamiast zakladac, ze dane sa bezpieczne.
 */
export default function DataView() {
  const { sessions, reload } = useSessions()
  const { categories } = useCategories()
  const fileRef = useRef<HTMLInputElement>(null)
  const [msg, setMsg] = useState<string | null>(null)

  const days = daysSinceBackup()
  const unsynced = sessions.filter((s) => !s.synced).length
  const cloud = hasRemote()

  function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0]
    if (!file) return
    const reader = new FileReader()
    reader.onload = () => {
      try {
        const r = restoreBackup(String(reader.result))
        reload()
        useCategories.persist.rehydrate()
        setMsg(`Wczytano: ${r.sessions} sesji, ${r.categories} kategorii.`)
      } catch (err) {
        setMsg(`Nie udało się wczytać: ${(err as Error).message}`)
      }
    }
    reader.readAsText(file)
    e.target.value = ''
  }

  return (
    <div className="stack">
      <div className={`banner ${cloud ? '' : 'warn'}`}>
        <span aria-hidden>{cloud ? '☁️' : '⚠️'}</span>
        <div>
          {cloud ? (
            <>
              <strong>Kopia w chmurze włączona</strong> ({remoteName()}).
              {unsynced > 0 && <> Czeka na wysłanie: {unsynced}.</>}
            </>
          ) : (
            <>
              <strong>Dane są tylko na tym urządzeniu.</strong> Przeglądarka może je usunąć
              bez ostrzeżenia — przy czyszczeniu danych witryn albo gdy zabraknie miejsca.
              Rób kopię regularnie, dopóki nie podłączymy chmury.
            </>
          )}
        </div>
      </div>

      {days !== null && days >= 7 && (
        <div className="banner warn">
          <span aria-hidden>⏳</span>
          <div>Ostatnia kopia {days} dni temu. Warto zrobić nową.</div>
        </div>
      )}

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 4, textAlign: 'center' }}>
          {[
            ['Sesje', sessions.length],
            ['Kategorie', categories.length],
            ['Kopia', days === null ? 'nigdy' : days === 0 ? 'dziś' : `${days} dni`],
          ].map(([l, v]) => (
            <div key={l as string}>
              <div className="mono" style={{ fontSize: 19, fontWeight: 600 }}>{v}</div>
              <div className="faint">{l}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="stack-sm">
        <button className="btn btn-primary" onClick={() => { downloadBackup(); setMsg('Kopia zapisana w Pobranych.') }}>
          Pobierz kopię danych
        </button>
        <button className="btn" onClick={() => fileRef.current?.click()}>
          Wczytaj kopię z pliku
        </button>
        <input ref={fileRef} type="file" accept="application/json,.json" onChange={onFile} className="sr" />
        <p className="faint" style={{ margin: '2px 0 0' }}>
          Wczytywanie scala po identyfikatorze — istniejące sesje nie zostaną nadpisane ani zdublowane.
        </p>
      </div>

      {msg && <div className="banner">{msg}</div>}
    </div>
  )
}
