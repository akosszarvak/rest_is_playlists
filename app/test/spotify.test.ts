import { describe, expect, it } from 'vitest'
import type { Episode } from '../shared/episodes'
import type { Playlist } from '../shared/grouping'
import {
  exportStatus,
  itemRequests,
  matchEpisodes,
  normalizeTitle,
  parseEpisodeLink,
  planExport,
  spotifyFileSchema,
  type EpisodeMatch
} from '../shared/spotify'

const id = (c: string) => c.repeat(22)

function rss(guid: string, title: string, releaseDate: string): Episode {
  return { guid, title, releaseDate, durationSec: 1, episodeType: 'full', episodeNumber: null, season: null, audioUrl: null, description: '' }
}

describe('normalizeTitle', () => {
  it('drops the episode number, punctuation and curly quotes', () => {
    expect(normalizeTitle('720. The Suez Crisis: Britain’s Shattered Empire (Part 2)')).toBe('the suez crisis britains shattered empire part 2')
    expect(normalizeTitle('200: American Civil War: Aftermath & Legacy (Part 4)')).toBe('american civil war aftermath and legacy part 4')
    expect(normalizeTitle('1981')).toBe('1981') // a title that is only a number stays
  })
})

describe('matchEpisodes', () => {
  it('matches by title and date, then title alone, then a close title', () => {
    const episodes = [
      rss('a', '1. Greatness', '2020-11-02'),
      rss('b', '2. Civil War', '2020-11-02'),
      rss('c', 'Trailer', '2020-10-28'),
      rss('d', '5. Napoleon: The Rise (Part 1)', '2021-03-01'),
      rss('e', 'Missing episode', '2021-04-01')
    ]
    const spotify = [
      { id: id('A'), name: 'Greatness', releaseDate: '2020-11-03' }, // +1 day
      { id: id('B'), name: '2. Civil War', releaseDate: '2020-11-02' },
      { id: id('C'), name: 'Trailer', releaseDate: '2019-01-01' }, // date way off, title unique
      { id: id('D'), name: 'Napoleon: The Rise (Pt 1)', releaseDate: '2021-03-01' }
    ]
    const { matches, unmatched } = matchEpisodes(episodes, spotify)
    // "pt 1" vs "part 1": 4 of 5 words shared, which meets the 80% close-title threshold.
    expect(Object.fromEntries(matches)).toEqual({ a: id('A'), b: id('B'), c: id('C'), d: id('D') })
    expect(unmatched).toEqual(['e'])
  })

  it('uses each Spotify episode once and skips taken ones', () => {
    const episodes = [rss('x', 'Same', '2022-01-01'), rss('y', 'Same', '2022-01-08')]
    const spotify = [{ id: id('X'), name: 'Same', releaseDate: '2022-01-01' }, { id: id('Y'), name: 'Same', releaseDate: '2022-01-08' }]
    expect(Object.fromEntries(matchEpisodes(episodes, spotify).matches)).toEqual({ x: id('X'), y: id('Y') })
    expect(matchEpisodes(episodes, spotify, new Set([id('X')])).matches.get('x')).toBeUndefined()
  })
})

describe('parseEpisodeLink', () => {
  it('accepts links, URIs and bare ids', () => {
    expect(parseEpisodeLink('https://open.spotify.com/episode/4rOoJ6Egrf8K2IrywzwOMk?si=abc')).toBe('4rOoJ6Egrf8K2IrywzwOMk')
    expect(parseEpisodeLink('https://open.spotify.com/intl-de/episode/4rOoJ6Egrf8K2IrywzwOMk')).toBe('4rOoJ6Egrf8K2IrywzwOMk')
    expect(parseEpisodeLink('spotify:episode:4rOoJ6Egrf8K2IrywzwOMk')).toBe('4rOoJ6Egrf8K2IrywzwOMk')
    expect(parseEpisodeLink(' 4rOoJ6Egrf8K2IrywzwOMk ')).toBe('4rOoJ6Egrf8K2IrywzwOMk')
    expect(parseEpisodeLink('https://open.spotify.com/track/4rOoJ6Egrf8K2IrywzwOMk')).toBeNull()
    expect(parseEpisodeLink('nonsense')).toBeNull()
  })
})

describe('export planning', () => {
  const playlist: Playlist = { id: 'rome', name: 'Ancient Rome', description: 'From  Romulus\nto the fall.', kind: 'broad', parent: null, era: null, episodes: ['a', 'b', 'c'] }
  const match = (episodeId: string): EpisodeMatch => ({ episodeId, method: 'auto', matchedAt: '2026-11-08T00:00:00.000Z' })
  const matches = { a: match(id('A')), c: match(id('C')) }

  it('builds name, description and URIs, and reports unmatched episodes', () => {
    const plan = planExport(playlist, matches, { namePrefix: 'RIH · ', visibility: 'private' })
    expect(plan).toMatchObject({
      name: 'RIH · Ancient Rome',
      description: 'From Romulus to the fall.',
      public: false,
      uris: [`spotify:episode:${id('A')}`, `spotify:episode:${id('C')}`],
      missing: ['b']
    })
  })

  it('status follows the hash', () => {
    const plan = planExport(playlist, matches, { namePrefix: '', visibility: 'private' })
    const record = { spotifyId: 'p', url: 'u', hash: plan.hash, exportedAt: '2026-11-08T00:00:00.000Z' }
    expect(exportStatus(plan, undefined)).toBe('not-exported')
    expect(exportStatus(plan, record)).toBe('up-to-date')
    const renamed = planExport({ ...playlist, name: 'Rome' }, matches, { namePrefix: '', visibility: 'private' })
    expect(exportStatus(renamed, record)).toBe('changed')
  })

  it('splits items into one replace and batches of 100 adds', () => {
    const uris = Array.from({ length: 250 }, (_, i) => `u${i}`)
    const { replace, add } = itemRequests(uris)
    expect(replace).toHaveLength(100)
    expect(add.map(a => a.length)).toEqual([100, 50])
    expect(itemRequests([])).toEqual({ replace: [], add: [] }) // empty PUT clears the playlist
  })
})

describe('spotifyFileSchema', () => {
  it('fills defaults for an empty file', () => {
    expect(spotifyFileSchema.parse({})).toMatchObject({ auth: null, matches: {}, playlists: {} })
  })
})
