import { useMemo, useState } from 'react'
import type { Category, Session } from '../types'
import {
  czytelnyCzas, czytelnyCzasKrotki, dniAktywne, minuty, poDniach, poprzedniOkres,
  postepTygodnia, udzialy, wOkresie,
  type Dzien, type Okres,
} from '../lib/statystyki'
import { streak } from '../store/sessions'

/**
 * Podsumowanie: co realnie robisz i w jakim rytmie.
 *
 * Kolor niesie tozsamosc kategorii, ale NIGDY sam - kazdy slupek ma podpis.
 * Walidator palety pokazal, ze przy piatym kolorze rozroznialnosc dla osob
 * z daltonizmem spada ponizej progu, dlatego piata i dalsze kategorie laczą
 * sie w "Pozostale" w kolorze neutralnym.
 */

const OKRESY: { v: Okres; label: string }[] = [
  { v: 7, label: '7 dni' },
  { v: 30, label: '30 dni' },
  { v: 0, label: 'wszystko' },
]

/**
 * Slupek pionowy: gora zaokraglona, dol plaski przy linii zera.
 * Zaokraglenie oznacza koniec DANYCH, nie ozdobe - dlatego tylko z tej strony.
 */
function slupekPionowy(x: number, y: number, w: number, h: number, r = 4): string {
  if (h <= 0) return ''
  const rr = Math.min(r, w / 2, h)
  return `M${x},${y + h} V${y + rr} Q${x},${y} ${x + rr},${y} H${x + w - rr} Q${x + w},${y} ${x + w},${y + rr} V${y + h} Z`
}

/** Slupek poziomy: prawy koniec zaokraglony, lewy plaski przy zerze. */
function slupekPoziomy(w: number, h: number, r = 4): string {
  const rr = Math.min(r, w / 2, h / 2)
  return `M0,0 H${w - rr} Q${w},0 ${w},${rr} V${h - rr} Q${w},${h} ${w - rr},${h} H0 Z`
}

function Rytm({ dni }: { dni: Dzien[] }) {
  const [nad, setNad] = useState<number | null>(null)
  const W = 320, H = 96, GAP = 2
  const maks = Math.max(...dni.map((d) => d.sekundy), 1)
  const szer = Math.max(2, W / dni.length - GAP)
  const dzis = new Date().toDateString()

  return (
    <div style={{ position: 'relative' }}>
      <svg viewBox={`0 0 ${W} ${H + 16}`} style={{ width: '100%', display: 'block' }}
           role="img" aria-label={`Rytm dzienny, ${dni.length} dni`}>
        {/* Siatka wygaszona - ma byc czytelna, nie widoczna. */}
        <line x1="0" y1={H} x2={W} y2={H} stroke="var(--border)" strokeWidth="1" />
        {dni.map((d, i) => {
          const h = (d.sekundy / maks) * (H - 8)
          const x = i * (szer + GAP)
          const aktywny = nad === i
          return (
            <g key={d.klucz}>
              {h > 0 && (
                <path d={slupekPionowy(x, H - h, szer, h)}
                      fill={aktywny ? 'var(--text)' : 'var(--accent)'}
                      opacity={nad === null || aktywny ? 1 : 0.45} />
              )}
              {/* Cel dotyku wiekszy niz znacznik. */}
              <rect x={x} y={0} width={szer + GAP} height={H} fill="transparent"
                    onMouseEnter={() => setNad(i)} onMouseLeave={() => setNad(null)}
                    onTouchStart={() => setNad(i)} />
              {d.data.toDateString() === dzis && (
                <circle cx={x + szer / 2} cy={H + 6} r="1.6" fill="var(--accent)" />
              )}
            </g>
          )
        })}
      </svg>

      <div className="faint" style={{ display: 'flex', justifyContent: 'space-between', marginTop: 2 }}>
        <span>{dni[0]?.data.toLocaleDateString('pl-PL', { day: 'numeric', month: 'short' })}</span>
        <span>dziś</span>
      </div>

      {nad !== null && dni[nad] && (
        <div className="wykres-dymek">
          <strong>{dni[nad].data.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })}</strong>
          {dni[nad].sekundy > 0
            ? ` — ${czytelnyCzas(dni[nad].sekundy)}, ${dni[nad].sesje} ${dni[nad].sesje === 1 ? 'sesja' : 'sesje'}`
            : ' — bez sesji'}
        </div>
      )}
    </div>
  )
}

/**
 * Cele tygodnia. Pokazywane tylko wtedy, gdy jakakolwiek kategoria ma cel -
 * pusta sekcja "nie masz zadnych celow" jest wyrzutem sumienia, nie informacja.
 */
function CeleTygodnia({ sessions, categories }: { sessions: Session[]; categories: Category[] }) {
  const postep = useMemo(() => postepTygodnia(sessions, categories), [sessions, categories])
  if (!postep.length) return null

  return (
    <div className="stack-sm">
      <h2 className="dim" style={{ fontSize: 13 }}>CELE TYGODNIA</h2>
      <div className="card stack-sm">
        {postep.map((p) => {
          const zrobione = Math.round(p.sekundy / 60)
          const osiagniete = p.udzial >= 1
          return (
            <div key={p.kategoria.id}>
              <div className="row" style={{ padding: '0 0 5px', border: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
                  <span className="dot" style={{ background: p.kategoria.color }} />
                  {p.kategoria.name}
                </span>
                <span className="mono faint">
                  {zrobione} / {p.celMinut} min{osiagniete ? ' ✓' : ''}
                </span>
              </div>
              <div className="meter">
                <i style={{
                  width: `${Math.min(100, p.udzial * 100)}%`,
                  background: p.kategoria.color,
                  opacity: osiagniete ? 1 : 0.85,
                }} />
              </div>
            </div>
          )
        })}
      </div>
      <p className="faint" style={{ margin: 0 }}>
        Tydzień liczony od poniedziałku. Cel ustawisz w Ustawieniach, przy kategorii.
      </p>
    </div>
  )
}

export default function SummaryView({ sessions, categories }: {
  sessions: Session[]; categories: Category[]
}) {
  const [okres, setOkres] = useState<Okres>(7)

  const dane = useMemo(() => {
    const w = wOkresie(sessions, okres)
    return {
      sesje: w,
      dni: poDniach(w, okres),
      kategorie: udzialy(w, categories),
      sekundy: w.reduce((a, s) => a + s.actualSeconds, 0),
      poprzedni: poprzedniOkres(sessions, okres),
    }
  }, [sessions, categories, okres])

  /**
   * Srednia po dniach AKTYWNYCH, nie po kalendarzu. Przy zakresie "wszystko"
   * dzielenie przez 70 dni, z ktorych 60 jest pustych, daje liczbe prawdziwa,
   * ale bezuzyteczna - "5 min dziennie" nie mowi nic o tym, jak pracujesz.
   */
  const aktywne = dniAktywne(dane.sesje) || 1
  const srednia = Math.round(dane.sekundy / 60 / aktywne)
  const zmiana = dane.poprzedni && dane.poprzedni.sekundy > 0
    ? Math.round(((dane.sekundy - dane.poprzedni.sekundy) / dane.poprzedni.sekundy) * 100)
    : null

  /**
   * Filtry musza byc renderowane TAKZE w stanie pustym. Wczesniej wczesny return
   * je pomijal, przez co komunikat "zmien zakres" nie mial czym zmienic zakresu -
   * uzytkownik z danymi sprzed miesiaca widzial pusty ekran bez wyjscia.
   */
  const filtry = (
    <div className="chips" role="group" aria-label="Zakres czasu">
      {OKRESY.map((o) => (
        <button key={o.label} className="chip" aria-pressed={okres === o.v} onClick={() => setOkres(o.v)}>
          {o.label}
        </button>
      ))}
    </div>
  )

  if (!dane.sesje.length) {
    return (
      <div className="stack">
        {filtry}
        <CeleTygodnia sessions={sessions} categories={categories} />
        <div className="card" style={{ textAlign: 'center', padding: 32 }}>
          <p className="dim" style={{ margin: 0 }}>Brak ukończonych sesji w tym okresie.</p>
          <p className="faint" style={{ marginBottom: 0 }}>Wybierz szerszy zakres powyżej albo zacznij pierwszą sesję.</p>
        </div>
      </div>
    )
  }

  const maksUdzial = Math.max(...dane.kategorie.map((k) => k.sekundy), 1)

  return (
    <div className="stack">
      {filtry}

      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, textAlign: 'center' }}>
          {[
            ['Czas', czytelnyCzasKrotki(dane.sekundy)],
            ['Sesje', String(dane.sesje.length)],
            ['Śr. dzień', `${srednia} min`],
            ['Passa', `${streak(sessions)} dni`],
          ].map(([l, v]) => (
            <div key={l}>
              <div className="mono" style={{ fontSize: 18, fontWeight: 600, whiteSpace: 'nowrap' }}>{v}</div>
              <div className="faint" style={{ whiteSpace: 'nowrap' }}>{l}</div>
            </div>
          ))}
        </div>
        {zmiana !== null && (
          <div className="faint" style={{ textAlign: 'center', marginTop: 10 }}>
            {`${aktywne} ${aktywne === 1 ? 'dzień' : 'dni'} z sesjami · `}
            {zmiana === 0 ? 'tyle samo co w poprzednim okresie'
              : `${zmiana > 0 ? '↑' : '↓'} ${Math.abs(zmiana)}% wobec poprzednich ${okres} dni`}
          </div>
        )}
      </div>

      <CeleTygodnia sessions={sessions} categories={categories} />

      <div className="stack-sm">
        <h2 className="dim" style={{ fontSize: 13 }}>RYTM</h2>
        <div className="card"><Rytm dni={dane.dni} /></div>
      </div>

      <div className="stack-sm">
        <h2 className="dim" style={{ fontSize: 13 }}>NA CO IDZIE CZAS</h2>
        <div className="card stack-sm">
          {dane.kategorie.map((k) => (
            <div key={k.nazwa}>
              {/* Podpis wprost przy kazdym slupku - tozsamosc nigdy z samego koloru. */}
              <div className="row" style={{ padding: '0 0 5px', border: 0 }}>
                <span style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 14 }}>
                  <span className="dot" style={{ background: k.kolor }} />
                  {k.nazwa}
                </span>
                <span className="mono faint">
                  {czytelnyCzas(k.sekundy)} · {Math.round(k.udzial * 100)}%
                </span>
              </div>
              <svg viewBox="0 0 320 8" style={{ width: '100%', display: 'block' }} aria-hidden>
                <path d={slupekPoziomy(Math.max(4, (k.sekundy / maksUdzial) * 320), 8)}
                      fill={k.kolor} />
              </svg>
            </div>
          ))}
        </div>
        {dane.kategorie.length >= 4 && (
          <p className="faint" style={{ margin: 0 }}>
            Kolorem oznaczone są cztery największe kategorie — przy piątym kolorze słupki
            przestają być rozróżnialne dla osób z daltonizmem.
          </p>
        )}
      </div>

      <div className="faint">
        Liczone są wyłącznie ukończone sesje skupienia — {minuty(dane.sekundy)} min
        w {aktywne} {aktywne === 1 ? 'dniu' : 'dniach'}. Przerwy i sesje przerwane
        widać na liście, ale nie wchodzą do czasu.
      </div>
    </div>
  )
}
