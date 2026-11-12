import { config } from './config.js';

export const supabaseUrl = config.supabaseUrl;
export const anonKey = config.supabaseAnonKey;
export const isConfigured = !!anonKey && !anonKey.startsWith('PLAK_');

const sb = isConfigured
  ? window.supabase.createClient(supabaseUrl, anonKey, {
      auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
    })
  : null;

function check({ data, error }) {
  if (error) throw error;
  return data;
}

// ---- Auth ----------------------------------------------------------------

export async function getSession() {
  return check(await sb.auth.getSession()).session;
}

export function onSignedOut(cb) {
  sb.auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') cb();
  });
}

export async function signIn(email, password) {
  return check(await sb.auth.signInWithPassword({ email, password }));
}

export async function signUp(email, password) {
  return check(await sb.auth.signUp({ email, password }));
}

export async function signOut() {
  await sb.auth.signOut();
}

export async function ensureSetup() {
  check(await sb.rpc('ensure_user_setup'));
}

export async function regenerateApiKey() {
  return check(await sb.rpc('regenerate_api_key'));
}

// ---- Data ----------------------------------------------------------------

// Supabase geeft standaard max. 1000 rijen per request; hier pagineren.
async function fetchAll(table) {
  const size = 1000;
  const rows = [];
  for (let from = 0; ; from += size) {
    const batch = check(
      await sb.from(table).select('*').order('created_at').order('id').range(from, from + size - 1),
    );
    rows.push(...batch);
    if (batch.length < size) break;
  }
  return rows;
}

export async function loadAll() {
  const tabs = (cols) => sb.from('video_tabs').select(cols).order('position').then(check);
  const [pages, cards, bookmarks, settings, videos, videoTabs, videoGroups] = await Promise.all([
    fetchAll('pages'),
    fetchAll('cards'),
    fetchAll('bookmarks'),
    sb.from('user_settings').select('api_key').maybeSingle().then(check),
    // null = tabel bestaat nog niet (003_videos.sql niet uitgevoerd); de rest van de app werkt dan gewoon
    fetchAll('videos').catch(() => null),
    // null = 006_video_tabs.sql nog niet uitgevoerd; zonder 007 is er nog geen kolom group_id
    tabs('tag, position, group_id')
      .catch(() => tabs('tag, position'))
      .catch(() => null),
    // null = 007_video_groups.sql nog niet uitgevoerd; dan zijn er geen hoofdtabs
    sb.from('video_groups').select('id, name, position').order('position').then(check).catch(() => null),
  ]);
  return { pages, cards, bookmarks, settings, videos, videoTabs, videoGroups };
}

export async function currentEmail() {
  const s = await getSession();
  return s?.user?.email ?? '';
}

const insert = async (table, row) => check(await sb.from(table).insert(row).select().single());
const patch = async (table, id, values) => check(await sb.from(table).update(values).eq('id', id));
const remove = async (table, id) => check(await sb.from(table).delete().eq('id', id));

// Bulk-insert (voor importeren); rijen mogen een eigen id meekrijgen.
export async function insertMany(table, rows) {
  const size = 300;
  for (let i = 0; i < rows.length; i += size) {
    check(await sb.from(table).insert(rows.slice(i, i + size)));
  }
}

export const insertPage = (row) => insert('pages', row);
export const patchPage = (id, v) => patch('pages', id, v);
export const removePage = (id) => remove('pages', id);

export const insertCard = (row) => insert('cards', row);
export const patchCard = (id, v) => patch('cards', id, v);
export const removeCard = (id) => remove('cards', id);

export const insertBookmark = (row) => insert('bookmarks', row);
export const patchBookmark = (id, v) => patch('bookmarks', id, v);
export const removeBookmark = (id) => remove('bookmarks', id);

// Labels op de Video's-pagina: volgorde en hoofdtab opslaan, hernoemen, verwijderen
// rows: [{ tag, position, group_id? }] (group_id alleen als 007 is uitgevoerd)
export async function saveVideoTabs(rows) {
  const { user } = await getSession();
  if (rows.length) check(await sb.from('video_tabs').upsert(rows.map((r) => ({ user_id: user.id, ...r })), { onConflict: 'user_id,tag' }));
}

// Hoofdtabs (groepen van labels)
export const insertVideoGroup = (row) => insert('video_groups', row);
export const patchVideoGroup = (id, v) => patch('video_groups', id, v);
export const removeVideoGroup = (id) => remove('video_groups', id);

export async function renameVideoTag(oldTag, newTag) {
  check(await sb.rpc('rename_video_tag', { p_old: oldTag, p_new: newTag }));
}

export async function deleteVideoTag(tag) {
  check(await sb.rpc('delete_video_tag', { p_tag: tag }));
}

export const insertVideo = (row) => insert('videos', row);
export const patchVideo = (id, v) => patch('videos', id, v);
export const removeVideo = (id) => remove('videos', id);

// rows: [{ id, ...velden }]
export async function patchMany(table, rows) {
  await Promise.all(
    rows.map(({ id, ...values }) => sb.from(table).update(values).eq('id', id).then(check)),
  );
}

// ---- Realtime ------------------------------------------------------------

function subscribeInserts(table, onInsert) {
  const channel = sb
    .channel(`${table}-inserts`)
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table }, (p) => onInsert(p.new))
    .subscribe();
  return () => sb.removeChannel(channel);
}

export const subscribeBookmarks = (onInsert) => subscribeInserts('bookmarks', onInsert);
export const subscribeVideos = (onInsert) => subscribeInserts('videos', onInsert);
