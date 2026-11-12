import * as api from './api.js';
import { h, icon, showMenu, showPopover, closeMenu, openDialog, fieldsBody, confirmDialog, toast } from './ui.js';
import { parseBookmarksHtml } from './importer.js';
import { WIDGETS, HEADING_LEVELS } from './widgets.js';
import { parseYouTube, playlistAsVideo, videoThumb, embedUrl, fetchOEmbed } from './videos.js';

const VIEWS = [
  { value: 'list', label: 'Lijst' },
  { value: 'icons-s', label: 'Iconen S' },
  { value: 'icons-m', label: 'Iconen M' },
  { value: 'icons-l', label: 'Iconen L' },
];
const MAX_COLUMNS = 6;

const state = { pages: [], cards: [], bookmarks: [], videos: null, videoTabs: null, videoGroups: null, settings: null, email: '', loaded: false };
const $root = document.getElementById('app');

let sortables = [];
let navSortable = null;
let unsubscribe = null;
let lastLoad = 0;

// ---- Voorkeuren (alleen op dit apparaat) --------------------------------------

const prefs = {
  get(key, fallback = '') {
    try {
      return localStorage.getItem(key) ?? fallback;
    } catch {
      return fallback;
    }
  },
  set(key, value) {
    try {
      if (value) localStorage.setItem(key, value);
      else localStorage.removeItem(key);
    } catch {
      /* opslag niet beschikbaar */
    }
  },
};

const THEMES = [
  { id: 'light', label: 'Licht', hint: 'Rustig wit' },
  { id: 'dark', label: 'Donker', hint: 'Zacht donker met paars' },
  { id: 'neon', label: 'Neon', hint: 'Zwart met neon-gloed' },
  { id: 'ocean', label: 'Oceaan', hint: 'Diepblauw' },
  { id: 'forest', label: 'Bos', hint: 'Licht met groen' },
  { id: 'sunset', label: 'Zonsondergang', hint: 'Warm donker' },
];

// Opgeslagen voorkeur: een thema-id, of leeg = automatisch (volgt het systeem).
function applyTheme() {
  const stored = prefs.get('theme');
  const dark = matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = THEMES.some((t) => t.id === stored) ? stored : dark ? 'dark' : 'light';
  document.documentElement.dataset.theme = theme;
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--bg').trim();
  if (bg) document.querySelector('meta[name="theme-color"]')?.setAttribute('content', bg);
}

function setTheme(id) {
  prefs.set('theme', id);
  applyTheme();
}

matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
  if (!prefs.get('theme')) applyTheme();
});

function themeMenu(anchor) {
  const current = prefs.get('theme');
  showMenu(anchor, [
    { label: 'Automatisch', checked: !THEMES.some((t) => t.id === current), onClick: () => setTheme('') },
    '-',
    ...THEMES.map((t) => ({ label: t.label, checked: current === t.id, onClick: () => setTheme(t.id) })),
  ]);
}

function miniPreview(id) {
  return h('span', { class: 'theme-preview', dataset: { theme: id }, 'aria-hidden': 'true' }, h('i', { class: 'tp-side' }), h('span', { class: 'tp-main' }, h('i', { class: 'tp-bar' }), h('i', { class: 'tp-card' })));
}

function themePicker() {
  const current = THEMES.some((t) => t.id === prefs.get('theme')) ? prefs.get('theme') : '';
  const options = [{ id: '', label: 'Automatisch', hint: 'Volgt je systeem (licht of donker)' }, ...THEMES];
  const tiles = options.map((t) =>
    h(
      'button',
      {
        type: 'button',
        role: 'radio',
        class: 'theme-tile',
        'aria-checked': String(t.id === current),
        onclick: () => {
          setTheme(t.id);
          tiles.forEach((el, i) => el.setAttribute('aria-checked', String(options[i].id === t.id)));
        },
      },
      t.id ? miniPreview(t.id) : h('span', { class: 'theme-split', 'aria-hidden': 'true' }, miniPreview('light'), miniPreview('dark')),
      h('strong', {}, t.label),
      h('span', { class: 'theme-hint' }, t.hint),
    ),
  );
  return h('div', { class: 'theme-grid', role: 'radiogroup', 'aria-label': 'Thema' }, tiles);
}

const linkTarget = () => (prefs.get('openIn', 'blank') === 'self' ? '_self' : '_blank');

// ---- Data-helpers --------------------------------------------------------------

const byPos = (a, b) => a.position - b.position;
const inboxPage = () => state.pages.find((p) => p.is_inbox);
const userPages = () => state.pages.filter((p) => !p.is_inbox).sort(byPos);
const pageById = (id) => state.pages.find((p) => p.id === id);
const cardById = (id) => state.cards.find((c) => c.id === id);
const pageCards = (pageId) => state.cards.filter((c) => c.page_id === pageId);
const cardType = (card) => card.type ?? 'links';
const isLinksCard = (card) => cardType(card) === 'links';
const cardLinks = (cardId) => state.bookmarks.filter((b) => b.card_id === cardId).sort(byPos);
const inboxLinks = () =>
  state.bookmarks.filter((b) => !b.card_id).sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function normalizeUrl(value) {
  let v = value.trim();
  if (!v) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(v)) v = `https://${v}`;
  try {
    const u = new URL(v);
    return /^https?:$/.test(u.protocol) ? u.href : null;
  } catch {
    return null;
  }
}

const safeHref = (url) => (/^https?:\/\//i.test(url) ? url : '#');

const rtf = new Intl.RelativeTimeFormat('nl', { numeric: 'auto' });
function timeAgo(iso) {
  const s = (Date.parse(iso) - Date.now()) / 1000;
  const abs = Math.abs(s);
  if (abs < 60) return 'zojuist';
  if (abs < 3600) return rtf.format(Math.round(s / 60), 'minute');
  if (abs < 86400) return rtf.format(Math.round(s / 3600), 'hour');
  if (abs < 2592000) return rtf.format(Math.round(s / 86400), 'day');
  return new Date(iso).toLocaleDateString('nl-NL');
}

function leastFilledColumn(page) {
  const counts = Array(page.columns).fill(0);
  pageCards(page.id).forEach((c) => counts[Math.min(c.column_index, page.columns - 1)]++);
  return counts.indexOf(Math.min(...counts));
}

function persist(promise, message = 'Opslaan mislukt') {
  return promise.catch((err) => {
    console.error(err);
    toast(`${message}: ${err.message || err}`, { error: true });
    reload();
  });
}

async function reload() {
  try {
    Object.assign(state, await api.loadAll());
    lastLoad = Date.now();
    renderAll();
  } catch (err) {
    console.error(err);
  }
}

// ---- Routing -----------------------------------------------------------------------

function currentRoute() {
  const hash = location.hash.replace(/^#\/?/, '');
  if (hash === 'instellingen') return { name: 'settings' };
  if (hash === 'videos') return { name: 'videos' };
  const m = hash.match(/^p\/([\w-]+)/);
  let page = m && pageById(m[1]);
  if (!page) page = pageById(prefs.get('lastPage')) || userPages()[0] || inboxPage();
  return { name: 'page', page };
}

const go = (hash) => {
  location.hash = hash;
};

// ---- Favicons en links ------------------------------------------------------------------

function faviconEl(url) {
  const host = hostOf(url);
  const img = h('img', {
    class: 'fav',
    alt: '',
    loading: 'lazy',
    draggable: 'false',
    src: `https://www.google.com/s2/favicons?domain=${encodeURIComponent(host)}&sz=64`,
  });
  img.addEventListener('error', () => img.replaceWith(letterTile(host)));
  return img;
}

function letterTile(host) {
  let hash = 0;
  for (const ch of host) hash = (hash * 31 + ch.charCodeAt(0)) % 360;
  return h('span', { class: 'fav fav-letter', style: { '--hue': hash } }, (host[0] || '?').toUpperCase());
}

function iconButton(name, label, onclick, cls = '') {
  return h('button', { class: `icon-btn ${cls}`, type: 'button', 'aria-label': label, title: label, onclick }, icon(name));
}

function linkEl(b) {
  const el = h(
    'div',
    { class: 'link', dataset: { id: b.id } },
    h(
      'a',
      {
        class: 'link-a',
        href: safeHref(b.url),
        target: linkTarget(),
        rel: 'noopener noreferrer',
        draggable: 'false',
        title: `${b.title}\n${b.url}`,
      },
      faviconEl(b.url),
      h('span', { class: 'link-title' }, b.title),
    ),
    h(
      'button',
      {
        class: 'icon-btn link-menu',
        type: 'button',
        'aria-label': `Opties voor ${b.title}`,
        onclick: (e) => linkMenu(b, e.currentTarget),
      },
      icon('dots', 16),
    ),
  );
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    linkMenu(b, { x: e.clientX, y: e.clientY });
  });
  return el;
}

function linkMenu(b, anchor) {
  showMenu(anchor, [
    { label: 'Bewerken', icon: 'pencil', onClick: () => editLink(b) },
    { label: 'Verplaatsen…', icon: 'move', onClick: () => moveLink(b) },
    { label: 'Adres kopiëren', icon: 'copy', onClick: () => copyText(b.url, 'Adres gekopieerd') },
    '-',
    { label: 'Verwijderen', icon: 'trash', danger: true, onClick: () => deleteLink(b) },
  ]);
}

async function copyText(text, message = 'Gekopieerd') {
  try {
    await navigator.clipboard.writeText(text);
    toast(message);
  } catch {
    toast('Kopiëren is niet gelukt.', { error: true });
  }
}

// ---- Acties: links -------------------------------------------------------------------------

const urlFields = (url = '', title = '') => [
  {
    name: 'url',
    label: 'Adres',
    value: url,
    required: true,
    placeholder: 'https://voorbeeld.nl',
    inputmode: 'url',
    validate: (v) => (normalizeUrl(v) ? null : 'Dit is geen geldig webadres.'),
  },
  { name: 'title', label: 'Naam', value: title, placeholder: 'Optioneel — anders de domeinnaam', maxlength: 300 },
];

async function addLink(card) {
  const r = await openDialog('Link toevoegen', fieldsBody(urlFields()), { submit: 'Toevoegen' });
  if (!r) return;
  const url = normalizeUrl(r.url);
  const position = cardLinks(card.id).length;
  try {
    const row = await api.insertBookmark({ card_id: card.id, url, title: r.title || hostOf(url), position });
    state.bookmarks.push(row);
    renderMain();
  } catch (err) {
    toast(`Toevoegen mislukt: ${err.message}`, { error: true });
  }
}

async function editLink(b) {
  const r = await openDialog('Link bewerken', fieldsBody(urlFields(b.url, b.title)));
  if (!r) return;
  const url = normalizeUrl(r.url);
  Object.assign(b, { url, title: r.title || hostOf(url) });
  renderMain();
  persist(api.patchBookmark(b.id, { url: b.url, title: b.title }));
}

async function deleteLink(b) {
  state.bookmarks = state.bookmarks.filter((x) => x !== b);
  renderAll();
  try {
    await api.removeBookmark(b.id);
  } catch (err) {
    state.bookmarks.push(b);
    renderAll();
    toast(`Verwijderen mislukt: ${err.message}`, { error: true });
    return;
  }
  toast('Link verwijderd', {
    action: {
      label: 'Ongedaan maken',
      onClick: async () => {
        try {
          const row = await api.insertBookmark({
            id: b.id,
            card_id: b.card_id,
            url: b.url,
            title: b.title,
            position: b.position,
            created_at: b.created_at,
          });
          state.bookmarks.push(row);
          renderAll();
        } catch (err) {
          toast(`Terugzetten mislukt: ${err.message}`, { error: true });
        }
      },
    },
  });
}

async function moveLink(b) {
  const pages = userPages();
  if (!pages.length) {
    toast('Maak eerst een pagina aan om naartoe te verplaatsen.');
    return;
  }
  let last = {};
  try {
    last = JSON.parse(prefs.get('lastMove', '{}'));
  } catch {
    /* negeren */
  }
  const current = b.card_id && pageById(cardById(b.card_id)?.page_id);
  const startPage = pages.find((p) => p.id === (current?.id ?? last.pageId)) ?? pages[0];

  const body = () => {
    const pageSel = h('select', { class: 'input' }, pages.map((p) => h('option', { value: p.id, selected: p.id === startPage.id }, p.title)));
    const cardSel = h('select', { class: 'input' });
    const newTitle = h('input', { class: 'input', type: 'text', placeholder: 'Naam van de nieuwe card', maxlength: 100 });
    const newRow = h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Naam nieuwe card'), newTitle, h('div', { class: 'field-error' }));

    const fill = (preferred) => {
      const cards = pageCards(pageSel.value).filter(isLinksCard).sort((a, c) => a.column_index - c.column_index || a.position - c.position);
      cardSel.replaceChildren(
        ...cards.map((c) => h('option', { value: c.id, selected: c.id === preferred }, c.title)),
        h('option', { value: '__new', selected: !cards.length }, '＋ Nieuwe card…'),
      );
      newRow.hidden = cardSel.value !== '__new';
    };
    pageSel.addEventListener('change', () => fill());
    cardSel.addEventListener('change', () => {
      newRow.hidden = cardSel.value !== '__new';
      if (!newRow.hidden) newTitle.focus();
    });
    fill(b.card_id ?? last.cardId);

    return {
      el: h(
        'div',
        { class: 'fields' },
        h('p', { class: 'dialog-text' }, b.title),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Pagina'), pageSel),
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Card'), cardSel),
        newRow,
      ),
      focus: () => cardSel,
      collect() {
        const isNew = cardSel.value === '__new';
        if (isNew && !newTitle.value.trim()) {
          newRow.querySelector('.field-error').textContent = 'Geef de nieuwe card een naam.';
          return undefined;
        }
        return { pageId: pageSel.value, cardId: isNew ? null : cardSel.value, newTitle: newTitle.value.trim() };
      },
    };
  };

  const r = await openDialog('Verplaatsen naar…', body, { submit: 'Verplaatsen' });
  if (!r) return;
  const page = pageById(r.pageId);
  try {
    let card = r.cardId && cardById(r.cardId);
    if (!card) {
      card = await api.insertCard({
        page_id: page.id,
        title: r.newTitle,
        view: 'list',
        column_index: leastFilledColumn(page),
        position: pageCards(page.id).length,
      });
      state.cards.push(card);
    }
    const position = cardLinks(card.id).length;
    await api.patchBookmark(b.id, { card_id: card.id, position });
    Object.assign(b, { card_id: card.id, position });
    prefs.set('lastMove', JSON.stringify({ pageId: page.id, cardId: card.id }));
    renderAll();
    toast(`Verplaatst naar ${page.title} › ${card.title}`, { action: { label: 'Openen', onClick: () => go(`#/p/${page.id}`) } });
  } catch (err) {
    toast(`Verplaatsen mislukt: ${err.message}`, { error: true });
    reload();
  }
}

// ---- Acties: cards ----------------------------------------------------------------------------

function pickCardType() {
  const types = [{ type: 'links', label: 'Snelkoppelingen', hint: 'Lijst of iconen', icon: 'link' }, ...Object.entries(WIDGETS).map(([type, w]) => ({ type, ...w }))];
  return openDialog(
    'Wat wil je toevoegen?',
    ({ close }) => ({
      el: h(
        'div',
        { class: 'type-grid' },
        types.map((t) => h('button', { class: 'type-tile', type: 'button', onclick: () => close(t.type) }, icon(t.icon, 22), h('strong', {}, t.label), h('span', {}, t.hint))),
      ),
      collect: () => undefined,
    }),
    { footer: false, className: 'type-dialog' },
  );
}

async function addCard(page) {
  const type = await pickCardType();
  if (!type) return;

  const fields = {};
  let title;
  if (type === 'links') {
    const r = await openDialog(
      'Nieuwe card',
      fieldsBody([
        { name: 'title', label: 'Titel', required: true, maxlength: 100 },
        { name: 'view', label: 'Weergave', type: 'segmented', options: VIEWS, value: 'list' },
      ]),
      { submit: 'Aanmaken' },
    );
    if (!r) return;
    title = r.title;
    fields.view = r.view;
  } else {
    const def = WIDGETS[type];
    title = def.title;
    fields.type = type;
    fields.config = structuredClone(def.defaults);
    const ask = def.init ?? def.configure;
    if (ask) {
      const r = await ask(fields.config, { title });
      if (!r) return;
      fields.config = r.config;
      title = r.title ?? r.softTitle ?? title;
    }
  }

  const col = leastFilledColumn(page);
  const position = pageCards(page.id).filter((c) => Math.min(c.column_index, page.columns - 1) === col).length;
  try {
    const row = await api.insertCard({ page_id: page.id, title, view: 'list', ...fields, column_index: col, position });
    state.cards.push(row);
    renderMain();
  } catch (err) {
    const hint = /type|config/i.test(err.message) ? ' (voer eerst de nieuwste SQL uit supabase/migrations uit: 002 voor widgets, 004 voor koppen)' : '';
    toast(`Aanmaken mislukt: ${err.message}${hint}`, { error: true });
  }
}

async function configureCard(card) {
  const def = WIDGETS[card.type];
  if (!def?.configure) return;
  const previousCity = card.config?.city ?? card.config?.tz?.split('/').pop().replace(/_/g, ' ');
  const r = await def.configure({ ...def.defaults, ...card.config }, { title: card.title });
  if (!r) return;
  card.config = r.config;
  if (r.title) card.title = r.title;
  else if (r.softTitle && (card.title === def.title || card.title === previousCity)) card.title = r.softTitle;
  renderMain();
  persist(api.patchCard(card.id, { config: card.config, title: card.title }));
}

async function moveCard(card) {
  const targets = userPages().filter((p) => p.id !== card.page_id);
  if (!targets.length) {
    toast('Er is geen andere pagina om naartoe te verplaatsen. Maak er eerst een aan.');
    return;
  }
  const r = await openDialog(
    'Card verplaatsen',
    fieldsBody(
      [{ name: 'pageId', label: 'Naar pagina', type: 'select', options: targets.map((p) => ({ value: p.id, label: p.title })) }],
      `“${card.title}” wordt verplaatst, met alles wat erin staat.`,
    ),
    { submit: 'Verplaatsen' },
  );
  if (!r) return;
  const page = pageById(r.pageId);
  const column_index = leastFilledColumn(page);
  const position = pageCards(page.id).filter((c) => Math.min(c.column_index, page.columns - 1) === column_index).length;
  const before = { page_id: card.page_id, column_index: card.column_index, position: card.position };
  Object.assign(card, { page_id: page.id, column_index, position });
  renderMain();
  toast(`Verplaatst naar ${page.title}`, { action: { label: 'Openen', onClick: () => go(`#/p/${page.id}`) } });
  try {
    await api.patchCard(card.id, { page_id: page.id, column_index, position });
  } catch (err) {
    Object.assign(card, before);
    renderMain();
    toast(`Verplaatsen mislukt: ${err.message}`, { error: true });
  }
}

const saveTimers = new Map();
function saveCardConfig(card, delay = 400) {
  clearTimeout(saveTimers.get(card.id));
  saveTimers.set(
    card.id,
    setTimeout(() => {
      saveTimers.delete(card.id);
      persist(api.patchCard(card.id, { config: card.config }));
    }, delay),
  );
}

async function renameCard(card) {
  const r = await openDialog('Naam wijzigen', fieldsBody([{ name: 'title', label: 'Titel', value: card.title, required: true, maxlength: 100 }]));
  if (!r) return;
  card.title = r.title;
  renderMain();
  persist(api.patchCard(card.id, { title: card.title }));
}

function setCardView(card, view) {
  if (card.view === view) return;
  card.view = view;
  renderMain();
  persist(api.patchCard(card.id, { view }));
}

async function deleteCard(card) {
  const n = cardLinks(card.id).length;
  const ok = await confirmDialog({
    title: 'Card verwijderen?',
    message: n
      ? `“${card.title}” en de ${n} snelkoppeling${n === 1 ? '' : 'en'} erin worden verwijderd.`
      : `“${card.title}” wordt verwijderd.`,
  });
  if (!ok) return;
  try {
    await api.removeCard(card.id);
    state.cards = state.cards.filter((c) => c !== card);
    state.bookmarks = state.bookmarks.filter((b) => b.card_id !== card.id);
    renderAll();
  } catch (err) {
    toast(`Verwijderen mislukt: ${err.message}`, { error: true });
  }
}

function cardMenu(card, anchor) {
  if (card.type === 'heading') {
    showMenu(anchor, [
      ...HEADING_LEVELS.map((l) => ({ label: l.label, checked: headingLevel(card) === l.value, onClick: () => setHeadingLevel(card, l.value) })),
      '-',
      { label: 'Naam wijzigen', icon: 'pencil', onClick: () => renameCard(card) },
      { label: 'Verplaatsen naar pagina…', icon: 'move', onClick: () => moveCard(card) },
      '-',
      { label: 'Kop verwijderen', icon: 'trash', danger: true, onClick: () => deleteCard(card) },
    ]);
    return;
  }
  if (!isLinksCard(card)) {
    const def = WIDGETS[card.type];
    showMenu(anchor, [
      def?.configure ? { label: 'Instellingen…', icon: 'settings', onClick: () => configureCard(card) } : null,
      { label: 'Naam wijzigen', icon: 'pencil', onClick: () => renameCard(card) },
      { label: 'Verplaatsen naar pagina…', icon: 'move', onClick: () => moveCard(card) },
      '-',
      { label: 'Card verwijderen', icon: 'trash', danger: true, onClick: () => deleteCard(card) },
    ].filter(Boolean));
    return;
  }
  showMenu(anchor, [
    { label: 'Link toevoegen', icon: 'plus', onClick: () => addLink(card) },
    '-',
    ...VIEWS.map((v) => ({ label: v.label, checked: card.view === v.value, onClick: () => setCardView(card, v.value) })),
    '-',
    { label: 'Naam wijzigen', icon: 'pencil', onClick: () => renameCard(card) },
    { label: 'Verplaatsen naar pagina…', icon: 'move', onClick: () => moveCard(card) },
    '-',
    { label: 'Card verwijderen', icon: 'trash', danger: true, onClick: () => deleteCard(card) },
  ]);
}

// ---- Acties: pagina's ------------------------------------------------------------------------------

async function addPage() {
  const r = await openDialog('Nieuwe pagina', fieldsBody([{ name: 'title', label: 'Titel', required: true, maxlength: 60 }]), { submit: 'Aanmaken' });
  if (!r) return;
  try {
    const position = Math.max(-1, ...userPages().map((p) => p.position)) + 1;
    const row = await api.insertPage({ title: r.title, columns: 3, position });
    state.pages.push(row);
    go(`#/p/${row.id}`);
    renderAll();
  } catch (err) {
    toast(`Aanmaken mislukt: ${err.message}`, { error: true });
  }
}

async function deletePage(page) {
  const cards = pageCards(page.id);
  const n = cards.reduce((sum, c) => sum + cardLinks(c.id).length, 0);
  const ok = await confirmDialog({
    title: 'Pagina verwijderen?',
    message: cards.length
      ? `“${page.title}” met ${cards.length} card${cards.length === 1 ? '' : 's'} en ${n} snelkoppeling${n === 1 ? '' : 'en'} wordt verwijderd.`
      : `“${page.title}” wordt verwijderd.`,
  });
  if (!ok) return;
  try {
    await api.removePage(page.id);
    const ids = new Set(cards.map((c) => c.id));
    state.pages = state.pages.filter((p) => p !== page);
    state.cards = state.cards.filter((c) => c.page_id !== page.id);
    state.bookmarks = state.bookmarks.filter((b) => !ids.has(b.card_id));
    prefs.set('lastPage', '');
    go('#/');
    renderAll();
  } catch (err) {
    toast(`Verwijderen mislukt: ${err.message}`, { error: true });
  }
}

function setColumns(page, n) {
  n = Math.min(MAX_COLUMNS, Math.max(1, n));
  if (n === page.columns) return;
  page.columns = n;
  renderMain();
  persist(api.patchPage(page.id, { columns: n }));
}

// ---- Weergave: shell en header ---------------------------------------------------------------------------

function buildShell() {
  $root.replaceChildren(
    h('div', { class: 'shell' }, h('header', { id: 'header', class: 'header' }), h('main', { id: 'main', class: 'main' })),
  );
}

function renderAll() {
  renderHeader();
  renderMain();
}

function pageItem(page, route, extra) {
  const active = route.name === 'page' && route.page?.id === page.id;
  return h(
    'a',
    { class: `pm-item${active ? ' active' : ''}`, href: `#/p/${page.id}`, dataset: { id: page.id }, role: 'menuitem', 'aria-current': active ? 'page' : null, onclick: closeMenu },
    icon(page.is_inbox ? 'inbox' : 'page', 16),
    h('span', { class: 'pm-label' }, page.title),
    extra,
  );
}

let pagesMenuClosedAt = 0;

function openPagesMenu(anchor) {
  const route = currentRoute();
  const inbox = inboxPage();
  const count = inboxLinks().length;
  const pages = userPages();

  const list = h('div', { class: 'pm-list' }, pages.map((p) => pageItem(p, route)));
  const filter =
    pages.length >= 8
      ? h('input', {
          class: 'input pm-filter',
          type: 'search',
          placeholder: 'Pagina zoeken…',
          'aria-label': 'Pagina zoeken',
          autocomplete: 'off',
          oninput: (e) => {
            const q = e.target.value.trim().toLowerCase();
            list.querySelectorAll('.pm-item').forEach((item) => {
              item.hidden = !!q && !item.textContent.toLowerCase().includes(q);
            });
          },
        })
      : null;
  const sep = () => h('div', { class: 'menu-sep' });
  const onVideos = route.name === 'videos';
  const videosItem = h(
    'a',
    { class: `pm-item${onVideos ? ' active' : ''}`, href: '#/videos', role: 'menuitem', 'aria-current': onVideos ? 'page' : null, onclick: closeMenu },
    icon('video', 16),
    h('span', { class: 'pm-label' }, "Video's"),
    state.videos?.length ? h('span', { class: 'pm-count' }, state.videos.length) : null,
  );
  const menu = h(
    'div',
    { class: 'pages-menu', role: 'menu', 'aria-label': "Pagina's" },
    filter,
    inbox ? pageItem(inbox, route, count ? h('span', { class: 'badge' }, count > 99 ? '99+' : count) : null) : null,
    videosItem,
    pages.length ? sep() : null,
    list,
    pages.length ? null : h('p', { class: 'pm-empty' }, "Nog geen pagina's."),
    sep(),
    h('button', { class: 'pm-add', type: 'button', onclick: () => (closeMenu(), addPage()) }, icon('plus', 16), h('span', {}, 'Nieuwe pagina')),
  );
  menu.addEventListener('keydown', (e) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return;
    const items = [...menu.querySelectorAll('.pm-item:not([hidden]), .pm-add')];
    const at = items.indexOf(document.activeElement);
    const next = items[(at + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length];
    if (next) {
      e.preventDefault();
      next.focus();
    }
  });

  navSortable?.destroy();
  showPopover(anchor, menu, {
    alignLeft: true,
    onClose: () => {
      navSortable?.destroy();
      navSortable = null;
      pagesMenuClosedAt = performance.now();
    },
  });
  if (pages.length > 1) {
    navSortable = Sortable.create(list, {
      animation: 150,
      delay: 200,
      delayOnTouchOnly: true,
      ghostClass: 'drag-ghost',
      onEnd: () => {
        const changes = [];
        [...list.children].forEach((node, i) => {
          const p = pageById(node.dataset.id);
          if (p && p.position !== i) {
            p.position = i;
            changes.push({ id: p.id, position: i });
          }
        });
        if (changes.length) persist(api.patchMany('pages', changes));
      },
    });
  }
  (filter ?? menu.querySelector('.pm-item.active') ?? menu.querySelector('.pm-item'))?.focus({ preventScroll: true });
}

function renderHeader() {
  const el = document.getElementById('header');
  if (!el) return;
  const route = currentRoute();
  const count = inboxLinks().length;
  const onPage = route.name === 'page' && !!route.page;
  const onVideos = route.name === 'videos';
  const inInbox = onPage && route.page.is_inbox;
  const label = onPage ? route.page.title : onVideos ? "Video's" : "Pagina's";

  const pagesBtn = h(
    'button',
    {
      class: `tab pages-btn${onPage || onVideos ? ' active' : ''}`,
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-label': onPage || onVideos ? `Pagina: ${label}. Pagina kiezen` : 'Pagina kiezen',
      onclick: (e) => {
        if (performance.now() - pagesMenuClosedAt < 200) return; // klik die het menu zojuist sloot
        openPagesMenu(e.currentTarget);
      },
    },
    icon(onVideos ? 'video' : inInbox ? 'inbox' : 'page', 16),
    h('span', { class: 'tab-label' }, label),
    count && !inInbox ? h('span', { class: 'badge', title: `${count} nieuw in Nieuw` }, count > 99 ? '99+' : count) : null,
    icon('chevron-down', 16),
  );

  el.replaceChildren(
    h('a', { class: 'brand', href: '#/', title: 'Bookmarks' }, h('img', { class: 'brand-logo', src: 'icons/icon-192.png', alt: '', width: 32, height: 32, draggable: 'false' }), h('span', { class: 'brand-name' }, 'Bookmarks')),
    h('nav', { class: 'header-nav', 'aria-label': 'Navigatie' }, pagesBtn),
    h('div', { class: 'spacer' }),
    h(
      'div',
      { class: 'header-actions' },
      h('button', { class: 'search-btn', type: 'button', 'aria-label': 'Zoeken', title: 'Zoeken (/)', onclick: openSearch }, icon('search', 16), h('span', { class: 'search-text' }, 'Zoeken'), h('kbd', {}, '/')),
      iconButton('palette', 'Thema kiezen', (e) => themeMenu(e.currentTarget)),
      h('a', { class: `icon-btn${route.name === 'settings' ? ' active' : ''}`, href: '#/instellingen', 'aria-label': 'Instellingen', title: 'Instellingen', 'aria-current': route.name === 'settings' ? 'page' : null }, icon('settings')),
    ),
  );
}

// ---- Weergave: hoofdgebied ----------------------------------------------------------------------------------

const widgetCleanups = [];

function destroySortables() {
  sortables.forEach((s) => s.destroy());
  sortables = [];
  widgetCleanups.splice(0).forEach((fn) => fn?.());
}

function renderMain() {
  const main = document.getElementById('main');
  if (!main) return;
  destroySortables();
  const route = currentRoute();
  let view;
  if (route.name === 'settings') view = settingsView();
  else if (route.name === 'videos') view = videosView();
  else if (route.page?.is_inbox) view = inboxView(route.page);
  else if (route.page) view = boardView(route.page);
  else view = h('div', { class: 'empty' }, 'Geen pagina gevonden.');
  if (route.page) prefs.set('lastPage', route.page.id);
  main.replaceChildren(view);
  const names = { settings: 'Instellingen', videos: "Video's" };
  document.title = `${names[route.name] ?? route.page?.title ?? 'Bookmarks'} · Bookmarks`;
}

function topbar({ title, page, controls }) {
  const titleEl = page
    ? h('input', {
        class: 'page-title',
        value: page.title,
        maxlength: 60,
        'aria-label': 'Paginatitel',
        onchange: (e) => {
          const v = e.target.value.trim();
          if (!v) {
            e.target.value = page.title;
            return;
          }
          page.title = v;
          renderHeader();
          persist(api.patchPage(page.id, { title: v }));
        },
        onkeydown: (e) => {
          if (e.key === 'Enter') e.target.blur();
          if (e.key === 'Escape') {
            e.target.value = page.title;
            e.target.blur();
          }
        },
      })
    : h('h1', { class: 'page-title static' }, title);
  return h('header', { class: 'topbar' }, titleEl, h('div', { class: 'spacer' }), controls);
}

function boardView(page) {
  const controls = [
    h(
      'div',
      { class: 'stepper', role: 'group', 'aria-label': 'Aantal kolommen' },
      h('span', { class: 'stepper-label' }, 'Kolommen'),
      h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Minder kolommen', disabled: page.columns <= 1, onclick: () => setColumns(page, page.columns - 1) }, icon('minus', 14)),
      h('span', { class: 'stepper-value', 'aria-live': 'polite' }, page.columns),
      h('button', { class: 'icon-btn small', type: 'button', 'aria-label': 'Meer kolommen', disabled: page.columns >= MAX_COLUMNS, onclick: () => setColumns(page, page.columns + 1) }, icon('plus', 14)),
    ),
    h('button', { class: 'btn primary', type: 'button', onclick: () => addCard(page) }, icon('plus', 16), h('span', {}, 'Card')),
    iconButton('dots', 'Paginaopties', (e) =>
      showMenu(e.currentTarget, [
        { label: 'Titel wijzigen', icon: 'pencil', onClick: () => document.querySelector('.page-title')?.focus() },
        { label: 'Pagina verwijderen', icon: 'trash', danger: true, onClick: () => deletePage(page) },
      ]),
    ),
  ];

  const cards = pageCards(page.id);
  const wrap = h('div', { class: 'view' }, topbar({ page, controls }));
  if (!cards.length) {
    wrap.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-art' }, icon('page', 36)),
        h('h2', {}, 'Nog geen cards op deze pagina'),
        h('p', {}, 'Een card is een groepje snelkoppelingen onder één titel.'),
        h('button', { class: 'btn primary', type: 'button', onclick: () => addCard(page) }, icon('plus', 16), h('span', {}, 'Eerste card maken')),
      ),
    );
    return wrap;
  }

  const board = h('div', { class: 'board', dataset: { cols: page.columns }, style: { '--cols': page.columns } });
  for (let i = 0; i < page.columns; i++) {
    const colCards = cards
      .filter((c) => Math.min(c.column_index, page.columns - 1) === i)
      .sort(byPos);
    board.append(h('div', { class: 'column', dataset: { col: i } }, colCards.map(cardEl)));
  }
  wrap.append(board);
  initBoardSortables(board, page);
  return wrap;
}

const headingLevel = (card) => (HEADING_LEVELS.some((l) => l.value === card.config?.level) ? card.config.level : 'h2');

function setHeadingLevel(card, level) {
  if (headingLevel(card) === level) return;
  card.config = { ...card.config, level };
  renderMain();
  persist(api.patchCard(card.id, { config: card.config }));
}

function headingCardEl(card) {
  const level = headingLevel(card);
  const title = h(level, { class: 'heading-title', title: 'Dubbelklik om de naam te wijzigen' }, card.title);
  title.addEventListener('dblclick', () => renameCard(card));
  return h(
    'article',
    { class: `card heading-card lvl-${level}`, dataset: { id: card.id } },
    h('header', { class: 'card-head heading-head' }, title, iconButton('dots', 'Kop-opties', (e) => cardMenu(card, e.currentTarget), 'small')),
  );
}

function widgetCardEl(card) {
  if (card.type === 'heading') return headingCardEl(card);
  const def = WIDGETS[card.type];
  const body = h('div', { class: `widget-body widget-${card.type}` });
  if (def) {
    const widget = def.render(card, { saveConfig: (delay) => saveCardConfig(card, delay), linkTarget: linkTarget() });
    widgetCleanups.push(widget.destroy);
    body.append(widget.el);
  } else {
    body.append(h('p', { class: 'muted' }, `Onbekend widget-type “${card.type}”.`));
  }
  return h(
    'article',
    { class: 'card widget-card', dataset: { id: card.id } },
    h('header', { class: 'card-head' }, h('h2', { class: 'card-title', title: card.title }, card.title), iconButton('dots', 'Card-opties', (e) => cardMenu(card, e.currentTarget), 'small')),
    body,
  );
}

function cardEl(card) {
  if (!isLinksCard(card)) return widgetCardEl(card);
  return h(
    'article',
    { class: 'card', dataset: { id: card.id } },
    h(
      'header',
      { class: 'card-head' },
      h('h2', { class: 'card-title', title: card.title }, card.title),
      iconButton('plus', 'Link toevoegen', () => addLink(card), 'small'),
      iconButton('dots', 'Card-opties', (e) => cardMenu(card, e.currentTarget), 'small'),
    ),
    h('div', { class: `links view-${card.view}`, dataset: { card: card.id } }, cardLinks(card.id).map(linkEl)),
  );
}

function initBoardSortables(board, page) {
  const common = { animation: 150, delay: 150, delayOnTouchOnly: true, touchStartThreshold: 6, ghostClass: 'drag-ghost', chosenClass: 'drag-chosen' };
  const setDragging = (on) => document.body.classList.toggle('dragging', on);

  board.querySelectorAll('.column').forEach((col) =>
    sortables.push(
      Sortable.create(col, {
        ...common,
        group: 'cards',
        draggable: '.card',
        handle: '.card-head',
        filter: '.icon-btn',
        preventOnFilter: false,
        onStart: () => setDragging(true),
        onEnd: () => {
          setDragging(false);
          const changes = [];
          board.querySelectorAll('.column').forEach((colEl, ci) => {
            [...colEl.children].forEach((node, pos) => {
              const c = cardById(node.dataset.id);
              if (c && (c.column_index !== ci || c.position !== pos)) {
                Object.assign(c, { column_index: ci, position: pos });
                changes.push({ id: c.id, column_index: ci, position: pos });
              }
            });
          });
          if (changes.length) persist(api.patchMany('cards', changes));
        },
      }),
    ),
  );

  board.querySelectorAll('.links').forEach((box) =>
    sortables.push(
      Sortable.create(box, {
        ...common,
        group: 'links',
        draggable: '.link',
        filter: '.link-menu',
        preventOnFilter: false,
        onStart: () => setDragging(true),
        onEnd: () => {
          setDragging(false);
          const changes = [];
          board.querySelectorAll('.links').forEach((boxEl) => {
            [...boxEl.children].forEach((node, pos) => {
              const b = state.bookmarks.find((x) => x.id === node.dataset.id);
              if (b && (b.card_id !== boxEl.dataset.card || b.position !== pos)) {
                Object.assign(b, { card_id: boxEl.dataset.card, position: pos });
                changes.push({ id: b.id, card_id: b.card_id, position: pos });
              }
            });
          });
          if (changes.length) persist(api.patchMany('bookmarks', changes));
        },
      }),
    ),
  );
}

function inboxView(page) {
  const links = inboxLinks();
  const wrap = h('div', { class: 'view' }, topbar({ title: page.title, controls: null }));
  const body = h('div', { class: 'inbox' });
  body.append(h('p', { class: 'inbox-intro' }, 'Snelkoppelingen die je via de browserextensie opslaat komen hier binnen. Verplaats ze naar de juiste pagina en card.'));

  if (!links.length) {
    body.append(
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-art' }, icon('inbox', 36)),
        h('h2', {}, 'Je inbox is leeg'),
        h('p', {}, 'Sla een site op met de extensie en hij verschijnt hier direct.'),
        h('a', { class: 'btn', href: '#/instellingen' }, 'Extensie koppelen'),
      ),
    );
  } else {
    body.append(
      h(
        'ul',
        { class: 'inbox-list' },
        links.map((b) =>
          h(
            'li',
            { class: 'inbox-row' },
            h(
              'a',
              { class: 'inbox-link', href: safeHref(b.url), target: linkTarget(), rel: 'noopener noreferrer', title: b.url },
              faviconEl(b.url),
              h('span', { class: 'inbox-text' }, h('span', { class: 'inbox-title' }, b.title), h('span', { class: 'inbox-meta' }, `${hostOf(b.url)} · ${timeAgo(b.created_at)}`)),
            ),
            h('button', { class: 'btn soft', type: 'button', onclick: () => moveLink(b) }, icon('move', 16), h('span', {}, 'Verplaats')),
            iconButton('dots', `Opties voor ${b.title}`, (e) => linkMenu(b, e.currentTarget), 'link-menu-always'),
          ),
        ),
      ),
    );
  }
  wrap.append(body);
  return wrap;
}

// ---- Instellingen ---------------------------------------------------------------------------------------------

function segmented(options, value, onChange) {
  const buttons = options.map((o) =>
    h('button', { type: 'button', role: 'radio', class: 'seg', 'aria-checked': String(o.value === value), onclick: () => {
      buttons.forEach((b, i) => b.setAttribute('aria-checked', String(options[i].value === o.value)));
      onChange(o.value);
    } }, o.label),
  );
  return h('div', { class: 'segmented', role: 'radiogroup' }, buttons);
}

function settingsView() {
  const key = state.settings?.api_key ?? '';
  let shown = false;
  const keyBox = h('code', { class: 'secret' });
  const paint = () => {
    keyBox.textContent = shown ? key : `${'•'.repeat(24)}${key.slice(-4)}`;
  };
  paint();

  const endpoint = `${api.supabaseUrl}/rest/v1/rpc/add_bookmark`;
  const example = `POST ${endpoint}
apikey: ${api.anonKey}
Content-Type: application/json

{ "p_key": "<jouw API-sleutel>", "p_url": "https://voorbeeld.nl", "p_title": "Titel van de pagina" }`;

  const section = (title, ...kids) => h('section', { class: 'panel' }, h('h2', {}, title), kids);
  const importInput = h('input', {
    type: 'file',
    accept: '.html,.htm,text/html',
    hidden: true,
    onchange: (e) => {
      const file = e.target.files[0];
      e.target.value = '';
      if (file) importFile(file);
    },
  });

  return h(
    'div',
    { class: 'view' },
    topbar({ title: 'Instellingen', controls: null }),
    h(
      'div',
      { class: 'settings' },
      section(
        'Browserextensie',
        h('p', { class: 'muted' }, 'De extensie stuurt een snelkoppeling met deze sleutel naar je inbox “Nieuw”. Deel de sleutel met niemand: wie hem heeft, kan links aan je inbox toevoegen.'),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'API-sleutel'), keyBox,
          h('button', { class: 'btn', type: 'button', onclick: () => { shown = !shown; paint(); } }, shown ? 'Verberg' : 'Toon'),
          h('button', { class: 'btn', type: 'button', onclick: () => copyText(key, 'Sleutel gekopieerd') }, icon('copy', 16), h('span', {}, 'Kopieer')),
          h('button', { class: 'btn ghost', type: 'button', onclick: regenerateKey }, icon('refresh', 16), h('span', {}, 'Nieuwe sleutel')),
        ),
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Endpoint'), h('code', { class: 'secret' }, endpoint),
          h('button', { class: 'btn', type: 'button', onclick: () => copyText(endpoint, 'Endpoint gekopieerd') }, icon('copy', 16), h('span', {}, 'Kopieer')),
        ),
        h('details', {}, h('summary', {}, 'Voorbeeldverzoek'), h('pre', { class: 'code' }, example),
          h('button', { class: 'btn', type: 'button', onclick: () => copyText(example.replace('<jouw API-sleutel>', key), 'Voorbeeld gekopieerd') }, icon('copy', 16), h('span', {}, 'Kopieer met sleutel')),
        ),
      ),
      section(
        'Importeren',
        h('p', { class: 'muted' }, 'Importeer de HTML-export van start.me (of een bladwijzerbestand van Chrome, Firefox of Edge). Pagina’s en mappen worden nieuwe pagina’s en cards; bestaande pagina’s blijven ongemoeid.'),
        h('div', { class: 'row' },
          h('button', { class: 'btn', type: 'button', onclick: () => importInput.click() }, icon('plus', 16), h('span', {}, 'Bestand kiezen…')),
          importInput,
        ),
      ),
      section('Thema', themePicker()),
      section(
        'Weergave',
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Links openen'),
          segmented([{ value: 'blank', label: 'Nieuw tabblad' }, { value: 'self', label: 'Zelfde venster' }], prefs.get('openIn', 'blank'), (v) => { prefs.set('openIn', v); }),
        ),
      ),
      section(
        'Account',
        h('div', { class: 'row' }, h('span', { class: 'label' }, 'Ingelogd als'), h('span', {}, state.email)),
        h('div', { class: 'row' }, h('button', { class: 'btn', type: 'button', onclick: logout }, icon('logout', 16), h('span', {}, 'Uitloggen'))),
      ),
    ),
  );
}

async function importFile(file) {
  let parsed;
  try {
    parsed = parseBookmarksHtml(await file.text());
  } catch (err) {
    toast(`Bestand lezen mislukt: ${err.message}`, { error: true });
    return;
  }
  const { totals, pages, stray } = parsed;
  if (!totals.links) {
    toast('Geen snelkoppelingen gevonden in dit bestand.', { error: true });
    return;
  }

  const summary = h(
    'div',
    { class: 'fields' },
    h('p', { class: 'dialog-text' }, `Gevonden: ${totals.pages} pagina’s, ${totals.cards} cards en ${totals.links} snelkoppelingen. Ze worden als nieuwe pagina’s toegevoegd.`),
    h('ul', { class: 'import-list' }, pages.map((p) => h('li', {}, h('strong', {}, p.title), ` — ${p.cards.length} cards, ${p.cards.reduce((n, c) => n + c.links.length, 0)} links`))),
    stray.length ? h('p', { class: 'dialog-text' }, `${stray.length} losse link${stray.length === 1 ? '' : 's'} komen in Nieuw.`) : null,
  );
  const ok = await openDialog('Importeren?', { el: summary, collect: () => true }, { submit: 'Importeren' });
  if (!ok) return;

  const pageRows = [];
  const cardRows = [];
  const bookmarkRows = [];
  let pos = Math.max(-1, ...userPages().map((p) => p.position)) + 1;
  for (const p of pages) {
    const pageId = crypto.randomUUID();
    pageRows.push({ id: pageId, title: p.title, columns: p.columns, position: pos++ });
    for (const c of p.cards) {
      const cardId = crypto.randomUUID();
      cardRows.push({ id: cardId, page_id: pageId, title: c.title, column_index: c.column_index, position: c.position, view: 'list' });
      c.links.forEach((l, i) => bookmarkRows.push({ card_id: cardId, title: l.title, url: l.url, position: i }));
    }
  }
  stray.forEach((l) => bookmarkRows.push({ card_id: null, title: l.title, url: l.url, position: 0 }));

  toast('Bezig met importeren…', { duration: 2500 });
  try {
    await api.insertMany('pages', pageRows);
    await api.insertMany('cards', cardRows);
    await api.insertMany('bookmarks', bookmarkRows);
  } catch (err) {
    // terugdraaien: het verwijderen van de pagina’s verwijdert ook hun cards en links
    await Promise.allSettled(pageRows.map((p) => api.removePage(p.id)));
    toast(`Importeren mislukt, er is niets toegevoegd: ${err.message}`, { error: true });
    await reload();
    return;
  }
  await reload();
  if (pageRows.length) go(`#/p/${pageRows[0].id}`);
  toast(`Geïmporteerd: ${totals.pages} pagina’s, ${totals.cards} cards, ${totals.links} links`);
}

async function regenerateKey() {
  const ok = await confirmDialog({
    title: 'Nieuwe API-sleutel genereren?',
    message: 'De huidige sleutel werkt daarna niet meer. Vergeet niet de nieuwe sleutel in je extensie te zetten.',
    confirm: 'Genereren',
    danger: false,
  });
  if (!ok) return;
  try {
    state.settings = { api_key: await api.regenerateApiKey() };
    renderMain();
    toast('Nieuwe sleutel aangemaakt');
  } catch (err) {
    toast(`Genereren mislukt: ${err.message}`, { error: true });
  }
}

async function logout() {
  await api.signOut();
}

// ---- Video's ------------------------------------------------------------------------------------------------------------
//
// Twee niveaus: hoofdtabs (groepen, bijvoorbeeld Onderwijs en Persoonlijk) en daarbinnen labels.
// Een label hoort bij één hoofdtab; labels zonder hoofdtab staan onder Overig. Video's zonder label staan
// onder Te sorteren. Er is bewust geen tabblad met alle video's: wat je op het werk opent, blijft binnen één hoofdtab.
// De gekozen hoofdtab en het label worden per apparaat onthouden.

const OTHER = '__other'; // hoofdtab voor labels zonder hoofdtab
const INBOX = '__none'; // video's zonder label
const ALL_IN_GROUP = '__all'; // alle video's binnen de hoofdtab
const VIDEO_MIME = 'application/x-bookmarks-video';
const videoFilter = { kind: prefs.get('videoKind', 'all'), group: prefs.get('videoGroup', ''), tab: prefs.get('videoTab', ALL_IN_GROUP) };
const enrichTried = new Set();

const videosByNewest = () => [...(state.videos ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
const videoTags = (v) => v.tags ?? [];
const normalizeTag = (t) => t.trim().toLowerCase().replace(/\s+/g, ' ').slice(0, 30);
const sortTags = (tags) => [...new Set(tags)].sort((a, b) => a.localeCompare(b, 'nl'));
const groupsAvailable = () => Array.isArray(state.videoGroups);
const sortedGroups = () => [...(state.videoGroups ?? [])].sort(byPos);
const groupById = (id) => (state.videoGroups ?? []).find((g) => g.id === id);
const isLabel = (tab) => !!tab && !tab.startsWith('__');
const untaggedCount = () => (state.videos ?? []).filter((v) => !videoTags(v).length).length;

function tagCounts() {
  const counts = new Map();
  for (const v of state.videos ?? []) for (const t of videoTags(v)) counts.set(t, (counts.get(t) ?? 0) + 1);
  return counts;
}

// Alle labels in de opgeslagen volgorde (nieuwe labels alfabetisch achteraan), met aantal en hoofdtab.
function videoTabList() {
  const counts = tagCounts();
  const rows = [...(state.videoTabs ?? [])].sort(byPos);
  const groupOf = new Map(rows.map((r) => [r.tag, groupById(r.group_id) ? r.group_id : OTHER]));
  const saved = rows.map((r) => r.tag);
  const extra = [...counts.keys()].filter((t) => !groupOf.has(t)).sort((a, b) => a.localeCompare(b, 'nl'));
  return [...saved, ...extra].map((tag) => ({ tag, count: counts.get(tag) ?? 0, group: groupOf.get(tag) ?? OTHER }));
}

const labelsIn = (groupId, list = videoTabList()) => list.filter((l) => l.group === groupId);
const groupOfTag = (tag) => videoTabList().find((l) => l.tag === tag)?.group ?? OTHER;

// Video's binnen een hoofdtab: alles met minstens één label uit die hoofdtab.
function videosInGroup(groupId, list = videoTabList()) {
  if (groupId === INBOX) return videosByNewest().filter((v) => !videoTags(v).length);
  const tags = new Set(labelsIn(groupId, list).map((l) => l.tag));
  return videosByNewest().filter((v) => videoTags(v).some((t) => tags.has(t)));
}

// De hoofdtabs op rij 1: je eigen hoofdtabs, dan Overig (alleen als er labels zonder hoofdtab zijn).
function groupTabs() {
  const list = videoTabList();
  const groups = sortedGroups().map((g) => ({ id: g.id, name: g.name, real: true, count: videosInGroup(g.id, list).length }));
  if (labelsIn(OTHER, list).length) groups.push({ id: OTHER, name: groups.length ? 'Overig' : 'Labels', real: false, count: videosInGroup(OTHER, list).length });
  return groups;
}

// Wat er nu getoond wordt, met terugval als de gekozen hoofdtab of het label niet meer bestaat.
function currentVideoView() {
  const groups = groupTabs();
  let { group, tab } = videoFilter;
  if (!group && isLabel(tab)) group = groupOfTag(tab); // voorkeur uit de versie zonder hoofdtabs
  if (group === INBOX && untaggedCount()) return { group: INBOX, tab: ALL_IN_GROUP };
  if (!groups.some((g) => g.id === group)) {
    group = groups[0]?.id ?? (untaggedCount() ? INBOX : null);
    tab = ALL_IN_GROUP;
  }
  if (!group || group === INBOX) return { group, tab: ALL_IN_GROUP };
  if (isLabel(tab) && !labelsIn(group).some((l) => l.tag === tab)) tab = ALL_IN_GROUP;
  return { group, tab: isLabel(tab) ? tab : ALL_IN_GROUP };
}

function setVideoView(group, tab = ALL_IN_GROUP) {
  Object.assign(videoFilter, { group, tab });
  prefs.set('videoGroup', group);
  prefs.set('videoTab', tab);
  renderMain();
}

function filteredVideos(view = currentVideoView()) {
  if (!view.group) return [];
  const list = isLabel(view.tab) ? videosByNewest().filter((v) => videoTags(v).includes(view.tab)) : videosInGroup(view.group);
  return list.filter((v) => videoFilter.kind === 'all' || v.kind === videoFilter.kind);
}

// Video op een label (of op Te sorteren) laten vallen. Vanuit een ander label: verplaatsen (oud label eraf).
// Vanuit de hele hoofdtab: label erbij. Op Te sorteren: alle labels eraf. Altijd met ongedaan maken.
async function dropVideoOnTab(id, target) {
  const v = (state.videos ?? []).find((x) => x.id === id);
  if (!v) return;
  const from = currentVideoView().tab;
  const before = videoTags(v);
  let next;
  let message;
  if (target === INBOX) {
    next = [];
    message = 'Labels eraf, de video staat nu bij Te sorteren';
  } else if (isLabel(from) && from !== target && before.includes(from)) {
    next = sortTags([...before.filter((t) => t !== from), target]);
    message = `Verplaatst naar “${target}”`;
  } else {
    next = sortTags([...before, target]);
    message = `Label “${target}” toegevoegd`;
  }
  if (next.join('\n') === before.join('\n')) {
    toast(target === INBOX ? 'Deze video heeft geen labels.' : `Staat al in “${target}”.`);
    return;
  }
  await saveVideoTags(v, next, message);
}

async function saveVideoTags(v, next, message) {
  const before = videoTags(v);
  v.tags = next;
  renderMain();
  try {
    await api.patchVideo(v.id, { tags: next });
  } catch (err) {
    v.tags = before;
    renderMain();
    const hint = /tags/i.test(err.message) ? ' (voer eerst supabase/migrations/005_video_tags.sql uit)' : '';
    toast(`Opslaan mislukt: ${err.message}${hint}`, { error: true });
    return;
  }
  if (!message) return;
  toast(message, {
    action: {
      label: 'Ongedaan maken',
      onClick: () => {
        v.tags = before;
        renderMain();
        persist(api.patchVideo(v.id, { tags: before }));
      },
    },
  });
}

function videoTile(v, group, view) {
  // Alleen labels uit dezelfde hoofdtab; het label van het open tabblad hoeft niet nog eens.
  const otherTags = videoTags(v).filter((t) => t !== view.tab && view.groupTags.has(t));
  const tile = h(
    'div',
    { class: `vtile ${v.kind}`, dataset: { id: v.id }, draggable: 'true' },
    h(
      'button',
      { class: 'vtile-main', type: 'button', 'aria-label': `Afspelen: ${v.title}`, onclick: () => openPlayer(group, group.indexOf(v)) },
      h(
        'span',
        { class: 'vthumb' },
        videoThumb(v) ? h('img', { src: videoThumb(v), alt: '', loading: 'lazy', draggable: 'false' }) : h('span', { class: 'vthumb-empty' }, icon('playlist', 34)),
        h('span', { class: 'vplay' }, icon('play', 22)),
        v.kind === 'playlist' ? h('span', { class: 'vbadge' }, icon('playlist', 14), h('span', {}, 'Playlist')) : null,
      ),
      h('span', { class: 'vtitle' }, v.title),
      v.channel ? h('span', { class: 'vchannel' }, v.channel) : null,
    ),
    otherTags.length
      ? h(
          'div',
          { class: 'vtags' },
          otherTags.slice(0, 3).map((t) => h('button', { class: 'vtag', type: 'button', title: `Naar label “${t}”`, onclick: () => setVideoView(view.group, t) }, t)),
          otherTags.length > 3 ? h('span', { class: 'vtag more', title: otherTags.slice(3).join(', ') }, `+${otherTags.length - 3}`) : null,
        )
      : null,
    h('button', { class: 'icon-btn vmenu', type: 'button', 'aria-label': `Opties voor ${v.title}`, onclick: (e) => videoMenu(v, e.currentTarget) }, icon('dots', 16)),
  );
  // Slepen naar een label (desktop). Op touchscreens gaat het via Labels… in het menu.
  tile.addEventListener('dragstart', (e) => {
    e.dataTransfer.setData(VIDEO_MIME, v.id);
    e.dataTransfer.effectAllowed = 'move';
    document.body.classList.add('dragging-video');
  });
  tile.addEventListener('dragend', endVideoDrag);
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    videoMenu(v, { x: e.clientX, y: e.clientY });
  });
  return tile;
}

function endVideoDrag() {
  document.body.classList.remove('dragging-video');
  document.querySelectorAll('.drop-target').forEach((el) => el.classList.remove('drop-target'));
}
// Wisselt de pagina tijdens het slepen van hoofdtab, dan verdwijnt de tegel en komt er geen dragend.
// De eerste muisbeweging na het slepen ruimt dan alsnog op.
document.addEventListener('mousemove', () => document.body.classList.contains('dragging-video') && endVideoDrag(), { passive: true });

function videoMenu(v, anchor) {
  const group = filteredVideos().filter((x) => x.kind === v.kind);
  showMenu(anchor, [
    { label: 'Afspelen', icon: 'play', onClick: () => openPlayer(group.includes(v) ? group : [v], Math.max(group.indexOf(v), 0)) },
    { label: 'Openen op YouTube', icon: 'video', onClick: () => window.open(v.url, '_blank', 'noopener') },
    '-',
    { label: 'Labels…', icon: 'tag', onClick: () => editTags(v) },
    { label: 'Titel wijzigen', icon: 'pencil', onClick: () => editVideo(v) },
    { label: 'Adres kopiëren', icon: 'copy', onClick: () => copyText(v.url, 'Adres gekopieerd') },
    '-',
    { label: 'Verwijderen', icon: 'trash', danger: true, onClick: () => deleteVideo(v) },
  ]);
}

async function editVideo(v) {
  const r = await openDialog('Titel wijzigen', fieldsBody([{ name: 'title', label: 'Titel', value: v.title, required: true, maxlength: 300 }]));
  if (!r) return;
  v.title = r.title;
  renderMain();
  persist(api.patchVideo(v.id, { title: v.title }));
}

async function deleteVideo(v) {
  state.videos = state.videos.filter((x) => x !== v);
  renderMain();
  try {
    await api.removeVideo(v.id);
  } catch (err) {
    state.videos.push(v);
    renderMain();
    toast(`Verwijderen mislukt: ${err.message}`, { error: true });
    return;
  }
  toast('Video verwijderd', {
    action: {
      label: 'Ongedaan maken',
      onClick: async () => {
        try {
          const { id, video_id, kind, url, title, channel, created_at } = v;
          const tags = videoTags(v).length ? { tags: videoTags(v) } : {};
          state.videos.push(await api.insertVideo({ id, video_id, kind, url, title, channel, created_at, ...tags }));
          renderMain();
        } catch (err) {
          toast(`Terugzetten mislukt: ${err.message}`, { error: true });
        }
      },
    },
  });
}

async function addVideo() {
  const view = currentVideoView();
  const labels = view.group && view.group !== INBOX ? labelsIn(view.group) : [];
  const fields = [
    {
      name: 'url',
      label: 'YouTube-adres',
      required: true,
      placeholder: 'https://www.youtube.com/shorts/…',
      inputmode: 'url',
      hint: 'Een video, Short of hele playlist (youtube.com/playlist?list=…).',
      validate: (v) => {
        const p = parseYouTube(v);
        if (!p) return 'Dit is geen YouTube-video, Short of playlist.';
        if (p.kind === 'playlist' && !p.embeddable) return 'Deze playlist is privé of automatisch (zoals Later bekijken of een mix) en kan niet in de site afspelen.';
        return null;
      },
    },
  ];
  if (labels.length) {
    fields.push({
      name: 'tag',
      label: 'Label',
      type: 'select',
      value: isLabel(view.tab) ? view.tab : labels[0].tag,
      options: [...labels.map((l) => ({ value: l.tag, label: l.tag })), { value: '', label: 'Geen label (Te sorteren)' }],
    });
  }
  const r = await openDialog('Video toevoegen', fieldsBody(fields), { submit: 'Toevoegen' });
  if (!r) return;
  let p = parseYouTube(r.url);
  // Een video die je in een playlist bekeek: vraag of je de video of de hele playlist wilt.
  if (p.list) {
    const pick = await openDialog(
      'Video of playlist?',
      fieldsBody(
        [{ name: 'what', label: 'Opslaan', type: 'segmented', value: 'video', options: [{ value: 'video', label: 'Alleen deze video' }, { value: 'playlist', label: 'Hele playlist' }] }],
        'Dit adres hoort bij een video in een playlist.',
      ),
      { submit: 'Opslaan' },
    );
    if (!pick) return;
    if (pick.what === 'playlist') p = playlistAsVideo(p.list);
  }
  const isList = p.kind === 'playlist';
  const what = isList ? 'Playlist' : 'Video';
  if (state.videos.some((v) => v.video_id === p.id)) {
    toast(isList ? 'Deze playlist staat er al in.' : 'Deze video staat er al in.');
    return;
  }
  const info = await fetchOEmbed({ kind: p.kind, video_id: p.id });
  try {
    const row = await api.insertVideo({
      video_id: p.id,
      kind: !isList && info?.portrait ? 'short' : p.kind,
      url: p.url,
      title: info?.title || (isList ? 'YouTube-playlist' : 'YouTube-video'),
      channel: info?.channel ?? null,
      ...(isList && info?.thumb ? { thumb: info.thumb } : {}),
      ...(r.tag ? { tags: [r.tag] } : {}),
    });
    state.videos.push(row);
    renderAll();
    toast(r.tag ? `${what} toegevoegd aan “${r.tag}”` : `${what} toegevoegd aan Te sorteren`);
  } catch (err) {
    const hint = isList && /kind|check|thumb/i.test(err.message) ? ' (voer eerst supabase/migrations/008_video_playlists.sql uit)' : '';
    toast(`Toevoegen mislukt: ${err.message}${hint}`, { error: true });
  }
}

// Haalt kanaalnaam (en zo nodig titel/type) op bij YouTube voor video's die de extensie zonder die gegevens opsloeg.
async function enrichVideos() {
  const queue = (state.videos ?? []).filter((v) => (!v.channel || (v.kind === 'playlist' && !v.thumb)) && !enrichTried.has(v.id));
  if (!queue.length) return;
  queue.forEach((v) => enrichTried.add(v.id));
  let changed = false;
  const worker = async () => {
    for (let v = queue.shift(); v; v = queue.shift()) {
      const info = await fetchOEmbed(v);
      if (!info) continue;
      const patch = { channel: info.channel };
      if (info.title && (!v.title || v.title === 'YouTube-video' || v.title === 'YouTube-playlist')) patch.title = info.title;
      if (info.portrait && v.kind === 'video') patch.kind = 'short';
      if (v.kind === 'playlist' && info.thumb) patch.thumb = info.thumb;
      Object.assign(v, patch);
      changed = true;
      api.patchVideo(v.id, patch).catch(() => {});
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (changed && currentRoute().name === 'videos' && !document.querySelector('dialog[open]') && !isTyping()) renderMain();
}

// Labels bewerken: bestaande labels (per hoofdtab) aan/uit klikken en nieuwe typen.
// Een nieuw getypt label komt in de hoofdtab die open staat.
async function editTags(v) {
  const view = currentVideoView();
  const homeGroup = groupById(view.group) ? view.group : null;
  const list = videoTabList();
  const selected = new Set(videoTags(v));
  const typed = new Set(); // nieuw getypte labels blijven als chip staan
  const chips = h('div', { class: 'tag-groups' });
  const error = h('div', { class: 'field-error', role: 'alert' });
  const input = h('input', { class: 'input', type: 'text', placeholder: 'Nieuw label, bijvoorbeeld tennis', maxlength: 30, autocomplete: 'off', 'aria-label': 'Nieuw label' });

  const chip = (t) =>
    h(
      'button',
      {
        class: 'tag-chip',
        type: 'button',
        'aria-pressed': String(selected.has(t)),
        onclick: () => {
          if (!selected.delete(t)) selected.add(t);
          paint();
        },
      },
      t,
    );
  const paint = () => {
    const known = new Set(list.map((l) => l.tag));
    const fresh = [...new Set([...typed, ...selected])].filter((t) => !known.has(t));
    const sections = groupTabs()
      .map((g) => ({ id: g.id, name: g.name, tags: labelsIn(g.id, list).map((l) => l.tag).concat(g.id === (homeGroup ?? OTHER) ? fresh : []) }))
      .filter((s) => s.tags.length);
    if (!sections.some((s) => s.tags.some((t) => fresh.includes(t))) && fresh.length) sections.push({ id: '', name: 'Nieuw', tags: fresh });
    const section = (s, named) => h('div', { class: 'tag-group' }, named ? h('div', { class: 'tag-group-name' }, s.name) : null, h('div', { class: 'tag-chips' }, s.tags.map(chip)));
    // Binnen een hoofdtab staan de labels van andere hoofdtabs dichtgeklapt (handig op een gedeeld scherm).
    const home = sections.filter((s) => s.id === view.group || s.id === '');
    const rest = sections.filter((s) => !home.includes(s));
    const fold = view.group !== INBOX && rest.length && (home.length || groupById(view.group));
    const picked = rest.reduce((n, s) => n + s.tags.filter((t) => selected.has(t)).length, 0);
    chips.replaceChildren(
      ...(!sections.length
        ? [h('span', { class: 'muted' }, 'Nog geen labels. Typ er hieronder een.')]
        : fold
          ? [
              ...(home.length ? home.map((s) => section(s, false)) : [h('span', { class: 'muted' }, 'Nog geen labels in deze hoofdtab. Typ er hieronder een.')]),
              h(
                'details',
                { class: 'tag-more', open: chips.querySelector('details')?.open || null },
                h('summary', {}, `Labels uit andere hoofdtabs${picked ? ` (${picked} gekozen)` : ''}`),
                ...rest.map((s) => section(s, true)),
              ),
            ]
          : sections.map((s) => section(s, sections.length > 1))),
    );
  };
  const addTyped = () => {
    input.value.split(',').map(normalizeTag).filter(Boolean).forEach((t) => {
      typed.add(t);
      selected.add(t);
    });
    input.value = '';
    paint();
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      addTyped();
    }
  });
  paint();

  const hint = homeGroup ? `Een nieuw label komt onder “${groupById(homeGroup).name}”. ` : '';
  const result = await openDialog(
    'Labels',
    {
      el: h(
        'div',
        { class: 'fields' },
        h('p', { class: 'dialog-text' }, v.title),
        chips,
        h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Nieuw label'), input, h('span', { class: 'field-hint' }, `${hint}Druk op Enter om toe te voegen. Maximaal 10 labels per video.`)),
        error,
      ),
      focus: () => input,
      collect() {
        addTyped();
        if (selected.size > 10) {
          error.textContent = 'Een video kan maximaal 10 labels hebben.';
          return undefined;
        }
        return [...selected].sort((a, b) => a.localeCompare(b, 'nl'));
      },
    },
    { submit: 'Opslaan' },
  );
  if (!result) return;
  const fresh = result.filter((t) => !list.some((l) => l.tag === t));
  if (fresh.length && homeGroup && state.videoTabs) {
    await saveTabs([...list.map((l) => ({ tag: l.tag, group: l.group })), ...fresh.map((tag) => ({ tag, group: homeGroup }))]);
  }
  await saveVideoTags(v, result);
}

// ---- Labels en hoofdtabs beheren -------------------------------------------------------------------------------------

function tabsUnavailable() {
  toast('Voer eerst supabase/migrations/006_video_tabs.sql uit om labels te beheren.', { error: true });
}

function groupsUnavailable() {
  toast('Voer eerst supabase/migrations/007_video_groups.sql uit om hoofdtabs te maken.', { error: true });
}

// Slaat alle labels op in deze volgorde, met hun hoofdtab. entries: [{ tag, group }]
async function saveTabs(entries) {
  const rows = entries.map((e, position) => ({ tag: e.tag, position, ...(groupsAvailable() ? { group_id: groupById(e.group) ? e.group : null } : {}) }));
  state.videoTabs = rows.map((r) => ({ group_id: null, ...r }));
  try {
    await api.saveVideoTabs(rows);
  } catch (err) {
    console.error(err);
    toast(`Opslaan mislukt: ${err.message}`, { error: true });
  }
}

const tabEntries = (list = videoTabList()) => list.map((l) => ({ tag: l.tag, group: l.group }));

// Nieuwe volgorde binnen één hoofdtab; de labels van andere hoofdtabs houden hun plek.
function saveLabelOrder(groupId, ordered) {
  const queue = [...ordered];
  saveTabs(tabEntries().map((e) => (e.group === groupId ? { tag: queue.shift(), group: groupId } : e)));
}

async function moveTagToGroup(tag, groupId) {
  if (state.videoTabs === null) return tabsUnavailable();
  if (groupOfTag(tag) === groupId) return;
  const entries = tabEntries().filter((e) => e.tag !== tag);
  // achteraan in de nieuwe hoofdtab
  const lastIndex = entries.map((e) => e.group).lastIndexOf(groupId);
  entries.splice(lastIndex + 1 || entries.length, 0, { tag, group: groupId });
  await saveTabs(entries);
  renderMain();
  const name = groupById(groupId)?.name ?? 'Overig';
  toast(`“${tag}” staat nu onder ${name}`, { action: { label: 'Bekijken', onClick: () => setVideoView(groupId, tag) } });
}

async function moveTagDialog(tag) {
  if (!groupsAvailable()) return groupsUnavailable();
  const groups = sortedGroups();
  if (!groups.length) {
    toast('Maak eerst een hoofdtab met de + naast de hoofdtabs.');
    return;
  }
  const current = groupOfTag(tag);
  const r = await openDialog(
    `“${tag}” verplaatsen`,
    fieldsBody([
      {
        name: 'group',
        label: 'Naar hoofdtab',
        type: 'select',
        value: current,
        options: [...groups.map((g) => ({ value: g.id, label: g.name })), { value: OTHER, label: 'Overig (geen hoofdtab)' }],
      },
    ]),
    { submit: 'Verplaatsen' },
  );
  if (r) await moveTagToGroup(tag, r.group);
}

async function addVideoTab() {
  if (state.videoTabs === null) return tabsUnavailable();
  const view = currentVideoView();
  const groupId = groupById(view.group) ? view.group : OTHER;
  const groupName = groupById(groupId)?.name;
  const r = await openDialog(
    'Nieuw label',
    fieldsBody(
      [{ name: 'tag', label: 'Naam', required: true, maxlength: 30, placeholder: 'Bijvoorbeeld rekenen', validate: (v) => (normalizeTag(v) ? null : 'Geef het label een naam.') }],
      `${groupName ? `Het label komt onder “${groupName}”. ` : ''}Sleep daarna een video op het label, of geef hem het label via Labels… in het menu van de video.`,
    ),
    { submit: 'Aanmaken' },
  );
  if (!r) return;
  const tag = normalizeTag(r.tag);
  const existing = videoTabList().find((l) => l.tag === tag);
  if (!existing) await saveTabs([...tabEntries(), { tag, group: groupId }]);
  else if (existing.group !== groupId) await moveTagToGroup(tag, groupId);
  setVideoView(groupId, tag);
}

async function renameVideoTab(tag) {
  if (state.videoTabs === null) return tabsUnavailable();
  const r = await openDialog(
    'Label hernoemen',
    fieldsBody([{ name: 'tag', label: 'Naam', value: tag, required: true, maxlength: 30 }], 'Het label verandert ook bij alle video’s met dit label. Kies je een bestaande naam, dan worden de labels samengevoegd.'),
  );
  if (!r) return;
  const next = normalizeTag(r.tag);
  if (!next || next === tag) return;
  try {
    await api.renameVideoTag(tag, next);
  } catch (err) {
    toast(`Hernoemen mislukt: ${err.message}`, { error: true });
    return;
  }
  for (const v of state.videos ?? []) {
    if (videoTags(v).includes(tag)) v.tags = sortTags(videoTags(v).map((t) => (t === tag ? next : t)));
  }
  const merged = state.videoTabs.some((t) => t.tag === next);
  state.videoTabs = merged ? state.videoTabs.filter((t) => t.tag !== tag) : state.videoTabs.map((t) => (t.tag === tag ? { ...t, tag: next } : t));
  if (videoFilter.tab === tag) setVideoView(groupOfTag(next), next);
  else renderMain();
  toast(merged ? `Samengevoegd met “${next}”` : `Hernoemd naar “${next}”`);
}

async function deleteVideoTab(tag) {
  const n = (state.videos ?? []).filter((v) => videoTags(v).includes(tag)).length;
  const ok = await confirmDialog({
    title: 'Label verwijderen?',
    message: n ? `Het label “${tag}” verdwijnt. De ${n} video${n === 1 ? '' : '’s'} blijven bewaard; alleen dit label gaat eraf.` : `Het lege label “${tag}” verdwijnt.`,
  });
  if (!ok) return;
  try {
    await api.deleteVideoTag(tag);
  } catch (err) {
    const hint = /function|delete_video_tag|schema cache/i.test(err.message) ? ' (voer eerst supabase/migrations/006_video_tabs.sql uit)' : '';
    toast(`Verwijderen mislukt: ${err.message}${hint}`, { error: true });
    return;
  }
  for (const v of state.videos ?? []) if (videoTags(v).includes(tag)) v.tags = videoTags(v).filter((t) => t !== tag);
  if (state.videoTabs) state.videoTabs = state.videoTabs.filter((t) => t.tag !== tag);
  renderMain();
  toast(`Label “${tag}” verwijderd`);
}

function tabMenu(tag, anchor) {
  showMenu(anchor, [
    { label: 'Hernoemen…', icon: 'pencil', onClick: () => renameVideoTab(tag) },
    { label: 'Verplaatsen naar hoofdtab…', icon: 'move', onClick: () => moveTagDialog(tag) },
    '-',
    { label: 'Label verwijderen', icon: 'trash', danger: true, onClick: () => deleteVideoTab(tag) },
  ]);
}

async function addVideoGroup() {
  if (!groupsAvailable()) return groupsUnavailable();
  const first = !sortedGroups().length;
  const r = await openDialog(
    'Nieuwe hoofdtab',
    fieldsBody(
      [{ name: 'name', label: 'Naam', required: true, maxlength: 40, placeholder: 'Bijvoorbeeld Onderwijs' }],
      first
        ? 'Een hoofdtab bundelt labels, zoals Onderwijs, Webdesign of Persoonlijk. Je bestaande labels staan daarna onder Overig; sleep ze naar een hoofdtab of kies Verplaatsen in het menu van een label.'
        : 'Sleep daarna labels naar deze hoofdtab, of maak er hier nieuwe aan.',
    ),
    { submit: 'Aanmaken' },
  );
  if (!r) return;
  const name = r.name.trim().slice(0, 40);
  try {
    const row = await api.insertVideoGroup({ name, position: sortedGroups().length });
    state.videoGroups.push(row);
    setVideoView(row.id);
  } catch (err) {
    toast(`Aanmaken mislukt: ${err.message}`, { error: true });
  }
}

async function renameVideoGroup(g) {
  const r = await openDialog('Hoofdtab hernoemen', fieldsBody([{ name: 'name', label: 'Naam', value: g.name, required: true, maxlength: 40 }]));
  if (!r || r.name.trim() === g.name) return;
  g.name = r.name.trim().slice(0, 40);
  renderMain();
  persist(api.patchVideoGroup(g.id, { name: g.name }));
}

async function deleteVideoGroup(g) {
  const n = labelsIn(g.id).length;
  const ok = await confirmDialog({
    title: 'Hoofdtab verwijderen?',
    message: n
      ? n === 1
        ? `De hoofdtab “${g.name}” verdwijnt. Het label en alle video’s blijven bewaard; het label komt onder Overig.`
        : `De hoofdtab “${g.name}” verdwijnt. De ${n} labels en alle video’s blijven bewaard; de labels komen onder Overig.`
      : `De lege hoofdtab “${g.name}” verdwijnt.`,
  });
  if (!ok) return;
  try {
    await api.removeVideoGroup(g.id); // in de database worden de labels dan vanzelf losgekoppeld
  } catch (err) {
    toast(`Verwijderen mislukt: ${err.message}`, { error: true });
    return;
  }
  state.videoGroups = state.videoGroups.filter((x) => x !== g);
  state.videoTabs = (state.videoTabs ?? []).map((t) => (t.group_id === g.id ? { ...t, group_id: null } : t));
  renderMain();
  toast(`Hoofdtab “${g.name}” verwijderd`);
}

function saveGroupOrder(ids) {
  const groups = ids.map(groupById).filter(Boolean);
  groups.forEach((g, i) => (g.position = i));
  persist(api.patchMany('video_groups', groups.map((g) => ({ id: g.id, position: g.position }))), 'Volgorde opslaan mislukt');
}

function groupMenu(g, anchor) {
  showMenu(anchor, [
    { label: 'Hernoemen…', icon: 'pencil', onClick: () => renameVideoGroup(g) },
    { label: 'Hoofdtab verwijderen', icon: 'trash', danger: true, onClick: () => deleteVideoGroup(g) },
  ]);
}

// Laat een element een video ontvangen (labels en Te sorteren).
function acceptVideoDrop(el, target) {
  el.classList.add('vdrop');
  el.addEventListener('dragover', (e) => {
    if (!e.dataTransfer.types.includes(VIDEO_MIME)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    el.classList.add('drop-target');
  });
  el.addEventListener('dragleave', () => el.classList.remove('drop-target'));
  el.addEventListener('drop', (e) => {
    const videoId = e.dataTransfer.getData(VIDEO_MIME);
    endVideoDrag();
    if (!videoId) return;
    e.preventDefault();
    dropVideoOnTab(videoId, target);
  });
}

// Hoofdtab op rij 1. Een video die je erboven houdt, opent na een halve seconde die hoofdtab,
// zodat je hem daarna op een label kunt laten vallen.
function groupTabEl(g, view) {
  const active = view.group === g.id;
  const real = groupById(g.id);
  const el = h(
    'button',
    {
      class: `vtab vgroup${active ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': String(active),
      dataset: { group: g.id },
      title: real ? `${g.name} · dubbelklik om te hernoemen, rechtsklik voor opties` : 'Labels zonder hoofdtab',
      onclick: () => setVideoView(g.id),
    },
    h('span', { class: 'vtab-label' }, g.name),
    h('span', { class: 'vtab-count' }, g.count),
  );
  if (real) {
    el.addEventListener('dblclick', () => renameVideoGroup(real));
    el.addEventListener('contextmenu', (e) => {
      e.preventDefault();
      groupMenu(real, { x: e.clientX, y: e.clientY });
    });
  }
  let timer = 0;
  el.addEventListener('dragenter', (e) => {
    if (active || !e.dataTransfer.types.includes(VIDEO_MIME)) return;
    clearTimeout(timer);
    el.classList.add('drop-target');
    timer = setTimeout(() => setVideoView(g.id), 550);
  });
  el.addEventListener('dragleave', (e) => {
    if (el.contains(e.relatedTarget)) return;
    clearTimeout(timer);
    el.classList.remove('drop-target');
  });
  return el;
}

function inboxTabEl(view, count) {
  const active = view.group === INBOX;
  const el = h(
    'button',
    {
      class: `vtab vinbox${active ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': String(active),
      dataset: { group: INBOX },
      title: 'Video’s zonder label, bijvoorbeeld net opgeslagen met de extensie',
      onclick: () => setVideoView(INBOX),
    },
    icon('inbox', 15),
    h('span', { class: 'vtab-label' }, 'Te sorteren'),
    h('span', { class: 'vtab-count' }, count),
  );
  acceptVideoDrop(el, INBOX);
  return el;
}

function labelPillEl(l, view) {
  const active = view.tab === l.tag;
  const el = h(
    'button',
    {
      class: `vpill${active ? ' active' : ''}`,
      type: 'button',
      role: 'tab',
      'aria-selected': String(active),
      dataset: { tag: l.tag },
      title: `${l.tag} · dubbelklik om te hernoemen, rechtsklik voor opties`,
      onclick: () => setVideoView(view.group, l.tag),
    },
    h('span', { class: 'vtab-label' }, l.tag),
    h('span', { class: 'vtab-count' }, l.count),
  );
  el.addEventListener('dblclick', () => renameVideoTab(l.tag));
  el.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    tabMenu(l.tag, { x: e.clientX, y: e.clientY });
  });
  acceptVideoDrop(el, l.tag);
  return el;
}

// Horizontaal scrollen met het muiswiel, fade aan de randen en het actieve item in beeld.
function scrollStrip(scroller) {
  const updateFade = () => {
    scroller.classList.toggle('fade-end', scroller.scrollLeft + scroller.clientWidth < scroller.scrollWidth - 2);
    scroller.classList.toggle('fade-start', scroller.scrollLeft > 2);
  };
  scroller.addEventListener('scroll', updateFade, { passive: true });
  scroller.addEventListener(
    'wheel',
    (e) => {
      if (scroller.scrollWidth <= scroller.clientWidth || Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return;
      scroller.scrollLeft += e.deltaY;
      e.preventDefault();
    },
    { passive: false },
  );
  requestAnimationFrame(() => {
    const active = scroller.querySelector('.active');
    if (active) {
      const a = active.getBoundingClientRect();
      const s = scroller.getBoundingClientRect();
      if (a.left < s.left + 8) scroller.scrollLeft -= s.left + 40 - a.left;
      else if (a.right > s.right - 8) scroller.scrollLeft += a.right - s.right + 40;
    }
    updateFade();
  });
  return scroller;
}

// Rij 1: hoofdtabs. Herschikken door te slepen (muismodus, zodat het niet botst met video's slepen).
function videoGroupBar(view) {
  const groups = groupTabs();
  const untagged = untaggedCount();
  const real = groups.filter((g) => g.real);
  const other = groups.find((g) => !g.real);
  const list = h('div', { class: 'vtabs-list' }, real.map((g) => groupTabEl(g, view)));
  const scroller = scrollStrip(
    h(
      'div',
      { class: 'vtabs-scroll', role: 'tablist', 'aria-label': 'Hoofdtabs' },
      list,
      other ? groupTabEl(other, view) : null,
      untagged && groups.length ? h('span', { class: 'vtab-sep', 'aria-hidden': 'true' }) : null,
      untagged ? inboxTabEl(view, untagged) : null,
    ),
  );
  const activeGroup = groupById(view.group);
  if (real.length > 1) {
    sortables.push(
      Sortable.create(list, {
        animation: 150,
        forceFallback: true,
        fallbackTolerance: 4,
        delay: 200,
        delayOnTouchOnly: true,
        direction: 'horizontal',
        ghostClass: 'drag-ghost',
        onEnd: (evt) => {
          if (evt.oldIndex !== evt.newIndex) saveGroupOrder([...list.children].map((node) => node.dataset.group));
        },
      }),
    );
  }
  return h(
    'div',
    { class: 'vtabs vgroups' },
    scroller,
    iconButton('plus', 'Nieuwe hoofdtab', addVideoGroup, 'small vtabs-btn'),
    activeGroup ? iconButton('dots', `Opties voor hoofdtab ${activeGroup.name}`, (e) => groupMenu(activeGroup, e.currentTarget), 'small vtabs-btn') : null,
  );
}

// Rij 2: labels binnen de hoofdtab. Herschikken door te slepen; een label op een hoofdtab
// laten vallen verplaatst het naar die hoofdtab.
function videoLabelBar(view) {
  if (view.group === INBOX) {
    return h('p', { class: 'vpills-hint' }, 'Net opgeslagen video’s zonder label. Sleep ze op een label, of kies Labels… in het menu van een video.');
  }
  const labels = labelsIn(view.group);
  const list = h('div', { class: 'vpills-list' }, labels.map((l) => labelPillEl(l, view)));
  const all = h(
    'button',
    { class: `vpill all${view.tab === ALL_IN_GROUP ? ' active' : ''}`, type: 'button', role: 'tab', 'aria-selected': String(view.tab === ALL_IN_GROUP), onclick: () => setVideoView(view.group) },
    h('span', { class: 'vtab-label' }, 'Alles'),
  );
  const scroller = scrollStrip(h('div', { class: 'vpills-scroll', role: 'tablist', 'aria-label': 'Labels' }, all, list));

  if (labels.length) {
    let hover = null;
    const groupUnder = (x, y) => document.elementFromPoint(x, y)?.closest('.vgroup');
    const point = (e) => e?.changedTouches?.[0] ?? e?.touches?.[0] ?? e;
    const track = (e) => {
      const p = point(e);
      const g = p && groupUnder(p.clientX, p.clientY);
      if (g === hover) return;
      hover?.classList.remove('drop-target');
      hover = g && g.dataset.group !== view.group ? g : null;
      hover?.classList.add('drop-target');
    };
    sortables.push(
      Sortable.create(list, {
        animation: 150,
        forceFallback: true,
        fallbackTolerance: 4,
        delay: 200,
        delayOnTouchOnly: true,
        direction: 'horizontal',
        ghostClass: 'drag-ghost',
        onStart: () => {
          document.body.classList.add('dragging-label');
          document.addEventListener('pointermove', track);
          document.addEventListener('touchmove', track, { passive: true });
        },
        onEnd: (evt) => {
          document.body.classList.remove('dragging-label');
          document.removeEventListener('pointermove', track);
          document.removeEventListener('touchmove', track);
          const target = hover?.dataset.group;
          hover?.classList.remove('drop-target');
          hover = null;
          const tag = evt.item.dataset.tag;
          if (!target && evt.oldIndex === evt.newIndex) return;
          if (state.videoTabs === null) {
            tabsUnavailable();
            renderMain();
            return;
          }
          if (target) {
            moveTagToGroup(tag, target);
            return;
          }
          saveLabelOrder(view.group, [...list.children].map((node) => node.dataset.tag));
        },
      }),
    );
  }

  return h(
    'div',
    { class: 'vpills' },
    scroller,
    h('button', { class: 'vpill add', type: 'button', title: 'Nieuw label in deze hoofdtab', onclick: addVideoTab }, icon('plus', 14), h('span', {}, 'Label')),
    isLabel(view.tab) ? iconButton('dots', `Opties voor label ${view.tab}`, (e) => tabMenu(view.tab, e.currentTarget), 'small') : null,
  );
}

function videosView() {
  const wrap = h('div', { class: 'view' });
  const title = h('h1', { class: 'page-title static' }, "Video's");

  if (state.videos === null) {
    wrap.append(
      h('header', { class: 'topbar' }, title),
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-art' }, icon('video', 36)),
        h('h2', {}, 'De video-tabel ontbreekt nog'),
        h('p', {}, 'Voer supabase/migrations/003_videos.sql uit in de Supabase SQL Editor en ververs deze pagina.'),
      ),
    );
    return wrap;
  }
  const view = currentVideoView();
  if (!view.group) {
    wrap.append(
      h('header', { class: 'topbar' }, title),
      h(
        'div',
        { class: 'empty' },
        h('div', { class: 'empty-art' }, icon('video', 36)),
        h('h2', {}, 'Nog geen video’s'),
        h('p', {}, 'Sla een YouTube-video of Short op met de video-knop in de extensie, of plak hieronder een adres.'),
        h('button', { class: 'btn primary', type: 'button', onclick: addVideo }, icon('plus', 16), h('span', {}, 'Video toevoegen')),
      ),
    );
    return wrap;
  }

  view.groupTags = new Set(labelsIn(view.group).map((l) => l.tag));
  const list = filteredVideos(view);
  const shorts = list.filter((v) => v.kind === 'short');
  const videos = list.filter((v) => v.kind === 'video');
  const playlists = list.filter((v) => v.kind === 'playlist');
  // Het filter Playlists verschijnt pas als je er een hebt opgeslagen.
  const hasPlaylists = state.videos.some((v) => v.kind === 'playlist');
  const kindOptions = [
    { value: 'all', label: hasPlaylists ? 'Alle' : 'Beide' },
    { value: 'short', label: 'Shorts' },
    { value: 'video', label: "Video's" },
    ...(hasPlaylists ? [{ value: 'playlist', label: 'Playlists' }] : []),
  ];

  // Rij 1: hoofdtabs. Rij 2: labels, type-filter en toevoegen. De paginanaam staat al in de header.
  wrap.append(
    h(
      'header',
      { class: 'topbar videos-bar' },
      h('h1', { class: 'sr-only' }, "Video's"),
      videoGroupBar(view),
      videoLabelBar(view),
      segmented(kindOptions, kindOptions.some((o) => o.value === videoFilter.kind) ? videoFilter.kind : 'all', (value) => {
        videoFilter.kind = value;
        prefs.set('videoKind', value);
        renderMain();
      }),
      h('button', { class: 'btn primary', type: 'button', title: 'Video toevoegen', onclick: addVideo }, icon('plus', 16), h('span', {}, 'Video')),
    ),
  );

  const section = (heading, group, kind) =>
    group.length
      ? h('section', { class: 'vsection' }, h('h2', {}, `${heading} · ${group.length}`), h('div', { class: `vgrid ${kind}` }, group.map((v) => videoTile(v, group, view))))
      : null;
  let empty = null;
  if (!list.length) {
    const groupName = groupById(view.group)?.name;
    empty = isLabel(view.tab)
      ? h(
          'div',
          { class: 'empty small' },
          h('h2', {}, `Nog geen video’s met “${view.tab}”`),
          h('p', {}, 'Sleep een video op dit label, of kies Labels… in het menu van een video. Een video die je met + toevoegt, kun je meteen dit label geven.'),
        )
      : groupName && !labelsIn(view.group).length
        ? h(
            'div',
            { class: 'empty small' },
            h('h2', {}, `“${groupName}” is nog leeg`),
            h('p', {}, 'Maak een label met + Label, of sleep een bestaand label vanuit een andere hoofdtab op deze hoofdtab.'),
          )
        : h('p', { class: 'search-empty' }, 'Geen video’s met dit filter.');
  }
  wrap.append(h('div', { class: 'videos' }, [section('Playlists', playlists, 'video'), section('Shorts', shorts, 'short'), section("Video's", videos, 'video'), empty]));
  enrichVideos();
  return wrap;
}

function openPlayer(group, startIndex) {
  if (!group.length || startIndex < 0) return;
  let i = startIndex;
  const dlg = h('dialog', { class: 'dialog player-dialog' });
  const frame = h('div', { class: 'player-frame' });
  const titleEl = h('div', { class: 'player-title' });
  const metaEl = h('div', { class: 'player-meta' });
  const ytLink = h('a', { class: 'btn ghost', target: '_blank', rel: 'noopener noreferrer', title: 'Openen op YouTube', 'aria-label': 'Openen op YouTube' }, icon('video', 16), h('span', {}, 'YouTube'));

  const paintInfo = () => {
    const v = group[i];
    dlg.dataset.kind = v.kind;
    titleEl.textContent = v.title;
    metaEl.textContent = [v.kind === 'playlist' ? 'Playlist' : null, v.channel, group.length > 1 ? `${i + 1} van ${group.length}` : null].filter(Boolean).join(' · ');
    ytLink.href = v.url;
  };
  const show = (n) => {
    i = (n + group.length) % group.length;
    const v = group[i];
    frame.replaceChildren(
      h('iframe', {
        src: embedUrl(v),
        title: v.title,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; web-share',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      }),
    );
    paintInfo();
  };
  // Eerst de iframe weghalen: de video stopt dan meteen, ook als het sluit-event pas later komt.
  const stop = () => frame.replaceChildren();
  const closePlayer = () => {
    stop();
    dlg.close();
  };

  const multiple = group.length > 1;
  dlg.append(
    h(
      'div',
      { class: 'player' },
      h(
        'div',
        { class: 'player-head' },
        h('div', { class: 'player-text' }, titleEl, metaEl),
        iconButton('x', 'Sluiten', closePlayer),
      ),
      frame,
      h(
        'div',
        { class: 'player-foot' },
        multiple ? iconButton('chevron-left', 'Vorige', () => show(i - 1)) : null,
        multiple ? iconButton('chevron-right', 'Volgende', () => show(i + 1)) : null,
        h('div', { class: 'spacer' }),
        ytLink,
      ),
    ),
  );
  dlg.addEventListener('keydown', (e) => {
    if (!multiple) return;
    if (e.key === 'ArrowLeft') show(i - 1);
    if (e.key === 'ArrowRight') show(i + 1);
  });
  dlg.addEventListener('click', (e) => {
    if (e.target === dlg) closePlayer();
  });
  dlg.addEventListener('cancel', stop); // Esc
  dlg.addEventListener('close', () => {
    stop();
    dlg.remove(); // verwijdert de iframe, dus de video stopt
    if (currentRoute().name === 'videos') renderMain();
  });
  document.body.append(dlg);
  dlg.showModal();
  show(i);
}

// ---- Zoeken -----------------------------------------------------------------------------------------------------------

function whereIs(b) {
  const card = b.card_id && cardById(b.card_id);
  const page = card ? pageById(card.page_id) : inboxPage();
  return card ? `${page?.title ?? '?'} › ${card.title}` : 'Nieuw';
}

function playFromSearch(video) {
  setTimeout(() => {
    const group = videosByNewest().filter((x) => x.kind === video.kind);
    openPlayer(group, group.findIndex((x) => x.id === video.id));
  }, 0);
}

function openSearch() {
  if (document.querySelector('dialog[open]')) return;
  openDialog(
    null,
    ({ close }) => {
      const input = h('input', { class: 'input search-input', type: 'search', placeholder: 'Zoek in je snelkoppelingen en video’s…', autocomplete: 'off', 'aria-label': 'Zoeken' });
      const list = h('div', { class: 'search-results', role: 'listbox' });
      let results = [];
      let sel = 0;

      const paint = () => {
        list.replaceChildren(
          ...(results.length
            ? results.map((r, i) =>
                r.video
                  ? h(
                      'a',
                      {
                        class: `search-hit${i === sel ? ' selected' : ''}`,
                        role: 'option',
                        href: r.video.url,
                        onclick: (e) => {
                          e.preventDefault();
                          close(true);
                          playFromSearch(r.video);
                        },
                      },
                      videoThumb(r.video) ? h('img', { class: 'hit-thumb', src: videoThumb(r.video), alt: '', loading: 'lazy' }) : h('span', { class: 'hit-thumb' }),
                      h(
                        'span',
                        { class: 'hit-text' },
                        h('span', { class: 'hit-title' }, r.video.title),
                        h('span', { class: 'hit-meta' }, `${r.video.kind === 'playlist' ? 'Playlist' : 'Video’s'} · ${r.video.channel ?? 'YouTube'}`),
                      ),
                    )
                  : h(
                      'a',
                      { class: `search-hit${i === sel ? ' selected' : ''}`, role: 'option', href: safeHref(r.b.url), target: linkTarget(), rel: 'noopener noreferrer', onclick: () => close(true) },
                      faviconEl(r.b.url),
                      h('span', { class: 'hit-text' }, h('span', { class: 'hit-title' }, r.b.title), h('span', { class: 'hit-meta' }, `${whereIs(r.b)} · ${hostOf(r.b.url)}`)),
                    ),
              )
            : [h('p', { class: 'search-empty' }, input.value.trim() ? 'Niets gevonden.' : 'Nog geen snelkoppelingen.')]),
        );
        list.querySelector('.selected')?.scrollIntoView({ block: 'nearest' });
      };

      const run = () => {
        const tokens = input.value.toLowerCase().split(/\s+/).filter(Boolean);
        const all = [
          ...state.bookmarks.map((b) => ({ b, text: `${b.title} ${b.url}`, at: Date.parse(b.created_at) })),
          ...(state.videos ?? []).map((video) => ({ video, text: `${video.title} ${video.channel ?? ''} ${videoTags(video).join(' ')} youtube ${video.kind === 'playlist' ? 'playlist' : 'video'}`, at: Date.parse(video.created_at) })),
        ].sort((x, y) => y.at - x.at);
        results = tokens.length ? all.filter((r) => tokens.every((t) => r.text.toLowerCase().includes(t))) : all;
        results = results.slice(0, 40);
        sel = 0;
        paint();
      };

      input.addEventListener('input', run);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault();
          sel = (sel + (e.key === 'ArrowDown' ? 1 : -1) + results.length) % Math.max(results.length, 1);
          paint();
        }
      });
      run();

      return {
        el: h('div', { class: 'search' }, input, list),
        focus: () => input,
        collect() {
          const hit = results[sel];
          if (hit?.video) playFromSearch(hit.video);
          else if (hit) window.open(safeHref(hit.b.url), linkTarget(), 'noopener');
          return true;
        },
      };
    },
    { footer: false, className: 'search-dialog' },
  );
}

// ---- Inloggen en foutschermen ------------------------------------------------------------------------------------------------

function authCard(children) {
  return h('div', { class: 'auth' }, h('div', { class: 'auth-card' }, h('img', { class: 'auth-logo', src: 'icons/icon-192.png', alt: '', width: 56, height: 56 }), children));
}

function renderSetupNeeded() {
  $root.replaceChildren(
    authCard([
      h('h1', {}, 'Bijna klaar'),
      h('p', { class: 'muted' }, 'Vul je Supabase anon key in bij '),
      h('code', { class: 'secret' }, 'js/config.js'),
      h('p', { class: 'muted' }, 'en laad de pagina opnieuw.'),
    ]),
  );
}

function renderFatal(err) {
  console.error(err);
  const missing = /ensure_user_setup|relation .* does not exist|schema cache|PGRST/i.test(err.message || '');
  $root.replaceChildren(
    authCard([
      h('h1', {}, 'Er ging iets mis'),
      h('p', { class: 'muted' }, missing ? 'De database is nog niet ingericht. Voer supabase/schema.sql uit in de Supabase SQL Editor en laad de pagina opnieuw.' : err.message || String(err)),
      h('div', { class: 'row center' },
        h('button', { class: 'btn primary', type: 'button', onclick: () => location.reload() }, 'Opnieuw proberen'),
        h('button', { class: 'btn ghost', type: 'button', onclick: logout }, 'Uitloggen'),
      ),
    ]),
  );
}

function renderLogin() {
  let signup = false;
  const form = h('form', { class: 'fields', novalidate: true });
  const email = h('input', { class: 'input', type: 'email', autocomplete: 'username', required: true });
  const password = h('input', { class: 'input', type: 'password', autocomplete: 'current-password', required: true, minlength: 6 });
  const error = h('div', { class: 'form-error', role: 'alert' });
  const submit = h('button', { class: 'btn primary wide', type: 'submit' }, 'Inloggen');
  const toggle = h('button', { class: 'link-btn', type: 'button' });
  const title = h('h1', {}, 'Inloggen');

  const paint = () => {
    title.textContent = signup ? 'Account aanmaken' : 'Inloggen';
    submit.textContent = signup ? 'Registreren' : 'Inloggen';
    toggle.textContent = signup ? 'Heb je al een account? Inloggen' : 'Nog geen account? Registreren';
    password.autocomplete = signup ? 'new-password' : 'current-password';
    error.textContent = '';
  };
  toggle.addEventListener('click', () => {
    signup = !signup;
    paint();
  });

  form.append(
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'E-mailadres'), email),
    h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Wachtwoord'), password),
    error,
    submit,
    toggle,
  );
  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    error.textContent = '';
    if (!email.value.trim() || password.value.length < 6) {
      error.textContent = 'Vul een e-mailadres en een wachtwoord van minimaal 6 tekens in.';
      return;
    }
    submit.disabled = true;
    try {
      if (signup) {
        const { session } = await api.signUp(email.value.trim(), password.value);
        if (!session) {
          error.textContent = 'Account aangemaakt. Bevestig je e-mailadres via de mail en log daarna in.';
          signup = false;
          submit.disabled = false;
          return;
        }
      } else {
        await api.signIn(email.value.trim(), password.value);
      }
      await startApp();
    } catch (err) {
      error.textContent = /invalid login/i.test(err.message) ? 'Onjuist e-mailadres of wachtwoord.' : err.message;
      submit.disabled = false;
    }
  });

  $root.replaceChildren(authCard([title, form]));
  paint();
  email.focus();
}

// ---- Delen vanaf telefoon (PWA share target) en realtime ----------------------------------------------------------------------------

async function handleShareTarget() {
  const params = new URLSearchParams(location.search);
  if (!params.has('url') && !params.has('text')) return;
  const found = normalizeUrl(params.get('url') || '') || (params.get('text') || '').match(/https?:\/\/\S+/)?.[0];
  history.replaceState(null, '', location.pathname + location.hash);
  const url = found && normalizeUrl(found);
  if (!url) return;
  try {
    const row = await api.insertBookmark({ card_id: null, url, title: params.get('title') || hostOf(url), position: 0 });
    state.bookmarks.push(row);
    go(`#/p/${inboxPage().id}`);
    renderAll();
    toast('Toegevoegd aan Nieuw');
  } catch (err) {
    toast(`Toevoegen mislukt: ${err.message}`, { error: true });
  }
}

function onRemoteBookmark(row) {
  if (state.bookmarks.some((b) => b.id === row.id)) return;
  state.bookmarks.push(row);
  renderHeader();
  const route = currentRoute();
  if (route.name === 'page' && route.page?.is_inbox && !document.querySelector('dialog[open]')) renderMain();
  toast(`Nieuw in inbox: ${row.title}`);
}

function onRemoteVideo(row) {
  if (!state.videos || state.videos.some((v) => v.id === row.id)) return;
  state.videos.push(row);
  renderHeader();
  if (currentRoute().name === 'videos' && !document.querySelector('dialog[open]')) renderMain();
  toast(`${row.kind === 'playlist' ? 'Nieuwe playlist' : 'Nieuwe video'}: ${row.title}`);
}

// ---- Start ------------------------------------------------------------------------------------------------------------------------------

async function startApp() {
  $root.replaceChildren(h('div', { class: 'splash' }, icon('bookmark', 32)));
  try {
    await api.ensureSetup();
    Object.assign(state, await api.loadAll());
    state.email = await api.currentEmail();
  } catch (err) {
    renderFatal(err);
    return;
  }
  state.loaded = true;
  lastLoad = Date.now();
  buildShell();
  renderAll();
  unsubscribe?.();
  const unsubs = [api.subscribeBookmarks(onRemoteBookmark)];
  if (state.videos) unsubs.push(api.subscribeVideos(onRemoteVideo));
  unsubscribe = () => unsubs.forEach((fn) => fn());
  handleShareTarget();
}

function teardown() {
  unsubscribe?.();
  unsubscribe = null;
  destroySortables();
  navSortable?.destroy();
  Object.assign(state, { pages: [], cards: [], bookmarks: [], videos: null, videoTabs: null, videoGroups: null, settings: null, email: '', loaded: false });
  renderLogin();
}

function isTyping() {
  const el = document.activeElement;
  return el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable);
}

addEventListener('hashchange', () => {
  if (!state.loaded) return;
  renderAll();
});

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && state.loaded && Date.now() - lastLoad > 30000 && !document.querySelector('dialog[open]') && !isTyping()) {
    reload();
  }
});

document.addEventListener('keydown', (e) => {
  if (!state.loaded) return;
  const k = e.key.toLowerCase();
  if ((k === 'k' && (e.ctrlKey || e.metaKey)) || (e.key === '/' && !isTyping() && !e.ctrlKey && !e.metaKey)) {
    e.preventDefault();
    openSearch();
  }
});

applyTheme();
if ('serviceWorker' in navigator) {
  addEventListener('load', () => navigator.serviceWorker.register('./sw.js').catch(() => {}));
}

(async function boot() {
  if (!api.isConfigured) return renderSetupNeeded();
  api.onSignedOut(teardown);
  try {
    (await api.getSession()) ? await startApp() : renderLogin();
  } catch (err) {
    renderFatal(err);
  }
})();
