# Bookmarks

Eigen startpagina met snelkoppelingen, in de geest van start.me. Pure HTML/CSS/JS (geen build-stap), Supabase als backend, hostbaar op GitHub Pages en installeerbaar als PWA.

**Functies**

- Pagina's met eigen titel en instelbaar aantal kolommen (1–6); pagina's kies je in een dropdown linksboven in de header (met Nieuw erin, zoeken bij veel pagina's, en herschikken door te slepen)
- Cards met titel en snelkoppelingen; per card de weergave: lijst, iconen S, M of L
- Cards slepen tussen kolommen, links slepen tussen cards, alles bewerken en verwijderen (links met "ongedaan maken")
- Widgets als card: **klok** (analoog of digitaal, per tijdzone), **weer** (Open-Meteo, 5 dagen), **aftellen**, **notitie**, **taken** (afvinklijst) en **zoeken** (Google, DuckDuckGo, Bing, Ecosia, YouTube), plus de **kop**: een H2-titel zonder kaartachtergrond waaronder je bij elkaar horende cards sleept. Ze slepen, hernoemen en verwijderen net als andere cards
- Pagina **Video's** voor YouTube Shorts en video's: rooster met voorbeeldplaatjes, afspelen in de site (met vorige/volgende), filter op Shorts/Video's en Te kijken/Bekeken, handmatig toevoegen, en ze komen mee in het zoeken. De extensie slaat ze op met een eigen knop. Sommige video's staan embedden niet toe (keuze van de eigenaar); daarvoor is er de knop "Openen op YouTube"
- Vaste pagina **Nieuw**: hier komen links binnen die je via de browserextensie opslaat; met één klik verplaats je ze naar de juiste pagina en card
- Zoeken door al je links (`/` of `Ctrl+K`), realtime updates vanuit de extensie
- Zes thema's: **Licht**, **Donker**, **Neon**, **Oceaan**, **Bos** en **Zonsondergang**, of **Automatisch** (volgt je systeem). Kies via Instellingen of het paletje rechtsboven in de header; de keuze geldt per apparaat
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

### Bestaande installatie bijwerken (widgets)

Heb je het schema al eerder uitgevoerd? Draai dan eenmalig [`supabase/migrations/002_widgets.sql`](supabase/migrations/002_widgets.sql) in de SQL Editor, en voor de kop-kaart ook [`004_heading_cards.sql`](supabase/migrations/004_heading_cards.sql). Zonder deze stap werken je bestaande cards gewoon door, maar kun je geen widgets toevoegen. Het weer haalt gegevens op bij Open-Meteo; daarvoor wordt alleen de plaatsnaam en locatie van je widget gedeeld.

### Video's activeren

Voer eenmalig [`supabase/migrations/003_videos.sql`](supabase/migrations/003_videos.sql) uit in de SQL Editor. Zonder dit bestand werkt de rest van de site gewoon en toont de pagina Video's een melding. Titel en kanaalnaam haalt de site zelf op bij YouTube (oEmbed, geen sleutel nodig); de speler gebruikt de officiële ingesloten YouTube-speler. Er wordt geen video gedownload of opgeslagen, alleen het adres, de titel en de kanaalnaam.

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

### Video's opslaan

Dezelfde sleutel en headers, maar een andere functie, die alleen YouTube-adressen accepteert (`youtube.com/shorts/…`, `watch?v=…`, `youtu.be/…`, `/live/`, `/embed/`):

```
POST https://smufazdrxboqdyosxyiv.supabase.co/rest/v1/rpc/add_video
{ "p_key": "<jouw API-sleutel>", "p_url": "https://www.youtube.com/shorts/…", "p_title": "Titel - YouTube" }
```

Antwoord: `{ "ok": true, "id": "…", "duplicate": false, "kind": "short" }`. Een video die er al in staat geeft `duplicate: true`. Een ander adres geeft de fout `geen YouTube-video`. Het achtervoegsel " - YouTube" van een tabtitel wordt automatisch verwijderd.

## Importeren uit start.me

1. Exporteer in start.me via **Export → Export bookmarks** (HTML-bestand).
2. Open op de site **Instellingen → Importeren** en kies het bestand.
3. Je ziet eerst een samenvatting. Na bevestigen worden pagina's (met hun kolomaantal), cards en links toegevoegd als nieuwe pagina's; bestaande pagina's blijven staan. Mislukt de import halverwege, dan wordt alles teruggedraaid.

Start.me bewaart geen kolompositie van widgets, dus de cards worden evenwichtig over de kolommen verdeeld. Alle cards krijgen de weergave Lijst. Importeer één keer: een tweede import voegt alles nogmaals toe. Bladwijzerbestanden van Chrome, Firefox en Edge worden ook gelezen (mappen worden pagina's of cards), maar die zijn niet uitgebreid getest. Zet het exportbestand niet in de repository; `Export-*.html` staat in `.gitignore`.

## Opbouw

| Pad | Inhoud |
| --- | --- |
| `index.html`, `css/styles.css` | Shell en styling (primaire kleur `#9E86FF`) |
| `js/app.js` | Applicatielogica en views |
| `js/api.js` | Alle Supabase-aanroepen |
| `js/ui.js` | Menu's, dialogen, toasts, iconen |
| `js/importer.js` | Parser voor bladwijzer-HTML (start.me e.a.) |
| `js/widgets.js` | Widgets: klok, weer, aftellen, notitie, taken, zoeken |
| `js/videos.js` | YouTube-adressen herkennen, plaatjes, speler-adres, oEmbed |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA |
| `vendor/` | `supabase-js` 2.49.4 en SortableJS 1.15.6 (lokaal, geen CDN nodig) |
| `supabase/schema.sql` | Tabellen, RLS-beleid en functies |
