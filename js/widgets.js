// Widgets: cards met een type in plaats van een lijst links.
// Elke widget heeft: label, icon, hint, title (standaardnaam), defaults (config),
// render(card, ctx) -> { el, destroy }, en optioneel configure(config, { title }) ->
// { config, title?, softTitle? } | null.
//   ctx.saveConfig(delayMs)  bewaart card.config (kan na het wijzigen aangeroepen worden)
//   ctx.linkTarget           '_blank' | '_self'

import { h, openDialog, fieldsBody } from './ui.js';

const SVGNS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => {
  const el = document.createElementNS(SVGNS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.append(...kids);
  return el;
};

const yesNo = [
  { value: 'yes', label: 'Aan' },
  { value: 'no', label: 'Uit' },
];

const timeZones = () => {
  try {
    return Intl.supportedValuesOf('timeZone');
  } catch {
    return ['Europe/Amsterdam', 'Europe/London', 'America/New_York', 'America/Los_Angeles', 'Asia/Tokyo', 'Australia/Sydney', 'UTC'];
  }
};

// Geeft undefined (lokale tijd) of een geldige IANA-tijdzone.
function zoneOf(tz) {
  if (!tz || tz === 'local') return undefined;
  try {
    new Intl.DateTimeFormat('nl-NL', { timeZone: tz });
    return tz;
  } catch {
    return undefined;
  }
}

// ---- Klok -------------------------------------------------------------------------------

function renderClock(card) {
  const cfg = { ...clock.defaults, ...card.config };
  const zone = zoneOf(cfg.tz);
  const hourOpts = cfg.h24 ? { hourCycle: 'h23' } : { hour12: true };
  const timeFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: zone, hour: '2-digit', minute: '2-digit', second: cfg.seconds ? '2-digit' : undefined, ...hourOpts });
  const dateFmt = new Intl.DateTimeFormat('nl-NL', { timeZone: zone, weekday: 'long', day: 'numeric', month: 'long' });
  const partsFmt = new Intl.DateTimeFormat('en-GB', { timeZone: zone, hour: 'numeric', minute: 'numeric', second: 'numeric', hourCycle: 'h23' });
  const parts = (d) => Object.fromEntries(partsFmt.formatToParts(d).map((p) => [p.type, Number(p.value)]));

  const dateEl = cfg.date ? h('div', { class: 'w-clock-date' }) : null;
  let update;
  let face;

  if (cfg.mode === 'analog') {
    const ticks = Array.from({ length: 12 }, (_, i) =>
      svg('line', { x1: 50, y1: i % 3 === 0 ? 7 : 9, x2: 50, y2: 12, class: i % 3 === 0 ? 'tick major' : 'tick', transform: `rotate(${i * 30} 50 50)` }),
    );
    const hour = svg('line', { x1: 50, y1: 50, x2: 50, y2: 28, class: 'hand hour' });
    const minute = svg('line', { x1: 50, y1: 50, x2: 50, y2: 15, class: 'hand minute' });
    const second = cfg.seconds ? svg('line', { x1: 50, y1: 56, x2: 50, y2: 12, class: 'hand second' }) : null;
    face = h(
      'div',
      { class: 'w-clock-analog' },
      svg('svg', { viewBox: '0 0 100 100', role: 'img', 'aria-label': 'Analoge klok' }, svg('circle', { cx: 50, cy: 50, r: 48, class: 'face' }), ...ticks, hour, minute, second ?? '', svg('circle', { cx: 50, cy: 50, r: 2.5, class: 'pin' })),
    );
    update = (now) => {
      const p = parts(now);
      hour.setAttribute('transform', `rotate(${((p.hour % 12) + p.minute / 60) * 30} 50 50)`);
      minute.setAttribute('transform', `rotate(${(p.minute + p.second / 60) * 6} 50 50)`);
      second?.setAttribute('transform', `rotate(${p.second * 6} 50 50)`);
      face.setAttribute('aria-label', timeFmt.format(now));
    };
  } else {
    face = h('div', { class: 'w-clock-digital' });
    update = (now) => {
      face.textContent = timeFmt.format(now);
    };
  }

  const tick = () => {
    const now = new Date();
    update(now);
    if (dateEl) dateEl.textContent = dateFmt.format(now);
  };
  tick();
  const timer = setInterval(tick, 1000);
  const label = zone && zone !== Intl.DateTimeFormat().resolvedOptions().timeZone ? h('div', { class: 'w-sub' }, zone.split('/').pop().replace(/_/g, ' ')) : null;

  return { el: h('div', { class: 'w-clock' }, face, dateEl, label), destroy: () => clearInterval(timer) };
}

const clock = {
  label: 'Klok',
  icon: 'clock',
  hint: 'Analoog of digitaal',
  title: 'Klok',
  defaults: { mode: 'digital', tz: 'local', h24: true, seconds: true, date: true },
  render: renderClock,
  async configure(cfg) {
    const zones = [{ value: 'local', label: 'Lokale tijd' }, ...timeZones().map((z) => ({ value: z, label: z.replace(/_/g, ' ') }))];
    const r = await openDialog(
      'Klok instellen',
      fieldsBody([
        { name: 'mode', label: 'Type', type: 'segmented', value: cfg.mode, options: [{ value: 'digital', label: 'Digitaal' }, { value: 'analog', label: 'Analoog' }] },
        { name: 'tz', label: 'Tijdzone', type: 'select', value: cfg.tz, options: zones },
        { name: 'h24', label: 'Uren', type: 'segmented', value: cfg.h24 ? '24' : '12', options: [{ value: '24', label: '24-uurs' }, { value: '12', label: '12-uurs (am/pm)' }] },
        { name: 'seconds', label: 'Seconden', type: 'segmented', value: cfg.seconds ? 'yes' : 'no', options: yesNo },
        { name: 'date', label: 'Datum tonen', type: 'segmented', value: cfg.date ? 'yes' : 'no', options: yesNo },
      ]),
    );
    if (!r) return null;
    return {
      config: { mode: r.mode, tz: r.tz, h24: r.h24 === '24', seconds: r.seconds === 'yes', date: r.date === 'yes' },
      softTitle: r.tz === 'local' ? 'Klok' : r.tz.split('/').pop().replace(/_/g, ' '),
    };
  },
};

// ---- Weer (Open-Meteo, geen sleutel nodig) -------------------------------------------------------

const WMO = {
  0: ['Helder', '☀️', '🌙'],
  1: ['Overwegend helder', '🌤️', '🌙'],
  2: ['Half bewolkt', '⛅', '☁️'],
  3: ['Bewolkt', '☁️'],
  45: ['Mist', '🌫️'],
  48: ['Rijpmist', '🌫️'],
  51: ['Lichte motregen', '🌦️'],
  53: ['Motregen', '🌦️'],
  55: ['Zware motregen', '🌧️'],
  56: ['IJzel', '🌧️'],
  57: ['Zware ijzel', '🌧️'],
  61: ['Lichte regen', '🌧️'],
  63: ['Regen', '🌧️'],
  65: ['Zware regen', '🌧️'],
  66: ['Ijsregen', '🌧️'],
  67: ['Zware ijsregen', '🌧️'],
  71: ['Lichte sneeuw', '🌨️'],
  73: ['Sneeuw', '🌨️'],
  75: ['Zware sneeuw', '❄️'],
  77: ['Sneeuwkorrels', '🌨️'],
  80: ['Lichte buien', '🌦️'],
  81: ['Buien', '🌧️'],
  82: ['Zware buien', '⛈️'],
  85: ['Sneeuwbuien', '🌨️'],
  86: ['Zware sneeuwbuien', '❄️'],
  95: ['Onweer', '⛈️'],
  96: ['Onweer met hagel', '⛈️'],
  99: ['Zwaar onweer met hagel', '⛈️'],
};
const wmo = (code, isDay = 1) => {
  const [text, day, night] = WMO[code] ?? ['Onbekend', '❔'];
  return { text, emoji: isDay ? day : (night ?? day) };
};

const weatherCache = new Map(); // `${lat},${lon}` -> { t, data }
const WEATHER_TTL = 10 * 60 * 1000;

async function fetchWeather(lat, lon) {
  const key = `${lat},${lon}`;
  const hit = weatherCache.get(key);
  if (hit && Date.now() - hit.t < WEATHER_TTL) return hit.data;
  const url =
    'https://api.open-meteo.com/v1/forecast' +
    `?latitude=${lat}&longitude=${lon}` +
    '&current=temperature_2m,apparent_temperature,weather_code,wind_speed_10m,is_day' +
    '&daily=weather_code,temperature_2m_max,temperature_2m_min,precipitation_probability_max' +
    '&timezone=auto&forecast_days=5';
  const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`Weerdienst gaf status ${res.status}`);
  const data = await res.json();
  weatherCache.set(key, { t: Date.now(), data });
  return data;
}

function renderWeather(card) {
  const cfg = { ...weather.defaults, ...card.config };
  const box = h('div', { class: 'w-weather' });
  let alive = true;

  if (cfg.lat == null) {
    box.append(h('p', { class: 'muted' }, 'Kies een plaats via Instellingen in het menu.'));
    return { el: box, destroy() {} };
  }

  const weekday = new Intl.DateTimeFormat('nl-NL', { weekday: 'short' });
  const draw = (d) => {
    const c = d.current;
    const now = wmo(c.weather_code, c.is_day);
    const days = d.daily.time.map((t, i) => {
      const w = wmo(d.daily.weather_code[i]);
      return h(
        'div',
        { class: 'w-day', title: w.text },
        h('span', { class: 'w-day-name' }, i === 0 ? 'Vandaag' : weekday.format(new Date(`${t}T12:00`))),
        h('span', { class: 'w-day-icon' }, w.emoji),
        h('span', { class: 'w-day-temp' }, `${Math.round(d.daily.temperature_2m_max[i])}°`, h('span', { class: 'low' }, ` ${Math.round(d.daily.temperature_2m_min[i])}°`)),
      );
    });
    box.replaceChildren(
      h(
        'div',
        { class: 'w-now' },
        h('span', { class: 'w-emoji', 'aria-hidden': 'true' }, now.emoji),
        h('div', {}, h('div', { class: 'w-temp' }, `${Math.round(c.temperature_2m)}°`), h('div', { class: 'w-cond' }, now.text)),
      ),
      h(
        'div',
        { class: 'w-meta' },
        h('span', {}, `Gevoel ${Math.round(c.apparent_temperature)}°`),
        h('span', {}, `Wind ${Math.round(c.wind_speed_10m)} km/u`),
        h('span', {}, `Regen ${d.daily.precipitation_probability_max[0] ?? 0}%`),
      ),
      h('div', { class: 'w-days' }, days),
    );
  };

  const load = async () => {
    try {
      const data = await fetchWeather(cfg.lat, cfg.lon);
      if (alive) draw(data);
    } catch (err) {
      if (!alive) return;
      box.replaceChildren(
        h('p', { class: 'muted' }, 'Het weer kon niet worden opgehaald.'),
        h('button', { class: 'btn', type: 'button', onclick: load }, 'Opnieuw proberen'),
      );
    }
  };
  box.append(h('p', { class: 'muted' }, 'Weer laden…'));
  load();
  const timer = setInterval(load, WEATHER_TTL + 5000);
  return { el: box, destroy: () => ((alive = false), clearInterval(timer)) };
}

const weather = {
  label: 'Weer',
  icon: 'cloud',
  hint: 'Nu en de komende dagen',
  title: 'Weer',
  defaults: { city: '', lat: null, lon: null },
  render: renderWeather,
  configure(cfg) {
    return openDialog('Weer instellen', () => {
      const input = h('input', { class: 'input', type: 'text', placeholder: 'Plaatsnaam, bijvoorbeeld Utrecht', value: cfg.city || '', autocomplete: 'off', 'aria-label': 'Plaats' });
      const select = h('select', { class: 'input', 'aria-label': 'Gevonden plaatsen', hidden: true });
      const status = h('div', { class: 'field-hint' }, cfg.city ? `Huidige plaats: ${cfg.city}` : 'Zoek een plaats en kies hem uit de lijst.');
      let found = [];

      const search = async () => {
        const q = input.value.trim();
        if (!q) return;
        status.className = 'field-hint';
        status.textContent = 'Zoeken…';
        try {
          const res = await fetch(`https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=5&language=nl&format=json`, { signal: AbortSignal.timeout(8000) });
          found = (await res.json()).results ?? [];
        } catch {
          found = [];
          status.className = 'field-error';
          status.textContent = 'Zoeken is niet gelukt. Controleer je verbinding.';
          return;
        }
        select.replaceChildren(...found.map((r, i) => h('option', { value: i }, [r.name, r.admin1, r.country].filter(Boolean).join(', '))));
        select.hidden = !found.length;
        status.className = found.length ? 'field-hint' : 'field-error';
        status.textContent = found.length ? 'Kies de juiste plaats en klik op Opslaan.' : 'Geen plaats gevonden.';
      };
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          search();
        }
      });

      return {
        el: h('div', { class: 'fields' }, h('label', { class: 'field' }, h('span', { class: 'field-label' }, 'Plaats'), h('div', { class: 'row' }, input, h('button', { class: 'btn', type: 'button', onclick: search }, 'Zoeken')), select, status)),
        focus: () => input,
        collect() {
          const r = !select.hidden && found[Number(select.value)];
          if (r) return { config: { city: r.name, lat: r.latitude, lon: r.longitude }, softTitle: r.name };
          if (cfg.lat != null && input.value.trim() === cfg.city) return { config: cfg };
          status.className = 'field-error';
          status.textContent = 'Zoek eerst een plaats en kies hem uit de lijst.';
          return undefined;
        },
      };
    });
  },
};

// ---- Aftellen ---------------------------------------------------------------------------------------

function renderCountdown(card) {
  const cfg = { ...countdown.defaults, ...card.config };
  const target = cfg.target ? new Date(cfg.target) : null;
  if (!target || Number.isNaN(target.getTime())) {
    return { el: h('p', { class: 'muted' }, 'Kies een datum via Instellingen in het menu.'), destroy() {} };
  }
  const tile = (label) => {
    const num = h('span', { class: 'num' }, '0');
    return { num, el: h('div', { class: 'w-tile' }, num, h('span', { class: 'unit' }, label)) };
  };
  const d = tile('dagen');
  const hh = tile('uur');
  const m = tile('min');
  const s = tile('sec');
  const status = h('div', { class: 'w-sub' });
  const hasTime = target.getHours() || target.getMinutes();
  const when = target.toLocaleString('nl-NL', hasTime ? { dateStyle: 'long', timeStyle: 'short' } : { dateStyle: 'long' });

  const tick = () => {
    let diff = target - Date.now();
    const past = diff <= 0;
    diff = Math.abs(diff);
    d.num.textContent = Math.floor(diff / 86400000);
    hh.num.textContent = String(Math.floor(diff / 3600000) % 24).padStart(2, '0');
    m.num.textContent = String(Math.floor(diff / 60000) % 60).padStart(2, '0');
    s.num.textContent = String(Math.floor(diff / 1000) % 60).padStart(2, '0');
    status.textContent = `${past ? 'Geleden sinds' : 'Tot'} ${when}`;
  };
  tick();
  const timer = setInterval(tick, 1000);
  return { el: h('div', { class: 'w-countdown' }, h('div', { class: 'w-tiles' }, d.el, hh.el, m.el, s.el), status), destroy: () => clearInterval(timer) };
}

const pad = (n) => String(n).padStart(2, '0');

const countdown = {
  label: 'Aftellen',
  icon: 'hourglass',
  hint: 'Naar een datum toe',
  title: 'Aftellen',
  defaults: { target: '' },
  render: renderCountdown,
  async configure(cfg, { title } = {}) {
    const t = cfg.target ? new Date(cfg.target) : null;
    const valid = t && !Number.isNaN(t.getTime());
    const r = await openDialog(
      'Aftellen instellen',
      fieldsBody([
        { name: 'title', label: 'Waar tel je naartoe af?', value: title && title !== 'Aftellen' ? title : '', placeholder: 'Bijvoorbeeld Vakantie', required: true, maxlength: 100 },
        { name: 'date', label: 'Datum', type: 'date', value: valid ? `${t.getFullYear()}-${pad(t.getMonth() + 1)}-${pad(t.getDate())}` : '', required: true },
        { name: 'time', label: 'Tijd', type: 'time', value: valid ? `${pad(t.getHours())}:${pad(t.getMinutes())}` : '00:00' },
      ]),
    );
    if (!r) return null;
    return { config: { target: `${r.date}T${r.time || '00:00'}` }, title: r.title };
  },
};

// ---- Notitie ------------------------------------------------------------------------------------------

function renderNote(card, ctx) {
  const area = h('textarea', { class: 'w-note', placeholder: 'Schrijf hier je notitie…', 'aria-label': 'Notitie', spellcheck: 'true' });
  area.value = card.config?.text ?? '';
  const fit = () => {
    area.style.height = 'auto';
    area.style.height = `${Math.max(120, area.scrollHeight + 2)}px`;
  };
  area.addEventListener('input', () => {
    card.config = { ...card.config, text: area.value };
    fit();
    ctx.saveConfig(700);
  });
  area.addEventListener('blur', () => ctx.saveConfig(0));
  requestAnimationFrame(fit);
  return { el: area, destroy() {} };
}

const note = {
  label: 'Notitie',
  icon: 'note',
  hint: 'Vrij tekstvlak',
  title: 'Notitie',
  defaults: { text: '' },
  render: renderNote,
};

// ---- Taken ----------------------------------------------------------------------------------------------

function renderTodo(card, ctx) {
  const items = () => (card.config.items ??= []);
  if (!card.config) card.config = { items: [] };
  const list = h('ul', { class: 'w-todo' });
  const footer = h('div', { class: 'w-todo-foot' });
  const save = () => ctx.saveConfig(300);

  const paint = () => {
    list.replaceChildren(
      ...items().map((it) =>
        h(
          'li',
          { class: it.done ? 'done' : '' },
          h('input', {
            type: 'checkbox',
            checked: !!it.done,
            'aria-label': it.text,
            onchange: (e) => {
              it.done = e.target.checked;
              save();
              paint();
            },
          }),
          h('span', { class: 'w-todo-text' }, it.text),
          h('button', {
            class: 'icon-btn small w-todo-del',
            type: 'button',
            'aria-label': `Verwijder ${it.text}`,
            title: 'Verwijderen',
            onclick: () => {
              card.config.items = items().filter((x) => x !== it);
              save();
              paint();
            },
          }, '×'),
        ),
      ),
    );
    const done = items().filter((i) => i.done).length;
    footer.replaceChildren(
      done
        ? h('button', { class: 'link-btn', type: 'button', onclick: () => {
            card.config.items = items().filter((i) => !i.done);
            save();
            paint();
          } }, `${done} afgevinkt verwijderen`)
        : '',
    );
  };

  const input = h('input', { class: 'input', type: 'text', placeholder: 'Nieuwe taak…', maxlength: 200, 'aria-label': 'Nieuwe taak' });
  const form = h(
    'form',
    {
      class: 'w-todo-add',
      onsubmit: (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        items().push({ id: crypto.randomUUID(), text, done: false });
        input.value = '';
        save();
        paint();
        input.focus();
      },
    },
    input,
    h('button', { class: 'btn', type: 'submit' }, 'Toevoegen'),
  );
  paint();
  return { el: h('div', {}, list, form, footer), destroy() {} };
}

const todo = {
  label: 'Taken',
  icon: 'tasks',
  hint: 'Afvinklijst',
  title: 'Taken',
  defaults: { items: [] },
  render: renderTodo,
};

// ---- Zoeken ------------------------------------------------------------------------------------------------

const ENGINES = {
  google: { label: 'Google', url: 'https://www.google.com/search?q=' },
  duckduckgo: { label: 'DuckDuckGo', url: 'https://duckduckgo.com/?q=' },
  bing: { label: 'Bing', url: 'https://www.bing.com/search?q=' },
  ecosia: { label: 'Ecosia', url: 'https://www.ecosia.org/search?q=' },
  youtube: { label: 'YouTube', url: 'https://www.youtube.com/results?search_query=' },
};

function renderSearch(card, ctx) {
  const cfg = { ...search.defaults, ...card.config };
  const engine = ENGINES[cfg.engine] ?? ENGINES.google;
  const input = h('input', { class: 'input', type: 'search', placeholder: `Zoeken met ${engine.label}…`, 'aria-label': `Zoeken met ${engine.label}`, autocomplete: 'off' });
  const form = h(
    'form',
    {
      class: 'w-search',
      onsubmit: (e) => {
        e.preventDefault();
        const q = input.value.trim();
        if (q) window.open(engine.url + encodeURIComponent(q), ctx.linkTarget, 'noopener');
        input.value = '';
      },
    },
    input,
    h('button', { class: 'btn primary', type: 'submit' }, 'Zoek'),
  );
  return { el: form, destroy() {} };
}

const search = {
  label: 'Zoeken',
  icon: 'globe',
  hint: 'Google, DuckDuckGo e.a.',
  title: 'Zoeken',
  defaults: { engine: 'google' },
  render: renderSearch,
  async configure(cfg) {
    const r = await openDialog(
      'Zoekmachine kiezen',
      fieldsBody([{ name: 'engine', label: 'Zoekmachine', type: 'select', value: cfg.engine, options: Object.entries(ENGINES).map(([value, e]) => ({ value, label: e.label })) }]),
    );
    return r ? { config: { engine: r.engine } } : null;
  },
};

export const WIDGETS = { clock, weather, countdown, note, todo, search };
