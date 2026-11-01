-- Widgets (klok, weer, aftellen, notitie, taken, zoeken)
-- Uitvoeren in: Supabase dashboard > SQL Editor > New query > Run
-- Bestaande cards blijven ongewijzigd (type 'links').

alter table public.cards
  add column if not exists type text not null default 'links'
    check (type in ('links', 'clock', 'weather', 'countdown', 'note', 'todo', 'search')),
  add column if not exists config jsonb not null default '{}'::jsonb;
