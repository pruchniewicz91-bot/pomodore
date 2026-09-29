-- Jedno zapytanie zamiast czterech. Kazdy wiersz to osobny test bezpieczenstwa.
-- Wszystkie musza pokazac OK. Uruchom po schema.sql.

select 'RLS wlaczone' as test,
       case when count(*) = 4 then 'OK' else 'BLAD' end as wynik,
       count(*)::text || ' / 4 tabel' as szczegoly
from pg_tables
where schemaname = 'public' and rowsecurity
  and tablename in ('sessions','categories','settings','sessions_audit')

union all
select 'Brak polityk DELETE',
       case when count(*) = 0 then 'OK' else 'BLAD' end,
       count(*)::text || ' polityk (ma byc 0)'
from pg_policies
where schemaname = 'public' and cmd = 'DELETE'

union all
select 'anon bez dostepu do tabel',
       case when count(*) = 0 then 'OK' else 'BLAD' end,
       count(*)::text || ' uprawnien (ma byc 0)'
from information_schema.role_table_grants
where table_schema = 'public'
  and grantee in ('anon','PUBLIC')
  and table_name in ('sessions','categories','settings','sessions_audit')

union all
select 'Nikt poza administracja nie kasuje',
       case when count(*) = 0 then 'OK' else 'BLAD' end,
       coalesce(string_agg(distinct grantee, ', '), 'nikt')
from information_schema.role_table_grants
where table_schema = 'public'
  and privilege_type = 'DELETE'
  and grantee not in ('postgres','supabase_admin')
  and table_name in ('sessions','categories','settings','sessions_audit')

union all
select 'Straznicy i stemple czasu',
       case when count(*) >= 6 then 'OK' else 'BLAD' end,
       count(*)::text || ' triggerow (ma byc 6)'
from pg_trigger t
join pg_class c on c.oid = t.tgrelid
join pg_namespace n on n.oid = c.relnamespace
where not t.tgisinternal and n.nspname = 'public'
  and c.relname in ('sessions','categories','settings')

union all
select 'Audyt tylko do dopisywania',
       case when count(*) = 0 then 'OK' else 'BLAD' end,
       count(*)::text || ' uprawnien zapisu (ma byc 0)'
from information_schema.role_table_grants
where table_schema = 'public' and table_name = 'sessions_audit'
  and privilege_type in ('INSERT','UPDATE')
  and grantee not in ('postgres','supabase_admin');
