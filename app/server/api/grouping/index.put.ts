import { groupingUpdateSchema } from '#shared/grouping'

/**
 * Saves manual edits from the Playlists page. The user pressed Save, which is the confirmation.
 * Keeps the grouping's method and generatedAt: manual edits refine a grouping, they don't regenerate it.
 */
export default defineEventHandler(async (event) => {
  const update = await readBodyWith(event, groupingUpdateSchema)
  return saveGrouping(update.revision, current => ({
    version: 1,
    generatedAt: current?.generatedAt ?? new Date().toISOString(),
    method: current?.method ?? 'manual',
    playlists: update.playlists,
    excluded: update.excluded
  }))
})
