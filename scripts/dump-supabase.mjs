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
import { createInterface } from 'node:readline'

const { VITE_SUPABASE_URL: URL, VITE_SUPABASE_ANON_KEY: ANON } = process.env
let EMAIL = process.env.POMODORE_EMAIL
let PASS = process.env.POMODORE_PASSWORD

if (!URL || !ANON) {
  console.error('Brak VITE_SUPABASE_URL albo VITE_SUPABASE_ANON_KEY.')
  console.error('Uruchom tak, zeby skrypt widzial .env.local:')
  console.error('  node --env-file=.env.local scripts/dump-supabase.mjs')
  process.exit(1)
}

/**
 * Haslo pytamy interaktywnie, gdy nie ma go w zmiennych.
 * Argument wiersza polecen odpada - trafilby do historii powloki.
 * Plik tez jest gorszy niz pytanie: haslo do konta nie musi lezec na dysku,
 * skoro potrzebne jest raz na jakis czas.
 */
function zapytaj(pytanie, ukryte = false) {
  return new Promise((resolve) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    if (ukryte) {
      // Podmieniamy wypisywanie, zeby haslo nie pojawilo sie na ekranie.
      const pisz = rl._writeToOutput?.bind(rl)
      rl._writeToOutput = function (str) {
        if (str.includes(pytanie)) pisz?.(str)
        else pisz?.('*')
      }
    }
    rl.question(pytanie, (odp) => { rl.close(); if (ukryte) process.stdout.write('\n'); resolve(odp.trim()) })
  })
}

if (!process.stdin.isTTY && (!EMAIL || !PASS)) {
  console.error('Brak POMODORE_EMAIL / POMODORE_PASSWORD, a terminal nie pozwala zapytac.')
  console.error('Uzupelnij je w .env.local albo uruchom skrypt w zwyklym terminalu.')
  process.exit(1)
}

if (!EMAIL) EMAIL = await zapytaj('E-mail konta Pomodore: ')
if (!PASS) PASS = await zapytaj('Haslo (nie bedzie widoczne): ', true)

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
