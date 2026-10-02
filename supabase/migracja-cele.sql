-- Cel tygodniowy na kategorie. Uruchom w SQL Editorze po schema.sql.
-- Idempotentne: mozna puscic ponownie bez szkody.

alter table public.categories
  add column if not exists weekly_goal_minutes integer;

comment on column public.categories.weekly_goal_minutes is
  'Cel tygodniowy w minutach skupienia. NULL = brak celu. Tygodniowy, nie dzienny, '
  'bo aktywnosci typu silownia maja rytm kilku razy w tygodniu, a nie codzienny.';

-- Kontrola: kolumna istnieje i jest pusta dla istniejacych kategorii
select name, weekly_goal_minutes
from public.categories
order by position;
