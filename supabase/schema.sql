-- =====================================================================
--  Pomodore — schemat synchronizacji
--  Wklej CALOSC w Supabase → SQL Editor → Run.
--  Skrypt jest idempotentny: mozna go uruchomic ponownie bez szkody.
-- =====================================================================
--
--  Niezmiennik nadrzedny calego projektu:
--      NIEOBECNOSC REKORDU LOKALNIE NIGDY NIE KASUJE GO W CHMURZE.
--
--  Wersja 1.0 aplikacji stracila dostep do dwoch miesiecy historii, bo dane
--  istnialy w jednym miejscu. Ten schemat jest zbudowany tak, ze zadna pomylka
--  w kodzie klienta ani wyciek klucza nie usuwa wiersza fizycznie.
-- =====================================================================


-- ---------------------------------------------------------------------
-- 1. TABELE
--
-- Czasy trzymamy jako bigint w milisekundach epoch — 1:1 z src/types.ts
-- i z rekordami odzyskanymi z localstorage.sqlite3. Zadnej konwersji na
-- sciezce zapisu. Czytelnosc w dashboardzie zapewniaja widoki z sekcji 6.
--
-- Swiadomie BEZ ograniczen CHECK na mode/status/dlugosc sesji: nowy tryb
-- dodany w kodzie odbijalby sie bledem 23514 i taki rekord zostalby brudny
-- na zawsze, blokujac przy okazji cala paczke wysylki.
-- ---------------------------------------------------------------------

create table if not exists public.sessions (
  id               uuid primary key,
  user_id          uuid not null default auth.uid()
                     references auth.users(id) on delete restrict,
  intention        text not null default '',
  category_id      uuid,
  mode             text not null,
  planned_seconds  integer not null default 0,
  actual_seconds   integer not null default 0,
  status           text not null,
  reflection       text,
  mood             integer,
  started_at_ms    bigint not null,
  ended_at_ms      bigint not null,
  updated_at_ms    bigint not null,
  deleted_at_ms    bigint,
  server_updated_at timestamptz not null default now()
);

create table if not exists public.categories (
  id               uuid primary key,
  user_id          uuid not null default auth.uid()
                     references auth.users(id) on delete restrict,
  name             text not null,
  color            text not null default '#1F8A8A',
  position         integer not null default 0,
  created_at_ms    bigint not null,
  focus_min                 integer,
  short_break_min           integer,
  long_break_min            integer,
  long_break_every_sessions integer,
  long_break_every_minutes  integer,
  daily_session_goal        integer,
  updated_at_ms    bigint not null,
  deleted_at_ms    bigint,
  server_updated_at timestamptz not null default now()
);

-- Ustawienia to jeden obiekt na uzytkownika. Klucz glowny = user_id,
-- bo upsert leci z onConflict='user_id', nie po 'id'.
create table if not exists public.settings (
  user_id          uuid primary key default auth.uid()
                     references auth.users(id) on delete restrict,
  data             jsonb not null default '{}'::jsonb,
  updated_at_ms    bigint not null,
  server_updated_at timestamptz not null default now()
);

-- Refleksje sa jedyna trescia w tej aplikacji, ktorej nie da sie odtworzyc.
-- Kazda ich nadpisana lub odrzucona wersja ląduje tutaj. Tabela tylko rosnie.
create table if not exists public.sessions_audit (
  id          bigserial primary key,
  session_id  uuid not null,
  user_id     uuid not null,
  op          text not null,          -- 'overwritten' | 'rejected'
  row_data    jsonb not null,
  at          timestamptz not null default now()
);


-- ---------------------------------------------------------------------
-- 2. INDEKSY
-- Kursor pobierania chodzi po (user_id, server_updated_at) — to jedyne
-- zapytanie wykonywane czesto.
-- ---------------------------------------------------------------------

create index if not exists sessions_sync_idx    on public.sessions    (user_id, server_updated_at);
create index if not exists categories_sync_idx  on public.categories  (user_id, server_updated_at);
create index if not exists sessions_started_idx on public.sessions    (user_id, started_at_ms desc);
create index if not exists audit_session_idx    on public.sessions_audit (user_id, session_id, at desc);


-- ---------------------------------------------------------------------
-- 3. STEMPEL SERWERA + PRZYCIECIE ZEGARA KLIENTA
--
-- server_updated_at to JEDYNY monotoniczny porzadek w systemie i sluzy
-- wylacznie jako kursor pobierania. Nie mylic z updated_at_ms, ktory
-- rozstrzyga konflikty i pochodzi od klienta.
--
-- Telefon z zegarem ustawionym w przyszlosc wygrywalby kazdy przyszly
-- konflikt, dlatego przycinamy do now()+2min.
-- ---------------------------------------------------------------------

create or replace function public.stamp_row()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  new.server_updated_at := now();
  new.updated_at_ms := least(
    new.updated_at_ms,
    (extract(epoch from now()) * 1000)::bigint + 120000
  );
  return new;
end;
$$;


-- ---------------------------------------------------------------------
-- 4. STRAZNIK PRZEDAWNIONEGO ZAPISU
--
-- Urzadzenie offline przez trzy dni nie moze po powrocie nadpisac nowszej
-- edycji z drugiego urzadzenia samym faktem pozniejszego doreczenia.
--
-- Zwracamy OLD zamiast rzucac wyjatkiem: wyjatek wywrocilby cala paczke
-- upsertu, a tak przegrany wiersz jest po prostu pomijany i 199 pozostalych
-- przechodzi. Klient pozna faktyczny stan z return=representation.
-- ---------------------------------------------------------------------

create or replace function public.sessions_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.updated_at_ms < old.updated_at_ms then
    -- Zapis przedawniony. Odrzucamy CALY wiersz, wiec zachowujemy CALY wiersz.
    -- Wczesniej warunek patrzyl tylko na reflection/intention, przez co zmiany
    -- pozostalych pol ginely bez sladu, a klient dostawal potwierdzenie przyjecia.
    if to_jsonb(new) is distinct from to_jsonb(old) then
      insert into public.sessions_audit (session_id, user_id, op, row_data)
      values (old.id, old.user_id, 'rejected', to_jsonb(new));
    end if;
    return old;
  end if;

  -- Zapis przyjety. Poprzednia wersja tresci trafia do audytu.
  if new.reflection is distinct from old.reflection
     or new.intention is distinct from old.intention then
    insert into public.sessions_audit (session_id, user_id, op, row_data)
    values (old.id, old.user_id, 'overwritten', to_jsonb(old));
  end if;

  return new;
end;
$$;

create or replace function public.categories_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.updated_at_ms < old.updated_at_ms then
    return old;
  end if;
  return new;
end;
$$;

-- 'create or replace trigger' wymaga PG14+; Supabase to ma.
-- Bez tego ponowne uruchomienie skryptu przerywa sie bledem 42710.
create or replace trigger sessions_stamp
  before insert or update on public.sessions
  for each row execute function public.stamp_row();

create or replace trigger sessions_guard_trg
  before update on public.sessions
  for each row execute function public.sessions_guard();

create or replace trigger categories_stamp
  before insert or update on public.categories
  for each row execute function public.stamp_row();

create or replace trigger categories_guard_trg
  before update on public.categories
  for each row execute function public.categories_guard();

-- Ustawienia takze potrzebuja straznika. Bez niego urzadzenie po dluzszej
-- przerwie bezwarunkowo nadpisuje nowsze ustawienia na wszystkich pozostalych,
-- bo wygrywa ten, kto dotrze pozniej, niezaleznie od wieku danych.
create or replace function public.settings_guard()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.updated_at_ms < old.updated_at_ms then
    return old;
  end if;
  return new;
end;
$$;

create or replace trigger settings_stamp
  before insert or update on public.settings
  for each row execute function public.stamp_row();

create or replace trigger settings_guard_trg
  before update on public.settings
  for each row execute function public.settings_guard();


-- ---------------------------------------------------------------------
-- 5. ROW LEVEL SECURITY
--
-- Kazda tabela: wlasciciel widzi i zmienia wylacznie swoje wiersze.
-- ZADNEJ polityki DELETE — kasowanie odbywa sie przez deleted_at_ms.
-- Brak polityki oznacza brak operacji, takze dla zalogowanego wlasciciela.
-- ---------------------------------------------------------------------

alter table public.sessions       enable row level security;
alter table public.categories     enable row level security;
alter table public.settings       enable row level security;
alter table public.sessions_audit enable row level security;

-- Postgres nie ma 'create policy if not exists', wiec kasujemy przed utworzeniem.
drop policy if exists sessions_select on public.sessions;
drop policy if exists sessions_insert on public.sessions;
drop policy if exists sessions_update on public.sessions;
create policy sessions_select on public.sessions
  for select to authenticated using (user_id = auth.uid());
create policy sessions_insert on public.sessions
  for insert to authenticated with check (user_id = auth.uid());
create policy sessions_update on public.sessions
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists categories_select on public.categories;
drop policy if exists categories_insert on public.categories;
drop policy if exists categories_update on public.categories;
create policy categories_select on public.categories
  for select to authenticated using (user_id = auth.uid());
create policy categories_insert on public.categories
  for insert to authenticated with check (user_id = auth.uid());
create policy categories_update on public.categories
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

drop policy if exists settings_select on public.settings;
drop policy if exists settings_insert on public.settings;
drop policy if exists settings_update on public.settings;
create policy settings_select on public.settings
  for select to authenticated using (user_id = auth.uid());
create policy settings_insert on public.settings
  for insert to authenticated with check (user_id = auth.uid());
create policy settings_update on public.settings
  for update to authenticated using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Audyt: tylko do odczytu z aplikacji. Wpisy tworzy wylacznie trigger
-- (security definer), wiec polityka INSERT nie jest potrzebna.
drop policy if exists audit_select on public.sessions_audit;
create policy audit_select on public.sessions_audit
  for select to authenticated using (user_id = auth.uid());


-- ---------------------------------------------------------------------
-- 6. WIDOKI DO CZYTANIA W DASHBOARDZIE
--
-- Sens tej warstwy to odzyskiwalnosc BEZ aplikacji. W podgladzie Supabase
-- ma byc widac "Diuna, 25.09, refleksja: ...", a nie slupek liczb.
-- security_invoker sprawia, ze widok respektuje RLS pytajacego.
-- ---------------------------------------------------------------------

create or replace view public.sessions_readable
with (security_invoker = true) as
select
  s.id,
  s.intention,
  c.name as kategoria,
  s.mode,
  round(s.actual_seconds / 60.0, 1) as minuty,
  s.status,
  s.reflection,
  s.mood,
  to_timestamp(s.started_at_ms / 1000.0) as rozpoczeto,
  to_timestamp(s.ended_at_ms   / 1000.0) as zakonczono,
  s.deleted_at_ms is not null as usunieta,
  s.server_updated_at
from public.sessions s
left join public.categories c on c.id = s.category_id
order by s.started_at_ms desc;


-- ---------------------------------------------------------------------
-- 7. ODEBRANIE PRAWA KASOWANIA
--
-- Supabase domyslnie nadaje ALL na nowe tabele rolom anon, authenticated
-- i service_role. Samo pominiecie polityki RLS nie wystarczy: klucz
-- service_role omija RLS calkowicie, wiec jego wyciek oznaczalby mozliwosc
-- twardego kasowania. Odbieramy DELETE i TRUNCATE wszystkim.
--
-- Czyszczenie danych pozostaje mozliwe wylacznie jako swiadoma operacja
-- wlasciciela w SQL Editorze, ktory laczy sie jako postgres.
-- ---------------------------------------------------------------------

revoke delete, truncate on
  public.sessions, public.categories, public.settings, public.sessions_audit
  from anon, authenticated, service_role, public;

-- Audyt ma byc TYLKO do dopisywania, a wpisy tworzy wylacznie trigger
-- (security definer dziala z uprawnieniami wlasciciela funkcji, wiec odebranie
-- praw rolom klienckim mu nie przeszkadza). Bez tego revoke service_role
-- nadal moglby zmieniac historie, czyli jedyna kopie przegranych refleksji.
revoke insert, update on public.sessions_audit
  from anon, authenticated, service_role, public;

-- anon (klucz jawny w kodzie aplikacji) nie ma prawa do niczego.
revoke all on
  public.sessions, public.categories, public.settings, public.sessions_audit
  from anon;

grant select, insert, update on
  public.sessions, public.categories, public.settings
  to authenticated;
grant select on public.sessions_audit  to authenticated;
grant select on public.sessions_readable to authenticated;
grant usage, select on sequence public.sessions_audit_id_seq to authenticated;


-- =====================================================================
-- 8. WERYFIKACJA — uruchom po powyzszym i sprawdz wyniki
-- =====================================================================

-- (a) RLS wlaczone na wszystkich czterech tabelach → cztery wiersze, rowsecurity = true
select tablename, rowsecurity
from pg_tables
where schemaname = 'public'
  and tablename in ('sessions','categories','settings','sessions_audit');

-- (b) Zadnej polityki DELETE → ZERO wierszy
select tablename, policyname, cmd
from pg_policies
where schemaname = 'public' and cmd = 'DELETE';

-- (c) anon nie ma zadnych uprawnien do tabel → ZERO wierszy
--     (grantee 'PUBLIC' tez sprawdzamy — 'revoke from anon' tej drogi nie zamyka)
select table_name, grantee, privilege_type
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','PUBLIC')
  and table_name in ('sessions','categories','settings','sessions_audit');

-- (d) Kto moze kasowac → powinny zostac wylacznie role administracyjne
--     (postgres/supabase_admin maja to z definicji wlasciciela i to jest OK)
select table_name, grantee
from information_schema.role_table_grants
where table_schema = 'public'
  and privilege_type = 'DELETE'
  and grantee not in ('postgres','supabase_admin')
  and table_name in ('sessions','categories','settings','sessions_audit');
