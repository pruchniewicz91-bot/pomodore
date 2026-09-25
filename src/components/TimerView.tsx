import { useEffect, useState } from 'react'
import { useTimer } from '../store/timer'
import { useSettings } from '../store/settings'
import { useCategories } from '../store/categories'
import { useSessions, todaysFocus } from '../store/sessions'
import { MODE_LABEL, MODE_ACCUSATIVE, minutesFor } from '../lib/effective'
import { unlockAudio } from '../lib/audio'
import * as wake from '../lib/wakelock'
import Dial from './Dial'
import ReflectionSheet from './ReflectionSheet'

function mmss(total: number) {
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${String(s).padStart(2, '0')}`
}

export default function TimerView() {
  const t = useTimer()
  const settings = useSettings()
  const { categories } = useCategories()
  const { sessions } = useSessions()

  const cat = categories.find((c) => c.id === t.categoryId) ?? null
  const color = cat?.color ?? 'var(--accent)'
  const idle = t.status === 'idle'

  const plannedMin = t.plannedOverrideSeconds
    ? t.plannedOverrideSeconds / 60
    : minutesFor(t.mode, settings, cat)

  const remaining = idle ? Math.round(plannedMin * 60) : t.remainingSeconds()
  const progress = t.plannedSeconds > 0 ? t.elapsedSeconds() / t.plannedSeconds : 0

  // Akcent interfejsu podaza za kategoria.
  useEffect(() => {
    document.documentElement.style.setProperty('--accent', cat?.color ?? '#1F8A8A')
  }, [cat?.color])

  // Odliczanie nie zmienia stanu magazynu (czas wynika z sygnatur czasowych),
  // wiec React sam z siebie nie przerysuje zegara. Ten licznik wymusza odswiezenie.
  const [, forceRender] = useState(0)
  useEffect(() => {
    if (t.status !== 'running') return
    const id = setInterval(() => {
      useTimer.getState().tick()
      forceRender((n) => n + 1)
    }, 250)
    return () => clearInterval(id)
  }, [t.status])

  // Po powrocie z tla przeliczamy natychmiast - moglo minac duzo czasu.
  useEffect(() => {
    const onVisible = () => {
      if (document.visibilityState !== 'visible') return
      useTimer.getState().tick()
      forceRender((n) => n + 1)
    }
    document.addEventListener('visibilitychange', onVisible)
    return () => document.removeEventListener('visibilitychange', onVisible)
  }, [])

  useEffect(() => {
    if (!settings.keepScreenOn) return
    if (t.status === 'running') void wake.acquire()
    else void wake.release()
  }, [t.status, settings.keepScreenOn])

  useEffect(() => {
    wake.reacquireOnVisible(() => useTimer.getState().status === 'running')
  }, [])

  const today = todaysFocus(sessions)
  const goalMin = settings.dailyGoalMinutes
  const doneMin = Math.round(today.seconds / 60)

  function handleStart() {
    unlockAudio()
    t.start()
  }

  return (
    <div className="stack">
      <div className="chips" role="group" aria-label="Kategoria sesji">
        <button className="chip" aria-pressed={t.categoryId === null} onClick={() => t.setCategory(null)}>
          Bez kategorii
        </button>
        {categories.map((c) => (
          <button
            key={c.id}
            className="chip"
            aria-pressed={t.categoryId === c.id}
            onClick={() => t.setCategory(c.id)}
            disabled={!idle}
          >
            <span className="dot" style={{ background: c.color }} />
            {c.name}
          </button>
        ))}
      </div>

      <input
        type="text"
        value={t.intention}
        onChange={(e) => t.setIntention(e.target.value)}
        placeholder="Co czytasz? np. Diuna — rozdział 12"
        aria-label="Intencja sesji"
      />

      <Dial
        progress={progress}
        label={mmss(remaining)}
        mode={MODE_LABEL[t.mode]}
        color={color}
        editable={idle && t.mode === 'focus'}
        minutes={Math.round(plannedMin)}
        maxMinutes={60}
        snapMinutes={settings.dialSnapMinutes}
        onChangeMinutes={(m) => t.setOverrideMinutes(m)}
      />

      {idle && t.mode === 'focus' && (
        <p className="faint" style={{ textAlign: 'center', margin: 0 }}>
          Przeciągnij tarczę, żeby zmienić długość sesji
        </p>
      )}

      <div className="btn-row">
        {idle && (
          <button className="btn btn-primary" onClick={handleStart}>
            Zacznij {MODE_ACCUSATIVE[t.mode]}
          </button>
        )}
        {t.status === 'running' && (
          <>
            <button className="btn btn-ghost" onClick={() => t.stop()}>Przerwij</button>
            <button className="btn" onClick={() => t.pause()}>Pauza</button>
          </>
        )}
        {t.status === 'paused' && (
          <>
            <button className="btn btn-ghost" onClick={() => t.stop()}>Przerwij</button>
            <button className="btn btn-primary" onClick={() => t.resume()}>Wznów</button>
          </>
        )}
      </div>

      <div className="card stack-sm">
        <div className="row" style={{ padding: 0, border: 0 }}>
          <span className="dim" style={{ fontSize: 14 }}>Dzisiaj</span>
          <span className="mono" style={{ fontSize: 14 }}>
            {doneMin} / {goalMin} min · {today.count} / {settings.dailySessionGoal} sesji
          </span>
        </div>
        <div className="meter">
          <i style={{ width: `${Math.min(100, goalMin ? (doneMin / goalMin) * 100 : 0)}%` }} />
        </div>
      </div>

      {t.pendingReflection && (
        <ReflectionSheet
          defaultMood={settings.defaultMood}
          onSubmit={(text, mood) => t.submitReflection(text, mood)}
          onSkip={() => t.dismissReflection()}
        />
      )}
    </div>
  )
}
