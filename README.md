# Rest Is Playlists

A locally run web app that groups the episodes of
[*The Rest Is History*](https://open.spotify.com/show/7Cvsbcjhtur7nplC148TWy) into themed,
chronologically ordered playlists and exports them to your own Spotify account.

- **Episodes** come from the podcast's public RSS feed.
- **Grouping** follows a fixed set of rules: few broad playlists, multi-part series kept
  together, episodes ordered by the period they cover. You can run it with any chatbot
  (free), Google Gemini (free tier) or Anthropic Claude (paid), or edit the playlists by hand.
  Every generated grouping is a proposal you review before anything changes.
- **Export** creates the playlists in your Spotify account and keeps them up to date.

It runs on your machine only. There is no hosting and no login besides Spotify's own.
Your keys and tokens stay in `.data/` and never leave your computer except to talk to the
service they belong to. See [`SPEC.md`](SPEC.md) for the full design.

## Requirements

- [Node.js](https://nodejs.org/) 20 or newer
- A Spotify account. The owner of the Spotify developer app needs **Spotify Premium**
  (a Spotify rule for apps in Development Mode since 2026).

## Quick start

```bash
cd app
npm install
npm run dev
```

Then open **http://127.0.0.1:3000** (use `127.0.0.1`, not `localhost`: the Spotify login
only returns to `127.0.0.1`). The Dashboard tells you what to do next.

## Using the app

1. **Episodes**: the episode list is already included. Press *Refresh from RSS* to fetch
   new episodes.
2. **Grouping**: generate a grouping and review it as a diff. *Full regroup* groups all
   episodes; *New episodes only* places unassigned episodes into your existing playlists.
   Accept everything, only some playlists, or nothing.
3. **Playlists**: fine-tune by hand: move, copy, reorder (drag and drop), rename, merge,
   split, exclude. Nothing is saved until you press *Save*. Every save keeps a backup in
   `.data/backups/`.
4. **Export**: connect Spotify, match the episodes, then export. The first export creates
   each playlist; later exports update the same playlists in place.

## Spotify developer app setup

Spotify only lets apps create playlists for you through a developer app. It is free and
takes a few minutes. You need it once.

1. Log in at the [Spotify developer dashboard](https://developer.spotify.com/dashboard)
   with the Spotify account that has Premium.
2. Click **Create app** and fill in:
   - **App name**: anything, e.g. `Rest Is Playlists`
   - **App description**: anything, e.g. `Personal playlist exporter`
   - **Redirect URI**: exactly `http://127.0.0.1:3000/api/spotify/callback`
     (Spotify rejects `localhost`; use the IP address)
   - If asked which APIs you plan to use, choose **Web API**.
3. Accept the Developer Terms of Service and save.
4. Open the app's page and copy the **Client ID**. You do **not** need the client secret:
   the app uses the PKCE login flow, which works without one.
5. In Rest Is Playlists, open **Settings**, paste the Client ID and save.
6. Open **Export** and click **Connect Spotify**.

**Other people:** an app in Development Mode works for its owner and up to five more users.
To let someone else use *your* developer app, add their name and Spotify email under
*User Management* in the app's settings. Usually it's simpler if everyone creates their own app.

**Troubleshooting**

- *"INVALID_CLIENT: Invalid redirect URI"*: the redirect URI in the Spotify app must match
  `http://127.0.0.1:3000/api/spotify/callback` exactly.
- *403 errors*: the app owner needs an active Premium subscription, and your account must
  be the owner or listed under User Management.
- *Episodes not matched*: matching uses title and release date. For the few that don't
  match, the Export page links to a Spotify search; copy the episode link
  (*Share → Copy link to episode*) and paste it. Unmatched episodes are left out of exports.

## Optional: AI grouping keys

The free **manual** method needs no key: the Grouping page builds a prompt you paste into
any chatbot, and you paste the answer back. To run the grouping from the app instead, add a
key in **Settings** and use *Test connection*:

| Provider | Cost | Key | Default model |
| --- | --- | --- | --- |
| Google Gemini | Free tier (low rate limits; Google may use free-tier prompts to improve its products. The prompts only contain public episode metadata) | [Google AI Studio](https://aistudio.google.com/apikey) | `gemini-3.6-flash` |
| Anthropic Claude | Paid, billed to your Anthropic account. A full regroup is roughly 60K input tokens | [Claude Console](https://platform.claude.com/settings/keys) | `claude-haiku-5-5` |

The model names can be changed in Settings. A full regroup takes about 8 requests; the
Grouping page shows the estimate before you start, and progress and token usage while it runs.

## Keeping it up to date

Every few months:

1. **Episodes → Refresh from RSS** (or `node scripts/fetch-rss.mjs`, no install needed).
2. **Grouping → New episodes only** to place the new episodes, then review and accept.
3. **Export → Match again**, then **Export all**.

## Files and data

| Path | What it is | In git? |
| --- | --- | --- |
| `app/` | The Nuxt 4 + Nuxt UI app (run `npm` commands here) | yes |
| `data/episodes.json` | Episode metadata from the RSS feed | yes |
| `data/grouping.json` | Your playlists (created when you first save or accept a grouping) | yes |
| `.data/settings.json` | Spotify Client ID, AI keys, playlist preferences | **no** |
| `.data/spotify.json` | Spotify tokens, episode matches, exported playlist ids | **no** |
| `.data/proposal.json` | The open grouping proposal | **no** |
| `.data/backups/` | The last 20 versions of `grouping.json` | **no** |
| `scripts/fetch-rss.mjs` | Standalone RSS fetcher (shares its parser with the app) | yes |

`.data/` is gitignored, so keys and tokens are never committed.

### Environment overrides (optional)

Settings come from the Settings page. Power users can override them with environment
variables or an `app/.env` file (see [`app/.env.example`](app/.env.example)):
`RIP_SPOTIFY_CLIENT_ID`, `RIP_ANTHROPIC_API_KEY`, `RIP_ANTHROPIC_MODEL`,
`RIP_GEMINI_API_KEY`, `RIP_GEMINI_MODEL`. Values set this way are read-only in Settings.
The `RIP_` prefix keeps a globally exported `ANTHROPIC_API_KEY` from being used by accident.

## Development

```bash
cd app
npm test            # unit tests (vitest)
npm run typecheck   # Vue + server type check
```

All external calls (RSS, Spotify, AI providers) are made by server routes in `app/server/`;
the browser never sees a key or token. Data files and AI answers are validated with zod.
