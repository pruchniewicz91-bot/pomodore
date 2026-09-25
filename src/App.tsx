import { useEffect, useState } from 'react'
import TimerView from './components/TimerView'
import HistoryView from './components/HistoryView'
import SettingsView from './components/SettingsView'
import DataView from './components/DataView'

type Tab = 'timer' | 'history' | 'data' | 'settings'

const TABS: { id: Tab; label: string; path: string }[] = [
  { id: 'timer', label: 'Timer', path: 'M12 6v6l4 2M12 3a9 9 0 100 18 9 9 0 000-18z' },
  { id: 'history', label: 'Historia', path: 'M4 19V5M9 19V9M14 19v-7M19 19v-4' },
  { id: 'data', label: 'Dane', path: 'M12 3l8 4v6c0 4-3.4 7.2-8 8-4.6-.8-8-4-8-8V7l8-4z' },
  { id: 'settings', label: 'Ustawienia', path: 'M12 15a3 3 0 100-6 3 3 0 000 6zM4 12h2m12 0h2M12 4v2m0 12v2M6.3 6.3l1.4 1.4m8.6 8.6l1.4 1.4m0-11.4l-1.4 1.4M7.7 16.3l-1.4 1.4' },
]

export default function App() {
  const [tab, setTab] = useState<Tab>('timer')

  // iOS respektuje motyw systemowy; zapisany wybor uzytkownika ma pierwszenstwo.
  useEffect(() => {
    const saved = localStorage.getItem('pomodore-theme')
    if (saved) document.documentElement.dataset.theme = saved
  }, [])

  return (
    <>
      <div className="app">
        <header className="row" style={{ padding: '4px 0 14px', border: 0 }}>
          <h1>{TABS.find((t) => t.id === tab)!.label}</h1>
        </header>

        <main>
          {tab === 'timer' && <TimerView />}
          {tab === 'history' && <HistoryView />}
          {tab === 'data' && <DataView />}
          {tab === 'settings' && <SettingsView />}
        </main>
      </div>

      <nav className="tabbar" aria-label="Nawigacja główna">
        {TABS.map((t) => (
          <button key={t.id} onClick={() => setTab(t.id)} aria-current={tab === t.id ? 'page' : undefined}>
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"
                 strokeLinecap="round" strokeLinejoin="round" aria-hidden>
              <path d={t.path} />
            </svg>
            {t.label}
          </button>
        ))}
      </nav>
    </>
  )
}
