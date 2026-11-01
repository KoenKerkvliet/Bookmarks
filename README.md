# Bookmarks

Eigen startpagina met snelkoppelingen, in de geest van start.me. Pure HTML/CSS/JS (geen build-stap), Supabase als backend, hostbaar op GitHub Pages en installeerbaar als PWA.

**Functies**

- Pagina's met eigen titel en instelbaar aantal kolommen (1–6); pagina's herschikken in de zijbalk
- Cards met titel en snelkoppelingen; per card de weergave: lijst, iconen S, M of L
- Cards slepen tussen kolommen, links slepen tussen cards, alles bewerken en verwijderen (links met "ongedaan maken")
- Vaste pagina **Nieuw**: hier komen links binnen die je via de browserextensie opslaat; met één klik verplaats je ze naar de juiste pagina en card
- Zoeken door al je links (`/` of `Ctrl+K`), licht/donker thema, realtime updates vanuit de extensie
- Op Android delen vanuit een andere app naar Bookmarks (PWA share target) landt ook in **Nieuw**

## Installatie

### 1. Database (Supabase)

1. Open het Supabase-dashboard > **SQL Editor** > New query.
2. Plak de inhoud van [`supabase/schema.sql`](supabase/schema.sql) en klik **Run**.
3. Ga naar **Project Settings > API Keys** en kopieer de **anon / publishable key**.
4. Zet die key in [`js/config.js`](js/config.js) bij `supabaseAnonKey`. Deze key is bedoeld om publiek te zijn; de beveiliging zit in Row Level Security.

### 2. Account

1. Open de site, kies **Registreren** en maak je account aan.
2. Staat e-mailbevestiging aan (standaard), bevestig dan eerst via de mail.
3. Zet daarna in Supabase onder **Authentication > Sign In / Providers** de optie *Allow new users to sign up* uit, zodat niemand anders een account kan maken.
4. Zet onder **Authentication > URL Configuration** de Site URL op je GitHub Pages-adres.

### 3. GitHub Pages

1. Push deze map naar `main` van `KoenKerkvliet/Bookmarks`.
2. Repository > **Settings > Pages** > Source: *Deploy from a branch*, branch `main`, map `/ (root)`.
3. De site staat daarna op `https://koenkerkvliet.github.io/Bookmarks/`. Alle paden zijn relatief, dus het werkt onder die submap.
4. Open de site in Chrome/Edge en kies **Installeren** (of op iOS: Deel > Zet op beginscherm).

Lokaal testen kan met een willekeurige statische server, bijvoorbeeld `python -m http.server 8000` in deze map.

## Extensie koppelen

Na inloggen staat onder **Instellingen > Browserextensie** je persoonlijke API-sleutel. De extensie hoeft niet in te loggen: één aanroep van een database-functie voegt de link toe aan **Nieuw**.

```
POST https://smufazdrxboqdyosxyiv.supabase.co/rest/v1/rpc/add_bookmark
apikey: <anon key uit js/config.js>
Content-Type: application/json

{ "p_key": "<jouw API-sleutel>", "p_url": "https://voorbeeld.nl", "p_title": "Titel" }
```

Antwoord bij succes: `{ "ok": true, "id": "…", "duplicate": false }`. Staat dezelfde URL al in de inbox, dan wordt hij niet dubbel toegevoegd (`duplicate: true`). Een ongeldige sleutel of URL geeft een foutstatus (400/401).

Voorbeeld voor de extensie (service worker of popup, Manifest V3). Zet `https://smufazdrxboqdyosxyiv.supabase.co/*` bij `host_permissions`:

```js
const SUPABASE_URL = 'https://smufazdrxboqdyosxyiv.supabase.co';
const ANON_KEY = '…';       // dezelfde anon key als in js/config.js
const API_KEY = '…';        // uit Instellingen op de site

async function saveCurrentTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const res = await fetch(`${SUPABASE_URL}/rest/v1/rpc/add_bookmark`, {
    method: 'POST',
    headers: { apikey: ANON_KEY, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_key: API_KEY, p_url: tab.url, p_title: tab.title }),
  });
  if (!res.ok) throw new Error((await res.json()).message);
  return res.json();
}
```

Lekt je sleutel? Klik in Instellingen op **Nieuwe sleutel**; de oude werkt dan direct niet meer.

## Opbouw

| Pad | Inhoud |
| --- | --- |
| `index.html`, `css/styles.css` | Shell en styling (primaire kleur `#9E86FF`) |
| `js/app.js` | Applicatielogica en views |
| `js/api.js` | Alle Supabase-aanroepen |
| `js/ui.js` | Menu's, dialogen, toasts, iconen |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |
| `vendor/` | `supabase-js` 2.49.4 en SortableJS 1.15.6 (lokaal, geen CDN nodig) |
| `supabase/schema.sql` | Tabellen, RLS-beleid en functies |
