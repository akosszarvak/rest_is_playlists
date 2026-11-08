import {
  exportStatus,
  itemRequests,
  matchEpisodes,
  parseEpisodeLink,
  planExport,
  SPOTIFY_SHOW_ID,
  type PlaylistExportInfo,
  type SpotifyEpisode,
  type SpotifyStatus
} from '#shared/spotify'

/** Converts Spotify errors into HTTP errors with a readable message. */
export function asHttpError(error: unknown): Error {
  if (error instanceof SpotifyError) return createError({ statusCode: error.status, message: error.message })
  return error as Error
}

// --- Status ---------------------------------------------------------------------------------------

export async function getSpotifyStatus(): Promise<SpotifyStatus> {
  const [settings, spotify, grouping, episodes] = await Promise.all([getSettings(), readSpotify(), getGroupingState(), readEpisodes()])
  const exportSettings = { namePrefix: settings.playlists.namePrefix, visibility: settings.playlists.visibility }
  const all = episodes?.episodes ?? []
  const known = new Set(all.map(e => e.guid))
  const matches = Object.entries(spotify.matches).filter(([guid]) => known.has(guid))

  const playlists: PlaylistExportInfo[] = grouping.exists
    ? grouping.grouping.playlists.map((playlist) => {
        const plan = planExport(playlist, spotify.matches, exportSettings)
        const record = spotify.playlists[playlist.id]
        return {
          id: playlist.id,
          name: playlist.name,
          spotifyName: plan.name,
          episodes: playlist.episodes.length,
          exportable: plan.uris.length,
          missing: plan.missing.length,
          status: exportStatus(plan, record),
          url: record?.url ?? null,
          exportedAt: record?.exportedAt ?? null
        }
      })
    : []

  // Excluded episodes never get exported, so they don't need a match.
  const excluded = new Set(grouping.grouping.excluded.map(e => e.guid))
  const unmatched = spotify.lastMatchAt
    ? all.filter(e => !spotify.matches[e.guid] && !excluded.has(e.guid)).map(({ guid, title, releaseDate }) => ({ guid, title, releaseDate }))
    : []

  return {
    clientIdSet: Boolean(settings.spotify.clientId),
    redirectUri: spotifyRedirectUri(),
    connected: Boolean(spotify.auth),
    user: spotify.user,
    matching: {
      total: all.length - [...excluded].filter(g => known.has(g)).length,
      matched: matches.filter(([guid]) => !excluded.has(guid)).length,
      manual: matches.filter(([, m]) => m.method === 'manual').length,
      lastMatchAt: spotify.lastMatchAt
    },
    unmatched,
    playlists,
    lastExportAt: spotify.lastExportAt
  }
}

// --- Matching -------------------------------------------------------------------------------------

interface ShowEpisode { id: string, name: string, release_date: string }

/**
 * Pages through the show's episodes on Spotify and matches every RSS episode that has no
 * manual match. Auto matches are recomputed each time; manual matches are kept.
 */
export async function matchAllEpisodes(): Promise<{ spotifyEpisodes: number, matched: number, unmatched: number }> {
  const episodes = (await readEpisodes())?.episodes ?? []
  if (!episodes.length) throw createError({ statusCode: 409, message: 'No episodes yet. Refresh the episode list first.' })

  let show: ShowEpisode[]
  try {
    show = await fetchAllPages<ShowEpisode>(`/shows/${SPOTIFY_SHOW_ID}/episodes`)
  } catch (error) {
    if (error instanceof SpotifyError && (error.status === 403 || error.status === 404)) {
      throw createError({
        statusCode: error.status,
        message: `Spotify did not allow listing the show's episodes (${error.message}). Automatic matching is not possible; paste episode links for the episodes you need.`
      })
    }
    throw asHttpError(error)
  }
  const spotifyEpisodes: SpotifyEpisode[] = show.map(e => ({ id: e.id, name: e.name, releaseDate: e.release_date }))

  return updateSpotify((state) => {
    const manual = Object.fromEntries(Object.entries(state.matches).filter(([, m]) => m.method === 'manual'))
    const toMatch = episodes.filter(e => !manual[e.guid])
    const { matches, unmatched } = matchEpisodes(toMatch, spotifyEpisodes, new Set(Object.values(manual).map(m => m.episodeId)))
    const now = new Date().toISOString()
    state.matches = { ...manual }
    for (const [guid, episodeId] of matches) state.matches[guid] = { episodeId, method: 'auto', matchedAt: now }
    state.lastMatchAt = now
    return { spotifyEpisodes: spotifyEpisodes.length, matched: Object.keys(state.matches).length, unmatched: unmatched.length }
  })
}

/** Stores a manual match from a pasted Spotify link, after checking the episode exists. */
export async function setManualMatch(guid: string, link: string): Promise<{ episodeName: string }> {
  const episodes = (await readEpisodes())?.episodes ?? []
  if (!episodes.some(e => e.guid === guid)) throw createError({ statusCode: 404, message: 'Unknown episode.' })
  const episodeId = parseEpisodeLink(link)
  if (!episodeId) throw createError({ statusCode: 400, message: 'That is not a Spotify episode link. Use "Share → Copy link to episode" in Spotify.' })

  let episode: { name: string, show?: { id: string, name: string } }
  try {
    episode = await spotifyFetch(`/episodes/${episodeId}`)
  } catch (error) {
    if (error instanceof SpotifyError && (error.status === 404 || error.status === 400)) {
      throw createError({ statusCode: 404, message: 'Spotify has no episode with that link.' })
    }
    throw asHttpError(error)
  }
  if (episode.show && episode.show.id !== SPOTIFY_SHOW_ID) {
    throw createError({ statusCode: 400, message: `That episode belongs to "${episode.show.name}", not The Rest Is History.` })
  }

  await updateSpotify((state) => {
    for (const [otherGuid, match] of Object.entries(state.matches)) {
      if (match.episodeId === episodeId && otherGuid !== guid) delete state.matches[otherGuid]
    }
    state.matches[guid] = { episodeId, method: 'manual', matchedAt: new Date().toISOString() }
  })
  return { episodeName: episode.name }
}

// --- Export ---------------------------------------------------------------------------------------

let ownPlaylistsCache: { ids: Set<string>, at: number } | null = null

/** Ids of the playlists in the user's library. A playlist "deleted" in Spotify disappears from here. */
async function ownPlaylistIds(): Promise<Set<string>> {
  if (ownPlaylistsCache && Date.now() - ownPlaylistsCache.at < 30_000) return ownPlaylistsCache.ids
  const items = await fetchAllPages<{ id: string }>('/me/playlists')
  ownPlaylistsCache = { ids: new Set(items.map(p => p.id)), at: Date.now() }
  return ownPlaylistsCache.ids
}

/**
 * Exports one playlist idempotently (SPEC 6): creates it the first time, afterwards updates
 * details and replaces the items in place. Recreates it if the user deleted it in Spotify.
 */
export async function exportPlaylist(playlistId: string): Promise<{ created: boolean, missing: number, url: string }> {
  const [settings, state, grouping] = await Promise.all([getSettings(), readSpotify(), getGroupingState()])
  if (!state.auth) throw createError({ statusCode: 401, message: 'Not connected to Spotify.' })
  const playlist = grouping.grouping.playlists.find(p => p.id === playlistId)
  if (!playlist) throw createError({ statusCode: 404, message: `Playlist "${playlistId}" not found in the grouping.` })

  const plan = planExport(playlist, state.matches, { namePrefix: settings.playlists.namePrefix, visibility: settings.playlists.visibility })
  try {
    const record = state.playlists[playlistId]
    let spotifyId = record?.spotifyId
    let url = record?.url
    let created = false

    if (spotifyId && !(await ownPlaylistIds()).has(spotifyId)) spotifyId = undefined

    if (spotifyId) {
      await spotifyFetch(`/playlists/${spotifyId}`, { method: 'PUT', body: { name: plan.name, description: plan.description, public: plan.public } })
    } else {
      const createdPlaylist = await spotifyFetch<{ id: string, external_urls: { spotify: string } }>('/me/playlists', {
        method: 'POST',
        body: { name: plan.name, description: plan.description, public: plan.public }
      })
      spotifyId = createdPlaylist.id
      url = createdPlaylist.external_urls.spotify
      created = true
      ownPlaylistsCache?.ids.add(spotifyId)
    }

    const { replace, add } = itemRequests(plan.uris)
    await spotifyFetch(`/playlists/${spotifyId}/items`, { method: 'PUT', body: { uris: replace } })
    for (const batch of add) await spotifyFetch(`/playlists/${spotifyId}/items`, { method: 'POST', body: { uris: batch } })

    const finalUrl = url ?? `https://open.spotify.com/playlist/${spotifyId}`
    await updateSpotify((s) => {
      const now = new Date().toISOString()
      s.playlists[playlistId] = { spotifyId: spotifyId!, url: finalUrl, hash: plan.hash, exportedAt: now }
      s.lastExportAt = now
    })
    return { created, missing: plan.missing.length, url: finalUrl }
  } catch (error) {
    throw asHttpError(error)
  }
}
