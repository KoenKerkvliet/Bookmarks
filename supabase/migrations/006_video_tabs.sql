-- Tabbladen op de Video's-pagina: elk tabblad is een label (tag).
-- Deze tabel bewaart de volgorde van de tabbladen en laat lege tabbladen bestaan.
-- Uitvoeren in: Supabase dashboard > SQL Editor > New query > Run
-- Vereist 003_videos.sql en 005_video_tags.sql. Het script is herhaalbaar.

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
