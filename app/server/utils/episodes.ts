import { episodesFileSchema, type EpisodeRef, type EpisodesFile, type RefreshResult } from '#shared/episodes'
// Same parser as the CLI script (node scripts/fetch-rss.mjs).
import { FEED_URL, fetchEpisodes } from '#rss'

const episodesPath = () => repoPath('data', 'episodes.json')

/**
 * A refresh may not shrink the list by more than this share. A feed outage or a
 * truncated response must never wipe the committed episode list.
 */
const MAX_SHRINK = 0.1

/** Reads `data/episodes.json`. Returns `null` if it hasn't been fetched yet. */
export function readEpisodes(): Promise<EpisodesFile | null> {
  return readJsonFile(episodesPath(), episodesFileSchema)
}

const toRef = ({ guid, title, releaseDate }: EpisodeRef): EpisodeRef => ({ guid, title, releaseDate })

let running: Promise<RefreshResult> | null = null

/** Fetches the RSS feed, validates it, and replaces `data/episodes.json`. One refresh at a time. */
export function refreshEpisodes(): Promise<RefreshResult> {
  running ??= doRefresh().finally(() => { running = null })
  return running
}

async function doRefresh(): Promise<RefreshResult> {
  let raw: unknown
  try {
    raw = await fetchEpisodes(FEED_URL, { signal: AbortSignal.timeout(60_000) })
  } catch (error) {
    throw createError({ statusCode: 502, message: `Could not fetch the RSS feed: ${(error as Error).message}` })
  }

  const parsed = episodesFileSchema.safeParse(raw)
  if (!parsed.success) {
    throw createError({
      statusCode: 502,
      message: `The RSS feed returned data that failed validation, so nothing was saved: ${formatZodIssues(parsed.error)}`
    })
  }
  const next = parsed.data

  const previous = await readEpisodes()
  if (previous && next.count < previous.count * (1 - MAX_SHRINK)) {
    throw createError({
      statusCode: 502,
      message: `The feed returned only ${next.count} episodes (was ${previous.count}). This looks like a feed problem, so nothing was saved.`
    })
  }

  const oldGuids = new Set(previous?.episodes.map(e => e.guid))
  const newGuids = new Set(next.episodes.map(e => e.guid))
  await writeJsonFile(episodesPath(), next)

  return {
    count: next.count,
    fetchedAt: next.fetchedAt,
    added: next.episodes.filter(e => !oldGuids.has(e.guid)).map(toRef),
    removed: (previous?.episodes ?? []).filter(e => !newGuids.has(e.guid)).map(toRef)
  }
}
