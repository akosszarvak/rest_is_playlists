import { describe, expect, it } from 'vitest'
import { nextSteps, type DashboardSummary } from '../shared/dashboard'

const NOW = Date.parse('2026-11-08T12:00:00Z')

function summary(overrides: Partial<{ [K in keyof DashboardSummary]: Partial<DashboardSummary[K]> | DashboardSummary[K] }> = {}): DashboardSummary {
  const base: DashboardSummary = {
    episodes: { count: 738, fetchedAt: '2026-11-01T00:00:00Z', newest: null },
    grouping: { exists: true, playlists: 20, unassigned: 0, excluded: 6, method: 'manual', generatedAt: '2026-11-01T00:00:00Z' },
    proposalOpen: false,
    ai: { anthropic: false, gemini: false },
    spotify: { clientIdSet: true, connected: true, user: 'me', matched: 732, total: 732, lastMatchAt: '2026-11-02T00:00:00Z', lastExportAt: '2026-11-02T00:00:00Z', pendingExports: 0 }
  }
  return {
    ...base,
    ...overrides,
    episodes: { ...base.episodes, ...overrides.episodes },
    grouping: { ...base.grouping, ...overrides.grouping },
    ai: { ...base.ai, ...overrides.ai },
    spotify: { ...base.spotify, ...overrides.spotify }
  } as DashboardSummary
}

const ids = (s: DashboardSummary) => nextSteps(s, NOW).map(x => x.id)

describe('nextSteps', () => {
  it('is empty when everything is done', () => {
    expect(ids(summary())).toEqual([])
  })

  it('starts with fetching when there are no episodes', () => {
    expect(ids(summary({ episodes: { count: 0, fetchedAt: null } }))).toEqual(['fetch'])
  })

  it('walks a first run: group, then set up Spotify', () => {
    const first = summary({
      grouping: { exists: false, playlists: 0, unassigned: 738 },
      spotify: { clientIdSet: false, connected: false, lastMatchAt: null, lastExportAt: null }
    })
    expect(nextSteps(first, NOW).map(x => [x.id, x.kind])).toEqual([['group', 'todo'], ['client-id', 'info']])
  })

  it('a review comes before placing episodes, exports after matching', () => {
    expect(ids(summary({ proposalOpen: true, grouping: { unassigned: 3 } }))).toEqual(['review'])
    expect(ids(summary({ grouping: { unassigned: 3 }, spotify: { pendingExports: 2 } }))).toEqual(['place', 'export'])
    expect(ids(summary({ spotify: { lastMatchAt: null, pendingExports: 2 } }))).toEqual(['match'])
  })

  it('reminds about stale episodes and unmatched ones after the todos', () => {
    expect(ids(summary({ episodes: { fetchedAt: '2026-08-01T00:00:00Z' }, spotify: { matched: 730, pendingExports: 1 } })))
      .toEqual(['export', 'refresh', 'unmatched'])
  })
})
