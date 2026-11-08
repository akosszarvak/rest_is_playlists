// Grouping proposals: building the prompt, turning an AI/chatbot answer into a proposed
// grouping, and comparing / partially accepting it. Framework-free and unit-tested.
import { z } from 'zod'
import type { Episode } from './episodes'
import {
  EXCLUDE_REASONS,
  MAX_DESCRIPTION_LENGTH,
  type Excluded,
  type GroupingContent,
  type Playlist
} from './grouping'
import { GROUPING_RULES } from './grouping-rules'
import { slugify } from './grouping-ops'

export const PROPOSAL_MODES = ['full', 'incremental'] as const
export type ProposalMode = (typeof PROPOSAL_MODES)[number]

export const DETAIL_LEVELS = ['full', 'short', 'titles'] as const
export type DetailLevel = (typeof DETAIL_LEVELS)[number]
const DETAIL_CHARS: Record<DetailLevel, number> = { full: 400, short: 150, titles: 0 }

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T
}

// --- Short episode keys ------------------------------------------------------------------
// Guids are long (24–36 chars). Prompts use short keys derived from a hash of the guid, so
// answers stay small. Keys are stateless: a pasted answer is resolved against the current list.

const MIN_KEY_LENGTH = 5
const MAX_KEY_LENGTH = 7

/** FNV-1a 32-bit hash, as 7 base-36 characters. */
function hashKey(guid: string): string {
  let hash = 0x811C9DC5
  for (let i = 0; i < guid.length; i++) {
    hash ^= guid.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }
  return hash.toString(36).padStart(MAX_KEY_LENGTH, '0')
}

/** guid -> short key, using the shortest length at which all keys are unique. */
export function episodeKeys(guids: string[]): Map<string, string> {
  const full = guids.map(hashKey)
  for (let length = MIN_KEY_LENGTH; length <= MAX_KEY_LENGTH; length++) {
    const keys = full.map(k => k.slice(0, length))
    if (new Set(keys).size === keys.length) return new Map(guids.map((g, i) => [g, keys[i]!]))
  }
  // Practically impossible with a few thousand episodes; fall back to the guids themselves.
  return new Map(guids.map(g => [g, g]))
}

/** key -> guid for every key length, so answers to an older prompt still resolve. Ambiguous keys are left out. */
export function keyResolver(guids: string[]): (key: string) => string | undefined {
  const byKey = new Map<string, string | null>()
  for (const guid of guids) {
    byKey.set(guid, guid)
    const hash = hashKey(guid)
    for (let length = MIN_KEY_LENGTH; length <= MAX_KEY_LENGTH; length++) {
      const key = hash.slice(0, length)
      const existing = byKey.get(key)
      if (existing === undefined) byKey.set(key, guid)
      else if (existing !== guid) byKey.set(key, null) // ambiguous, stays unresolvable
    }
  }
  return key => byKey.get(key.trim().toLowerCase()) ?? byKey.get(key.trim()) ?? undefined
}

// --- Prompt ----------------------------------------------------------------------------------

const BOILERPLATE = /https?:\/\/|www\.|\.com\b|\.fm\b|rest is history club|goalhanger|producer|editor|twitter|^@|tickets|ad choices|nordvpn|sponsor|live tour|\blive in\b|on tour|onstage|^_+$/i

/** The episode description without ads, credits and links, cut to `maxChars` at a word boundary. */
export function cleanDescription(text: string, maxChars: number): string {
  if (maxChars <= 0) return ''
  const kept = text
    .split(/\n+/)
    .map(p => p.trim())
    .filter(p => p && !BOILERPLATE.test(p))
    .join(' ')
    .replace(/\s+/g, ' ')
  if (kept.length <= maxChars) return kept
  const cut = kept.slice(0, maxChars)
  return `${cut.slice(0, Math.max(cut.lastIndexOf(' '), maxChars - 40))}…`
}

/** Rough token estimate (about 4 characters per token for English text). */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4)
}

const PLAYLIST_FIELDS = `{
      "id": "kebab-case-id",
      "name": "Ancient Rome",
      "description": "One or two sentences, at most ${MAX_DESCRIPTION_LENGTH} characters",
      "kind": "broad" | "series",
      "parent": null | "id of the broad playlist that also contains this series",
      "era": { "start": -753, "end": 476 } | null,
      "episodes": ["episode keys in listening order"]
    }`

const FULL_FORMAT = `{
  "playlists": [
    ${PLAYLIST_FIELDS}
  ],
  "excluded": [ { "episode": "episode key", "reason": "club" | "archive-duplicate" | "trailer" | "other" } ]
}`

const INCREMENTAL_FORMAT = `{
  "newPlaylists": [
    ${PLAYLIST_FIELDS}
  ],
  "additions": [
    {
      "playlist": "id of an existing playlist",
      "episodes": ["episode keys to add, in listening order"],
      "after": "key of the existing episode to insert after" | null
    }
  ],
  "excluded": [ { "episode": "episode key", "reason": "club" | "archive-duplicate" | "trailer" | "other" } ]
}`

export interface PromptInput {
  mode: ProposalMode
  detail: DetailLevel
  /** All episodes, in release order. */
  episodes: Episode[]
  /** The current grouping (empty for a first run). */
  current: GroupingContent
  /** Guids not in any playlist and not excluded. */
  unassigned: string[]
}

export interface BuiltPrompt {
  prompt: string
  episodeCount: number
  approxTokens: number
}

function episodeLine(episode: Episode, key: string, detail: DetailLevel): string {
  const description = cleanDescription(episode.description, DETAIL_CHARS[detail])
  return [key, episode.releaseDate, episode.title, description].filter(Boolean).join(' | ')
}

/** Builds the full prompt for a chatbot or an AI provider. */
export function buildPrompt(input: PromptInput): BuiltPrompt {
  const keys = episodeKeys(input.episodes.map(e => e.guid))
  const byGuid = new Map(input.episodes.map(e => [e.guid, e]))
  const key = (guid: string) => keys.get(guid) ?? guid

  const targets = input.mode === 'full'
    ? input.episodes
    : input.unassigned.map(g => byGuid.get(g)).filter((e): e is Episode => Boolean(e))

  const sections: string[] = []
  sections.push(input.mode === 'full'
    ? 'You organise every episode of the history podcast "The Rest Is History" into themed playlists for one listener. Group all episodes listed below, following the rules exactly.'
    : 'You place NEW episodes of the history podcast "The Rest Is History" into an existing set of themed playlists. Only place the new episodes listed under "New episodes", following the rules exactly. Create a new playlist only when no existing one fits.')

  sections.push(`## Rules\n\n${GROUPING_RULES}`)

  const answerShape = input.mode === 'full' ? FULL_FORMAT : INCREMENTAL_FORMAT
  sections.push(`## Answer format

Answer with one JSON object only, no other text, in this shape:

${answerShape}

- Refer to episodes only by their key (the first column below).
- Every listed episode must appear in at least one playlist or in "excluded".
- Use negative years for BC.${input.mode === 'full' ? '\n- When a playlist covers the same topic as an existing playlist below, reuse its id.' : '\n- In "additions", omit "after" to add at the end of the playlist, or use null to add at the start.'}`)

  if (input.current.playlists.length) {
    const lines = input.current.playlists.map((p) => {
      const header = `- ${p.id}: ${p.name} (${p.kind}${p.parent ? `, parent ${p.parent}` : ''})${p.description ? ` – ${p.description}` : ''}`
      if (input.mode === 'full') return header
      const episodes = p.episodes.map(g => `    ${key(g)} | ${byGuid.get(g)?.title ?? g}`).join('\n')
      return episodes ? `${header}\n${episodes}` : header
    })
    sections.push(input.mode === 'full'
      ? `## Existing playlists\n\n${lines.join('\n')}`
      : `## Existing playlists (with their episodes in order)\n\n${lines.join('\n')}`)
  }

  const columns = input.detail === 'titles' ? 'key | release date | title' : 'key | release date | title | description'
  const heading = input.mode === 'full' ? 'Episodes' : 'New episodes'
  sections.push(`## ${heading} (${targets.length}; ${columns})\n\n${targets.map(e => episodeLine(e, key(e.guid), input.detail)).join('\n')}`)

  sections.push('Answer with the JSON object only.')
  const prompt = sections.join('\n\n')
  return { prompt, episodeCount: targets.length, approxTokens: estimateTokens(prompt) }
}

// --- Parsing an answer ---------------------------------------------------------------------

const aiPlaylistSchema = z.object({
  id: z.string().optional(),
  name: z.string().trim().min(1, 'Every playlist needs a name.'),
  description: z.string().nullish().transform(v => v ?? ''),
  kind: z.enum(['broad', 'series']).catch('broad'),
  parent: z.string().nullish().transform(v => v || null),
  era: z.object({ start: z.coerce.number().int(), end: z.coerce.number().int() }).nullish().catch(null),
  episodes: z.array(z.string()).default([])
})
type AiPlaylist = z.infer<typeof aiPlaylistSchema>

const aiExcludedSchema = z.object({
  episode: z.string(),
  reason: z.enum(EXCLUDE_REASONS).catch('other')
})

export const fullAnswerSchema = z.object({
  playlists: z.array(aiPlaylistSchema),
  excluded: z.array(aiExcludedSchema).default([])
})

export const incrementalAnswerSchema = z.object({
  newPlaylists: z.array(aiPlaylistSchema).default([]),
  additions: z.array(z.object({
    playlist: z.string(),
    episodes: z.array(z.string()),
    after: z.string().nullish()
  })).default([]),
  excluded: z.array(aiExcludedSchema).default([])
})

/** Pulls the JSON object out of a chatbot answer (handles ```json fences and surrounding text). */
export function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i)
  const candidate = fenced ? fenced[1]! : text
  const start = candidate.indexOf('{')
  const end = candidate.lastIndexOf('}')
  if (start === -1 || end <= start) throw new Error('No JSON object found in the answer.')
  try {
    return JSON.parse(candidate.slice(start, end + 1))
  } catch (error) {
    throw new Error(`The answer is not valid JSON: ${(error as Error).message}`)
  }
}

export interface ProposalResult {
  /** The complete proposed grouping (current grouping with the answer applied, for incremental). */
  content: GroupingContent
  warnings: string[]
}

interface ConvertContext {
  /** All current episode guids, in release order. */
  guids: string[]
  current: GroupingContent
}

/** Shared conversion of AI playlists: resolve keys, fix ids, trim descriptions, collect warnings. */
function convertPlaylists(
  items: AiPlaylist[],
  resolve: (key: string) => string | undefined,
  takenIds: Set<string>,
  warnings: string[],
  unknownKeys: Set<string>
): Playlist[] {
  return items.map((item) => {
    let id = slugify(item.id || item.name)
    if (takenIds.has(id)) {
      let n = 2
      while (takenIds.has(`${id}-${n}`)) n++
      warnings.push(`Playlist id "${id}" was used twice; renamed one to "${id}-${n}".`)
      id = `${id}-${n}`
    }
    takenIds.add(id)

    let description = item.description.trim()
    if (description.length > MAX_DESCRIPTION_LENGTH) {
      description = `${description.slice(0, MAX_DESCRIPTION_LENGTH - 1)}…`
      warnings.push(`The description of "${item.name}" was too long and was shortened.`)
    }

    const episodes: string[] = []
    for (const key of item.episodes) {
      const guid = resolve(key)
      if (!guid) unknownKeys.add(key)
      else if (!episodes.includes(guid)) episodes.push(guid)
    }

    const era = item.era && item.era.start <= item.era.end ? item.era : null
    return { id, name: item.name.trim(), description, kind: item.kind, parent: item.parent ? slugify(item.parent) : null, era, episodes }
  })
}

function applyExclusions(content: GroupingContent, items: z.infer<typeof aiExcludedSchema>[], resolve: (key: string) => string | undefined, unknownKeys: Set<string>) {
  const excluded = new Map(content.excluded.map(e => [e.guid, e.reason]))
  for (const item of items) {
    const guid = resolve(item.episode)
    if (!guid) unknownKeys.add(item.episode)
    else excluded.set(guid, item.reason)
  }
  content.excluded = [...excluded].map(([guid, reason]) => ({ guid, reason }))
  // An excluded episode can't also be in a playlist: the exclusion wins.
  const set = new Set(excluded.keys())
  for (const playlist of content.playlists) playlist.episodes = playlist.episodes.filter(g => !set.has(g))
}

/** Fixes parent links that point nowhere or at a series, so the result always validates. */
function fixParents(content: GroupingContent, warnings: string[]) {
  const byId = new Map(content.playlists.map(p => [p.id, p]))
  for (const playlist of content.playlists) {
    if (!playlist.parent) continue
    const parent = byId.get(playlist.parent)
    if (playlist.kind !== 'series' || !parent || parent.kind !== 'broad' || parent.id === playlist.id) {
      warnings.push(`"${playlist.name}" had an invalid parent ("${playlist.parent}"), which was removed.`)
      playlist.parent = null
    }
  }
}

function finish(content: GroupingContent, ctx: ConvertContext, unknownKeys: Set<string>, warnings: string[], checkGuids: string[]): ProposalResult {
  fixParents(content, warnings)
  if (unknownKeys.size) {
    const sample = [...unknownKeys].slice(0, 5).join(', ')
    warnings.push(`${unknownKeys.size} unknown episode key(s) were ignored (${sample}${unknownKeys.size > 5 ? ', …' : ''}).`)
  }
  const placed = new Set([...content.playlists.flatMap(p => p.episodes), ...content.excluded.map(e => e.guid)])
  const missing = checkGuids.filter(g => !placed.has(g))
  if (missing.length) warnings.push(`${missing.length} episode(s) were not placed by the answer and stay unassigned.`)
  return { content, warnings }
}

/** Turns a full-regroup answer into a proposed grouping. */
export function proposalFromFullAnswer(answer: z.infer<typeof fullAnswerSchema>, ctx: ConvertContext): ProposalResult {
  const warnings: string[] = []
  const unknownKeys = new Set<string>()
  const resolve = keyResolver(ctx.guids)
  const content: GroupingContent = {
    playlists: convertPlaylists(answer.playlists, resolve, new Set(), warnings, unknownKeys),
    excluded: []
  }
  applyExclusions(content, answer.excluded, resolve, unknownKeys)
  return finish(content, ctx, unknownKeys, warnings, ctx.guids)
}

/** Merges an incremental answer into the current grouping. */
export function proposalFromIncrementalAnswer(
  answer: z.infer<typeof incrementalAnswerSchema>,
  ctx: ConvertContext & { unassigned: string[] }
): ProposalResult {
  const warnings: string[] = []
  const unknownKeys = new Set<string>()
  const resolve = keyResolver(ctx.guids)
  const content = clone(ctx.current)
  const taken = new Set(content.playlists.map(p => p.id))

  content.playlists.push(...convertPlaylists(answer.newPlaylists, resolve, taken, warnings, unknownKeys))

  for (const addition of answer.additions) {
    const playlist = content.playlists.find(p => p.id === slugify(addition.playlist))
    if (!playlist) {
      warnings.push(`The answer adds episodes to a playlist that doesn't exist ("${addition.playlist}"); they were skipped.`)
      continue
    }
    const guids = addition.episodes
      .map((key) => {
        const guid = resolve(key)
        if (!guid) unknownKeys.add(key)
        return guid
      })
      .filter((g): g is string => Boolean(g) && !playlist.episodes.includes(g!))

    let index = playlist.episodes.length
    if (addition.after === null) {
      index = 0
    } else if (addition.after !== undefined) {
      const afterGuid = resolve(addition.after)
      const position = afterGuid ? playlist.episodes.indexOf(afterGuid) : -1
      if (position === -1) warnings.push(`In "${playlist.name}", the insert position "${addition.after}" was not found; episodes were added at the end.`)
      else index = position + 1
    }
    playlist.episodes.splice(index, 0, ...new Set(guids))
  }

  applyExclusions(content, answer.excluded, resolve, unknownKeys)
  return finish(content, ctx, unknownKeys, warnings, ctx.unassigned)
}

/** Parses a pasted answer for the given mode. Throws an Error with a readable message. */
export function parseAnswer(mode: ProposalMode, text: string, ctx: ConvertContext & { unassigned: string[] }): ProposalResult {
  const json = extractJson(text)
  if (mode === 'full') {
    const parsed = fullAnswerSchema.safeParse(json)
    if (!parsed.success) throw new Error(`The answer doesn't match the expected format: ${formatIssues(parsed.error)}`)
    return proposalFromFullAnswer(parsed.data, ctx)
  }
  const parsed = incrementalAnswerSchema.safeParse(json)
  if (!parsed.success) throw new Error(`The answer doesn't match the expected format: ${formatIssues(parsed.error)}`)
  return proposalFromIncrementalAnswer(parsed.data, ctx)
}

function formatIssues(error: z.ZodError): string {
  return error.issues.slice(0, 5).map(i => `${i.path.join('.') || '(root)'}: ${i.message}`).join('; ')
}

// --- Diff --------------------------------------------------------------------------------------

export type DetailField = 'name' | 'description' | 'kind' | 'parent' | 'era'

export interface PlaylistDiff {
  id: string
  name: string
  status: 'new' | 'removed' | 'changed' | 'unchanged'
  current: Playlist | null
  proposed: Playlist | null
  detailChanges: DetailField[]
  added: string[]
  removed: string[]
  reordered: boolean
}

export interface GroupingDiff {
  playlists: PlaylistDiff[]
  exclusions: { added: Excluded[], removed: string[], changed: Excluded[] }
  /** Episode-level summary across all playlists. */
  episodes: { placed: string[], moved: string[], unplaced: string[] }
  hasChanges: boolean
}

function membershipOf(content: GroupingContent): Map<string, Set<string>> {
  const map = new Map<string, Set<string>>()
  for (const p of content.playlists) for (const g of p.episodes) map.set(g, (map.get(g) ?? new Set()).add(p.id))
  return map
}

export function diffGroupings(current: GroupingContent, proposed: GroupingContent): GroupingDiff {
  const currentById = new Map(current.playlists.map(p => [p.id, p]))
  const proposedIds = new Set(proposed.playlists.map(p => p.id))

  const playlists: PlaylistDiff[] = proposed.playlists.map((p) => {
    const c = currentById.get(p.id) ?? null
    if (!c) {
      return { id: p.id, name: p.name, status: 'new', current: null, proposed: p, detailChanges: [], added: [...p.episodes], removed: [], reordered: false }
    }
    const detailChanges = (['name', 'description', 'kind', 'parent', 'era'] as const)
      .filter(field => JSON.stringify(c[field]) !== JSON.stringify(p[field]))
    const before = new Set(c.episodes)
    const after = new Set(p.episodes)
    const added = p.episodes.filter(g => !before.has(g))
    const removed = c.episodes.filter(g => !after.has(g))
    const commonBefore = c.episodes.filter(g => after.has(g))
    const commonAfter = p.episodes.filter(g => before.has(g))
    const reordered = commonBefore.some((g, i) => g !== commonAfter[i])
    const changed = detailChanges.length > 0 || added.length > 0 || removed.length > 0 || reordered
    return { id: p.id, name: p.name, status: changed ? 'changed' : 'unchanged', current: c, proposed: p, detailChanges, added, removed, reordered }
  })
  for (const c of current.playlists) {
    if (!proposedIds.has(c.id)) {
      playlists.push({ id: c.id, name: c.name, status: 'removed', current: c, proposed: null, detailChanges: [], added: [], removed: [...c.episodes], reordered: false })
    }
  }

  const currentExcluded = new Map(current.excluded.map(e => [e.guid, e.reason]))
  const proposedExcluded = new Map(proposed.excluded.map(e => [e.guid, e.reason]))
  const exclusions = {
    added: proposed.excluded.filter(e => !currentExcluded.has(e.guid)),
    removed: current.excluded.filter(e => !proposedExcluded.has(e.guid)).map(e => e.guid),
    changed: proposed.excluded.filter(e => currentExcluded.has(e.guid) && currentExcluded.get(e.guid) !== e.reason)
  }

  const before = membershipOf(current)
  const after = membershipOf(proposed)
  const all = new Set([...before.keys(), ...after.keys()])
  const episodes = { placed: [] as string[], moved: [] as string[], unplaced: [] as string[] }
  for (const guid of all) {
    const b = before.get(guid) ?? new Set()
    const a = after.get(guid) ?? new Set()
    if (!b.size && a.size) episodes.placed.push(guid)
    else if (b.size && !a.size) episodes.unplaced.push(guid)
    else if ([...a].some(id => !b.has(id)) || [...b].some(id => !a.has(id))) episodes.moved.push(guid)
  }

  const hasChanges = playlists.some(p => p.status !== 'unchanged')
    || exclusions.added.length > 0 || exclusions.removed.length > 0 || exclusions.changed.length > 0
  return { playlists, exclusions, episodes, hasChanges }
}

// --- Partial accept ----------------------------------------------------------------------------

export interface AcceptSelection {
  /** Ids of playlists whose proposed version (or removal) is accepted. */
  playlists: string[]
  /** Whether the proposed exclusions (added, changed and removed) are accepted. */
  exclusions: boolean
}

/**
 * Applies the accepted parts of a proposal to the current grouping. Accepting everything
 * yields the proposal itself. Returns notes about automatic fixes (e.g. a missing parent).
 */
export function applyAccepted(current: GroupingContent, proposed: GroupingContent, accept: AcceptSelection): { content: GroupingContent, notes: string[] } {
  const notes: string[] = []
  const acceptedIds = new Set(accept.playlists)
  const proposedById = new Map(proposed.playlists.map(p => [p.id, p]))
  const currentIds = new Set(current.playlists.map(p => p.id))
  const everything = accept.exclusions
    && proposed.playlists.every(p => acceptedIds.has(p.id))
    && current.playlists.filter(p => !proposedById.has(p.id)).every(p => acceptedIds.has(p.id))
  if (everything) return { content: clone(proposed), notes }

  const next = clone(current)
  // Accepted changes and removals of existing playlists, in place.
  next.playlists = next.playlists.flatMap((p) => {
    if (!acceptedIds.has(p.id)) return [p]
    const replacement = proposedById.get(p.id)
    return replacement ? [clone(replacement)] : []
  })
  // Accepted new playlists, in proposal order.
  for (const p of proposed.playlists) {
    if (acceptedIds.has(p.id) && !currentIds.has(p.id)) next.playlists.push(clone(p))
  }
  // Episodes placed by accepted playlists are no longer excluded.
  const placed = new Set(next.playlists.filter(p => acceptedIds.has(p.id)).flatMap(p => p.episodes))
  next.excluded = next.excluded.filter(e => !placed.has(e.guid))

  if (accept.exclusions) {
    const proposedExcluded = new Map(proposed.excluded.map(e => [e.guid, e.reason]))
    const currentExcluded = new Set(current.excluded.map(e => e.guid))
    const kept = next.excluded.filter(e => proposedExcluded.has(e.guid) || !currentExcluded.has(e.guid))
    const map = new Map(kept.map(e => [e.guid, e.reason]))
    for (const [guid, reason] of proposedExcluded) map.set(guid, reason)
    next.excluded = [...map].map(([guid, reason]) => ({ guid, reason }))
    const set = new Set(map.keys())
    for (const p of next.playlists) p.episodes = p.episodes.filter(g => !set.has(g))
  }

  fixParents(next, notes)
  return { content: next, notes }
}
