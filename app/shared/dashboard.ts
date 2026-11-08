// Dashboard summary and "what to do next" hints (SPEC 4.1). Pure and tested.

export interface DashboardSummary {
  episodes: { count: number, fetchedAt: string | null, newest: { title: string, releaseDate: string } | null }
  grouping: { exists: boolean, playlists: number, unassigned: number, excluded: number, method: string | null, generatedAt: string | null }
  proposalOpen: boolean
  ai: { anthropic: boolean, gemini: boolean }
  spotify: {
    clientIdSet: boolean
    connected: boolean
    user: string | null
    matched: number
    total: number
    lastMatchAt: string | null
    lastExportAt: string | null
    pendingExports: number
  }
}

export interface NextStep {
  id: string
  title: string
  description: string
  to: string
  action: string
  /** "todo" needs doing; "info" is optional or a reminder. */
  kind: 'todo' | 'info'
}

/** Episodes older than this suggest a refresh (the README advises every few months). */
export const STALE_AFTER_DAYS = 60

function daysSince(iso: string, now: number): number {
  return Math.floor((now - Date.parse(iso)) / 86_400_000)
}

/** What the user should do next, most important first. Empty when everything is done. */
export function nextSteps(s: DashboardSummary, now = Date.now()): NextStep[] {
  const steps: NextStep[] = []

  if (!s.episodes.count) {
    return [{ id: 'fetch', title: 'Fetch the episode list', description: 'Load every episode from the podcast\'s RSS feed.', to: '/episodes', action: 'Go to Episodes', kind: 'todo' }]
  }
  if (s.episodes.fetchedAt && daysSince(s.episodes.fetchedAt, now) > STALE_AFTER_DAYS) {
    steps.push({ id: 'refresh', title: 'Refresh the episode list', description: `Last fetched ${daysSince(s.episodes.fetchedAt, now)} days ago. New episodes will show up as unassigned.`, to: '/episodes', action: 'Refresh', kind: 'info' })
  }

  if (s.proposalOpen) {
    steps.push({ id: 'review', title: 'Review the open proposal', description: 'A grouping proposal is waiting. Accept all of it, some playlists, or discard it.', to: '/grouping', action: 'Review', kind: 'todo' })
  } else if (!s.grouping.exists || !s.grouping.playlists) {
    const ai = s.ai.anthropic || s.ai.gemini
    steps.push({
      id: 'group',
      title: 'Group the episodes into playlists',
      description: ai
        ? 'Run a full regroup with your AI provider, or copy the prompt into any chatbot.'
        : 'Copy the prompt into any chatbot (free), or add a Gemini key in Settings to run it from here.',
      to: '/grouping',
      action: 'Go to Grouping',
      kind: 'todo'
    })
  } else if (s.grouping.unassigned) {
    steps.push({
      id: 'place',
      title: `Place ${s.grouping.unassigned} unassigned episode${s.grouping.unassigned === 1 ? '' : 's'}`,
      description: 'Use "New episodes only" on the Grouping page, or add them by hand on the Playlists page.',
      to: '/grouping',
      action: 'Place them',
      kind: 'todo'
    })
  }

  const hasPlaylists = s.grouping.exists && s.grouping.playlists > 0
  if (!s.spotify.clientIdSet) {
    steps.push({ id: 'client-id', title: 'Set up Spotify', description: 'Create a free Spotify developer app and paste its Client ID in Settings (see the README).', to: '/settings', action: 'Open Settings', kind: hasPlaylists ? 'todo' : 'info' })
  } else if (!s.spotify.connected) {
    steps.push({ id: 'connect', title: 'Connect Spotify', description: 'Log in with your Spotify account to export playlists.', to: '/export', action: 'Connect', kind: hasPlaylists ? 'todo' : 'info' })
  } else if (!s.spotify.lastMatchAt) {
    steps.push({ id: 'match', title: 'Match episodes to Spotify', description: 'Find each episode on Spotify before exporting.', to: '/export', action: 'Match', kind: 'todo' })
  } else if (s.spotify.matched < s.spotify.total) {
    steps.push({ id: 'unmatched', title: `${s.spotify.total - s.spotify.matched} episodes not matched on Spotify`, description: 'Match again after an RSS refresh, or paste links for the missing ones. Unmatched episodes are left out of exports.', to: '/export', action: 'Fix', kind: 'info' })
  }

  if (s.spotify.connected && s.spotify.lastMatchAt && s.spotify.pendingExports) {
    steps.push({
      id: 'export',
      title: `Export ${s.spotify.pendingExports} playlist${s.spotify.pendingExports === 1 ? '' : 's'}`,
      description: 'Some playlists are new or changed since the last export.',
      to: '/export',
      action: 'Export',
      kind: 'todo'
    })
  }

  // Todos first, then reminders; stable otherwise.
  return [...steps.filter(x => x.kind === 'todo'), ...steps.filter(x => x.kind === 'info')]
}
