-- Labels (tags) op video's
-- Uitvoeren in: Supabase dashboard > SQL Editor > New query > Run
-- Bestaande video's blijven ongewijzigd (geen labels). Het script is herhaalbaar.

alter table public.videos
  add column if not exists tags text[] not null default '{}';

create index if not exists videos_tags_idx on public.videos using gin (tags);
