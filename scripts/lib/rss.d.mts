// Types for rss.mjs. The output is unvalidated; the app checks it with zod.

export declare const FEED_URL: string

export interface RawEpisode {
  guid: string | null
  title: string | null
  releaseDate: string | null
  durationSec: number | null
  episodeType: 'full' | 'trailer' | 'bonus'
  episodeNumber: number | null
  season: number | null
  audioUrl: string | null
  description: string
}

export interface RawEpisodesDocument {
  source: string
  fetchedAt: string
  count: number
  episodes: RawEpisode[]
}

export declare function parseFeed(xml: string): RawEpisode[]
export declare function fetchEpisodes(feedUrl?: string, options?: { signal?: AbortSignal }): Promise<RawEpisodesDocument>
