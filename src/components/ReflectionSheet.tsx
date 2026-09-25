import { useState } from 'react'

const MOODS = ['😖', '😕', '😐', '🙂', '😌']

interface Props {
  onSubmit(text: string, mood: number | null): void
  onSkip(): void
  defaultMood: number | null
}

/** Pytanie po sesji. Krotkie - dluga ankieta zniecheca do konczenia sesji. */
export default function ReflectionSheet({ onSubmit, onSkip, defaultMood }: Props) {
  const [text, setText] = useState('')
  const [mood, setMood] = useState<number | null>(defaultMood)

  return (
    <div className="sheet-backdrop" onClick={(e) => e.target === e.currentTarget && onSkip()}>
      <div className="sheet stack" role="dialog" aria-label="Refleksja po sesji">
        <div>
          <h2>Jak poszło?</h2>
          <p className="faint" style={{ margin: '4px 0 0' }}>
            Jedno zdanie wystarczy. Możesz pominąć.
          </p>
        </div>

        <div className="moods">
          {MOODS.map((emoji, i) => (
            <button
              key={i}
              aria-pressed={mood === i + 1}
              aria-label={`Nastrój ${i + 1} z 5`}
              onClick={() => setMood(i + 1)}
            >
              {emoji}
            </button>
          ))}
        </div>

        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Co przeczytałeś? Co zostało w głowie?"
          autoFocus
        />

        <div className="btn-row">
          <button className="btn btn-ghost" style={{ flex: 1 }} onClick={onSkip}>Pomiń</button>
          <button className="btn btn-primary" style={{ flex: 1 }} onClick={() => onSubmit(text.trim(), mood)}>
            Zapisz
          </button>
        </div>
      </div>
    </div>
  )
}
