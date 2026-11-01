// Leest een Netscape-bookmarkbestand (HTML-export van start.me, Chrome, Firefox, ...)
// en zet het om naar pagina's > cards > links. Geen DOM nodig, dus ook in Node testbaar.
//
// start.me-export:   <H3 PAGE="true" COLUMNS="3">Pagina</H3>   -> pagina
//                      <H3>Widget</H3>                         -> card
//                        <A HREF="...">Link</A>                -> link
// Andere browsers:   mappen op het hoogste niveau worden pagina's, submappen cards.

const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function decode(s) {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, n) => ENTITIES[n.toLowerCase()] ?? m)
    .replace(/[‎‏​﻿]/g, '') // onzichtbare richtingstekens (komen in start.me-titels voor)
    .replace(/\s+/g, ' ')
    .trim();
}

const attr = (attrs, name) => {
  const m = attrs.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`, 'i'));
  return m ? decode(m[1]) : null;
};

function hostOf(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
}

function buildTree(html) {
  const root = { folders: [], links: [], attrs: '', title: '' };
  const stack = [root];
  let pending = null;
  const re = /<DL[^>]*>|<\/DL>|<H3([^>]*)>([\s\S]*?)<\/H3>|<A\s([^>]*)>([\s\S]*?)<\/A>/gi;
  for (let m; (m = re.exec(html)); ) {
    const tag = m[0].slice(0, 3).toUpperCase();
    if (tag === '<DL') {
      stack.push(pending ?? stack.at(-1)); // ongekoppelde <DL> blijft in dezelfde map
      pending = null;
    } else if (tag === '</D') {
      if (stack.length > 1) stack.pop();
    } else if (tag === '<H3') {
      const folder = { folders: [], links: [], attrs: m[1], title: decode(m[2].replace(/<[^>]+>/g, '')) };
      stack.at(-1).folders.push(folder);
      pending = folder;
    } else {
      const url = attr(m[3], 'HREF');
      if (url) stack.at(-1).links.push({ url, title: decode(m[4].replace(/<[^>]+>/g, '')) });
    }
  }
  return root;
}

// Alle links van een map, inclusief submappen (die worden in de card samengevoegd).
function flatten(folder) {
  return [...folder.links, ...folder.folders.flatMap(flatten)];
}

const MAX_COLUMNS = 6;

// Verdeelt cards over kolommen: telkens in de kolom met de minste inhoud.
function assignColumns(cards, columns) {
  const heights = Array(columns).fill(0);
  const counts = Array(columns).fill(0);
  for (const card of cards) {
    const col = heights.indexOf(Math.min(...heights));
    card.column_index = col;
    card.position = counts[col]++;
    heights[col] += 2 + card.links.length;
  }
}

export function parseBookmarksHtml(html) {
  const root = buildTree(html);
  const pages = [];
  const stray = []; // links die niet in een pagina/card zitten

  const toLinks = (links) =>
    links
      .filter((l) => /^https?:\/\//i.test(l.url))
      .map((l) => ({ url: l.url, title: (l.title || hostOf(l.url)).slice(0, 300) }));

  const topLevel = root.folders.length === 1 && !attr(root.folders[0].attrs, 'PAGE') && root.folders[0].folders.length ? root.folders[0] : root;
  const hasPageFlag = topLevel.folders.some((f) => attr(f.attrs, 'PAGE') === 'true');

  for (const folder of topLevel.folders) {
    if (hasPageFlag && attr(folder.attrs, 'PAGE') !== 'true') {
      stray.push(...toLinks(flatten(folder)));
      continue;
    }
    const columns = Math.min(MAX_COLUMNS, Math.max(1, Number(attr(folder.attrs, 'COLUMNS')) || 3));
    const cards = [];
    const loose = toLinks(folder.links);
    for (const sub of folder.folders) {
      const links = toLinks(flatten(sub));
      if (links.length) cards.push({ title: (sub.title || 'Naamloos').slice(0, 100), links });
    }
    if (loose.length) cards.push({ title: 'Overig', links: loose });
    if (!cards.length) continue;
    assignColumns(cards, columns);
    pages.push({ title: (folder.title || 'Geïmporteerd').slice(0, 60), columns, cards });
  }
  stray.push(...toLinks(topLevel.links));

  const count = (fn) => pages.reduce((n, p) => n + fn(p), 0);
  return {
    pages,
    stray,
    totals: {
      pages: pages.length,
      cards: count((p) => p.cards.length),
      links: count((p) => p.cards.reduce((n, c) => n + c.links.length, 0)) + stray.length,
    },
  };
}
