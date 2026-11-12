-- Hoofdtabs op de Video's-pagina (bijvoorbeeld Onderwijs, Webdesign, Persoonlijk).
-- Elke hoofdtab bundelt labels; een label hoort bij hooguit één hoofdtab.
-- Uitvoeren in: Supabase dashboard > SQL Editor > New query > Run
-- Vereist 006_video_tabs.sql. Het script is herhaalbaar.

create table if not exists public.video_groups (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  name       text not null check (char_length(name) between 1 and 40),
  position   int  not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists video_groups_user_idx on public.video_groups (user_id, position);

alter table public.video_groups enable row level security;

drop policy if exists "video_groups: eigen rijen" on public.video_groups;
create policy "video_groups: eigen rijen" on public.video_groups
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Bij welke hoofdtab een label hoort. Verwijder je een hoofdtab, dan komen de labels onder Overig.
alter table public.video_tabs
  add column if not exists group_id uuid references public.video_groups(id) on delete set null;

create index if not exists video_tabs_group_idx on public.video_tabs (group_id);
