# Rest Is Playlists: Specification

A locally run web app that groups episodes of *The Rest Is History* podcast into
themed, chronologically ordered playlists and exports them to the user's Spotify
account. It is a repo people clone and run on their own machine. It is never
hosted. There is no login system beyond Spotify's own.

Podcast: https://open.spotify.com/show/7Cvsbcjhtur7nplC148TWy
RSS feed: https://feeds.megaphone.fm/GLT4787413333

## 1. Stack

- **Nuxt 4** (Vue 3, TypeScript) with **Nuxt UI** (free, Tailwind-based) for a consistent look.
- Server routes under `server/api/` handle every external call (RSS, Spotify, AI providers).
  API keys never reach the browser.
- Validation: `zod` for every file and every AI response.
- No database. State lives in JSON files:
  - `data/episodes.json`: fetched episode metadata (committed, so the repo works out of the box).
  - `data/grouping.json`: the current grouping (committed; the reviewed, pre-made default).
  - `.data/settings.json`: API keys and preferences (**gitignored**).
  - `.data/spotify.json`: Spotify tokens, episode-ID matches, created playlist IDs (**gitignored**).
- Runs with `npm install` once, then `npm run dev`, at `http://127.0.0.1:3000`.
- English is the default UI language.

## 2. Data model

`data/episodes.json` (produced by `scripts/fetch-rss.mjs` and by the in-app refresh):

```jsonc
{
  "source": "https://feeds.megaphone.fm/GLT4787413333",
  "fetchedAt": "ISO timestamp",
  "count": 0,
  "episodes": [
    {
      "guid": "stable RSS guid, the primary key everywhere",
      "title": "string",
      "releaseDate": "YYYY-MM-DD",
      "durationSec": 0,
      "episodeType": "full | trailer | bonus",
      "episodeNumber": null,
      "season": null,
      "audioUrl": "string",
      "description": "plain text, HTML stripped"
    }
  ]
}
```

`data/grouping.json`:

```jsonc
{
  "version": 1,
  "generatedAt": "ISO timestamp",
  "method": "premade | manual | anthropic | gemini",
  "playlists": [
    {
      "id": "kebab-case-slug",
      "name": "Ancient Rome",
      "description": "Short description used as the Spotify playlist description",
      "kind": "broad | series",
      "parent": null,            // for kind=series: id of the broad playlist that also contains it
      "era": { "start": -753, "end": 476 },   // years; negative = BC; used for ordering hints
      "episodes": ["guid", "guid"]            // final listening order
    }
  ],
  "excluded": [ { "guid": "…", "reason": "club | archive-duplicate | trailer | other" } ],
  "unassigned": ["guid"]          // new episodes not yet placed; shown prominently in the UI
}
```

## 3. Grouping rules

These rules go into every AI prompt, and they are the rules the pre-made grouping follows.

1. **Prefer few, broad playlists.** The user does not want to maintain many small playlists.
   Before creating a playlist, decide whether the topic deserves its own playlist or is an
   integral part of a broader one. Example: the Punic Wars and Hannibal belong in *Ancient Rome*.
   Constantinople and Byzantium are a different subject.
2. **Overlap is allowed and intended.** A large multi-part series (e.g. the Hundred Years' War)
   may get its own `series` playlist *and* appear in full inside its broad parent, so listening
   to the broad playlist covers the smaller one.
3. **Keep context together.** Episodes that lead up to an event belong in the same playlist as
   that event, so back-references are not missed. Example: the run-up to the Hundred Years' War
   sits with the Joan of Arc episodes.
4. **One-offs go to broad era or theme buckets** (e.g. "Medieval Europe", "20th Century",
   "Modern Britain"), not to their own playlists.
5. **Exclude:** members-only / *Rest Is History Club* episodes, trailers, and "From the archive"
   re-releases whose original episode is already included. A re-release whose original is
   missing from the feed is kept.
6. **Ordering inside a playlist:** series and one-offs are ordered by the historical period
   they cover (Rome 753 BC → Punic Wars → Empire → fall of the West). Parts of a multi-part
   series always stay in their release order, even if a later part covers an earlier period.
   Episodes with no clear date fall back to release order.

## 4. Pages

All pages share one Nuxt UI layout with a sidebar.

1. **Dashboard:** episode count, last fetch time, count of unassigned episodes,
   Spotify connection status, last export time, "what to do next" hints.
2. **Episodes:** searchable table (title, date, duration, playlists it belongs to, excluded flag).
   "Refresh from RSS" button calls `POST /api/episodes/refresh`.
3. **Playlists:** each playlist with its ordered episodes. Manual edits: move an episode between
   playlists, add to a second playlist, reorder by drag-and-drop, rename, merge or split playlists,
   exclude/include. Edits save to `data/grouping.json`.
4. **Grouping:** run a grouping method (section 5). The result is always a **proposal** shown as
   a diff against the current grouping (added, moved and removed episodes, new playlists).
   The user accepts all, accepts per playlist, or discards it. Nothing is overwritten without
   confirmation. Modes: *full regroup* or *incremental* (only `unassigned` episodes, with the
   existing playlist list sent as context).
5. **Export:** list of playlists with episode counts and a status (not exported / up to date /
   changed since export). Buttons: export one, export all. Shows progress and errors.
6. **Settings:** Spotify Client ID, AI provider keys and model names, playlist name prefix
   (default `RIH · `), playlist visibility (default private), test-connection buttons.
   Keys are masked after saving.

## 5. Grouping methods

1. **Pre-made (default, free):** `data/grouping.json` shipped in the repo.
2. **Manual (free):** "Copy prompt" builds the full prompt (rules from section 3, the JSON
   schema, and the episode metadata, either everything or only unassigned episodes). The user
   pastes it into any chatbot and pastes the JSON answer back. The app validates it with zod
   and shows the diff.
3. **API providers** (keys set in Settings), each with a server-side adapter that returns the
   same validated structure:
   - **Anthropic Claude** (paid): Messages API, structured JSON output. Default model: `claude-haiku-5-5`.
   - **Google Gemini** (free tier via Google AI Studio key): JSON response mode. Default model:
     `gemini-3.6-flash`. Free-tier prompts may be used by Google to improve its products.
   - *GitHub Models was dropped: GitHub retired it on 2026-07-30.*
   - Verify current endpoints, auth headers and model names against each provider's docs when
     implementing. Do not hard-code from memory.
   - Batching: keep each request well under 100K input tokens (Haiku-class rates multiply
     above that threshold). Send compact metadata: guid, title, date, and a description
     truncated to about 400 chars. For a full regroup, first ask for the playlist list, then
     assign episodes in batches against that list, then merge.
   - Retry on rate-limit errors with backoff. Free tiers have low requests-per-minute limits.

## 6. Spotify integration

Constraints as of 2026 (verify against current Spotify docs):

- Development Mode apps need the app owner to have **Spotify Premium**, allow **5 allowlisted
  users**, and use the new endpoints:
  - create playlist: `POST /me/playlists` (the `/users/{id}/playlists` variant is removed)
  - add/replace items: `POST`/`PUT /playlists/{id}/items` (the `/tracks` paths were renamed)
  - batch `GET /episodes` is removed. Use `GET /shows/{id}/episodes` (paged) or
    `GET /episodes/{id}`.
- Each user creates their own free Spotify developer app (README must walk through this) and
  pastes the **Client ID** into Settings. Auth uses **Authorization Code with PKCE**, so no
  client secret is needed.
- Redirect URI: `http://127.0.0.1:3000/api/spotify/callback` (Spotify rejects `localhost`;
  loopback must be an explicit IP. Verify).
- Scopes: `playlist-modify-private playlist-modify-public playlist-read-private`.
- Tokens and refresh tokens live in `.data/spotify.json`. Refresh automatically.

**Episode matching:** RSS guids are not Spotify IDs. After login, page through
`GET /shows/7Cvsbcjhtur7nplC148TWy/episodes` and match each RSS episode by normalized title
plus release date (±1 day). Store matches in `.data/spotify.json`. Unmatched episodes are listed
in the UI with a manual "paste Spotify episode link" fix. If the show-episodes endpoint turns
out to be unavailable in Development Mode, fall back to per-episode lookup and report it.

**Export is idempotent:** the first export creates the playlist and stores its ID. Later
exports replace the items in place (`PUT` for the first 100 URIs, then `POST` in batches of
100) and update the description. If the stored playlist was deleted by the user, create a new
one. Never create duplicates.

## 7. Repo and docs

- `README.md`: what it is, Spotify developer app setup step by step, optional AI keys,
  `npm install` / `npm run dev`, refreshing every few months.
- `.env` is not needed (keys come from Settings), but support `.env` overrides for power users.
- Commit each part separately with a meaningful message (see `CLAUDE.md`).

## 8. Build order

1. Nuxt + Nuxt UI scaffold, layout, empty pages, `.gitignore`, README skeleton.
2. Settings store (`.data/settings.json`) and Settings page.
3. Episodes: RSS refresh server route (reuse the logic in `scripts/fetch-rss.mjs`), Episodes page.
4. Grouping data layer and Playlists page with manual editing.
5. Proposal/diff view, then the manual prompt method.
6. AI adapters: Anthropic, then Gemini.
7. Spotify PKCE login, episode matching, export.
8. Dashboard, README completion, final pass.
