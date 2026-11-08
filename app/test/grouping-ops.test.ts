import { describe, expect, it } from 'vitest'
import { groupingSchema, type GroupingContent } from '../shared/grouping'
import {
  addEpisodes,
  computeUnassigned,
  createPlaylist,
  deletePlaylist,
  excludeEpisodes,
  findIssues,
  includeEpisodes,
  membership,
  mergePlaylists,
  moveEpisodes,
  removeEpisodes,
  reorderEpisodes,
  slugify,
  sortByReleaseDate,
  updatePlaylist
} from '../shared/grouping-ops'

const ALL = ['e1', 'e2', 'e3', 'e4', 'e5']

function base(): GroupingContent {
  return {
    playlists: [
      { id: 'rome', name: 'Ancient Rome', description: '', kind: 'broad', parent: null, era: { start: -753, end: 476 }, episodes: ['e1', 'e2', 'e3'] },
      { id: 'punic', name: 'Punic Wars', description: '', kind: 'series', parent: 'rome', era: null, episodes: ['e2', 'e3'] },
      { id: 'medieval', name: 'Medieval Europe', description: '', kind: 'broad', parent: null, era: null, episodes: ['e4'] }
    ],
    excluded: [{ guid: 'e5', reason: 'trailer' }]
  }
}

describe('slugify', () => {
  it('makes kebab-case ids without apostrophes or accents', () => {
    expect(slugify('The Hundred Years\' War')).toBe('the-hundred-years-war')
    expect(slugify('Château & Crème')).toBe('chateau-creme')
    expect(slugify('!!!')).toBe('playlist')
  })
})

describe('createPlaylist', () => {
  it('adds a playlist with a unique id and un-excludes its episodes', () => {
    const { content, id } = createPlaylist(base(), { name: 'Ancient Rome', episodes: ['e5', 'e5'] })
    expect(id).toBe('ancient-rome')
    const again = createPlaylist(content, { name: 'Ancient Rome' })
    expect(again.id).toBe('ancient-rome-2')
    expect(content.playlists.at(-1)?.episodes).toEqual(['e5'])
    expect(content.excluded).toEqual([])
  })

  it('does not mutate its input', () => {
    const input = base()
    const snapshot = structuredClone(input)
    createPlaylist(input, { name: 'X', episodes: ['e5'] })
    expect(input).toEqual(snapshot)
  })
})

describe('updatePlaylist', () => {
  it('keeps the id stable and drops the parent of a broad playlist', () => {
    const next = updatePlaylist(base(), 'punic', { name: 'Punic', description: 'd', kind: 'broad', parent: 'rome', era: null })
    const punic = next.playlists.find(p => p.id === 'punic')!
    expect(punic).toMatchObject({ id: 'punic', name: 'Punic', kind: 'broad', parent: null })
  })

  it('detaches children when a broad playlist becomes a series', () => {
    const next = updatePlaylist(base(), 'rome', { name: 'Rome', description: '', kind: 'series', parent: null, era: null })
    expect(next.playlists.find(p => p.id === 'punic')!.parent).toBeNull()
  })
})

describe('deletePlaylist / mergePlaylists', () => {
  it('delete leaves episodes unassigned only if they are in no other playlist', () => {
    const next = deletePlaylist(base(), 'rome')
    expect(computeUnassigned(next, ALL)).toEqual(['e1'])
    expect(next.playlists.find(p => p.id === 'punic')!.parent).toBeNull()
  })

  it('merge appends missing episodes, deletes the source and re-parents its series', () => {
    const next = mergePlaylists(base(), 'rome', 'medieval')
    expect(next.playlists.map(p => p.id)).toEqual(['punic', 'medieval'])
    expect(next.playlists.find(p => p.id === 'medieval')!.episodes).toEqual(['e4', 'e1', 'e2', 'e3'])
    expect(next.playlists.find(p => p.id === 'punic')!.parent).toBe('medieval')
  })

  it('refuses to merge a playlist into itself', () => {
    expect(() => mergePlaylists(base(), 'rome', 'rome')).toThrow()
  })
})

describe('episode operations', () => {
  it('add skips duplicates and can insert at an index', () => {
    const next = addEpisodes(base(), 'medieval', ['e1', 'e4', 'e2'], 0)
    expect(next.playlists.find(p => p.id === 'medieval')!.episodes).toEqual(['e1', 'e2', 'e4'])
  })

  it('remove makes episodes unassigned when no other playlist has them', () => {
    const next = removeEpisodes(base(), 'medieval', ['e4'])
    expect(computeUnassigned(next, ALL)).toEqual(['e4'])
  })

  it('move removes from source and appends to target', () => {
    const next = moveEpisodes(base(), 'rome', 'medieval', ['e1'])
    expect(next.playlists.find(p => p.id === 'rome')!.episodes).toEqual(['e2', 'e3'])
    expect(next.playlists.find(p => p.id === 'medieval')!.episodes).toEqual(['e4', 'e1'])
  })

  it('reorder requires exactly the same episodes', () => {
    expect(reorderEpisodes(base(), 'rome', ['e3', 'e1', 'e2']).playlists[0]!.episodes).toEqual(['e3', 'e1', 'e2'])
    expect(() => reorderEpisodes(base(), 'rome', ['e1', 'e2'])).toThrow()
    expect(() => reorderEpisodes(base(), 'rome', ['e1', 'e2', 'e4'])).toThrow()
  })

  it('sorts by release date', () => {
    const dates: Record<string, string> = { e1: '2024-01-03', e2: '2024-01-01', e3: '2024-01-02' }
    const next = sortByReleaseDate(base(), 'rome', g => dates[g])
    expect(next.playlists[0]!.episodes).toEqual(['e2', 'e3', 'e1'])
  })

  it('exclude removes from all playlists; include makes them unassigned', () => {
    const excluded = excludeEpisodes(base(), ['e2', 'e5'], 'other')
    expect(membership(excluded).has('e2')).toBe(false)
    expect(excluded.excluded).toEqual([{ guid: 'e5', reason: 'other' }, { guid: 'e2', reason: 'other' }])
    const included = includeEpisodes(excluded, ['e2'])
    expect(computeUnassigned(included, ALL)).toEqual(['e2'])
  })
})

describe('findIssues', () => {
  it('reports unknown episodes, series not in parent, and empty playlists', () => {
    const content = base()
    content.playlists[1]!.episodes.push('e4', 'ghost')
    content.playlists.push({ id: 'empty', name: 'Empty', description: '', kind: 'broad', parent: null, era: null, episodes: [] })
    expect(findIssues(content, ALL)).toEqual([
      { type: 'unknown-episodes', guids: ['ghost'] },
      { type: 'series-not-in-parent', playlistId: 'punic', parentId: 'rome', guids: ['e4', 'ghost'] },
      { type: 'empty-playlist', playlistId: 'empty' }
    ])
  })
})

describe('groupingSchema structure rules', () => {
  const doc = (content: GroupingContent) => ({
    version: 1, generatedAt: '2026-11-08T12:00:00.000Z', method: 'manual', unassigned: [], ...content
  })

  it('accepts a valid grouping', () => {
    expect(groupingSchema.safeParse(doc(base())).success).toBe(true)
  })

  it('rejects duplicate ids, bad parents, duplicates and excluded-but-placed episodes', () => {
    const content = base()
    content.playlists.push({ ...content.playlists[0]! })
    content.playlists[2]!.parent = 'rome'
    content.playlists[0]!.episodes.push('e1')
    content.excluded.push({ guid: 'e4', reason: 'other' })
    const result = groupingSchema.safeParse(doc(content))
    expect(result.success).toBe(false)
    const messages = result.error!.issues.map(i => i.message).join('\n')
    expect(messages).toContain('Duplicate playlist id "rome"')
    expect(messages).toContain('Only series playlists can have a parent')
    expect(messages).toContain('appears twice')
    expect(messages).toContain('both excluded and in a playlist')
  })
})
