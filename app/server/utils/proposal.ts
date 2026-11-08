import { rm } from 'node:fs/promises'
import type { GroupingMethod } from '#shared/grouping'
import {
  applyAccepted,
  buildPrompt,
  storedProposalSchema,
  type AcceptSelection,
  type BuiltPrompt,
  type DetailLevel,
  type ProposalMode,
  type ProposalResult,
  type ProposalState,
  type StoredProposal
} from '#shared/proposal'

const proposalPath = () => repoPath('.data', 'proposal.json')

/** Everything a prompt or an answer conversion needs about the current state. */
export async function proposalContext() {
  const [episodes, state] = await Promise.all([readEpisodes(), getGroupingState()])
  if (!episodes?.episodes.length) {
    throw createError({ statusCode: 409, message: 'No episodes yet. Refresh the episode list from RSS first.' })
  }
  const { playlists, excluded, unassigned } = state.grouping
  return {
    episodes: episodes.episodes,
    guids: episodes.episodes.map(e => e.guid),
    current: { playlists, excluded },
    unassigned,
    revision: state.revision
  }
}

export async function buildGroupingPrompt(mode: ProposalMode, detail: DetailLevel): Promise<BuiltPrompt> {
  const ctx = await proposalContext()
  if (mode === 'incremental' && !ctx.unassigned.length) {
    throw createError({ statusCode: 409, message: 'There are no unassigned episodes, so there is nothing to place incrementally.' })
  }
  return buildPrompt({ mode, detail, episodes: ctx.episodes, current: ctx.current, unassigned: ctx.unassigned })
}

export async function readProposal(): Promise<StoredProposal | null> {
  return readJsonFile(proposalPath(), storedProposalSchema)
}

export async function getProposalState(): Promise<ProposalState> {
  const [proposal, grouping] = await Promise.all([readProposal(), getGroupingState()])
  return { proposal, stale: proposal !== null && proposal.baseRevision !== grouping.revision }
}

/** Stores a new proposal, replacing any open one. Never touches data/grouping.json. */
export async function storeProposal(mode: ProposalMode, method: GroupingMethod, result: ProposalResult, baseRevision: string): Promise<ProposalState> {
  const proposal = storedProposalSchema.parse({
    mode,
    method,
    createdAt: new Date().toISOString(),
    baseRevision,
    content: result.content,
    warnings: result.warnings
  })
  await writeJsonFile(proposalPath(), proposal)
  return { proposal, stale: false }
}

export async function discardProposal(): Promise<void> {
  await rm(proposalPath(), { force: true })
}

/**
 * Applies the accepted parts of the open proposal to data/grouping.json. This is the
 * confirmation step from SPEC 4.4: only called after the user reviewed the diff.
 */
export async function acceptProposal(revision: string, selection: AcceptSelection) {
  const proposal = await readProposal()
  if (!proposal) throw createError({ statusCode: 404, message: 'There is no open proposal to accept.' })

  let notes: string[] = []
  const state = await saveGrouping(revision, (current) => {
    const base = current ?? { playlists: [], excluded: [] }
    const result = applyAccepted({ playlists: base.playlists, excluded: base.excluded }, proposal.content, selection)
    notes = result.notes
    // A full regroup replaces the grouping, so it takes the proposal's method and date.
    // An incremental placement refines the existing grouping and keeps them.
    const regenerated = proposal.mode === 'full' || !current
    return {
      version: 1,
      generatedAt: regenerated ? new Date().toISOString() : current!.generatedAt,
      method: regenerated ? proposal.method : current!.method,
      ...result.content
    }
  })
  await discardProposal()
  return { state, notes }
}
