// Pure edit operations on a grouping. Each returns a new object and never mutates its input,
// so the Playlists page can keep the saved state for "Discard" and detect unsaved changes.
import type { Era, ExcludeReason, Grouping, GroupingContent, GroupingIssue, Playlist } from './grouping'

type Content = GroupingContent

function clone<T>(value: T): T {
  return structuredClone(value)
}

function findPlaylist(content: Content, id: string): Playlist {
  const playlist = content.playlists.find(p => p.id === id)
  if (!playlist) throw new Error(`Playlist "${id}" not found.`)
  return playlist
}

/** "The Hundred Years' War" -> "the-hundred-years-war" */
export function slugify(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/['’]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'playlist'
}

/** A slug for `name` that no existing playlist uses yet. */
export function uniquePlaylistId(content: Content, name: string): string {
  const base = slugify(name)
  const taken = new Set(content.playlists.map(p => p.id))
  let id = base
  for (let n = 2; taken.has(id); n++) id = `${base}-${n}`
  return id
}

export interface NewPlaylist {
  name: string
  description?: string
  kind?: Playlist['kind']
  parent?: string | null
  era?: Era | null
  episodes?: string[]
}

/** Adds a playlist. Episodes passed in are removed from the excluded list. Returns the new content and id. */
export function createPlaylist(content: Content, input: NewPlaylist): { content: Content, id: string } {
  const next = clone(content)
  const id = uniquePlaylistId(next, input.name)
  const episodes = [...new Set(input.episodes ?? [])]
  next.playlists.push({
    id,
    name: input.name.trim(),
    description: input.description?.trim() ?? '',
    kind: input.kind ?? 'broad',
    parent: input.kind === 'series' ? (input.parent ?? null) : null,
    era: input.era ?? null,
    episodes
  })
  const added = new Set(episodes)
  next.excluded = next.excluded.filter(e => !added.has(e.guid))
  return { content: next, id }
}

export type PlaylistDetails = Pick<Playlist, 'name' | 'description' | 'kind' | 'parent' | 'era'>

/** Changes name, description, kind, parent and era. The id stays stable (Spotify export relies on it). */
export function updatePlaylist(content: Content, id: string, details: PlaylistDetails): Content {
  const next = clone(content)
  const playlist = findPlaylist(next, id)
  playlist.name = details.name.trim()
  playlist.description = details.description.trim()
  playlist.kind = details.kind
  playlist.parent = details.kind === 'series' ? details.parent : null
  playlist.era = details.era
  // A playlist that becomes a series can no longer be anyone's parent.
  if (details.kind === 'series') {
    for (const other of next.playlists) if (other.parent === id) other.parent = null
  }
  return next
}

/** Deletes a playlist. Its episodes become unassigned unless they are in another playlist. */
export function deletePlaylist(content: Content, id: string): Content {
  const next = clone(content)
  findPlaylist(next, id)
  next.playlists = next.playlists.filter(p => p.id !== id)
  for (const other of next.playlists) if (other.parent === id) other.parent = null
  return next
}

/**
 * Merges `sourceId` into `targetId`: the source's episodes are appended to the target
 * (skipping ones already there), the source is deleted and its child series move to the target.
 */
export function mergePlaylists(content: Content, sourceId: string, targetId: string): Content {
  if (sourceId === targetId) throw new Error('Cannot merge a playlist into itself.')
  const next = clone(content)
  const source = findPlaylist(next, sourceId)
  const target = findPlaylist(next, targetId)
  const existing = new Set(target.episodes)
  target.episodes.push(...source.episodes.filter(g => !existing.has(g)))
  next.playlists = next.playlists.filter(p => p.id !== sourceId)
  for (const other of next.playlists) {
    if (other.parent === sourceId) other.parent = target.kind === 'broad' ? targetId : null
  }
  if (target.parent === sourceId) target.parent = null
  return next
}

/**
 * Adds episodes to a playlist (at the end, or before `index`), skipping ones already in it.
 * Excluded episodes are included again.
 */
export function addEpisodes(content: Content, playlistId: string, guids: string[], index?: number): Content {
  const next = clone(content)
  const playlist = findPlaylist(next, playlistId)
  const existing = new Set(playlist.episodes)
  const toAdd = [...new Set(guids)].filter(g => !existing.has(g))
  playlist.episodes.splice(index ?? playlist.episodes.length, 0, ...toAdd)
  const added = new Set(guids)
  next.excluded = next.excluded.filter(e => !added.has(e.guid))
  return next
}

/** Removes episodes from one playlist. Episodes in no other playlist become unassigned. */
export function removeEpisodes(content: Content, playlistId: string, guids: string[]): Content {
  const next = clone(content)
  const playlist = findPlaylist(next, playlistId)
  const remove = new Set(guids)
  playlist.episodes = playlist.episodes.filter(g => !remove.has(g))
  return next
}

/** Moves episodes from one playlist to another (appended to the target). */
export function moveEpisodes(content: Content, fromId: string, toId: string, guids: string[]): Content {
  if (fromId === toId) return content
  return addEpisodes(removeEpisodes(content, fromId, guids), toId, guids)
}

/** Sets a playlist's episode order. `guids` must contain exactly the playlist's episodes. */
export function reorderEpisodes(content: Content, playlistId: string, guids: string[]): Content {
  const next = clone(content)
  const playlist = findPlaylist(next, playlistId)
  const current = [...playlist.episodes].sort()
  const proposed = [...guids].sort()
  if (current.length !== proposed.length || current.some((g, i) => g !== proposed[i])) {
    throw new Error('Reorder must contain exactly the playlist\'s episodes.')
  }
  playlist.episodes = [...guids]
  return next
}

/** Sorts a playlist by release date (oldest first), using the given date lookup. */
export function sortByReleaseDate(content: Content, playlistId: string, releaseDate: (guid: string) => string | undefined): Content {
  const playlist = findPlaylist(content, playlistId)
  const sorted = [...playlist.episodes].sort((a, b) => (releaseDate(a) ?? '').localeCompare(releaseDate(b) ?? ''))
  return reorderEpisodes(content, playlistId, sorted)
}

/** Excludes episodes: removes them from every playlist and records the reason. */
export function excludeEpisodes(content: Content, guids: string[], reason: ExcludeReason): Content {
  const next = clone(content)
  const set = new Set(guids)
  for (const playlist of next.playlists) playlist.episodes = playlist.episodes.filter(g => !set.has(g))
  const already = new Set(next.excluded.map(e => e.guid))
  next.excluded = next.excluded.map(e => (set.has(e.guid) ? { guid: e.guid, reason } : e))
  next.excluded.push(...[...set].filter(g => !already.has(g)).map(guid => ({ guid, reason })))
  return next
}

/** Includes excluded episodes again. They become unassigned. */
export function includeEpisodes(content: Content, guids: string[]): Content {
  const next = clone(content)
  const set = new Set(guids)
  next.excluded = next.excluded.filter(e => !set.has(e.guid))
  return next
}

/** Episodes that are in no playlist and not excluded, in the order of `allGuids` (release order). */
export function computeUnassigned(content: Content, allGuids: string[]): string[] {
  const placed = new Set([...content.playlists.flatMap(p => p.episodes), ...content.excluded.map(e => e.guid)])
  return allGuids.filter(g => !placed.has(g))
}

/** guid -> ids of the playlists containing it. */
export function membership(content: Content): Map<string, string[]> {
  const map = new Map<string, string[]>()
  for (const playlist of content.playlists) {
    for (const g of playlist.episodes) map.set(g, [...(map.get(g) ?? []), playlist.id])
  }
  return map
}

/** Warnings that don't block saving but should be shown (SPEC section 3). */
export function findIssues(content: Content, allGuids: string[]): GroupingIssue[] {
  const issues: GroupingIssue[] = []
  const known = new Set(allGuids)
  const referenced = [...content.playlists.flatMap(p => p.episodes), ...content.excluded.map(e => e.guid)]
  const unknown = [...new Set(referenced.filter(g => !known.has(g)))]
  if (unknown.length) issues.push({ type: 'unknown-episodes', guids: unknown })

  const byId = new Map(content.playlists.map(p => [p.id, p]))
  for (const playlist of content.playlists) {
    if (!playlist.episodes.length) issues.push({ type: 'empty-playlist', playlistId: playlist.id })
    const parent = playlist.parent ? byId.get(playlist.parent) : undefined
    if (parent) {
      const inParent = new Set(parent.episodes)
      const missing = playlist.episodes.filter(g => !inParent.has(g))
      if (missing.length) issues.push({ type: 'series-not-in-parent', playlistId: playlist.id, parentId: parent.id, guids: missing })
    }
  }
  return issues
}

/** A fresh, empty grouping (used until `data/grouping.json` exists). */
export function emptyGrouping(allGuids: string[]): Grouping {
  return {
    version: 1,
    generatedAt: new Date().toISOString(),
    method: 'manual',
    playlists: [],
    excluded: [],
    unassigned: [...allGuids]
  }
}
