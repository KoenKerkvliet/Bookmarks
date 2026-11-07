-- Kop-kaart (H2-titel om cards te groeperen)
-- Uitvoeren in: Supabase dashboard > SQL Editor > New query > Run
-- Bestaande cards blijven ongewijzigd. Het script is herhaalbaar.

alter table public.cards drop constraint if exists cards_type_check;
alter table public.cards
  add constraint cards_type_check
  check (type in ('links', 'clock', 'weather', 'countdown', 'note', 'todo', 'search', 'heading'));
