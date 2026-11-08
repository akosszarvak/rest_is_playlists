/** Spotify redirects here after login. Tokens are stored server-side in .data/spotify.json. */
export default defineEventHandler(async (event) => {
  const query = getQuery(event)
  if (typeof query.error === 'string') {
    const reason = query.error === 'access_denied' ? 'You declined the Spotify login.' : `Spotify login failed: ${query.error}`
    return sendRedirect(event, `/export?spotifyError=${encodeURIComponent(reason)}`)
  }
  if (typeof query.code !== 'string' || typeof query.state !== 'string') {
    return sendRedirect(event, `/export?spotifyError=${encodeURIComponent('Spotify did not return a login code.')}`)
  }
  try {
    await finishLogin(query.code, query.state)
    return sendRedirect(event, '/export?spotify=connected')
  } catch (error) {
    return sendRedirect(event, `/export?spotifyError=${encodeURIComponent(errorText(error))}`)
  }
})
