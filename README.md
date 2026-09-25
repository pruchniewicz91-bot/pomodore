# Pomodore

Pomodoro dla osób, które chcą utrzymać skupienie przy czytaniu.

Nie jest to kolejny timer 25/5. Sesja zaczyna się od **intencji** („Diuna — rozdział 12"),
a kończy **refleksją** — jednym zdaniem o tym, co zostało w głowie. Kategorie mają własne
długości sesji, bo czytanie, nauka języka i trening rządzą się innym rytmem.

## Skąd ta wersja

Wersja 1.0 była aplikacją webową w natywnej skorupie, zainstalowaną poza App Store.
Po siedmiu dniach wygasł certyfikat podpisu i aplikacja przestała się uruchamiać —
razem z dostępem do dwóch miesięcy historii czytania.

Dane odzyskano 25.09.2026 z kopii zapasowej iPhone'a: kontener `AppDomain-com.sebastian.pomodore`,
plik `Library/WebKit/WebsiteData/.../LocalStorage/localstorage.sqlite3`.

Odzyskane sesje **nie są częścią tego repozytorium** — to prywatna historia czytania wraz
z refleksjami. Leżą lokalnie w `data/`, wykluczonym w `.gitignore`, i wczytuje się je
w zakładce **Dane** przez „Wczytaj kopię z pliku".

Wnioski wbudowane w tę wersję:

- **PWA zamiast natywnej skorupy** — nie ma certyfikatu, więc nie ma czego wygasić
- **Warstwa zapisu w jednym pliku** ([`src/lib/storage.ts`](src/lib/storage.ts)) — chmurę podłącza się przez jeden adapter
- **Zakładka Dane** pokazuje wprost, czy istnieje kopia poza urządzeniem

## Uruchomienie

```bash
npm install
npm run dev
```

## Polecenia

| Polecenie | Działanie |
|---|---|
| `npm run dev` | serwer deweloperski |
| `npm run build` | build produkcyjny do `dist/` |
| `npm run icons` | regeneracja ikon PWA (własny enkoder PNG, bez zależności) |
| `npm run import` | złożenie odzyskanych danych w plik kopii |

## Format danych

Klucze `localStorage` są **identyczne jak w wersji 1.0**, żeby odzyskane rekordy wczytywały się bez konwersji:

| Klucz | Format |
|---|---|
| `pomodore-settings` | `{ state, version: 2 }` |
| `pomodore-categories` | `{ state: { categories }, version: 4 }` |
| `pomodore-session-log` | czysta tablica sesji |
| `pomodore-timer` | `{ state, version: 1 }` |

Pole `synced: false` w każdym rekordzie czeka na warstwę synchronizacji.

## Do zrobienia

- [ ] Adapter chmury (Supabase) — dopóki go nie ma, dane żyją tylko w przeglądarce
- [ ] Przypomnienie o kopii, gdy minęło 7 dni
- [ ] Wykres tygodniowy w historii
