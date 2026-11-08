import { describe, expect, it } from 'vitest'
import type { Episode } from '../shared/episodes'
import {
  assembleFullAnswer,
  assignOutputSchema,
  batches,
  buildAssignPrompt,
  buildIncrementalBatchPrompt,
  buildPlanPrompt,
  estimateRun,
  incrementalOutputSchema,
  orderEpisodes,
  planOutputSchema,
  toIncrementalAnswer,
  type PlanOutput
} from '../shared/ai-pipeline'
import { episodeKeys, proposalFromFullAnswer, fullAnswerSchema } from '../shared/proposal'

function episode(guid: string, i: number, title = `Episode ${guid}`): Episode {
  return { guid, title, releaseDate: `2024-02-${String(i + 1).padStart(2, '0')}`, durationSec: 100, episodeType: 'full', episodeNumber: i, season: null, audioUrl: null, description: `About ${guid}.` }
}

describe('orderEpisodes', () => {
  const info: Record<string, { year: number | null, series: string | null, release: number }> = {
    empire: { year: -27, series: null, release: 0 },
    punic2: { year: -218, series: 'punic', release: 1 },
    founding: { year: -753, series: null, release: 2 },
    punic1: { year: -264, series: 'punic', release: 3 },
    punic3: { year: -300, series: 'punic', release: 4 }, // a later part covering an earlier period
    myth: { year: null, series: null, release: 5 },
    fall: { year: 476, series: null, release: 6 }
  }

  it('orders by period, keeps series parts together in release order, undated last', () => {
    const order = orderEpisodes(Object.keys(info), k => info[k]!)
    expect(order).toEqual(['founding', 'punic2', 'punic1', 'punic3', 'empire', 'fall', 'myth'])
  })
})

describe('batches', () => {
  it('splits into chunks', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]])
    expect(batches([], 2)).toEqual([])
  })
})

describe('prompts', () => {
  const episodes = ['a', 'b', 'c'].map((g, i) => episode(g, i))
  const plan: PlanOutput = { playlists: [{ id: 'rome', name: 'Rome', description: 'Romans.', kind: 'broad', parent: null, era: null }] }

  it('plan prompt lists every episode by key and title, without descriptions', () => {
    const prompt = buildPlanPrompt(episodes, { playlists: [], excluded: [] })
    const key = episodeKeys(['a', 'b', 'c']).get('b')
    expect(prompt).toContain(`${key} | 2024-02-02 | Episode b`)
    expect(prompt).not.toContain('About b')
  })

  it('assign prompt lists the playlists and the batch with descriptions', () => {
    const prompt = buildAssignPrompt([episodes[1]!], episodes, plan)
    expect(prompt).toContain('- rome: Rome (broad) – Romans.')
    expect(prompt).toContain('Episode b | About b.')
    expect(prompt).not.toContain('Episode a')
  })

  it('incremental batch prompt uses "null = at the end"', () => {
    const prompt = buildIncrementalBatchPrompt(episodes, { playlists: [], excluded: [] }, ['c'])
    expect(prompt).toContain('use null for "after" to add at the end')
    expect(prompt).not.toContain('use null to add at the start')
  })

  it('estimates requests and tokens', () => {
    expect(estimateRun('full', episodes, { playlists: [], excluded: [] }, []).requests).toBe(2)
    expect(estimateRun('incremental', episodes, { playlists: [], excluded: [] }, ['c']).requests).toBe(1)
  })
})

describe('assembleFullAnswer', () => {
  const episodes = ['founding', 'punic1', 'punic2', 'trailer', 'lost'].map((g, i) => episode(g, i))
  const keys = episodeKeys(episodes.map(e => e.guid))
  const k = (g: string) => keys.get(g)!
  const plan: PlanOutput = {
    playlists: [
      { id: 'rome', name: 'Ancient Rome', description: '', kind: 'broad', parent: null, era: { start: -753, end: 476 } },
      { id: 'punic', name: 'Punic Wars', description: '', kind: 'series', parent: 'rome', era: null }
    ]
  }

  it('builds ordered playlists, adds series episodes to the parent, and collects exclusions', () => {
    const { answer, warnings } = assembleFullAnswer(plan, [
      { episode: k('punic2'), playlists: ['punic'], exclude: null, year: -218, series: 'punic' },
      { episode: k('punic1'), playlists: ['punic', 'rome'], exclude: null, year: -264, series: 'punic' },
      { episode: k('founding'), playlists: ['rome', 'ghost'], exclude: null, year: -753, series: null },
      { episode: k('trailer'), playlists: [], exclude: 'trailer', year: null, series: null }
    ], episodes)

    expect(answer.playlists[0]!.episodes).toEqual([k('founding'), k('punic1'), k('punic2')])
    expect(answer.playlists[1]!.episodes).toEqual([k('punic1'), k('punic2')])
    expect(answer.excluded).toEqual([{ episode: k('trailer'), reason: 'trailer' }])
    expect(warnings[0]).toMatch(/unknown playlists.*ghost/)

    // The assembled answer goes through the same converter as a pasted answer.
    const parsed = fullAnswerSchema.parse(answer)
    const { content, warnings: convertWarnings } = proposalFromFullAnswer(parsed, { guids: episodes.map(e => e.guid), current: { playlists: [], excluded: [] } })
    expect(content.playlists[1]!.parent).toBe('rome')
    expect(convertWarnings.join('\n')).toMatch(/1 episode\(s\) were not placed/) // "lost"
  })
})

describe('strict output schemas', () => {
  it('accept well-formed provider output', () => {
    expect(planOutputSchema.safeParse({ playlists: [{ id: 'a', name: 'A', description: '', kind: 'broad', parent: null, era: null }] }).success).toBe(true)
    expect(assignOutputSchema.safeParse({ episodes: [{ episode: 'x', playlists: [], exclude: 'club', year: null, series: null }] }).success).toBe(true)
    const incremental = { newPlaylists: [], additions: [{ playlist: 'a', episodes: ['x'], after: null }], excluded: [] }
    expect(incrementalOutputSchema.safeParse(incremental).success).toBe(true)
    expect(toIncrementalAnswer(incremental).additions[0]).toEqual({ playlist: 'a', episodes: ['x'] }) // null -> at the end
  })
})
