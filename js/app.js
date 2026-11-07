import * as api from './api.js';
import { h, icon, showMenu, showPopover, closeMenu, openDialog, fieldsBody, confirmDialog, toast } from './ui.js';
import { parseBookmarksHtml } from './importer.js';
import { WIDGETS } from './widgets.js';
import { parseYouTube, thumbUrl, embedUrl, fetchOEmbed } from './videos.js';

const VIEWS = [
  { value: 'list', label: 'Lijst' },
  { value: 'icons-s', label: 'Iconen S' },
  { value: 'icons-m', label: 'Iconen M' },
  { value: 'icons-l', label: 'Iconen L' },
];
const MAX_COLUMNS = 6;

const state = { pages: [], cards: [], bookmarks: [], videos: null, settings: null, email: '', loaded: false };
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
  const menu = h(
    'div',
    { class: 'pages-menu', role: 'menu', 'aria-label': "Pagina's" },
    filter,
    inbox ? pageItem(inbox, route, count ? h('span', { class: 'badge' }, count > 99 ? '99+' : count) : null) : null,
    inbox && pages.length ? sep() : null,
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
  const inInbox = onPage && route.page.is_inbox;

  const pagesBtn = h(
    'button',
    {
      class: `tab pages-btn${onPage ? ' active' : ''}`,
      type: 'button',
      'aria-haspopup': 'menu',
      'aria-label': onPage ? `Pagina: ${route.page.title}. Pagina kiezen` : "Pagina kiezen",
      onclick: (e) => {
        if (performance.now() - pagesMenuClosedAt < 200) return; // klik die het menu zojuist sloot
        openPagesMenu(e.currentTarget);
      },
    },
    icon(inInbox ? 'inbox' : 'page', 16),
    h('span', { class: 'tab-label' }, onPage ? route.page.title : "Pagina's"),
    count && !inInbox ? h('span', { class: 'badge', title: `${count} nieuw in Nieuw` }, count > 99 ? '99+' : count) : null,
    icon('chevron-down', 16),
  );
  const videosTab = h(
    'a',
    { class: `tab${route.name === 'videos' ? ' active' : ''}`, href: '#/videos', 'aria-current': route.name === 'videos' ? 'page' : null },
    icon('video', 16),
    h('span', { class: 'tab-label' }, "Video's"),
  );

  el.replaceChildren(
    h('a', { class: 'brand', href: '#/', title: 'Bookmarks' }, h('img', { class: 'brand-logo', src: 'icons/icon-192.png', alt: '', width: 32, height: 32, draggable: 'false' }), h('span', { class: 'brand-name' }, 'Bookmarks')),
    h('nav', { class: 'header-nav', 'aria-label': 'Navigatie' }, pagesBtn, videosTab),
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

function headingCardEl(card) {
  const title = h('h2', { class: 'heading-title', title: 'Dubbelklik om de naam te wijzigen' }, card.title);
  title.addEventListener('dblclick', () => renameCard(card));
  return h(
    'article',
    { class: 'card heading-card', dataset: { id: card.id } },
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

const videoFilter = { kind: prefs.get('videoKind', 'all'), status: prefs.get('videoStatus', 'all') };
const enrichTried = new Set();

const videosByNewest = () => [...(state.videos ?? [])].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));

function filteredVideos() {
  return videosByNewest().filter(
    (v) => (videoFilter.kind === 'all' || v.kind === videoFilter.kind) && (videoFilter.status === 'all' || (videoFilter.status === 'watched') === !!v.watched),
  );
}

function videoTile(v, group) {
  const tile = h(
    'div',
    { class: `vtile ${v.kind}${v.watched ? ' watched' : ''}`, dataset: { id: v.id } },
    h(
      'button',
      { class: 'vtile-main', type: 'button', 'aria-label': `Afspelen: ${v.title}`, onclick: () => openPlayer(group, group.indexOf(v)) },
      h(
        'span',
        { class: 'vthumb' },
        h('img', { src: thumbUrl(v.video_id), alt: '', loading: 'lazy', draggable: 'false' }),
        h('span', { class: 'vplay' }, icon('play', 22)),
        v.watched ? h('span', { class: 'vseen', title: 'Bekeken' }, icon('check', 14)) : null,
      ),
      h('span', { class: 'vtitle' }, v.title),
      v.channel ? h('span', { class: 'vchannel' }, v.channel) : null,
    ),
    h('button', { class: 'icon-btn vmenu', type: 'button', 'aria-label': `Opties voor ${v.title}`, onclick: (e) => videoMenu(v, e.currentTarget) }, icon('dots', 16)),
  );
  tile.addEventListener('contextmenu', (e) => {
    e.preventDefault();
    videoMenu(v, { x: e.clientX, y: e.clientY });
  });
  return tile;
}

function videoMenu(v, anchor) {
  const group = videosByNewest().filter((x) => x.kind === v.kind);
  showMenu(anchor, [
    { label: 'Afspelen', icon: 'play', onClick: () => openPlayer(group, group.indexOf(v)) },
    { label: 'Openen op YouTube', icon: 'video', onClick: () => window.open(v.url, '_blank', 'noopener') },
    { label: v.watched ? 'Markeren als niet bekeken' : 'Markeren als bekeken', icon: 'check', onClick: () => toggleWatched(v) },
    '-',
    { label: 'Titel wijzigen', icon: 'pencil', onClick: () => editVideo(v) },
    { label: 'Adres kopiëren', icon: 'copy', onClick: () => copyText(v.url, 'Adres gekopieerd') },
    '-',
    { label: 'Verwijderen', icon: 'trash', danger: true, onClick: () => deleteVideo(v) },
  ]);
}

function toggleWatched(v) {
  v.watched = !v.watched;
  persist(api.patchVideo(v.id, { watched: v.watched }));
  if (currentRoute().name === 'videos' && !document.querySelector('dialog[open]')) renderMain();
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
          const { id, video_id, kind, url, title, channel, watched, created_at } = v;
          state.videos.push(await api.insertVideo({ id, video_id, kind, url, title, channel, watched, created_at }));
          renderMain();
        } catch (err) {
          toast(`Terugzetten mislukt: ${err.message}`, { error: true });
        }
      },
    },
  });
}

async function addVideo() {
  const r = await openDialog(
    'Video toevoegen',
    fieldsBody([
      {
        name: 'url',
        label: 'YouTube-adres',
        required: true,
        placeholder: 'https://www.youtube.com/shorts/…',
        inputmode: 'url',
        validate: (v) => (parseYouTube(v) ? null : 'Dit is geen YouTube-video of Short.'),
      },
    ]),
    { submit: 'Toevoegen' },
  );
  if (!r) return;
  const p = parseYouTube(r.url);
  if (state.videos.some((v) => v.video_id === p.id)) {
    toast('Deze video staat er al in.');
    return;
  }
  const info = await fetchOEmbed(p.id);
  try {
    const row = await api.insertVideo({
      video_id: p.id,
      kind: info?.portrait ? 'short' : p.kind,
      url: p.url,
      title: info?.title || 'YouTube-video',
      channel: info?.channel ?? null,
    });
    state.videos.push(row);
    renderAll();
    toast('Video toegevoegd');
  } catch (err) {
    toast(`Toevoegen mislukt: ${err.message}`, { error: true });
  }
}

// Haalt kanaalnaam (en zo nodig titel/type) op bij YouTube voor video's die de extensie zonder die gegevens opsloeg.
async function enrichVideos() {
  const queue = (state.videos ?? []).filter((v) => !v.channel && !enrichTried.has(v.id));
  if (!queue.length) return;
  queue.forEach((v) => enrichTried.add(v.id));
  let changed = false;
  const worker = async () => {
    for (let v = queue.shift(); v; v = queue.shift()) {
      const info = await fetchOEmbed(v.video_id);
      if (!info) continue;
      const patch = { channel: info.channel };
      if (info.title && (!v.title || v.title === 'YouTube-video')) patch.title = info.title;
      if (info.portrait && v.kind === 'video') patch.kind = 'short';
      Object.assign(v, patch);
      changed = true;
      api.patchVideo(v.id, patch).catch(() => {});
    }
  };
  await Promise.all([worker(), worker(), worker()]);
  if (changed && currentRoute().name === 'videos' && !document.querySelector('dialog[open]') && !isTyping()) renderMain();
}

function videosView() {
  const controls = state.videos
    ? h('button', { class: 'btn primary', type: 'button', onclick: addVideo }, icon('plus', 16), h('span', {}, 'Video'))
    : null;
  const wrap = h('div', { class: 'view' }, topbar({ title: "Video's", controls }));

  if (state.videos === null) {
    wrap.append(
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
  if (!state.videos.length) {
    wrap.append(
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

  const list = filteredVideos();
  const shorts = list.filter((v) => v.kind === 'short');
  const videos = list.filter((v) => v.kind === 'video');
  const filters = h(
    'div',
    { class: 'vfilters' },
    segmented([{ value: 'all', label: 'Alles' }, { value: 'short', label: 'Shorts' }, { value: 'video', label: "Video's" }], videoFilter.kind, (value) => {
      videoFilter.kind = value;
      prefs.set('videoKind', value);
      renderMain();
    }),
    segmented([{ value: 'all', label: 'Alle' }, { value: 'todo', label: 'Te kijken' }, { value: 'watched', label: 'Bekeken' }], videoFilter.status, (value) => {
      videoFilter.status = value;
      prefs.set('videoStatus', value);
      renderMain();
    }),
    h('span', { class: 'muted vcount' }, `${list.length} van ${state.videos.length}`),
  );
  const body = h('div', { class: 'videos' }, filters);
  const section = (title, group, kind) =>
    group.length
      ? h('section', { class: 'vsection' }, h('h2', {}, `${title} · ${group.length}`), h('div', { class: `vgrid ${kind}` }, group.map((v) => videoTile(v, group))))
      : null;
  body.append(section('Shorts', shorts, 'short'), section("Video's", videos, 'video'));
  if (!list.length) body.append(h('p', { class: 'search-empty' }, 'Geen video’s met dit filter.'));
  wrap.append(body);
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
  const seenBtn = h('button', { class: 'btn', type: 'button' });
  const ytLink = h('a', { class: 'btn ghost', target: '_blank', rel: 'noopener noreferrer', title: 'Openen op YouTube', 'aria-label': 'Openen op YouTube' }, icon('video', 16), h('span', {}, 'YouTube'));

  const paintInfo = () => {
    const v = group[i];
    dlg.dataset.kind = v.kind;
    titleEl.textContent = v.title;
    metaEl.textContent = [v.channel, `${i + 1} van ${group.length}`].filter(Boolean).join(' · ');
    seenBtn.replaceChildren(icon('check', 16), h('span', {}, v.watched ? 'Bekeken' : 'Markeer als bekeken'));
    seenBtn.classList.toggle('on', !!v.watched);
    const label = v.watched ? 'Bekeken (klik om te wissen)' : 'Markeer als bekeken';
    seenBtn.title = label;
    seenBtn.setAttribute('aria-label', label);
    ytLink.href = v.url;
  };
  const show = (n) => {
    i = (n + group.length) % group.length;
    const v = group[i];
    frame.replaceChildren(
      h('iframe', {
        src: embedUrl(v.video_id),
        title: v.title,
        allow: 'autoplay; encrypted-media; picture-in-picture; fullscreen; web-share',
        allowfullscreen: true,
        referrerpolicy: 'strict-origin-when-cross-origin',
      }),
    );
    paintInfo();
  };
  seenBtn.addEventListener('click', () => {
    const v = group[i];
    v.watched = !v.watched;
    persist(api.patchVideo(v.id, { watched: v.watched }));
    paintInfo();
  });

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
        seenBtn,
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
                      h('img', { class: 'hit-thumb', src: thumbUrl(r.video.video_id), alt: '', loading: 'lazy' }),
                      h('span', { class: 'hit-text' }, h('span', { class: 'hit-title' }, r.video.title), h('span', { class: 'hit-meta' }, `Video’s · ${r.video.channel ?? 'YouTube'}`)),
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
          ...(state.videos ?? []).map((video) => ({ video, text: `${video.title} ${video.channel ?? ''} youtube video`, at: Date.parse(video.created_at) })),
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
  toast(`Nieuwe video: ${row.title}`);
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
  Object.assign(state, { pages: [], cards: [], bookmarks: [], videos: null, settings: null, email: '', loaded: false });
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
