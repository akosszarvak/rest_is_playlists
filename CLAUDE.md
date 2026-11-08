# Project rules

This repo is **Rest Is Playlists**: a locally run Nuxt app that groups *The Rest Is History*
episodes into themed, chronologically ordered playlists and exports them to Spotify.
The full plan is in `SPEC.md`. Read it before working, and follow its build order.

## Working rules

- **Ask instead of assuming.** When a requirement is unclear or two options are reasonable,
  ask the user before building.
- **Commit each part separately** with a meaningful message: imperative mood, a short
  summary line, and a body explaining why when it isn't obvious. Never bundle unrelated
  changes into one commit.
- **English** is the default for UI text, code, comments and docs.
- **Zero cost:** only use free, trusted, well-maintained libraries and services.
  Paid APIs (e.g. Anthropic) stay optional.
- **Secrets never get committed.** Keys and tokens live in `.data/` (gitignored) or `.env`.
  Server routes make every external call. Keys never reach the browser.
- **Verify external APIs against current docs** before implementing (Spotify changed its
  Web API in 2026; AI provider endpoints and model names change often). Do not rely on old
  tutorials.
- Validate every file read and every AI response with zod. Show clear errors in the UI.
- Never overwrite `data/grouping.json` without a confirmed proposal (see SPEC section 4.4).

## Commands

- `node scripts/fetch-rss.mjs`: fetch episode metadata into `data/episodes.json` (no install needed)
- `cd app`, then `npm install` and `npm run dev`: start the app at http://127.0.0.1:3000
- `cd app && npm run typecheck`: type-check the app and server (run before committing)
- `cd app && npm test`: unit tests for the framework-free logic in `app/shared/` (run before committing)

## Layout

- The Nuxt project lives in `app/` (Nuxt 4 source in `app/app/`, server routes in `app/server/`).
- `data/` and `.data/` stay at the **repo root**, not inside `app/`. Server code resolves them
  from the repo root.
- Pure logic (grouping operations, proposals, AI pipeline, Spotify matching/export planning,
  dashboard hints) lives in `app/shared/` with tests in `app/test/`. Server routes and
  `app/server/utils/` handle files and external calls.

## Testing external services without real accounts

Server-only env vars point the adapters at local mocks: `RIP_GEMINI_BASE_URL`,
`RIP_SPOTIFY_ACCOUNTS_URL`, `RIP_SPOTIFY_API_URL`. Never commit test data: delete any
`data/grouping.json` or `.data/*` files a test created.
