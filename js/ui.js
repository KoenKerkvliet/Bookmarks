// Kleine DOM-helpers en UI-componenten (menu, dialogen, toasts)

export function h(tag, props, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v == null || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'style' && typeof v === 'object') {
      for (const [sk, sv] of Object.entries(v)) {
        if (sk.startsWith('--')) el.style.setProperty(sk, sv);
        else el.style[sk] = sv;
      }
    } else if (k === 'dataset') Object.assign(el.dataset, v);
    else if (k.startsWith('on') && typeof v === 'function') el.addEventListener(k.slice(2), v);
    else if (['value', 'checked', 'selected', 'disabled'].includes(k)) el[k] = v;
    else el.setAttribute(k, v === true ? '' : v);
  }
  append(el, kids);
  return el;
}

function append(el, kids) {
  for (const kid of kids.flat(Infinity)) {
    if (kid == null || kid === false) continue;
    el.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
}

// ---- Iconen ----------------------------------------------------------------

const ICONS = {
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  dots: '<circle cx="12" cy="5" r="1.3"/><circle cx="12" cy="12" r="1.3"/><circle cx="12" cy="19" r="1.3"/>',
  pencil: '<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/>',
  trash: '<path d="M3 6h18"/><path d="M8 6V4a1 1 0 0 1 1-1h6a1 1 0 0 1 1 1v2"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>',
  move: '<path d="M5 12h14"/><path d="m13 6 6 6-6 6"/>',
  inbox: '<path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.1 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.9A2 2 0 0 0 16.7 4H7.3a2 2 0 0 0-1.8 1.1Z"/>',
  page: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8Z"/><path d="M14 3v5h5"/>',
  settings: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
  search: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3"/>',
  logout: '<path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><path d="m16 17 5-5-5-5"/><path d="M21 12H9"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  check: '<path d="m5 12 5 5L20 7"/>',
  x: '<path d="M18 6 6 18M6 6l12 12"/>',
  copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/>',
  refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
  bookmark: '<path d="M6 3h12a1 1 0 0 1 1 1v17l-7-4-7 4V4a1 1 0 0 1 1-1Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.5.5l3-3a5 5 0 0 0-7-7l-1.7 1.7"/><path d="M14 11a5 5 0 0 0-7.5-.5l-3 3a5 5 0 0 0 7 7l1.7-1.7"/>',
  video: '<rect x="3" y="5" width="18" height="14" rx="3"/><path d="m10 9.5 4.5 2.5-4.5 2.5Z"/>',
  play: '<path d="M8 5.5v13l11-6.5Z"/>',
  playlist: '<path d="M3 6h12M3 12h12M3 18h8"/><path d="m16 15 5 3-5 3Z"/>',
  'chevron-left': '<path d="m15 6-6 6 6 6"/>',
  'chevron-right': '<path d="m9 6 6 6-6 6"/>',
  palette: '<circle cx="13.5" cy="6.5" r="1"/><circle cx="17.5" cy="10.5" r="1"/><circle cx="8.5" cy="7.5" r="1"/><circle cx="6.5" cy="12.5" r="1"/><path d="M12 2C6.5 2 2 6.5 2 12s4.5 10 10 10c.9 0 1.5-.7 1.5-1.5 0-.4-.2-.8-.4-1-.3-.3-.5-.6-.5-1 0-.8.7-1.5 1.5-1.5H16c3.3 0 6-2.7 6-6 0-4.9-4.5-9-10-9Z"/>',
  'chevron-down': '<path d="m6 9 6 6 6-6"/>',
  heading: '<path d="M6 4v16M18 4v16M6 12h12"/>',
  tag: '<path d="M20.6 13.4 13.4 20.6a2 2 0 0 1-2.8 0L3 13V3h10l7.6 7.6a2 2 0 0 1 0 2.8Z"/><circle cx="7.5" cy="7.5" r="1.2"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  cloud: '<path d="M17.5 19a4.5 4.5 0 1 0-1.4-8.8A6 6 0 0 0 4.5 12.5 3.5 3.5 0 0 0 7 19Z"/>',
  hourglass: '<path d="M6 2h12M6 22h12"/><path d="M7 2v4a5 5 0 0 0 2 4l3 2-3 2a5 5 0 0 0-2 4v4"/><path d="M17 2v4a5 5 0 0 1-2 4l-3 2 3 2a5 5 0 0 1 2 4v4"/>',
  note: '<path d="M5 3h11l4 4v14H5Z"/><path d="M8 7h4M8 11h8M8 15h8"/>',
  tasks: '<rect x="3" y="4" width="5" height="5" rx="1"/><path d="m4 6.5 1 1 2-2"/><rect x="3" y="15" width="5" height="5" rx="1"/><path d="M11 6.5h10M11 17.5h10"/>',
  globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a14 14 0 0 1 0 18 14 14 0 0 1 0-18"/>',
};

export function icon(name, size = 18) {
  const span = document.createElement('span');
  span.className = 'icon';
  span.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${size}" height="${size}" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ''}</svg>`;
  return span;
}

// ---- Popover en contextmenu ------------------------------------------------

let activeMenu = null;

export function closeMenu() {
  if (!activeMenu) return;
  const { cleanup, el, onClose } = activeMenu;
  activeMenu = null;
  cleanup();
  el.remove();
  onClose?.();
}

// Toont `el` als zwevend paneel onder `anchor` (element of { x, y }) en sluit het bij klik
// erbuiten, Esc, resize of scrollen van de pagina. Scrollen binnen het paneel sluit het niet.
// alignLeft: lijn het paneel uit op de linkerkant van het element (standaard: rechterkant).
export function showPopover(anchor, el, { alignLeft = false, onClose } = {}) {
  closeMenu();
  document.body.append(el);

  const isEl = anchor instanceof Element;
  const rect = isEl ? anchor.getBoundingClientRect() : { left: anchor.x, right: anchor.x, top: anchor.y, bottom: anchor.y };
  const mw = el.offsetWidth;
  const mh = el.offsetHeight;
  let left = isEl && !alignLeft ? rect.right - mw : rect.left;
  let top = rect.bottom + 4;
  if (left + mw > innerWidth - 8) left = innerWidth - mw - 8;
  if (left < 8) left = 8;
  if (top + mh > innerHeight - 8) top = Math.max(8, rect.top - mh - 4);
  el.style.left = `${left}px`;
  el.style.top = `${top}px`;

  const onOutside = (e) => {
    if (!el.contains(e.target)) closeMenu();
  };
  const onKey = (e) => {
    if (e.key === 'Escape') closeMenu();
  };
  const onScroll = (e) => {
    if (!(e?.target instanceof Node) || !el.contains(e.target)) closeMenu();
  };
  setTimeout(() => {
    if (activeMenu?.el !== el) return;
    document.addEventListener('pointerdown', onOutside, true);
    document.addEventListener('keydown', onKey);
    addEventListener('resize', onScroll);
    addEventListener('scroll', onScroll, true);
  }, 0);
  activeMenu = {
    el,
    onClose,
    cleanup() {
      document.removeEventListener('pointerdown', onOutside, true);
      document.removeEventListener('keydown', onKey);
      removeEventListener('resize', onScroll);
      removeEventListener('scroll', onScroll, true);
    },
  };
  return el;
}

// anchor: element of { x, y }. items: { label, icon, checked, danger, onClick } | '-'
export function showMenu(anchor, items) {
  const menu = h(
    'div',
    { class: 'menu', role: 'menu' },
    items.map((it) =>
      it === '-'
        ? h('div', { class: 'menu-sep' })
        : h(
            'button',
            {
              class: `menu-item${it.danger ? ' danger' : ''}`,
              role: 'menuitem',
              type: 'button',
              onclick: () => {
                closeMenu();
                it.onClick();
              },
            },
            it.icon ? icon(it.icon, 16) : h('span', { class: 'icon-pad' }),
            h('span', { class: 'menu-label' }, it.label),
            it.checked ? icon('check', 16) : null,
          ),
    ),
  );
  showPopover(anchor, menu);
  menu.querySelector('.menu-item')?.focus({ preventScroll: true });
}

// ---- Dialogen ----------------------------------------------------------------

// body: { el, collect() } of (ctx) => { el, collect() }.
// collect() geeft een waarde terug, of undefined als het formulier niet geldig is.
// Resolve: de waarde bij bevestigen, anders null.
export function openDialog(title, body, opts = {}) {
  const { submit = 'Opslaan', cancel = 'Annuleren', danger = false, footer = true, className = '' } = opts;
  return new Promise((resolve) => {
    const dlg = h('dialog', { class: `dialog ${className}` });
    let done = false;
    const close = (value) => {
      if (done) return;
      done = true;
      dlg.close();
      dlg.remove();
      resolve(value ?? null);
    };
    const part = typeof body === 'function' ? body({ close }) : body;
    const form = h(
      'form',
      { class: 'dialog-inner', novalidate: true },
      title ? h('h2', { class: 'dialog-title' }, title) : null,
      part.el,
      footer
        ? h(
            'div',
            { class: 'dialog-actions' },
            h('button', { type: 'button', class: 'btn ghost', onclick: () => close(null) }, cancel),
            h('button', { type: 'submit', class: `btn ${danger ? 'danger' : 'primary'}` }, submit),
          )
        : null,
    );
    form.addEventListener('submit', (e) => {
      e.preventDefault();
      const value = part.collect();
      if (value !== undefined) close(value);
    });
    dlg.append(form);
    dlg.addEventListener('cancel', (e) => {
      e.preventDefault();
      close(null);
    });
    dlg.addEventListener('click', (e) => {
      if (e.target === dlg) close(null);
    });
    document.body.append(dlg);
    dlg.showModal();
    (part.focus ? part.focus() : dlg.querySelector('input, select'))?.focus?.();
  });
}

// fields: { name, label, type: text|password|select|segmented, value, required, placeholder,
//           options: [{value,label}], validate(v) -> foutmelding | null, hint }
export function fieldsBody(fields, intro) {
  const controls = {};
  const errors = {};
  const rows = fields.map((f) => {
    let control;
    if (f.type === 'segmented') {
      const group = h('div', { class: 'segmented', role: 'radiogroup' });
      let current = f.value ?? f.options[0].value;
      const buttons = f.options.map((o) =>
        h(
          'button',
          {
            type: 'button',
            role: 'radio',
            class: 'seg',
            'aria-checked': String(o.value === current),
            onclick: () => {
              current = o.value;
              buttons.forEach((b, i) => b.setAttribute('aria-checked', String(f.options[i].value === current)));
            },
          },
          o.label,
        ),
      );
      group.append(...buttons);
      control = group;
      control.getValue = () => current;
    } else if (f.type === 'select') {
      control = h(
        'select',
        { class: 'input', name: f.name },
        f.options.map((o) => h('option', { value: o.value, selected: o.value === f.value }, o.label)),
      );
      control.getValue = () => control.value;
    } else {
      control = h('input', {
        class: 'input',
        name: f.name,
        type: f.type || 'text',
        value: f.value ?? '',
        placeholder: f.placeholder,
        autocomplete: 'off',
        autocapitalize: 'off',
        spellcheck: 'false',
        inputmode: f.inputmode,
        maxlength: f.maxlength,
      });
      control.getValue = () => control.value.trim();
    }
    controls[f.name] = control;
    errors[f.name] = h('div', { class: 'field-error', role: 'alert' });
    return h(
      'label',
      { class: 'field' },
      h('span', { class: 'field-label' }, f.label),
      control,
      f.hint ? h('span', { class: 'field-hint' }, f.hint) : null,
      errors[f.name],
    );
  });

  return {
    el: h('div', { class: 'fields' }, intro ? h('p', { class: 'dialog-text' }, intro) : null, rows),
    focus: () => Object.values(controls)[0],
    collect() {
      const values = {};
      let ok = true;
      for (const f of fields) {
        const v = controls[f.name].getValue();
        let err = null;
        if (f.required && !v) err = 'Dit veld is verplicht.';
        else if (f.validate) err = f.validate(v);
        errors[f.name].textContent = err || '';
        if (err) ok = false;
        values[f.name] = v;
      }
      return ok ? values : undefined;
    },
  };
}

export async function confirmDialog({ title, message, confirm = 'Verwijderen', danger = true }) {
  const r = await openDialog(title, { el: h('p', { class: 'dialog-text' }, message), collect: () => true }, { submit: confirm, danger });
  return r === true;
}

// ---- Toasts ----------------------------------------------------------------

export function toast(message, { action, duration = 4500, error = false } = {}) {
  const host = document.getElementById('toasts');
  const el = h(
    'div',
    { class: `toast${error ? ' error' : ''}`, role: error ? 'alert' : 'status' },
    h('span', {}, message),
    action
      ? h(
          'button',
          {
            class: 'toast-action',
            type: 'button',
            onclick: () => {
              el.remove();
              action.onClick();
            },
          },
          action.label,
        )
      : null,
  );
  host.append(el);
  setTimeout(() => el.remove(), action ? Math.max(duration, 7000) : duration);
}
