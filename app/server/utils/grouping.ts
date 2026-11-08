import { createHash } from 'node:crypto'
import { copyFile, mkdir, readdir, rm } from 'node:fs/promises'
import { basename } from 'node:path'
import { groupingSchema, type Grouping, type GroupingState } from '#shared/grouping'
import { computeUnassigned, emptyGrouping, findIssues } from '#shared/grouping-ops'

const groupingPath = () => repoPath('data', 'grouping.json')
const backupDir = () => repoPath('.data', 'backups')
const BACKUPS_TO_KEEP = 20
const NO_FILE_REVISION = 'none'

function revisionOf(grouping: Grouping): string {
  return createHash('sha256').update(JSON.stringify(grouping)).digest('hex').slice(0, 16)
}

/** All episode guids in release order (oldest first). Empty if episodes haven't been fetched. */
async function allEpisodeGuids(): Promise<string[]> {
  const episodes = await readEpisodes()
  return episodes?.episodes.map(e => e.guid) ?? []
}

async function latestBackup(): Promise<string | null> {
  const files = await readdir(backupDir()).catch(() => [] as string[])
  const backups = files.filter(f => f.startsWith('grouping-') && f.endsWith('.json')).sort()
  return backups.at(-1) ?? null
}

/** Copies the current grouping.json to .data/backups/ and prunes old backups. */
async function backupCurrentFile(): Promise<void> {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-')
  await mkdir(backupDir(), { recursive: true })
  await copyFile(groupingPath(), repoPath('.data', 'backups', `grouping-${stamp}.json`))
  const files = (await readdir(backupDir())).filter(f => f.startsWith('grouping-')).sort()
  for (const old of files.slice(0, Math.max(0, files.length - BACKUPS_TO_KEEP))) {
    await rm(repoPath('.data', 'backups', basename(old)))
  }
}

/**
 * The current grouping, reconciled with the episode list: `unassigned` is recomputed, so
 * episodes added by an RSS refresh show up without the file being rewritten.
 */
export async function getGroupingState(): Promise<GroupingState> {
  const [stored, allGuids, lastBackup] = await Promise.all([
    readJsonFile(groupingPath(), groupingSchema),
    allEpisodeGuids(),
    latestBackup()
  ])
  const base = stored ?? emptyGrouping(allGuids)
  return {
    exists: stored !== null,
    revision: stored ? revisionOf(stored) : NO_FILE_REVISION,
    grouping: { ...base, unassigned: computeUnassigned(base, allGuids) },
    issues: findIssues(base, allGuids),
    lastBackup
  }
}

let queue: Promise<unknown> = Promise.resolve()

/**
 * Replaces data/grouping.json with `build(current)`, but only if the file still has
 * `expectedRevision` (otherwise 409). Backs up the old file first. Saves run one at a time.
 * Callers are responsible for having the user's confirmation (SPEC section 4.4).
 */
export function saveGrouping(
  expectedRevision: string,
  build: (current: Grouping | null) => Omit<Grouping, 'unassigned'>
): Promise<GroupingState> {
  const run = queue.then(async () => {
    const state = await getGroupingState()
    if (state.revision !== expectedRevision) {
      throw createError({
        statusCode: 409,
        message: 'The grouping was changed elsewhere since you loaded it (maybe in another tab). Reload to see the latest version, then redo your changes.'
      })
    }

    const allGuids = await allEpisodeGuids()
    const draft = build(state.exists ? state.grouping : null)
    const parsed = groupingSchema.safeParse({ ...draft, unassigned: computeUnassigned(draft, allGuids) })
    if (!parsed.success) {
      throw createError({ statusCode: 400, message: `The grouping is invalid, nothing was saved: ${formatZodIssues(parsed.error)}` })
    }

    if (state.exists) await backupCurrentFile()
    await writeJsonFile(groupingPath(), parsed.data)
    return getGroupingState()
  })
  queue = run.catch(() => {})
  return run
}
