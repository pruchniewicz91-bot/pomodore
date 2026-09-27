// Zrzut calej bazy Pomodore na dysk. Trzecia warstwa trwalosci - jedyna,
// ktora nie zalezy od niczyjego serwera i niczyjego regulaminu.
//
// Uruchomienie (poswiadczenia czytane WYLACZNIE ze zmiennych srodowiskowych,
// nigdy z argumentow wiersza polecen, ktore trafiaja do historii powloki):
//
//     node --env-file=.env.local scripts/dump-supabase.mjs
//
// Zrzuca takze sessions_audit - to jedyna kopia przegranych wersji refleksji.

import { createClient } from '@supabase/supabase-js'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const { VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: ANON,
        POMODORE_EMAIL: EMAIL, POMODORE_PASSWORD: PASS } = process.env

const brakujace = Object.entries({ VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: ANON,
                                   POMODORE_EMAIL: EMAIL, POMODORE_PASSWORD: PASS })
  .filter(([, v]) => !v).map(([k]) => k)

if (brakujace.length) {
  console.error('Brak zmiennych srodowiskowych: ' + brakujace.join(', '))
  console.error('Uzupelnij .env.local i uruchom:')
  console.error('  node --env-file=.env.local scripts/dump-supabase.mjs')
  process.exit(1)
}

const db = createClient(URL, ANON, { auth: { persistSession: false } })

const { error: authErr } = await db.auth.signInWithPassword({ email: EMAIL, password: PASS })
if (authErr) { console.error('Logowanie nieudane:', authErr.message); process.exit(1) }

const PAGE = 1000

async function pobierzWszystko(tabela) {
  const out = []
  for (let off = 0; ; off += PAGE) {
    // PostgREST ucina odpowiedz na db-max-rows BEZ ostrzezenia - stad petla.
    const { data, error } = await db.from(tabela).select('*').range(off, off + PAGE - 1)
    if (error) throw new Error(`${tabela}: ${error.message}`)
    out.push(...data)
    if (data.length < PAGE) return out
  }
}

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const dir = join(root, 'data', 'backups')
mkdirSync(dir, { recursive: true })

const zrzut = { exportedAt: Date.now(), schema: 6 }
for (const t of ['sessions', 'categories', 'settings', 'sessions_audit']) {
  zrzut[t] = await pobierzWszystko(t)
  console.log(`  ${t.padEnd(16)} ${zrzut[t].length}`)
}

const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
const plik = join(dir, `pomodore-supabase-${stamp}.json`)
writeFileSync(plik, JSON.stringify(zrzut, null, 2))
console.log(`\nZapisano ${plik}`)

await db.auth.signOut()
