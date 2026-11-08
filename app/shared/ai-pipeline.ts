// Batched grouping with an AI provider (SPEC 5.3). Pure: builds prompts and output schemas,
// and assembles the answers into the same answer format the manual method uses, so every
// result goes through the same validation (proposalFromFullAnswer / proposalFromIncrementalAnswer).
import { z } from 'zod'
import type { Episode } from './episodes'
import { EXCLUDE_REASONS, MAX_DESCRIPTION_LENGTH, type GroupingContent } from './grouping'
import { GROUPING_RULES } from './grouping-rules'
import { buildPrompt, cleanDescription, episodeKeys, estimateTokens, type fullAnswerSchema, type incrementalAnswerSchema } from './proposal'

/** Episodes per assignment request. Keeps each request around 10K input tokens. */
export const ASSIGN_BATCH_SIZE = 120
const ASSIGN_DESCRIPTION_CHARS = 150

export const SYSTEM_PROMPT = 'You are a careful editor who organises history podcast episodes into playlists. You follow the given rules exactly and answer only with JSON that matches the requested schema.'

// --- Output schemas (strict, no transforms: they are sent to the providers as JSON Schema) ---

const era = z.object({ start: z.number().int(), end: z.number().int() }).nullable()

const plannedPlaylist = z.object({
  id: z.string().describe('kebab-case id; reuse an existing id when the topic matches'),
  name: z.string(),
  description: z.string().describe(`One or two sentences, at most ${MAX_DESCRIPTION_LENGTH} characters`),
  kind: z.enum(['broad', 'series']),
  parent: z.string().nullable().describe('For a series: id of the broad playlist that also contains it. Otherwise null.'),
  era: era.describe('Years covered, negative for BC; null if not applicable')
})

export const planOutputSchema = z.object({ playlists: z.array(plannedPlaylist) })
export type PlanOutput = z.infer<typeof planOutputSchema>

export const assignOutputSchema = z.object({
  episodes: z.array(z.object({
    episode: z.string().describe('Episode key'),
    playlists: z.array(z.string()).describe('Ids of every playlist the episode belongs to; for a series episode include the parent too. Empty if excluded.'),
    exclude: z.enum(EXCLUDE_REASONS).nullable().describe('Exclusion reason, or null if the episode is kept'),
    year: z.number().int().nullable().describe('Start year of the period the episode mainly covers, negative for BC; null if unclear'),
    series: z.string().nullable().describe('Shared kebab-case key for all parts of one multi-part series, e.g. "hundred-years-war"; null for one-offs')
  }))
})
export type AssignOutput = z.infer<typeof assignOutputSchema>

export const incrementalOutputSchema = z.object({
  newPlaylists: z.array(plannedPlaylist.extend({ episodes: z.array(z.string()) })),
  additions: z.array(z.object({
    playlist: z.string(),
    episodes: z.array(z.string()),
    after: z.string().nullable().describe('Key of the existing episode to insert after; null to add at the end')
  })),
  excluded: z.array(z.object({ episode: z.string(), reason: z.enum(EXCLUDE_REASONS) }))
})
export type IncrementalOutput = z.infer<typeof incrementalOutputSchema>

// --- Prompts ---------------------------------------------------------------------------------

export function buildPlanPrompt(episodes: Episode[], current: GroupingContent): string {
  const keys = episodeKeys(episodes.map(e => e.guid))
  const existing = current.playlists.length
    ? `\n\n## Existing playlists (reuse their ids when the topic matches)\n\n${current.playlists.map(p => `- ${p.id}: ${p.name} (${p.kind}${p.parent ? `, parent ${p.parent}` : ''})`).join('\n')}`
    : ''
  return `Design the playlist structure for all ${episodes.length} episodes of the history podcast "The Rest Is History" listed below. Return only the playlists (id, name, description, kind, parent, era), without episodes: the episodes are assigned in a later step.

## Rules

${GROUPING_RULES}${existing}

## Episodes (key | release date | title)

${episodes.map(e => `${keys.get(e.guid)} | ${e.releaseDate} | ${e.title}`).join('\n')}`
}

export function buildAssignPrompt(batch: Episode[], allEpisodes: Episode[], plan: PlanOutput): string {
  const keys = episodeKeys(allEpisodes.map(e => e.guid))
  const playlists = plan.playlists
    .map(p => `- ${p.id}: ${p.name} (${p.kind}${p.parent ? `, parent ${p.parent}` : ''}) – ${p.description}`)
    .join('\n')
  const lines = batch.map((e) => {
    const description = cleanDescription(e.description, ASSIGN_DESCRIPTION_CHARS)
    return [keys.get(e.guid), e.releaseDate, e.episodeType === 'full' ? null : `[${e.episodeType}]`, e.title, description].filter(Boolean).join(' | ')
  })
  return `Assign each episode below to the playlists it belongs to. Use only the playlist ids listed. Return one entry for every episode.

## Rules

${GROUPING_RULES}

## Playlists

${playlists}

## Episodes (key | release date | title | description)

${lines.join('\n')}`
}

/** Splits episodes into assignment batches. */
export function batches<T>(items: T[], size = ASSIGN_BATCH_SIZE): T[][] {
  const result: T[][] = []
  for (let i = 0; i < items.length; i += size) result.push(items.slice(i, i + size))
  return result
}

// --- Ordering (SPEC rule 6) -------------------------------------------------------------------

export interface EpisodeOrderInfo {
  year: number | null
  series: string | null
  /** Position in release order. */
  release: number
}

/**
 * Orders a playlist: multi-part series stay together in release order and are placed by the
 * earliest year of their parts; one-offs by their year. Undated units follow in release order.
 */
export function orderEpisodes<T extends string>(items: T[], info: (item: T) => EpisodeOrderInfo): T[] {
  interface Unit { items: T[], year: number | null, release: number }
  const units: Unit[] = []
  const bySeries = new Map<string, Unit>()
  for (const item of items) {
    const { year, series, release } = info(item)
    if (series) {
      const unit = bySeries.get(series)
      if (unit) {
        unit.items.push(item)
        unit.release = Math.min(unit.release, release)
        if (year !== null) unit.year = unit.year === null ? year : Math.min(unit.year, year)
        continue
      }
      const created: Unit = { items: [item], year, release }
      bySeries.set(series, created)
      units.push(created)
    } else {
      units.push({ items: [item], year, release })
    }
  }
  for (const unit of units) unit.items.sort((a, b) => info(a).release - info(b).release)
  units.sort((a, b) => {
    if (a.year !== null && b.year !== null) return a.year - b.year || a.release - b.release
    if (a.year !== null) return -1
    if (b.year !== null) return 1
    return a.release - b.release
  })
  return units.flatMap(u => u.items)
}

// --- Assembly ----------------------------------------------------------------------------------

/**
 * Combines the plan and all assignment batches into a full answer (keys, ordered playlists),
 * ready for proposalFromFullAnswer. Series episodes are also added to their parent (rule 2).
 */
export function assembleFullAnswer(
  plan: PlanOutput,
  assignments: AssignOutput['episodes'],
  episodes: Episode[]
): { answer: z.input<typeof fullAnswerSchema>, warnings: string[] } {
  const warnings: string[] = []
  const keys = episodeKeys(episodes.map(e => e.guid))
  const release = new Map(episodes.map((e, i) => [keys.get(e.guid)!, i]))
  const playlistIds = new Set(plan.playlists.map(p => p.id))
  const parentOf = new Map(plan.playlists.filter(p => p.parent).map(p => [p.id, p.parent!]))

  const members = new Map(plan.playlists.map(p => [p.id, new Set<string>()]))
  const info = new Map<string, EpisodeOrderInfo>()
  const excluded: { episode: string, reason: (typeof EXCLUDE_REASONS)[number] }[] = []
  const unknownPlaylists = new Set<string>()

  for (const a of assignments) {
    if (!release.has(a.episode)) continue // unknown keys are reported by the converter
    info.set(a.episode, { year: a.year, series: a.series, release: release.get(a.episode)! })
    if (a.exclude) {
      excluded.push({ episode: a.episode, reason: a.exclude })
      continue
    }
    for (const id of a.playlists) {
      if (!playlistIds.has(id)) {
        unknownPlaylists.add(id)
        continue
      }
      members.get(id)!.add(a.episode)
      const parent = parentOf.get(id)
      if (parent && members.has(parent)) members.get(parent)!.add(a.episode)
    }
  }
  if (unknownPlaylists.size) {
    warnings.push(`Assignments to unknown playlists were ignored: ${[...unknownPlaylists].slice(0, 5).join(', ')}.`)
  }

  const orderInfo = (key: string) => info.get(key) ?? { year: null, series: null, release: release.get(key) ?? 0 }
  return {
    answer: {
      playlists: plan.playlists.map(p => ({ ...p, episodes: orderEpisodes([...members.get(p.id)!], orderInfo) })),
      excluded
    },
    warnings
  }
}

/** Converts a strict incremental output into the manual incremental answer format. */
export function toIncrementalAnswer(output: IncrementalOutput): z.input<typeof incrementalAnswerSchema> {
  return {
    newPlaylists: output.newPlaylists,
    // In the AI schema, null means "at the end" (the manual format uses an omitted field for that).
    additions: output.additions.map(a => ({ playlist: a.playlist, episodes: a.episodes, ...(a.after ? { after: a.after } : {}) })),
    excluded: output.excluded
  }
}

/** Incremental prompt for one batch of unassigned episodes, with the AI's "after: null = end" rule. */
export function buildIncrementalBatchPrompt(allEpisodes: Episode[], current: GroupingContent, batch: string[]): string {
  return buildPrompt({ mode: 'incremental', detail: 'short', episodes: allEpisodes, current, unassigned: batch }).prompt
    .replace('omit "after" to add at the end of the playlist, or use null to add at the start', 'use null for "after" to add at the end of the playlist')
}

export interface RunEstimate {
  requests: number
  approxInputTokens: number
}

/** Rough size of a run before it starts, so the user knows what a paid run involves. */
export function estimateRun(mode: 'full' | 'incremental', episodes: Episode[], current: GroupingContent, unassigned: string[]): RunEstimate {
  if (mode === 'full') {
    const planTokens = estimateTokens(buildPlanPrompt(episodes, current))
    const fakePlan: PlanOutput = { playlists: Array.from({ length: 25 }, (_, i) => ({ id: `playlist-${i}`, name: 'Playlist name', description: 'A short description of about this length.', kind: 'broad', parent: null, era: null })) }
    const assignTokens = batches(episodes).reduce((sum, batch) => sum + estimateTokens(buildAssignPrompt(batch, episodes, fakePlan)), 0)
    return { requests: 1 + batches(episodes).length, approxInputTokens: planTokens + assignTokens }
  }
  const parts = batches(unassigned)
  return {
    requests: parts.length,
    approxInputTokens: parts.reduce((sum, batch) => sum + estimateTokens(buildIncrementalBatchPrompt(episodes, current, batch)), 0)
  }
}
