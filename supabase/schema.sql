-- Bookmarks — databaseschema voor Supabase
-- Uitvoeren in: Supabase dashboard > SQL Editor > New query > Run
-- Het script is herhaalbaar (idempotent) voor zover mogelijk.

-- ---------------------------------------------------------------------------
-- Tabellen
-- ---------------------------------------------------------------------------

create table if not exists public.user_settings (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  api_key    text not null unique
             default replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', ''),
  created_at timestamptz not null default now()
);

create table if not exists public.pages (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  title      text not null default 'Nieuwe pagina',
  columns    smallint not null default 3 check (columns between 1 and 6),
  position   int not null default 0,
  is_inbox   boolean not null default false,   -- de vaste pagina "Nieuw"
  created_at timestamptz not null default now()
);

-- Per gebruiker precies één inbox-pagina
create unique index if not exists pages_one_inbox_per_user
  on public.pages (user_id) where is_inbox;

create table if not exists public.cards (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid() references auth.users(id) on delete cascade,
  page_id      uuid not null references public.pages(id) on delete cascade,
  title        text not null default 'Nieuwe card',
  column_index smallint not null default 0,
  position     int not null default 0,
  view         text not null default 'list'
               check (view in ('list', 'icons-s', 'icons-m', 'icons-l')),
  created_at   timestamptz not null default now()
);
create index if not exists cards_page_idx on public.cards (page_id);

-- Widgets: een card is standaard een lijst met links; andere types zijn widgets.
-- (Los uitvoerbaar op bestaande databases: supabase/migrations/002_widgets.sql)
alter table public.cards
  add column if not exists type text not null default 'links'
    check (type in ('links', 'clock', 'weather', 'countdown', 'note', 'todo', 'search', 'heading')),
  add column if not exists config jsonb not null default '{}'::jsonb;

-- Kop-kaarten (supabase/migrations/004_heading_cards.sql)
alter table public.cards drop constraint if exists cards_type_check;
alter table public.cards
  add constraint cards_type_check
  check (type in ('links', 'clock', 'weather', 'countdown', 'note', 'todo', 'search', 'heading'));

-- card_id = null betekent: staat in de inbox ("Nieuw")
create table if not exists public.bookmarks (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  card_id    uuid references public.cards(id) on delete cascade,
  title      text not null,
  url        text not null,
  position   int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists bookmarks_card_idx on public.bookmarks (card_id);
create index if not exists bookmarks_user_idx on public.bookmarks (user_id);

-- ---------------------------------------------------------------------------
-- Row Level Security: iedereen ziet en wijzigt alleen zijn eigen data
-- ---------------------------------------------------------------------------

alter table public.user_settings enable row level security;
alter table public.pages         enable row level security;
alter table public.cards         enable row level security;
alter table public.bookmarks     enable row level security;

drop policy if exists "settings: eigen rij lezen" on public.user_settings;
create policy "settings: eigen rij lezen" on public.user_settings
  for select using (user_id = auth.uid());

drop policy if exists "pages: lezen" on public.pages;
drop policy if exists "pages: toevoegen" on public.pages;
drop policy if exists "pages: wijzigen" on public.pages;
drop policy if exists "pages: verwijderen" on public.pages;
create policy "pages: lezen" on public.pages
  for select using (user_id = auth.uid());
create policy "pages: toevoegen" on public.pages
  for insert with check (user_id = auth.uid() and not is_inbox);
create policy "pages: wijzigen" on public.pages
  for update using (user_id = auth.uid()) with check (user_id = auth.uid());
create policy "pages: verwijderen" on public.pages
  for delete using (user_id = auth.uid() and not is_inbox);

drop policy if exists "cards: eigen rijen" on public.cards;
create policy "cards: eigen rijen" on public.cards
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and exists (select 1 from public.pages p where p.id = page_id and p.user_id = auth.uid())
  );

drop policy if exists "bookmarks: eigen rijen" on public.bookmarks;
create policy "bookmarks: eigen rijen" on public.bookmarks
  for all using (user_id = auth.uid())
  with check (
    user_id = auth.uid()
    and (card_id is null
         or exists (select 1 from public.cards c where c.id = card_id and c.user_id = auth.uid()))
  );

-- ---------------------------------------------------------------------------
-- Functies
-- ---------------------------------------------------------------------------

-- Maakt bij de eerste login de API-sleutel en de inbox-pagina "Nieuw" aan.
create or replace function public.ensure_user_setup()
returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    return;
  end if;
  insert into public.user_settings (user_id) values (uid) on conflict do nothing;
  insert into public.pages (user_id, title, columns, position, is_inbox)
    values (uid, 'Nieuw', 1, -1, true)
    on conflict (user_id) where is_inbox do nothing;
end;
$$;

-- Nieuwe API-sleutel genereren (de oude werkt daarna niet meer).
create or replace function public.regenerate_api_key()
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  new_key text := replace(gen_random_uuid()::text || gen_random_uuid()::text, '-', '');
begin
  if auth.uid() is null then
    raise exception 'niet ingelogd' using errcode = '28000';
  end if;
  update public.user_settings set api_key = new_key where user_id = auth.uid();
  return new_key;
end;
$$;

-- Aanroepbaar door de browserextensie met alleen de API-sleutel (geen login nodig).
-- Voegt een snelkoppeling toe aan de inbox ("Nieuw"). Dubbele URL's in de inbox
-- worden niet nogmaals toegevoegd.
create or replace function public.add_bookmark(p_key text, p_url text, p_title text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid;
  bid       uuid;
  dup       boolean := false;
  clean_url text := btrim(coalesce(p_url, ''));
  clean_ttl text := nullif(btrim(coalesce(p_title, '')), '');
begin
  select user_id into uid from public.user_settings where api_key = p_key;
  if uid is null then
    raise exception 'ongeldige API-sleutel' using errcode = '28000';
  end if;
  if clean_url !~* '^https?://' or length(clean_url) > 2048 then
    raise exception 'ongeldige URL' using errcode = '22023';
  end if;

  select id into bid from public.bookmarks
    where user_id = uid and card_id is null and url = clean_url
    limit 1;

  if bid is null then
    insert into public.bookmarks (user_id, card_id, title, url, position)
      values (
        uid, null,
        left(coalesce(clean_ttl, regexp_replace(clean_url, '^https?://(www\.)?([^/?#]+).*$', '\2')), 300),
        clean_url, 0
      )
      returning id into bid;
  else
    dup := true;
  end if;

  return json_build_object('ok', true, 'id', bid, 'duplicate', dup);
end;
$$;

revoke all on function public.ensure_user_setup()  from public, anon;
revoke all on function public.regenerate_api_key() from public, anon;
revoke all on function public.add_bookmark(text, text, text) from public;
grant execute on function public.ensure_user_setup()  to authenticated;
grant execute on function public.regenerate_api_key() to authenticated;
grant execute on function public.add_bookmark(text, text, text) to anon, authenticated;

-- ---------------------------------------------------------------------------
-- Realtime: nieuwe snelkoppelingen van de extensie direct zichtbaar op de site
-- ---------------------------------------------------------------------------
do $$
begin
  alter publication supabase_realtime add table public.bookmarks;
exception when duplicate_object then
  null;
end $$;

-- ---------------------------------------------------------------------------
-- Video's (YouTube): zie ook supabase/migrations/003_videos.sql
-- ---------------------------------------------------------------------------

create table if not exists public.videos (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  video_id   text not null,                       -- de 11 tekens uit de YouTube-URL
  kind       text not null default 'video' check (kind in ('short', 'video')),
  url        text not null,
  title      text not null default 'YouTube-video',
  channel    text,
  watched    boolean not null default false,
  created_at timestamptz not null default now(),
  unique (user_id, video_id)
);
create index if not exists videos_user_idx on public.videos (user_id, created_at desc);

alter table public.videos enable row level security;

drop policy if exists "videos: eigen rijen" on public.videos;
create policy "videos: eigen rijen" on public.videos
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Aanroepbaar door de extensie met alleen de API-sleutel (zoals add_bookmark).
-- Herkent youtube.com/shorts/ID, youtube.com/watch?v=ID, youtu.be/ID, /live/, /embed/.
-- Dezelfde video wordt niet dubbel opgeslagen.
create or replace function public.add_video(p_key text, p_url text, p_title text default null)
returns json
language plpgsql
security definer
set search_path = public
as $$
declare
  uid       uuid;
  vid       text;
  vkind     text := 'video';
  m         text[];
  new_id    uuid;
  dup       boolean := false;
  clean_url text := btrim(coalesce(p_url, ''));
  clean_ttl text := nullif(btrim(regexp_replace(coalesce(p_title, ''), '\s*[-–]\s*YouTube\s*$', '', 'i')), '');
begin
  select user_id into uid from public.user_settings where api_key = p_key;
  if uid is null then
    raise exception 'ongeldige API-sleutel' using errcode = '28000';
  end if;

  m := regexp_match(clean_url, '^https?://(?:www\.|m\.|music\.)?youtube\.com/(shorts|live|embed|v)/([A-Za-z0-9_-]{11})', 'i');
  if m is not null then
    vid := m[2];
    if lower(m[1]) = 'shorts' then vkind := 'short'; end if;
  else
    m := regexp_match(clean_url, '^https?://(?:www\.|m\.|music\.)?youtube\.com/watch\?(?:[^#]*&)?v=([A-Za-z0-9_-]{11})', 'i');
    if m is null then
      m := regexp_match(clean_url, '^https?://youtu\.be/([A-Za-z0-9_-]{11})', 'i');
    end if;
    if m is not null then
      vid := m[1];
    end if;
  end if;

  if vid is null then
    raise exception 'geen YouTube-video' using errcode = '22023';
  end if;

  select id into new_id from public.videos where user_id = uid and video_id = vid;
  if new_id is null then
    insert into public.videos (user_id, video_id, kind, url, title)
      values (
        uid, vid, vkind,
        case when vkind = 'short' then 'https://www.youtube.com/shorts/' || vid
             else 'https://www.youtube.com/watch?v=' || vid end,
        left(coalesce(clean_ttl, 'YouTube-video'), 300)
      )
      returning id into new_id;
  else
    dup := true;
  end if;

  return json_build_object('ok', true, 'id', new_id, 'duplicate', dup, 'kind', vkind);
end;
$$;

revoke all on function public.add_video(text, text, text) from public;
grant execute on function public.add_video(text, text, text) to anon, authenticated;

-- Realtime: nieuwe video's van de extensie direct zichtbaar op de site
do $$
begin
  alter publication supabase_realtime add table public.videos;
exception when duplicate_object then
  null;
end $$;

-- ---------------------------------------------------------------------------
-- Labels op video's: zie ook supabase/migrations/005_video_tags.sql
-- ---------------------------------------------------------------------------
alter table public.videos
  add column if not exists tags text[] not null default '{}';

create index if not exists videos_tags_idx on public.videos using gin (tags);

-- ---------------------------------------------------------------------------
-- Tabbladen op de Video's-pagina: zie ook supabase/migrations/006_video_tabs.sql
-- ---------------------------------------------------------------------------
create table if not exists public.video_tabs (
  user_id    uuid not null default auth.uid() references auth.users(id) on delete cascade,
  tag        text not null check (char_length(tag) between 1 and 30),
  position   int  not null default 0,
  created_at timestamptz not null default now(),
  primary key (user_id, tag)
);

alter table public.video_tabs enable row level security;

drop policy if exists "video_tabs: eigen rijen" on public.video_tabs;
create policy "video_tabs: eigen rijen" on public.video_tabs
  for all using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- Hernoemt een label op alle video's en in de tabbladen. Bestaat de nieuwe naam al,
-- dan worden de twee samengevoegd. Draait met de rechten van de gebruiker (RLS geldt).
create or replace function public.rename_video_tag(p_old text, p_new text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'niet ingelogd' using errcode = '28000';
  end if;
  if coalesce(btrim(p_new), '') = '' then
    raise exception 'lege naam' using errcode = '22023';
  end if;

  update public.videos
     set tags = (select coalesce(array_agg(distinct t order by t), '{}')
                   from unnest(array_replace(tags, p_old, p_new)) as t)
   where user_id = uid and p_old = any(tags);

  if exists (select 1 from public.video_tabs where user_id = uid and tag = p_new) then
    delete from public.video_tabs where user_id = uid and tag = p_old;
  else
    update public.video_tabs set tag = p_new where user_id = uid and tag = p_old;
  end if;
end;
$$;

-- Verwijdert een label van alle video's en het tabblad. De video's zelf blijven bestaan.
create or replace function public.delete_video_tag(p_tag text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'niet ingelogd' using errcode = '28000';
  end if;
  update public.videos set tags = array_remove(tags, p_tag) where user_id = uid and p_tag = any(tags);
  delete from public.video_tabs where user_id = uid and tag = p_tag;
end;
$$;

revoke all on function public.rename_video_tag(text, text) from public, anon;
revoke all on function public.delete_video_tag(text) from public, anon;
grant execute on function public.rename_video_tag(text, text) to authenticated;
grant execute on function public.delete_video_tag(text) to authenticated;
