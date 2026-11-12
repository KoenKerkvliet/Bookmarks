// YouTube-hulpfuncties: URL's herkennen, plaatjes, speler-adres en titel/kanaal ophalen (oEmbed,
// geen API-sleutel nodig). De herkenning komt overeen met add_video in supabase/migrations/008_video_playlists.sql.

const ID = /^[A-Za-z0-9_-]{11}$/;
const LIST = /^[A-Za-z0-9_-]{2,64}$/;

// Lijsten die YouTube niet kan insluiten: Later bekijken, Video's die ik leuk vind en automatische mixen.
export const isEmbeddableList = (list) => LIST.test(list ?? '') && list !== 'WL' && list !== 'LL' && !list.startsWith('RD');

const playlistUrl = (list) => `https://www.youtube.com/playlist?list=${list}`;

// -> { id, kind: 'short' | 'video' | 'playlist', url, list? } of null als het geen YouTube-video of -playlist is.
// Bij een video die je in een playlist bekijkt (watch?v=…&list=…) staat de playlist-ID in `list`.
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
    if (u.pathname === '/playlist') {
      const list = u.searchParams.get('list');
      return LIST.test(list ?? '') ? { id: list, kind: 'playlist', url: playlistUrl(list), embeddable: isEmbeddableList(list) } : null;
    }
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
  const list = u.searchParams.get('list');
  return { id, kind, url, ...(isEmbeddableList(list) ? { list } : {}) };
}

export const playlistAsVideo = (list) => ({ id: list, kind: 'playlist', url: playlistUrl(list), embeddable: true });

export const thumbUrl = (id) => `https://i.ytimg.com/vi/${id}/hqdefault.jpg`;

// Plaatje van een video of playlist; playlists krijgen het plaatje dat YouTube via oEmbed geeft.
export const videoThumb = (v) => (v.kind === 'playlist' ? (/^https:\/\/i\.ytimg\.com\//.test(v.thumb ?? '') ? v.thumb : null) : thumbUrl(v.video_id));

const PLAYER = 'autoplay=1&rel=0&playsinline=1';
export const embedUrl = (v) =>
  v.kind === 'playlist'
    ? `https://www.youtube-nocookie.com/embed/videoseries?list=${encodeURIComponent(v.video_id)}&${PLAYER}`
    : `https://www.youtube-nocookie.com/embed/${v.video_id}?${PLAYER}`;

// Haalt " - YouTube" achteraan weg, en vooraan het aantal meldingen dat YouTube in de tabtitel zet,
// zoals "(10) " of "(99+) ". Maximaal twee cijfers, zodat een titel als "(1994) Film" blijft staan.
const NOTIFY_PREFIX = /^\s*\(\d{1,2}\+?\)\s+/;
export const cleanTitle = (t) => String(t ?? '').replace(NOTIFY_PREFIX, '').replace(/\s*[-–]\s*YouTube\s*$/i, '').trim();
export const hasTitleNoise = (t) => NOTIFY_PREFIX.test(t ?? '') || /\s[-–]\s*YouTube\s*$/i.test(t ?? '');

// -> { title, channel, portrait, thumb } of null als YouTube geen gegevens geeft (privé, verwijderd, offline).
// `v` is een rij uit videos (of { kind, video_id }).
export async function fetchOEmbed(v) {
  try {
    const page = encodeURIComponent(v.kind === 'playlist' ? playlistUrl(v.video_id) : `https://www.youtube.com/watch?v=${v.video_id}`);
    const res = await fetch(`https://www.youtube.com/oembed?url=${page}&format=json`, { signal: AbortSignal.timeout(8000) });
    if (!res.ok) return null;
    const d = await res.json();
    const thumb = /^https:\/\/i\.ytimg\.com\//.test(d.thumbnail_url ?? '') ? d.thumbnail_url : null;
    return { title: cleanTitle(d.title), channel: d.author_name ?? null, portrait: d.height > d.width, thumb };
  } catch {
    return null;
  }
}
