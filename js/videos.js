// YouTube-hulpfuncties: URL's herkennen, plaatjes, speler-adres en titel/kanaal ophalen (oEmbed,
// geen API-sleutel nodig). De herkenning komt overeen met add_video in supabase/migrations/003_videos.sql.

const ID = /^[A-Za-z0-9_-]{11}$/;

// -> { id, kind: 'short' | 'video', url } of null als het geen YouTube-video is
export function parseYouTube(input) {
  let u;
  try {
    u = new URL(String(input).trim());
  } catch {
    return null;
  }
  if (!/^https?:$/.test(u.protocol)) return null;
  const host = u.hostname.toLowerCase().replace(/^(www|m|music)\./, '');
  let id = null;
  let kind = 'video';
  if (host === 'youtu.be') {
    id = u.pathname.slice(1).split('/')[0];
  } else if (host === 'youtube.com' || host === 'youtube-nocookie.com') {
    const m = u.pathname.match(/^\/(shorts|live|embed|v)\/([^/?]+)/i);
    if (m) {
      id = m[2];
      if (m[1].toLowerCase() === 'shorts') kind = 'short';
    } else if (u.pathname === '/watch') {
      id = u.searchParams.get('v');
    }
  }
  if (!id || !ID.test(id)) return null;
  const url = kind === 'short' ? `https://www.youtube.com/shorts/${id}` : `https://www.youtube.com/watch?v=${id}`;
  return { id, kind, url };
}

export const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

export const embedUrl = (id) => `https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0&playsinline=1`;

export const cleanTitle = (t) => String(t ?? '').replace(/\s*[-–]\s*YouTube\s*$/i, '').trim();

// -> { title, channel, portrait } of null als YouTube geen gegevens geeft (privé, verwijderd, offline)
export async function fetchOEmbed(id) {
  try {
    const watch = encodeURIComponent(`https://www.youtube.com/watch?v=${id}`);
    const res = await fetch(`https://www.youtube.com/oembed?url=${watch}&format=json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = await res.json();
    return { title: cleanTitle(d.title), channel: d.author_name ?? null, portrait: d.height > d.width };
  } catch {
    return null;
  }
}
