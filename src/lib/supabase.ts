import { createClient, type SupabaseClient } from '@supabase/supabase-js'

/**
 * Klient Supabase. Konfiguracja przez zmienne build-time w .env.local
 * (plik jest poza repozytorium). Klucz anon jest jawny z zalozenia - dostepu
 * do danych pilnuje Row Level Security po stronie bazy, nie tajnosc klucza.
 */

const URL = import.meta.env.VITE_SUPABASE_URL as string | undefined
const ANON = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const CLOUD_CONFIGURED = Boolean(URL && ANON)
export const SUPABASE_URL = URL ?? ''

let client: SupabaseClient | null = null

export function supabase(): SupabaseClient | null {
  if (!CLOUD_CONFIGURED) return null
  if (!client) {
    client = createClient(URL!, ANON!, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        // KLUCZOWE dla iOS. Aplikacja z ekranu glownego ma wlasna partycje
        // storage. Magic link kliknięty w Mailu otwiera Safari i ustanawia
        // sesje TAM - aplikacja nadal nie ma tokenu. Nie parsujemy wiec URL-a
        // i nie udajemy, ze ta droga dziala.
        detectSessionInUrl: false,
        storageKey: 'pomodore-auth',
        flowType: 'implicit',
      },
      global: { headers: { 'x-application-name': 'pomodore' } },
    })
  }
  return client
}
