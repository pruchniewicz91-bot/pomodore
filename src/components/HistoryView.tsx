import { useMemo, useState } from 'react'
import SummaryView from './SummaryView'
import { useSessions, streak } from '../store/sessions'
import { useCategories } from '../store/categories'

const MOODS = ['😖', '😕', '😐', '🙂', '😌']

function dayLabel(ts: number) {
  const d = new Date(ts)
  const today = new Date(); today.setHours(0, 0, 0, 0)
  const diff = Math.round((today.getTime() - new Date(d).setHours(0, 0, 0, 0)) / 86_400_000)
  if (diff === 0) return 'Dzisiaj'
  if (diff === 1) return 'Wczoraj'
  return d.toLocaleDateString('pl-PL', { weekday: 'long', day: 'numeric', month: 'long' })
}

export default function HistoryView() {
  const { sessions } = useSessions()
  const categories = useCategories((st) => st.categories)
  const activeCats = categories.filter((c) => !c.deletedAt)
  const [filter, setFilter] = useState<string | null>(null)
  const [widok, setWidok] = useState<'podsumowanie' | 'lista'>('podsumowanie')

  const focus = useMemo(
    () => sessions.filter((s) => !s.deletedAt && s.mode === 'focus' && (!filter || s.categoryId === filter)),
    [sessions, filter]
  )

  const totals = useMemo(() => {
    const done = focus.filter((s) => s.status === 'completed')
    return {
      sessions: done.length,
      minutes: Math.round(done.reduce((a, s) => a + s.actualSeconds, 0) / 60),
      abandoned: focus.length - done.length,
      streak: streak(sessions),
    }
  }, [focus, sessions])

  const byDay = useMemo(() => {
    const map = new Map<string, typeof focus>()
    for (const s of [...focus].reverse()) {
      const key = new Date(s.startedAt).toDateString()
      const arr = map.get(key)
      if (arr) arr.push(s); else map.set(key, [s])
    }
    return [...map.entries()]
  }, [focus])

  const przelacznik = (
    <div className="chips" role="group" aria-label="Widok historii">
      <button className="chip" aria-pressed={widok === 'podsumowanie'} onClick={() => setWidok('podsumowanie')}>
        Podsumowanie
      </button>
      <button className="chip" aria-pressed={widok === 'lista'} onClick={() => setWidok('lista')}>
        Lista sesji
      </button>
    </div>
  )

  if (!sessions.length) {
    return (
      <div className="card" style={{ textAlign: 'center', padding: 36 }}>
        <p className="dim" style={{ margin: 0 }}>Brak sesji.</p>
        <p className="faint" style={{ marginBottom: 0 }}>
          Zacznij pierwszą albo wczytaj kopię w zakładce Dane.
        </p>
      </div>
    )
  }

  if (widok === 'podsumowanie') {
    return (
      <div className="stack">
        {przelacznik}
        <SummaryView sessions={sessions} categories={categories} />
      </div>
    )
  }

  return (
    <div className="stack">
      {przelacznik}
      <div className="card">
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 4, textAlign: 'center' }}>
          {[
            ['Sesje', totals.sessions],
            ['Minuty', totals.minutes],
            ['Passa', `${totals.streak} dni`],
            ['Porzucone', totals.abandoned],
          ].map(([label, value]) => (
            <div key={label as string}>
              <div className="mono" style={{ fontSize: 21, fontWeight: 600 }}>{value}</div>
              <div className="faint">{label}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="chips" role="group" aria-label="Filtr kategorii">
        <button className="chip" aria-pressed={filter === null} onClick={() => setFilter(null)}>
          Wszystkie
        </button>
        {activeCats.map((c) => (
          <button key={c.id} className="chip" aria-pressed={filter === c.id} onClick={() => setFilter(c.id)}>
            <span className="dot" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>

      {byDay.map(([key, items]) => (
        <div key={key} className="stack-sm">
          <h2 className="dim" style={{ fontSize: 13, textTransform: 'capitalize' }}>
            {dayLabel(items[0].startedAt)}
          </h2>
          <div className="card" style={{ paddingTop: 2, paddingBottom: 2 }}>
            {items.map((s) => {
              const cat = categories.find((c) => c.id === s.categoryId)
              return (
                <div className="row" key={s.id}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 7 }}>
                      {cat && <span className="dot" style={{ background: cat.color }} />}
                      <span style={{ fontSize: 14.5, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.intention || <span className="faint">bez intencji</span>}
                      </span>
                    </div>
                    {s.reflection && (
                      <div className="faint" style={{ marginTop: 3, fontStyle: 'italic' }}>„{s.reflection}"</div>
                    )}
                  </div>
                  <div style={{ textAlign: 'right', flex: '0 0 auto' }}>
                    <div className="mono" style={{ fontSize: 14, opacity: s.status === 'completed' ? 1 : 0.45 }}>
                      {Math.round(s.actualSeconds / 60)} min
                    </div>
                    <div className="faint">
                      {s.mood ? MOODS[s.mood - 1] : ''}{' '}
                      {new Date(s.startedAt).toLocaleTimeString('pl-PL', { hour: '2-digit', minute: '2-digit' })}
                    </div>
                  </div>
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}
