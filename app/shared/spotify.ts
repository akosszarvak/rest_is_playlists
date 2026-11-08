// Spotify: stored state, episode matching and export planning (SPEC section 6). Pure and tested.
import { z } from 'zod'
import type { Episode } from './episodes'
import type { Playlist } from './grouping'

export const SPOTIFY_SHOW_ID = '7Cvsbcjhtur7nplC148TWy'
export const SPOTIFY_SCOPES = ['playlist-modify-private', 'playlist-modify-public', 'playlist-read-private']
/** Spotify accepts loopback redirects only as an IP literal, never "localhost". */
export const DEFAULT_REDIRECT_URI = 'http://127.0.0.1:3000/api/spotify/callback'
/** Items per add/replace request (Spotify maximum). */
export const ITEMS_PER_REQUEST = 100

// --- Stored state (.data/spotify.json) -----------------------------------------------------------

const matchSchema = z.object({
  episodeId: z.string().regex(/^[0-9A-Za-z]{22}$/),
  method: z.enum(['auto', 'manual']),
  matchedAt: z.iso.datetime()
})
export type EpisodeMatch = z.infer<typeof matchSchema>

const exportRecordSchema = z.object({
  spotifyId: z.string(),
  url: z.string(),
  /** Hash of what was exported, to tell "up to date" from "changed since export". */
  hash: z.string(),
  exportedAt: z.iso.datetime()
})
export type ExportRecord = z.infer<typeof exportRecordSchema>

export const spotifyFileSchema = z.object({
  auth: z.object({
    clientId: z.string(),
    accessToken: z.string(),
    refreshToken: z.string(),
    expiresAt: z.number(),
    scope: z.string()
  }).nullable().default(null),
  user: z.object({ id: z.string(), displayName: z.string().nullable() }).nullable().default(null),
  /** Pending PKCE login (verifier and state), cleared after the callback. */
  pending: z.object({ verifier: z.string(), state: z.string(), createdAt: z.number() }).nullable().default(null),
  matches: z.record(z.string(), matchSchema).default({}),
  lastMatchAt: z.iso.datetime().nullable().default(null),
  /** Spotify playlist per grouping playlist id. */
  playlists: z.record(z.string(), exportRecordSchema).default({}),
  lastExportAt: z.iso.datetime().nullable().default(null)
})
export type SpotifyFile = z.infer<typeof spotifyFileSchema>

// --- Episode matching ------------------------------------------------------------------------------

export interface SpotifyEpisode {
  id: string
  name: string
  releaseDate: string // YYYY-MM-DD (or shorter for low precision)
}

/** "720. The Suez Crisis: Britain’s Shattered Empire (Part 2)" -> "the suez crisis britains shattered empire part 2" */
export function normalizeTitle(title: string): string {
  return title
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/^\s*\d+\s*[.:)-]\s*/, '') // leading episode number
    .replace(/['’‘`]/g, '')
    .replace(/&/g, ' and ')
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function dayDiff(a: string, b: string): number {
  if (a.length < 10 || b.length < 10) return Number.POSITIVE_INFINITY
  return Math.abs(Date.parse(`${a}T00:00:00Z`) - Date.parse(`${b}T00:00:00Z`)) / 86_400_000
}

function similarity(a: string, b: string): number {
  const ta = new Set(a.split(' '))
  const tb = new Set(b.split(' '))
  const shared = [...ta].filter(t => tb.has(t)).length
  return shared / Math.max(ta.size, tb.size, 1)
}

export interface MatchResult {
  /** guid -> Spotify episode id */
  matches: Map<string, string>
  unmatched: string[]
}

/**
 * Matches RSS episodes to Spotify episodes by normalized title plus release date (±1 day).
 * Fallbacks, in order: same title on any date (if unique), then a close title (≥ 80% shared
 * words) within ±1 day. Each Spotify episode is used at most once.
 */
export function matchEpisodes(rss: Episode[], spotify: SpotifyEpisode[], alreadyTaken: Set<string> = new Set()): MatchResult {
  const taken = new Set(alreadyTaken)
  const matches = new Map<string, string>()
  const items = spotify.map(s => ({ ...s, title: normalizeTitle(s.name) }))
  const byTitle = new Map<string, typeof items>()
  for (const item of items) byTitle.set(item.title, [...(byTitle.get(item.title) ?? []), item])

  const pending = rss.map(e => ({ episode: e, title: normalizeTitle(e.title) }))
  const passes: ((e: { episode: Episode, title: string }) => string | undefined)[] = [
    // 1. Same title, date within a day.
    e => byTitle.get(e.title)?.find(s => !taken.has(s.id) && dayDiff(s.releaseDate, e.episode.releaseDate) <= 1)?.id,
    // 2. Same title on any date, if only one unused candidate.
    (e) => {
      const free = (byTitle.get(e.title) ?? []).filter(s => !taken.has(s.id))
      return free.length === 1 ? free[0]!.id : undefined
    },
    // 3. Close title within a day.
    (e) => {
      let best: { id: string, score: number } | undefined
      for (const s of items) {
        if (taken.has(s.id) || dayDiff(s.releaseDate, e.episode.releaseDate) > 1) continue
        const score = similarity(e.title, s.title)
        if (score >= 0.8 && (!best || score > best.score)) best = { id: s.id, score }
      }
      return best?.id
    }
  ]

  let remaining = pending
  for (const pass of passes) {
    const next: typeof pending = []
    for (const item of remaining) {
      const id = pass(item)
      if (id) {
        matches.set(item.episode.guid, id)
        taken.add(id)
      } else {
        next.push(item)
      }
    }
    remaining = next
  }
  return { matches, unmatched: remaining.map(r => r.episode.guid) }
}

/** Extracts the episode id from "https://open.spotify.com/episode/<id>?si=…", "spotify:episode:<id>" or a bare id. */
export function parseEpisodeLink(input: string): string | null {
  const text = input.trim()
  const match = text.match(/(?:open\.spotify\.com\/(?:intl-[a-z-]+\/)?episode\/|spotify:episode:)([0-9A-Za-z]{22})/)
    ?? text.match(/^([0-9A-Za-z]{22})$/)
  return match ? match[1]! : null
}

// --- Export ---------------------------------------------------------------------------------------

export interface ExportSettings {
  namePrefix: string
  visibility: 'private' | 'public'
}

export interface ExportPlan {
  name: string
  description: string
  public: boolean
  uris: string[]
  /** Episodes in the playlist without a Spotify match (left out). */
  missing: string[]
  hash: string
}

/** Small stable string hash (FNV-1a), enough to detect changes. */
function hashString(text: string): string {
  let hash = 0x811C9DC5
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(16).padStart(8, '0')
}

/** What a playlist should look like on Spotify. */
export function planExport(playlist: Playlist, matches: Record<string, EpisodeMatch>, settings: ExportSettings): ExportPlan {
  const uris: string[] = []
  const missing: string[] = []
  for (const guid of playlist.episodes) {
    const match = matches[guid]
    if (match) uris.push(`spotify:episode:${match.episodeId}`)
    else missing.push(guid)
  }
  const name = `${settings.namePrefix}${playlist.name}`.slice(0, 100)
  const description = playlist.description.replace(/\s+/g, ' ').trim()
  const isPublic = settings.visibility === 'public'
  return { name, description, public: isPublic, uris, missing, hash: hashString(JSON.stringify([name, description, isPublic, uris])) }
}

export type ExportStatus = 'not-exported' | 'up-to-date' | 'changed'

export function exportStatus(plan: ExportPlan, record: ExportRecord | undefined): ExportStatus {
  if (!record) return 'not-exported'
  return record.hash === plan.hash ? 'up-to-date' : 'changed'
}

/** Splits URIs into the first replace request (PUT) and the following add requests (POST). */
export function itemRequests(uris: string[]): { replace: string[], add: string[][] } {
  const add: string[][] = []
  for (let i = ITEMS_PER_REQUEST; i < uris.length; i += ITEMS_PER_REQUEST) add.push(uris.slice(i, i + ITEMS_PER_REQUEST))
  return { replace: uris.slice(0, ITEMS_PER_REQUEST), add }
}

// --- API responses for the UI -------------------------------------------------------------------

export interface PlaylistExportInfo {
  id: string
  name: string
  spotifyName: string
  episodes: number
  exportable: number
  missing: number
  status: ExportStatus
  url: string | null
  exportedAt: string | null
}

export interface SpotifyStatus {
  clientIdSet: boolean
  redirectUri: string
  connected: boolean
  user: { id: string, displayName: string | null } | null
  matching: { total: number, matched: number, manual: number, lastMatchAt: string | null }
  unmatched: { guid: string, title: string, releaseDate: string }[]
  playlists: PlaylistExportInfo[]
  lastExportAt: string | null
}

export const manualMatchRequestSchema = z.strictObject({
  guid: z.string().min(1),
  link: z.string().trim().min(1, 'Paste a Spotify episode link.')
})
