import { describe, expect, it } from 'vitest'
import type { Episode } from '../shared/episodes'
import { groupingSchema, type GroupingContent } from '../shared/grouping'
import {
  applyAccepted,
  buildPrompt,
  cleanDescription,
  diffGroupings,
  episodeKeys,
  extractJson,
  keyResolver,
  parseAnswer
} from '../shared/proposal'

const GUIDS = ['g-rome-1', 'g-rome-2', 'g-punic-1', 'g-punic-2', 'g-medieval', 'g-trailer', 'g-new']

function episode(guid: string, i: number): Episode {
  return {
    guid,
    title: `Episode ${guid}`,
    releaseDate: `2024-01-${String(i + 1).padStart(2, '0')}`,
    durationSec: 3000,
    episodeType: guid === 'g-trailer' ? 'trailer' : 'full',
    episodeNumber: i + 1,
    season: null,
    audioUrl: null,
    description: `About ${guid}.\n\nFor more Goalhanger Podcasts, head to www.goalhanger.com\n\nProducer: Someone`
  }
}
const EPISODES = GUIDS.map(episode)
const keys = episodeKeys(GUIDS)
const k = (guid: string) => keys.get(guid)!

function current(): GroupingContent {
  return {
    playlists: [
      { id: 'rome', name: 'Ancient Rome', description: '', kind: 'broad', parent: null, era: null, episodes: ['g-rome-1', 'g-punic-1', 'g-punic-2', 'g-rome-2'] },
      { id: 'punic', name: 'Punic Wars', description: '', kind: 'series', parent: 'rome', era: null, episodes: ['g-punic-1', 'g-punic-2'] },
      { id: 'medieval', name: 'Medieval', description: '', kind: 'broad', parent: null, era: null, episodes: ['g-medieval'] }
    ],
    excluded: [{ guid: 'g-trailer', reason: 'trailer' }]
  }
}

const ctx = { guids: GUIDS, current: current(), unassigned: ['g-new'] }

describe('episode keys', () => {
  it('are short, unique and resolve back to guids', () => {
    expect(new Set(keys.values()).size).toBe(GUIDS.length)
    for (const key of keys.values()) expect(key.length).toBeLessThanOrEqual(7)
    const resolve = keyResolver(GUIDS)
    for (const guid of GUIDS) expect(resolve(k(guid))).toBe(guid)
    expect(resolve('g-rome-1')).toBe('g-rome-1') // full guids work too
    expect(resolve('zzzzz')).toBeUndefined()
  })
})

describe('cleanDescription', () => {
  it('drops ads, links and credits, then truncates at a word', () => {
    expect(cleanDescription(EPISODES[0]!.description, 400)).toBe('About g-rome-1.')
    expect(cleanDescription('one two three four five', 12)).toMatch(/^one two.*…$/)
    expect(cleanDescription('anything', 0)).toBe('')
  })
})

describe('buildPrompt', () => {
  it('full mode lists every episode by key and the existing playlist ids', () => {
    const { prompt, episodeCount } = buildPrompt({ mode: 'full', detail: 'short', episodes: EPISODES, current: current(), unassigned: ['g-new'] })
    expect(episodeCount).toBe(GUIDS.length)
    expect(prompt).toContain('## Rules')
    expect(prompt).toContain(`${k('g-medieval')} | 2024-01-05 | Episode g-medieval | About g-medieval.`)
    expect(prompt).toContain('- rome: Ancient Rome (broad)')
    expect(prompt).not.toContain('goalhanger')
  })

  it('incremental mode lists only new episodes, plus existing playlists with their episodes', () => {
    const { prompt, episodeCount } = buildPrompt({ mode: 'incremental', detail: 'titles', episodes: EPISODES, current: current(), unassigned: ['g-new'] })
    expect(episodeCount).toBe(1)
    expect(prompt).toContain(`## New episodes (1; key | release date | title)\n\n${k('g-new')} | 2024-01-07 | Episode g-new`)
    expect(prompt).toContain(`    ${k('g-punic-1')} | Episode g-punic-1`)
    expect(prompt).toContain('"additions"')
  })
})

describe('extractJson', () => {
  it('handles code fences and surrounding chatter', () => {
    expect(extractJson('Sure! ```json\n{"a": 1}\n``` Hope that helps')).toEqual({ a: 1 })
    expect(extractJson('Here: {"a": {"b": 2}} done')).toEqual({ a: { b: 2 } })
    expect(() => extractJson('no json here')).toThrow('No JSON object')
    expect(() => extractJson('{"a": }')).toThrow('not valid JSON')
  })
})

describe('parseAnswer (full)', () => {
  it('maps keys to guids, fixes ids and parents, and reports problems', () => {
    const answer = {
      playlists: [
        { id: 'Ancient Rome!', name: 'Ancient Rome', kind: 'broad', era: { start: -753, end: 476 }, episodes: [k('g-rome-1'), k('g-rome-2'), k('g-rome-2'), 'bogus'] },
        { name: 'Punic Wars', kind: 'series', parent: 'nope', episodes: [k('g-punic-1'), k('g-punic-2')] },
        { name: 'X', description: 'x'.repeat(400), kind: 'weird', episodes: [k('g-trailer')] }
      ],
      excluded: [{ episode: k('g-trailer'), reason: 'trailer' }]
    }
    const { content, warnings } = parseAnswer('full', JSON.stringify(answer), ctx)

    expect(content.playlists.map(p => p.id)).toEqual(['ancient-rome', 'punic-wars', 'x'])
    expect(content.playlists[0]!.episodes).toEqual(['g-rome-1', 'g-rome-2'])
    expect(content.playlists[0]!.era).toEqual({ start: -753, end: 476 })
    expect(content.playlists[1]!.parent).toBeNull()
    expect(content.playlists[2]!.kind).toBe('broad')
    expect(content.playlists[2]!.episodes).toEqual([]) // excluded wins
    expect(content.playlists[2]!.description.length).toBe(300)
    expect(warnings.join('\n')).toMatch(/invalid parent/)
    expect(warnings.join('\n')).toMatch(/1 unknown episode key/)
    expect(warnings.join('\n')).toMatch(/2 episode\(s\) were not placed/) // medieval + new
    expect(warnings.join('\n')).toMatch(/shortened/)

    const valid = groupingSchema.safeParse({ version: 1, generatedAt: '2026-11-08T00:00:00.000Z', method: 'manual', unassigned: [], ...content })
    expect(valid.success).toBe(true)
  })

  it('rejects answers in the wrong shape with a readable message', () => {
    expect(() => parseAnswer('full', '{"playlists": [{"episodes": []}]}', ctx)).toThrow(/expected format.*playlists\.0\.name/)
  })
})

describe('parseAnswer (incremental)', () => {
  it('adds new playlists and inserts additions at the requested position', () => {
    const answer = {
      newPlaylists: [{ id: 'rome', name: 'Clashing id', episodes: [] }],
      additions: [
        { playlist: 'punic', episodes: [k('g-new')], after: k('g-punic-1') },
        { playlist: 'rome', episodes: [k('g-new')], after: null },
        { playlist: 'missing', episodes: [k('g-new')] }
      ]
    }
    const { content, warnings } = parseAnswer('incremental', `\`\`\`json\n${JSON.stringify(answer)}\n\`\`\``, ctx)
    expect(content.playlists.find(p => p.id === 'punic')!.episodes).toEqual(['g-punic-1', 'g-new', 'g-punic-2'])
    expect(content.playlists.find(p => p.id === 'rome')!.episodes[0]).toBe('g-new')
    expect(content.playlists.at(-1)!.id).toBe('rome-2')
    expect(content.excluded).toEqual([{ guid: 'g-trailer', reason: 'trailer' }])
    expect(warnings.join('\n')).toMatch(/doesn't exist \("missing"\)/)
    expect(warnings.join('\n')).toMatch(/used twice/)
  })
})

describe('diffGroupings', () => {
  it('classifies playlists and episodes', () => {
    const proposed = current()
    proposed.playlists[0]!.name = 'Rome'
    proposed.playlists[0]!.episodes.reverse()
    proposed.playlists.splice(2, 1) // medieval removed
    proposed.playlists.push({ id: 'misc', name: 'Misc', description: '', kind: 'broad', parent: null, era: null, episodes: ['g-medieval', 'g-new'] })
    proposed.excluded = []

    const diff = diffGroupings(current(), proposed)
    const byId = Object.fromEntries(diff.playlists.map(p => [p.id, p]))
    expect(byId.rome).toMatchObject({ status: 'changed', detailChanges: ['name'], reordered: true, added: [], removed: [] })
    expect(byId.punic!.status).toBe('unchanged')
    expect(byId.medieval!.status).toBe('removed')
    expect(byId.misc).toMatchObject({ status: 'new', added: ['g-medieval', 'g-new'] })
    expect(diff.exclusions.removed).toEqual(['g-trailer'])
    expect(diff.episodes).toEqual({ placed: ['g-new'], moved: ['g-medieval'], unplaced: [] })
    expect(diff.hasChanges).toBe(true)
  })

  it('reports no changes for identical groupings', () => {
    expect(diffGroupings(current(), current()).hasChanges).toBe(false)
  })
})

describe('applyAccepted', () => {
  const proposed = (): GroupingContent => {
    const p = current()
    p.playlists = p.playlists.filter(x => x.id !== 'medieval')
    p.playlists.push({ id: 'misc', name: 'Misc', description: '', kind: 'broad', parent: null, era: null, episodes: ['g-medieval', 'g-trailer'] })
    p.playlists.push({ id: 'crusades', name: 'Crusades', description: '', kind: 'series', parent: 'misc', era: null, episodes: ['g-new'] })
    p.excluded = []
    return p
  }

  it('accepting everything yields the proposal', () => {
    const { content } = applyAccepted(current(), proposed(), { playlists: ['rome', 'punic', 'misc', 'crusades', 'medieval'], exclusions: true })
    expect(content).toEqual(proposed())
  })

  it('accepting one playlist leaves the rest untouched and un-excludes its episodes', () => {
    const { content } = applyAccepted(current(), proposed(), { playlists: ['misc'], exclusions: false })
    expect(content.playlists.map(p => p.id)).toEqual(['rome', 'punic', 'medieval', 'misc'])
    expect(content.excluded).toEqual([]) // g-trailer is now in misc
  })

  it('drops a parent link to a playlist that was not accepted', () => {
    const { content, notes } = applyAccepted(current(), proposed(), { playlists: ['crusades'], exclusions: false })
    expect(content.playlists.find(p => p.id === 'crusades')!.parent).toBeNull()
    expect(notes[0]).toMatch(/invalid parent/)
  })

  it('accepting a removal deletes the playlist', () => {
    const { content } = applyAccepted(current(), proposed(), { playlists: ['medieval'], exclusions: false })
    expect(content.playlists.map(p => p.id)).toEqual(['rome', 'punic'])
  })

  it('accepting exclusions applies removals and additions', () => {
    const next = current()
    next.excluded = [{ guid: 'g-new', reason: 'club' }]
    const { content } = applyAccepted(current(), next, { playlists: [], exclusions: true })
    expect(content.excluded).toEqual([{ guid: 'g-new', reason: 'club' }])
  })
})
