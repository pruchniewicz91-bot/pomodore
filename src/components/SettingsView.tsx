import { useState } from 'react'
import { useSettings } from '../store/settings'
import { useCategories } from '../store/categories'
import { SOUND_NAMES, playEndSound, unlockAudio } from '../lib/audio'
import { PALETTE } from '../lib/defaults'
import type { Settings } from '../types'

function NumberRow({ label, hint, value, min, max, step = 1, onChange }: {
  label: string; hint?: string; value: number; min: number; max: number; step?: number
  onChange(v: number): void
}) {
  return (
    <div className="row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5 }}>{label}</div>
        {hint && <div className="faint">{hint}</div>}
      </div>
      <div className="btn-row" style={{ flex: '0 0 auto' }}>
        <button className="btn" style={{ padding: '6px 13px' }}
          onClick={() => onChange(Math.max(min, value - step))} aria-label={`${label} mniej`}>−</button>
        <span className="mono" style={{ minWidth: 38, textAlign: 'center' }}>{value}</span>
        <button className="btn" style={{ padding: '6px 13px' }}
          onClick={() => onChange(Math.min(max, value + step))} aria-label={`${label} więcej`}>+</button>
      </div>
    </div>
  )
}

function Toggle({ label, hint, value, onChange }: {
  label: string; hint?: string; value: boolean; onChange(v: boolean): void
}) {
  return (
    <label className="row">
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 14.5 }}>{label}</div>
        {hint && <div className="faint">{hint}</div>}
      </div>
      <input type="checkbox" checked={value} onChange={(e) => onChange(e.target.checked)} />
    </label>
  )
}

export default function SettingsView() {
  const s = useSettings()
  const { add, update, remove } = useCategories()
  // Filtr POZA selektorem: selektor zwracajacy nowa tablice przy kazdym
  // wywolaniu lamie porownanie Object.is w useSyncExternalStore.
  const allCategories = useCategories((st) => st.categories)
  const categories = allCategories.filter((c) => !c.deletedAt)
  const [newName, setNewName] = useState('')
  const [editing, setEditing] = useState<string | null>(null)
  const set = <K extends keyof Settings>(k: K) => (v: Settings[K]) => s.set(k, v)

  return (
    <div className="stack">
      <div className="stack-sm">
        <h2 className="dim" style={{ fontSize: 13 }}>KATEGORIE</h2>
        <div className="card" style={{ paddingTop: 2, paddingBottom: 2 }}>
          {categories.map((c) => (
            <div key={c.id}>
              <div className="row">
                <button
                  style={{ display: 'flex', alignItems: 'center', gap: 9, minWidth: 0, flex: 1, textAlign: 'left' }}
                  onClick={() => setEditing(editing === c.id ? null : c.id)}
                >
                  <span className="dot" style={{ background: c.color, width: 11, height: 11 }} />
                  <span style={{ fontSize: 14.5 }}>{c.name}</span>
                  <span className="faint">
                    {c.focusMin ?? s.focusMin} min
                    {c.weeklyGoalMinutes ? ` · cel ${c.weeklyGoalMinutes}/tydz.` : ''}
                  </span>
                </button>
                <button className="faint" onClick={() => remove(c.id)} aria-label={`Usuń ${c.name}`}>Usuń</button>
              </div>
              {editing === c.id && (
                <div style={{ padding: '4px 0 14px' }}>
                  <div className="chips" style={{ marginBottom: 8 }}>
                    {PALETTE.map((col) => (
                      <button key={col} className="chip" aria-pressed={c.color === col}
                        onClick={() => update(c.id, { color: col })} aria-label={`Kolor ${col}`}>
                        <span className="dot" style={{ background: col }} />
                      </button>
                    ))}
                  </div>
                  <NumberRow label="Skupienie" hint="minut, 0 = jak globalne" min={0} max={120}
                    value={c.focusMin ?? 0} onChange={(v) => update(c.id, { focusMin: v || null })} />
                  <NumberRow label="Przerwa" hint="minut, 0 = jak globalne" min={0} max={60}
                    value={c.shortBreakMin ?? 0} onChange={(v) => update(c.id, { shortBreakMin: v || null })} />
                  <NumberRow label="Długa przerwa co" hint="minut skupienia, 0 = wyłączone" min={0} max={180} step={5}
                    value={c.longBreakEveryMinutes ?? 0} onChange={(v) => update(c.id, { longBreakEveryMinutes: v || null })} />
                  <NumberRow label="Cel tygodniowy" hint="minut w tygodniu, 0 = bez celu" min={0} max={1200} step={30}
                    value={c.weeklyGoalMinutes ?? 0} onChange={(v) => update(c.id, { weeklyGoalMinutes: v || null })} />
                </div>
              )}
            </div>
          ))}
          <div className="row">
            <input type="text" value={newName} placeholder="Nowa kategoria"
              onChange={(e) => setNewName(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter' && newName.trim()) { add(newName.trim()); setNewName('') } }} />
            <button className="btn" disabled={!newName.trim()}
              onClick={() => { add(newName.trim()); setNewName('') }}>Dodaj</button>
          </div>
        </div>
      </div>

      <div className="stack-sm">
        <h2 className="dim" style={{ fontSize: 13 }}>CZAS</h2>
        <div className="card" style={{ paddingTop: 2, paddingBottom: 2 }}>
          <NumberRow label="Skupienie" hint="minut" value={s.focusMin} min={1} max={120} onChange={set('focusMin')} />
          <NumberRow label="Przerwa" hint="minut" value={s.shortBreakMin} min={1} max={60} onChange={set('shortBreakMin')} />
          <NumberRow label="Długa przerwa" hint="minut" value={s.longBreakMin} min={1} max={90} onChange={set('longBreakMin')} />
          <NumberRow label="Długa przerwa co" hint="ukończonych sesji, 0 = wyłączone"
            value={s.longBreakEverySessions} min={0} max={12} onChange={set('longBreakEverySessions')} />
          <NumberRow label="Ostrzeżenie przed końcem" hint="minut wcześniej, 0 = bez"
            value={s.warningMinutes} min={0} max={10} onChange={set('warningMinutes')} />
        </div>
      </div>

      <div className="stack-sm">
        <h2 className="dim" style={{ fontSize: 13 }}>PRZEBIEG</h2>
        <div className="card" style={{ paddingTop: 2, paddingBottom: 2 }}>
          <Toggle label="Automatyczna przerwa" hint="startuje sama po sesji"
            value={s.autoStartBreak} onChange={set('autoStartBreak')} />
          <Toggle label="Automatyczne skupienie" hint="startuje samo po przerwie"
            value={s.autoStartFocus} onChange={set('autoStartFocus')} />
          <Toggle label="Pytaj o refleksję" hint="krótkie pytanie po sesji"
            value={s.askReflection} onChange={set('askReflection')} />
          <Toggle label="Nie wygaszaj ekranu" hint="przydatne przy czytaniu z ekranu"
            value={s.keepScreenOn} onChange={set('keepScreenOn')} />
        </div>
      </div>

      <div className="stack-sm">
        <h2 className="dim" style={{ fontSize: 13 }}>DŹWIĘK</h2>
        <div className="card" style={{ paddingTop: 2, paddingBottom: 2 }}>
          <Toggle label="Dźwięki" value={s.soundsEnabled} onChange={set('soundsEnabled')} />
          <div className="row">
            <span style={{ fontSize: 14.5 }}>Koniec skupienia</span>
            <select value={s.endSoundFocus} style={{ width: 'auto' }}
              onChange={(e) => { unlockAudio(); s.set('endSoundFocus', e.target.value); playEndSound('focus', { ...s, endSoundFocus: e.target.value }) }}>
              {SOUND_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <div className="row">
            <span style={{ fontSize: 14.5 }}>Koniec przerwy</span>
            <select value={s.endSoundBreak} style={{ width: 'auto' }}
              onChange={(e) => { unlockAudio(); s.set('endSoundBreak', e.target.value); playEndSound('shortBreak', { ...s, endSoundBreak: e.target.value }) }}>
              {SOUND_NAMES.map((n) => <option key={n} value={n}>{n}</option>)}
            </select>
          </div>
          <label className="row" style={{ display: 'block' }}>
            <div style={{ fontSize: 14.5, marginBottom: 6 }}>Głośność</div>
            <input type="range" min={0} max={1} step={0.02} value={s.soundVolume}
              onChange={(e) => s.set('soundVolume', Number(e.target.value))} />
          </label>
        </div>
      </div>

      <div className="stack-sm">
        <h2 className="dim" style={{ fontSize: 13 }}>CEL DNIA</h2>
        <div className="card" style={{ paddingTop: 2, paddingBottom: 2 }}>
          <NumberRow label="Minuty" value={s.dailyGoalMinutes} min={0} max={480} step={15} onChange={set('dailyGoalMinutes')} />
          <NumberRow label="Sesje" value={s.dailySessionGoal} min={0} max={24} onChange={set('dailySessionGoal')} />
        </div>
      </div>
    </div>
  )
}
