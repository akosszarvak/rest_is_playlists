import { manualMatchRequestSchema } from '#shared/spotify'

/** Fixes one unmatched episode with a pasted Spotify episode link. */
export default defineEventHandler(async (event) => {
  const { guid, link } = await readBodyWith(event, manualMatchRequestSchema)
  return setManualMatch(guid, link)
})
