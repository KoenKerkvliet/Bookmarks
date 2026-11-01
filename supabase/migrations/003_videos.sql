-- Video's (YouTube Shorts en video's) + add_video voor de browserextensie
-- Uitvoeren in: Supabase dashboard > SQL Editor > New query > Run
-- Bestaande data blijft ongewijzigd. Het script is herhaalbaar.

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
