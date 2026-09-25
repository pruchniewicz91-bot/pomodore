// Sklada dane odzyskane z kopii zapasowej iPhone'a w jeden plik kopii,
// ktory aplikacja wczytuje w zakladce Dane.
//
// Zrodlo: data/recovered/ - zrzut z localstorage.sqlite3 kontenera
// AppDomain-com.sebastian.pomodore, wyciagniety 25.09.2026.

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const src = join(root, 'data', 'recovered')
const read = (f) => JSON.parse(readFileSync(join(src, f), 'utf8'))

if (!existsSync(join(src, 'pomodore-session-log.json'))) {
  console.error('Brak data/recovered/ - nie ma czego importowac.')
  process.exit(1)
}

const sessions = read('pomodore-session-log.json')
const categories = read('pomodore-categories.json').state.categories
const settings = read('pomodore-settings.json').state

const out = { settings, categories, sessions, exportedAt: Date.now(), schema: 5 }
const dest = join(root, 'data', 'pomodore-backup-odzyskane.json')
writeFileSync(dest, JSON.stringify(out, null, 2))

const focus = sessions.filter((s) => s.mode === 'focus' && s.status === 'completed')
const minutes = Math.round(focus.reduce((a, s) => a + s.actualSeconds, 0) / 60)

console.log(`Zapisano ${dest}`)
console.log(`  sesji:      ${sessions.length} (${focus.length} ukonczonych sesji skupienia)`)
console.log(`  minut:      ${minutes}`)
console.log(`  kategorii:  ${categories.length}`)
console.log(`  zakres:     ${new Date(Math.min(...sessions.map(s => s.startedAt))).toLocaleDateString('pl-PL')}` +
            ` - ${new Date(Math.max(...sessions.map(s => s.startedAt))).toLocaleDateString('pl-PL')}`)
