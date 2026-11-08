import type { EpisodesFile } from '#shared/episodes'

/** The fetched episode list, or `null` if `data/episodes.json` doesn't exist yet. */
export default defineEventHandler(async (): Promise<EpisodesFile | null> => readEpisodes())
