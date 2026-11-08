/** Starts the Spotify PKCE login by redirecting to Spotify's authorize page. */
export default defineEventHandler(async (event) => {
  try {
    return sendRedirect(event, await startLogin())
  } catch (error) {
    return sendRedirect(event, `/export?spotifyError=${encodeURIComponent(errorText(error))}`)
  }
})
