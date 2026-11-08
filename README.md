# Rest Is Playlists

Turn the 700+ episodes of [*The Rest Is History*](https://open.spotify.com/show/7Cvsbcjhtur7nplC148TWy)
into themed, chronologically ordered Spotify playlists: *Ancient Rome* from Carthage to the fall
of the West, *The French Revolution* from Marie Antoinette to the Terror, *The First World War*
from Sarajevo to Gallipoli, and so on.

It's a small web app you run on your own computer. It comes with a ready-made set of playlists,
lets you adjust them, and creates them in your Spotify account with one click.

> Not affiliated with *The Rest Is History*, Goalhanger, Spotify, Anthropic or Google.
> Episode titles and descriptions come from the podcast's public RSS feed and belong to their owners.

## Features

- **Ready to use:** includes all episodes and a reviewed grouping into 17 era and theme
  playlists (Ancient World, Medieval Britain, Age of Revolution, American History, …) plus
  7 series playlists for the big sagas (Hundred Years' War, French Revolution, the Nazis, …).
- **Sensible ordering:** episodes run in the order of the history they cover, and the parts of a
  multi-part series always stay together.
- **Edit by hand:** move, copy, reorder (drag and drop), rename, merge, split or exclude, with undo.
- **Regroup with AI (optional):** paste a ready-made prompt into any chatbot for free, or run it
  from the app with a Google Gemini (free tier) or Anthropic Claude (paid) key. Every result is a
  proposal you review as a diff before anything changes.
- **Export to Spotify:** creates the playlists in your account, then keeps them up to date in
  place: no duplicates.
- **Stay current:** fetch new episodes from the RSS feed and place them in your playlists.
- **Private by design:** runs only on your computer. Your keys and Spotify login never leave it,
  except to talk to the service they belong to.

## Requirements

- **[Node.js](https://nodejs.org/) 22.22 or newer** (24.15+ also works). Check with `node -v`.
- **[Git](https://git-scm.com/downloads)** to download and update the app (or use *Download ZIP*
  on GitHub).
- **A Spotify account.** To export playlists you create a free Spotify developer app (step 2
  below). Since 2026 Spotify requires the owner of such an app to have **Spotify Premium**.

Works on Windows, macOS and Linux.

## Installation

1. **Download the code.** On GitHub, click the green **Code** button and copy the URL, then:

   ```bash
   git clone <repository-url> rest-is-playlists
   cd rest-is-playlists/app
   ```

   (Or choose *Download ZIP*, unzip it, and open a terminal in its `app` folder. With a ZIP you
   update by downloading again and copying your `.data` folder and `data/grouping.json` over.)

2. **Install the dependencies** (once, takes a minute or two):

   ```bash
   npm install
   ```

3. **Start the app:**

   ```bash
   npm run dev
   ```

4. **Open http://127.0.0.1:3000** in your browser.
   Use `127.0.0.1`, not `localhost`: Spotify's login only returns to `127.0.0.1`.

To stop the app, press `Ctrl+C` in the terminal. Next time, just run `npm run dev` in the `app`
folder again. Everything you change is saved on disk.

The **Dashboard** always shows what to do next.

## First-time setup

### 1. Look around (no setup needed)

Episodes and playlists are already there. Open **Playlists** to browse them and **Episodes**
to search all episodes. Change anything you like; nothing is saved until you press *Save*.

### 2. Create a Spotify developer app (once, about 5 minutes)

Spotify only lets apps create playlists for you through a developer app. It's free.

1. Go to the [Spotify developer dashboard](https://developer.spotify.com/dashboard) and log in
   with the Spotify account that has Premium.
2. Click **Create app** and fill in:
   - **App name:** anything, e.g. `Rest Is Playlists`
   - **App description:** anything, e.g. `Personal playlist exporter`
   - **Redirect URI:** exactly `http://127.0.0.1:3000/api/spotify/callback`
     (Spotify rejects `localhost`, so use the IP address)
   - If asked which APIs you plan to use, choose **Web API**.
3. Accept the Developer Terms of Service and save.
4. On the app's page, copy the **Client ID**. You do **not** need the client secret: the app
   logs in with PKCE, which works without one.
5. In Rest Is Playlists, open **Settings**, paste the Client ID and click *Save*.

**Sharing with family or friends:** a Spotify app in Development Mode works for its owner and up
to five more people. Add their name and Spotify email under *User Management* in the app's
settings on the Spotify dashboard. Each person still runs Rest Is Playlists on their own computer.

### 3. Export your playlists

1. Open **Export** and click **Connect Spotify**, then allow access.
2. Click **Match episodes**. The app looks up each episode on Spotify by title and release date.
   For the few that aren't found, use the *Search on Spotify* link, copy the episode link
   (*Share → Copy link to episode*) and paste it in. Unmatched episodes are simply left out.
3. Click **Export all**. The playlists appear in your Spotify library, private by default.

Changed something later? The Export page shows which playlists changed. Exporting again updates
the same Spotify playlists instead of creating new ones. Playlist name prefix (default `RIH · `)
and visibility are in **Settings**.

### 4. Optional: AI keys for regrouping

You don't need any key: the included grouping is ready to use, and the free **manual** method on
the **Grouping** page builds a prompt you paste into any chatbot (Claude, Gemini, ChatGPT, …).
To run grouping from the app instead, add a key in **Settings** and click *Test connection*:

| Provider | Cost | Get a key | Default model |
| --- | --- | --- | --- |
| Google Gemini | Free tier (low rate limits; Google may use free-tier prompts to improve its products; the prompts only contain public episode data) | [Google AI Studio](https://aistudio.google.com/apikey) | `gemini-3.6-flash` |
| Anthropic Claude | Paid, billed to your Anthropic account. A full regroup is roughly 60K input tokens | [Claude Console](https://platform.claude.com/settings/keys) | `claude-haiku-5-5` |

A full regroup takes about 8 requests; the page shows the estimate before you start and the
progress while it runs. The result is a **proposal**: you see what would change, then accept all
of it, only some playlists, or nothing.

## Keeping it up to date

New episodes come out twice a week. Every few weeks or months:

1. **Episodes → Refresh from RSS.** New episodes appear as *unassigned*.
2. **Grouping → New episodes only** (with an AI key or the manual prompt), then review and
   accept. Or add them by hand on the **Playlists** page.
3. **Export → Match again**, then **Export all**.

## Updating the app

To get a newer version of Rest Is Playlists:

```bash
cd rest-is-playlists
git pull
cd app
npm install
```

Your settings, keys and Spotify login live in `.data/`, which updates never touch.

**If you edited your playlists** and the update also changed the included grouping, `git pull`
stops with "Your local changes … would be overwritten". Keep your playlists like this:

```bash
git stash
git pull
git checkout stash@{0} -- data/grouping.json
git stash drop
```

This restores your own `grouping.json` after the update. Refresh the episodes in the app
afterwards to pick up any new ones.

## Your data and privacy

| File | What it holds | Shared on GitHub? |
| --- | --- | --- |
| `data/episodes.json` | Episode list from the public RSS feed | yes (part of the app) |
| `data/grouping.json` | Your playlists (starts as the included grouping) | yes (part of the app) |
| `.data/settings.json` | Spotify Client ID, AI keys, preferences | **no**, gitignored |
| `.data/spotify.json` | Spotify login tokens, episode matches, exported playlist ids | **no**, gitignored |
| `.data/proposal.json` | The grouping proposal you're reviewing | **no**, gitignored |
| `.data/backups/` | The last 20 versions of your playlists | **no**, gitignored |

- The browser never sees your keys or tokens: all calls to Spotify, the RSS feed and AI
  providers go through the app's local server. Saved keys show only their last 4 characters.
- The app itself talks only to the RSS feed (`feeds.megaphone.fm`), Spotify, and the AI
  provider you chose, and collects no usage data.
- **Made a mistake?** Every save of your playlists keeps a backup in `.data/backups/`. Copy one
  over `data/grouping.json` to go back.

## Run it on your own computer only

Rest Is Playlists is a personal desktop tool, not a web service. Don't run it on a server or
expose it to a network:

- it has **no login**: anyone who can open the page could use your API keys and Spotify account;
- Spotify only returns its login to `127.0.0.1` (or an HTTPS address);
- `npm run dev` listens on `127.0.0.1` only, so other devices can't reach it. Keep it that way.

## Troubleshooting

**`npm` complains about the Node.js version, or the app won't start.**
Install Node.js 22.22 or newer (the LTS version from [nodejs.org](https://nodejs.org/)) and run
`npm install` again.

**Windows: "running scripts is disabled on this system".**
PowerShell blocks `npm`'s script. Run the commands in **Command Prompt** (`cmd`) instead.

**Port 3000 is already in use.**
Stop the other program, or run on another port, for example 3001:
`npm run dev -- --port 3001`. Spotify needs a matching redirect URI, so also add
`http://127.0.0.1:3001/api/spotify/callback` to your Spotify app and put
`NUXT_SPOTIFY_REDIRECT_URI=http://127.0.0.1:3001/api/spotify/callback` in `app/.env`.

**Spotify: "INVALID_CLIENT: Invalid redirect URI".**
The redirect URI in your Spotify app must be exactly
`http://127.0.0.1:3000/api/spotify/callback`, and you must open the app at `127.0.0.1`.

**Spotify: 403 errors.**
The Spotify developer app's owner needs an active Premium subscription, and your account must
be the owner or listed under *User Management*.

**Spotify: "The Spotify session expired."**
Click **Connect Spotify** again. Spotify logins last about six months.

**Gemini: rate limited or daily quota used up.**
Free keys allow only a few requests per minute and per day. Wait, or use the manual method.

**Something else?** The error message in the app usually says what's wrong. For a clean start,
stop the app and delete the `.data` folder (you'll need to enter your keys and connect Spotify
again; your playlists in `data/grouping.json` stay).

## Advanced: environment overrides

Everything is configured on the **Settings** page. If you prefer environment variables, copy
[`app/.env.example`](app/.env.example) to `app/.env` (never committed) and fill in any of
`RIP_SPOTIFY_CLIENT_ID`, `RIP_ANTHROPIC_API_KEY`, `RIP_ANTHROPIC_MODEL`, `RIP_GEMINI_API_KEY`,
`RIP_GEMINI_MODEL`. Values set this way are read-only in Settings. The `RIP_` prefix keeps a
globally exported `ANTHROPIC_API_KEY` from being used by accident.

To fetch episodes without starting the app (no install needed): `node scripts/fetch-rss.mjs`.

## Development

Built with [Nuxt 4](https://nuxt.com/), [Nuxt UI](https://ui.nuxt.com/) and
[zod](https://zod.dev/). The design and the grouping rules are in [`SPEC.md`](SPEC.md).

```bash
cd app
npm run dev         # development server with hot reload
npm test            # unit tests (vitest)
npm run typecheck   # Vue and server type check
```

| Folder | Contents |
| --- | --- |
| `app/app/` | Pages, components and composables (Vue) |
| `app/server/` | API routes and server utilities: files, RSS, Spotify, AI providers |
| `app/shared/` | Framework-free logic shared by both, with tests in `app/test/` |
| `scripts/` | The standalone RSS fetcher and the parser it shares with the app |
| `data/` | Episode list and the playlist grouping |

To test the Spotify or Gemini integration without real accounts, point the server at a local mock
with `RIP_SPOTIFY_ACCOUNTS_URL`, `RIP_SPOTIFY_API_URL` or `RIP_GEMINI_BASE_URL`.

Issues and pull requests are welcome.

## License

[MIT](LICENSE) © 2026 Ákos Szarvák
