/** Exports one playlist to Spotify (create on first export, update in place afterwards). */
export default defineEventHandler(async (event) => {
  const id = getRouterParam(event, 'id')
  if (!id) throw createError({ statusCode: 400, message: 'Missing playlist id.' })
  return exportPlaylist(id)
})
