import { useEffect, useState } from 'react'

/**
 * Podpowiedz instalacji.
 *
 * Bez niej aplikacja webowa przegrywa z natywna w jednym konkretnym miejscu:
 * ktos otwiera link, oglada, zamyka karte i nigdy nie wraca. Nie dlatego, ze
 * mu sie nie podobalo, tylko dlatego, ze nie wiedzial, ze moze ja zainstalowac.
 *
 * Pokazujemy TYLKO poza trybem standalone i tylko raz - po odrzuceniu znika
 * na stale. Baner, ktory wraca, jest reklama, nie podpowiedzia.
 */

const KLUCZ = 'pomodore-install-hint'

type Platforma = 'ios' | 'android' | 'desktop'

function rozpoznaj(): Platforma {
  const ua = navigator.userAgent
  if (/iPad|iPhone|iPod/.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua))) return 'ios'
  if (/Android/.test(ua)) return 'android'
  return 'desktop'
}

function wStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    // iOS nie wspiera display-mode w starszych wersjach; ma wlasna flage.
    (navigator as unknown as { standalone?: boolean }).standalone === true
}

export default function InstallHint() {
  const [widoczny, setWidoczny] = useState(false)
  const [platforma, setPlatforma] = useState<Platforma>('desktop')

  useEffect(() => {
    if (wStandalone()) return
    if (localStorage.getItem(KLUCZ) === 'ukryty') return
    setPlatforma(rozpoznaj())
    // Chwila zwloki - baner na starcie wyglada jak wyskakujace okno.
    const t = setTimeout(() => setWidoczny(true), 2500)
    return () => clearTimeout(t)
  }, [])

  if (!widoczny) return null

  const ukryj = () => {
    try { localStorage.setItem(KLUCZ, 'ukryty') } catch { /* tryb prywatny */ }
    setWidoczny(false)
  }

  const tresc = {
    ios: (
      <>
        Naciśnij <strong>Udostępnij</strong> na dole, potem{' '}
        <strong>Dodaj do ekranu początkowego</strong>. Pomodore będzie działać jak
        zwykła aplikacja — pełny ekran, offline, bez paska przeglądarki.
      </>
    ),
    android: (
      <>
        Menu przeglądarki (trzy kropki) → <strong>Zainstaluj aplikację</strong>.
        Pomodore będzie działać jak zwykła aplikacja, także bez internetu.
      </>
    ),
    desktop: (
      <>
        W pasku adresu kliknij ikonę instalacji, żeby otwierać Pomodore
        w osobnym oknie, bez zakładek.
      </>
    ),
  }[platforma]

  return (
    <div className="banner" style={{ marginBottom: 14 }}>
      <span aria-hidden>📲</span>
      <div style={{ minWidth: 0 }}>
        <strong>Dodaj Pomodore do ekranu głównego</strong>
        <div style={{ marginTop: 3 }}>{tresc}</div>
        <button className="faint" style={{ padding: '7px 0 0', textDecoration: 'underline' }} onClick={ukryj}>
          Nie teraz
        </button>
      </div>
    </div>
  )
}
