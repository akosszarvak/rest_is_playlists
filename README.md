# Rest Is Playlists

A locally run web app that groups episodes of
[*The Rest Is History*](https://open.spotify.com/show/7Cvsbcjhtur7nplC148TWy) into themed,
chronologically ordered playlists and exports them to your own Spotify account.

It runs on your machine only. There is no hosting and no login besides Spotify's own.
See [`SPEC.md`](SPEC.md) for the full design.

## Requirements

- Node.js 20 or newer
- A Spotify account (Premium is required for the owner of the Spotify developer app)

## Quick start

```bash
cd app
npm install
npm run dev
```

Then open http://127.0.0.1:3000.

## Repo layout

| Path | What it is |
| --- | --- |
| `app/` | The Nuxt 4 + Nuxt UI app (run `npm` commands here) |
| `data/episodes.json` | Episode metadata from the RSS feed (committed) |
| `data/grouping.json` | The current playlist grouping (committed, reviewed default) |
| `.data/` | Your API keys, Spotify tokens and matches (gitignored, never committed) |
| `scripts/fetch-rss.mjs` | Standalone RSS fetcher, no install needed |

## Spotify developer app setup

_TODO: step-by-step guide (build step 7)._

## Optional: AI grouping keys

_TODO: Anthropic, Google Gemini and GitHub Models setup (build step 6)._

## Refreshing episodes

Every few months, refresh the episode list from the Episodes page, or run:

```bash
node scripts/fetch-rss.mjs
```
