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
  const [pages, cards, bookmarks, settings] = await Promise.all([
    fetchAll('pages'),
    fetchAll('cards'),
    fetchAll('bookmarks'),
    sb.from('user_settings').select('api_key').maybeSingle().then(check),
  ]);
  return { pages, cards, bookmarks, settings };
}

export async function currentEmail() {
  const s = await getSession();
  return s?.user?.email ?? '';
}

const insert = async (table, row) => check(await sb.from(table).insert(row).select().single());
const patch = async (table, id, values) => check(await sb.from(table).update(values).eq('id', id));
const remove = async (table, id) => check(await sb.from(table).delete().eq('id', id));

export const insertPage = (row) => insert('pages', row);
export const patchPage = (id, v) => patch('pages', id, v);
export const removePage = (id) => remove('pages', id);

export const insertCard = (row) => insert('cards', row);
export const patchCard = (id, v) => patch('cards', id, v);
export const removeCard = (id) => remove('cards', id);

export const insertBookmark = (row) => insert('bookmarks', row);
export const patchBookmark = (id, v) => patch('bookmarks', id, v);
export const removeBookmark = (id) => remove('bookmarks', id);

// rows: [{ id, ...velden }]
export async function patchMany(table, rows) {
  await Promise.all(
    rows.map(({ id, ...values }) => sb.from(table).update(values).eq('id', id).then(check)),
  );
}

// ---- Realtime ------------------------------------------------------------

export function subscribeBookmarks(onInsert) {
  const channel = sb
    .channel('bookmarks-inserts')
    .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'bookmarks' }, (p) =>
      onInsert(p.new),
    )
    .subscribe();
  return () => sb.removeChannel(channel);
}
