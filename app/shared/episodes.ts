import { z } from 'zod'

export const EPISODE_TYPES = ['full', 'trailer', 'bonus'] as const

export const episodeSchema = z.object({
  guid: z.string().min(1, 'Episode has no guid.'),
  title: z.string().min(1, 'Episode has no title.'),
  releaseDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date.'),
  durationSec: z.number().int().nonnegative().nullable(),
  episodeType: z.enum(EPISODE_TYPES),
  episodeNumber: z.number().int().nullable(),
  season: z.number().int().nullable(),
  audioUrl: z.string().nullable(),
  description: z.string()
})
export type Episode = z.infer<typeof episodeSchema>

/** Shape of `data/episodes.json`. */
export const episodesFileSchema = z.object({
  source: z.url(),
  fetchedAt: z.iso.datetime(),
  count: z.number().int().nonnegative(),
  episodes: z.array(episodeSchema)
}).superRefine((doc, ctx) => {
  if (doc.count !== doc.episodes.length) {
    ctx.addIssue({ code: 'custom', path: ['count'], message: `count is ${doc.count} but there are ${doc.episodes.length} episodes.` })
  }
  const seen = new Set<string>()
  doc.episodes.forEach((episode, index) => {
    if (seen.has(episode.guid)) {
      ctx.addIssue({ code: 'custom', path: ['episodes', index, 'guid'], message: `Duplicate guid "${episode.guid}".` })
    }
    seen.add(episode.guid)
  })
})
export type EpisodesFile = z.infer<typeof episodesFileSchema>

export interface EpisodeRef {
  guid: string
  title: string
  releaseDate: string
}

/** Response of `POST /api/episodes/refresh`. */
export interface RefreshResult {
  count: number
  fetchedAt: string
  added: EpisodeRef[]
  removed: EpisodeRef[]
}
