import { z } from 'zod'

export const GROUPING_METHODS = ['premade', 'manual', 'anthropic', 'gemini'] as const
export const PLAYLIST_KINDS = ['broad', 'series'] as const
export const EXCLUDE_REASONS = ['club', 'archive-duplicate', 'trailer', 'other'] as const
export type ExcludeReason = (typeof EXCLUDE_REASONS)[number]

export const EXCLUDE_REASON_LABELS: Record<ExcludeReason, string> = {
  'club': 'Members-only / Club',
  'archive-duplicate': 'Archive re-release',
  'trailer': 'Trailer',
  'other': 'Other'
}

/** Spotify's limit for playlist descriptions (verify again when building the export). */
export const MAX_DESCRIPTION_LENGTH = 300

const guid = z.string().min(1)

export const eraSchema = z.object({
  start: z.number().int(),
  end: z.number().int()
}).refine(era => era.start <= era.end, { message: 'Era start must not be after its end.' })
export type Era = z.infer<typeof eraSchema>

export const playlistSchema = z.object({
  id: z.string().regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Playlist id must be kebab-case.'),
  name: z.string().trim().min(1, 'Playlist name is required.').max(100),
  description: z.string().max(MAX_DESCRIPTION_LENGTH, `Description must be at most ${MAX_DESCRIPTION_LENGTH} characters.`),
  kind: z.enum(PLAYLIST_KINDS),
  parent: z.string().nullable(),
  era: eraSchema.nullable(),
  episodes: z.array(guid)
})
export type Playlist = z.infer<typeof playlistSchema>

export const excludedSchema = z.object({ guid, reason: z.enum(EXCLUDE_REASONS) })
export type Excluded = z.infer<typeof excludedSchema>

/** Structural rules that hold for every valid grouping, independent of the episode list. */
function checkStructure(
  doc: { playlists: Playlist[], excluded: Excluded[] },
  ctx: z.RefinementCtx
) {
  const ids = new Set<string>()
  doc.playlists.forEach((playlist, i) => {
    if (ids.has(playlist.id)) ctx.addIssue({ code: 'custom', path: ['playlists', i, 'id'], message: `Duplicate playlist id "${playlist.id}".` })
    ids.add(playlist.id)
    const seen = new Set<string>()
    playlist.episodes.forEach((g, j) => {
      if (seen.has(g)) ctx.addIssue({ code: 'custom', path: ['playlists', i, 'episodes', j], message: `Episode ${g} appears twice in "${playlist.name}".` })
      seen.add(g)
    })
  })

  const byId = new Map(doc.playlists.map(p => [p.id, p]))
  doc.playlists.forEach((playlist, i) => {
    if (playlist.parent === null) return
    const parent = byId.get(playlist.parent)
    if (playlist.kind !== 'series') {
      ctx.addIssue({ code: 'custom', path: ['playlists', i, 'parent'], message: `Only series playlists can have a parent ("${playlist.name}" is broad).` })
    } else if (!parent) {
      ctx.addIssue({ code: 'custom', path: ['playlists', i, 'parent'], message: `Parent "${playlist.parent}" of "${playlist.name}" does not exist.` })
    } else if (parent.kind !== 'broad') {
      ctx.addIssue({ code: 'custom', path: ['playlists', i, 'parent'], message: `Parent of "${playlist.name}" must be a broad playlist.` })
    }
  })

  const inPlaylist = new Set(doc.playlists.flatMap(p => p.episodes))
  const excluded = new Set<string>()
  doc.excluded.forEach((entry, i) => {
    if (excluded.has(entry.guid)) ctx.addIssue({ code: 'custom', path: ['excluded', i], message: `Episode ${entry.guid} is excluded twice.` })
    if (inPlaylist.has(entry.guid)) ctx.addIssue({ code: 'custom', path: ['excluded', i], message: `Episode ${entry.guid} is both excluded and in a playlist.` })
    excluded.add(entry.guid)
  })
}

/** Shape of `data/grouping.json`. */
export const groupingSchema = z.object({
  version: z.literal(1),
  generatedAt: z.iso.datetime(),
  method: z.enum(GROUPING_METHODS),
  playlists: z.array(playlistSchema),
  excluded: z.array(excludedSchema),
  unassigned: z.array(guid)
}).superRefine(checkStructure)
export type Grouping = z.infer<typeof groupingSchema>

/** The editable part of a grouping. `unassigned` is always derived from it. */
export type GroupingContent = Pick<Grouping, 'playlists' | 'excluded'>

/** Body of `PUT /api/grouping`. */
export const groupingUpdateSchema = z.strictObject({
  /** Revision the edits are based on; the save fails if the file changed since. */
  revision: z.string(),
  playlists: z.array(playlistSchema),
  excluded: z.array(excludedSchema)
}).superRefine(checkStructure)
export type GroupingUpdate = z.infer<typeof groupingUpdateSchema>

export type GroupingIssue =
  | { type: 'unknown-episodes', guids: string[] }
  | { type: 'series-not-in-parent', playlistId: string, parentId: string, guids: string[] }
  | { type: 'empty-playlist', playlistId: string }

/** Response of `GET /api/grouping` and `PUT /api/grouping`. */
export interface GroupingState {
  /** False until `data/grouping.json` has been saved for the first time. */
  exists: boolean
  /** Content hash of the file, used to detect concurrent edits. */
  revision: string
  grouping: Grouping
  issues: GroupingIssue[]
  /** Newest backup made before the last save, if any. */
  lastBackup: string | null
}
