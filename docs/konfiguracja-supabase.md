# Konfiguracja Supabase — co, gdzie i dlaczego

Dokument dla przyszłego Ciebie. Opisuje nie tylko kroki, ale **zależności**:
co na co wpływa i gdzie szukać, gdy coś przestanie działać.

## Mapa systemu

Synchronizacja składa się z dwóch niezależnych połówek. Każda może zepsuć się osobno.

```
SUPABASE (serwer)                      APLIKACJA (klient)
├── Tabele          kształt danych     ├── .env.local      adres + klucz
├── RLS             kto widzi co       ├── npm run build   WPISUJE je w JS
├── Triggery        kto wygrywa spór   ├── gh-pages        publikuje
├── Granty          czy można kasować  └── localStorage    kopia lokalna
└── Auth
    ├── Users       Twoje konto
    ├── Signup      czy obcy wejdzie
    └── SMTP        czy kod OTP dojdzie
```

**Najważniejsza rzecz do zapamiętania:** zmienne z `.env.local` są **wpisywane
na sztywno w moment budowania**, nie czytane w czasie działania. Zmiana pliku
bez `npm run build` nie zmienia nic. To źródło większości pomyłek.

## Krok 1 — schemat bazy

Uruchamiasz `supabase/schema.sql` w SQL Editorze. Sekcje po kolei:

| Sekcja | Co robi | Co się stanie, gdy zrobisz to źle |
|---|---|---|
| 1. Tabele | kształt danych; czasy jako `bigint` ms, zgodnie z `src/types.ts` | konwersja przy każdym zapisie, ryzyko przesunięć stref |
| 2. Indeksy | przyspieszają zapytanie kursora | działa, ale wolno przy tysiącach rekordów |
| 3. `stamp_row` | dwa zegary: `updated_at_ms` (klient, rozstrzyga spory) i `server_updated_at` (serwer, kursor) | telefon z zegarem w przyszłości wygrywa każdy przyszły konflikt |
| 4. Strażnicy | odrzucają zapis starszy niż to, co już jest | urządzenie offline po powrocie nadpisuje nowsze zmiany |
| 5. RLS | każdy widzi wyłącznie swoje wiersze | **wyciek albo `permission denied`** |
| 6. Widoki | czytelny podgląd w dashboardzie | dane odzyskasz, ale będziesz czytał surowe liczby |
| 7. Odebranie DELETE | fizyczna nieusuwalność wierszy | pomyłka w kodzie kasuje dane bezpowrotnie |
| 8. Weryfikacja | dowód, że powyższe zadziałało | nie wiesz, czy działa, aż będzie za późno |

### Dlaczego brak polityki DELETE

RLS działa na zasadzie „co niedozwolone, jest zabronione". Brak polityki `DELETE`
oznacza, że **nikt** nie skasuje wiersza — nawet zalogowany właściciel, nawet
przez błąd w pętli. Kasowanie odbywa się przez ustawienie `deleted_at_ms`,
co widać i co da się cofnąć jednym `UPDATE`.

Osobno odbieramy grant `DELETE` roli `service_role`, bo ten klucz **omija RLS
całkowicie**. Bez tego jego wyciek oznaczałby możliwość twardego kasowania.

### Co muszą pokazać zapytania weryfikacyjne

- **(a)** cztery wiersze, `rowsecurity = true` — RLS włączone
- **(b) ZERO wierszy** — nie istnieje żadna polityka DELETE
- **(c) ZERO wierszy** — rola `anon` nie ma dostępu do żadnej tabeli
- **(d) ZERO wierszy** — poza rolami administracyjnymi nikt nie kasuje

## Krok 2 — konto

### Dlaczego ręcznie, a nie przez rejestrację w aplikacji

Klucz `anon` jest w kodzie publicznej strony — każdy go odczyta. Gdyby
rejestracja była włączona, dowolna osoba założyłaby konto w **Twoim** projekcie.
Twoich danych by nie zobaczyła (pilnuje tego RLS), ale zużywałaby Twój darmowy
limit i zapełniała bazę.

### Auto Confirm User

Bez tego Supabase wysyła mail potwierdzający. Wbudowany SMTP ma limit rzędu
kilku wiadomości na godzinę i jest oznaczony jako nieprodukcyjny — uzależnianie
pierwszego logowania od poczty to niepotrzebne ryzyko.

### Zależność, o której łatwo zapomnieć

Wyłączenie rejestracji wpływa na kod awaryjny OTP. Dlatego w
`src/lib/auth.ts` jest `shouldCreateUser: false` — bez tego Supabase próbuje
założyć konto i odrzuca całe żądanie. Jedyne wejście awaryjne przestałoby
działać dokładnie wtedy, gdy byłoby potrzebne.

## Krok 3 — klucze

| Klucz | Do czego | Czy jawny | Gdzie |
|---|---|---|---|
| Project URL | adres projektu | tak | `.env.local` → build |
| `anon` | mówi „jestem gościem"; RLS decyduje, co to znaczy | **tak, z założenia** | `.env.local` → build |
| `service_role` | **omija RLS całkowicie** | **nie, nigdy** | tylko serwer, nigdy tu |
| hasło do bazy | bezpośrednie połączenie Postgres (psql, migracje) | **nie** | aplikacja go nie używa |

Po zmianie `.env.local` **zawsze** `npm run build`. Inaczej pracujesz na starych
wartościach wpisanych w poprzedni build.

## Diagnostyka — objaw → przyczyna

| Co widzisz | Gdzie szukać |
|---|---|
| „Chmura nieskonfigurowana" | `.env.local` istnieje? nazwy zmiennych z `VITE_`? zrobiony rebuild? |
| „Błędny e-mail lub hasło" | Authentication → Users: czy konto istnieje i jest potwierdzone |
| „To konto nie istnieje w projekcie" | rejestracja wyłączona, a próbujesz OTP na nieistniejący adres |
| `permission denied for table` | sekcja 7 SQL: granty dla `authenticated` |
| `new row violates row-level security` | polityka INSERT; `user_id` nie zgadza się z `auth.uid()` |
| `42P10 no unique constraint` | `onConflict` wskazuje kolumnę bez klucza — `settings` używa `user_id`, nie `id` |
| Zielony baner, a baza pusta | zmiana projektu Supabase; sprawdź `pomodore-sync-owner` w localStorage |
| „Chmura ma mniej danych niż telefon" | `verifyCount()` wykrył rozjazd — naciśnij „Wyślij wszystko ponownie" |
| Dane nie wracają na drugie urządzenie | kursor `pomodore-sync-cursor`; skasuj go, żeby wymusić pełne pobranie |
| „Za dużo prób" przy kodzie OTP | limit wbudowanego SMTP; podepnij własny (Resend/Postmark) |

### Gdzie zaglądać

- **Supabase → Logs → API** — każde zapytanie z aplikacji, z kodem odpowiedzi
- **Supabase → Table Editor → `sessions_readable`** — Twoje dane po ludzku
- **Supabase → `sessions_audit`** — nadpisane i odrzucone wersje refleksji
- **Przeglądarka → konsola** — wszystkie komunikaty synchronizacji mają prefiks `[sync]`
- **Przeglądarka → Application → Local Storage** — klucze `pomodore-*`

### Klucze w localStorage i ich rola

| Klucz | Rola | Kiedy skasować |
|---|---|---|
| `pomodore-session-log` | dziennik sesji | nigdy ręcznie |
| `pomodore-sync-cursor` | dokąd doszło pobieranie | żeby wymusić pełne pobranie |
| `pomodore-sync-owner` | `URL\|user_id` — wykrywa zmianę projektu | razem z kursorem |
| `pomodore-auth` | token sesji Supabase | przy problemach z logowaniem |
| `pomodore-poison` | rekordy odrzucane przez serwer | po naprawieniu przyczyny |

## Awaria planu darmowego

Darmowy projekt Supabase **usypia po tygodniu bezczynności**, a po długim
uśpieniu może zostać usunięty. To niepokojąco dokładne echo siedmiodniowego
certyfikatu Apple, który zabrał wersję 1.0.

Dlatego istnieje trzecia warstwa, niezależna od czyjegokolwiek serwera:

```bash
node --env-file=.env.local scripts/dump-supabase.mjs
```

Zrzuca całą bazę (łącznie z `sessions_audit`) do `data/backups/` na dysku Maca.
Rób to co jakiś czas. To jedyna kopia, która nie zależy od niczyjego regulaminu.
