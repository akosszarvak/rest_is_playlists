import type { DashboardSummary } from '#shared/dashboard'

/** Small summary for the Dashboard, so it doesn't load the full episode list. */
export default defineEventHandler(async (): Promise<DashboardSummary> => {
  const [episodes, grouping, proposal, settings, spotify] = await Promise.all([
    readEpisodes(),
    getGroupingState(),
    getProposalState(),
    getSettings(),
    getSpotifyStatus()
  ])
  const newest = episodes?.episodes.at(-1)
  return {
    episodes: {
      count: episodes?.count ?? 0,
      fetchedAt: episodes?.fetchedAt ?? null,
      newest: newest ? { title: newest.title, releaseDate: newest.releaseDate } : null
    },
    grouping: {
      exists: grouping.exists,
      playlists: grouping.grouping.playlists.length,
      unassigned: grouping.grouping.unassigned.length,
      excluded: grouping.grouping.excluded.length,
      method: grouping.exists ? grouping.grouping.method : null,
      generatedAt: grouping.exists ? grouping.grouping.generatedAt : null
    },
    proposalOpen: proposal.proposal !== null,
    ai: { anthropic: Boolean(settings.anthropic.apiKey), gemini: Boolean(settings.gemini.apiKey) },
    spotify: {
      clientIdSet: spotify.clientIdSet,
      connected: spotify.connected,
      user: spotify.user?.displayName ?? spotify.user?.id ?? null,
      matched: spotify.matching.matched,
      total: spotify.matching.total,
      lastMatchAt: spotify.matching.lastMatchAt,
      lastExportAt: spotify.lastExportAt,
      pendingExports: spotify.playlists.filter(p => p.status !== 'up-to-date').length
    }
  }
})
