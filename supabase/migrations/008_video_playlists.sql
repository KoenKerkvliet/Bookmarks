-- YouTube-playlists opslaan op de Video's-pagina, als één tegel die in de YouTube-speler afspeelt.
-- Een playlist is een rij in videos met kind = 'playlist' en in video_id de playlist-ID (list=…).
-- Uitvoeren in: Supabase dashboard > SQL Editor > New query > Run
-- Vereist 003_videos.sql. Het script is herhaalbaar.

alter table public.videos drop constraint if exists videos_kind_check;
alter table public.videos
  add constraint videos_kind_check check (kind in ('short', 'video', 'playlist'));

-- Voorbeeldplaatje (van YouTube); voor video's leidt de site het plaatje af uit video_id.
alter table public.videos
  add column if not exists thumb text check (thumb is null or thumb like 'https://i.ytimg.com/%');

-- add_video herkent nu ook youtube.com/playlist?list=… (een video die je in een playlist bekijkt,
-- watch?v=…&list=…, blijft een losse video). Privélijsten zoals Later bekijken (WL) en
-- Video's die ik leuk vind (LL) en automatische mixen (RD…) kan YouTube niet insluiten; die worden geweigerd.
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

  m := regexp_match(clean_url, '^https?://(?:www\.|m\.|music\.)?youtube\.com/playlist\?(?:[^#]*&)?list=([A-Za-z0-9_-]{2,64})', 'i');
  if m is not null then
    if m[1] in ('WL', 'LL') or m[1] like 'RD%' then
      raise exception 'deze playlist is privé of automatisch en kan niet worden ingesloten' using errcode = '22023';
    end if;
    vid := m[1];
    vkind := 'playlist';
  else
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
  end if;

  if vid is null then
    raise exception 'geen YouTube-video' using errcode = '22023';
  end if;

  select id into new_id from public.videos where user_id = uid and video_id = vid;
  if new_id is null then
    insert into public.videos (user_id, video_id, kind, url, title)
      values (
        uid, vid, vkind,
        case vkind when 'short' then 'https://www.youtube.com/shorts/' || vid
                   when 'playlist' then 'https://www.youtube.com/playlist?list=' || vid
                   else 'https://www.youtube.com/watch?v=' || vid end,
        left(coalesce(clean_ttl, case when vkind = 'playlist' then 'YouTube-playlist' else 'YouTube-video' end), 300)
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
