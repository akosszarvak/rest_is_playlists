import type { z } from 'zod'
import type { AiProvider } from '#shared/settings'
import type { GroupingContent } from '#shared/grouping'
import {
  ASSIGN_BATCH_SIZE,
  assembleFullAnswer,
  assignOutputSchema,
  batches,
  buildAssignPrompt,
  buildIncrementalBatchPrompt,
  buildPlanPrompt,
  estimateRun,
  incrementalOutputSchema,
  planOutputSchema,
  SYSTEM_PROMPT,
  toIncrementalAnswer,
  type AssignOutput,
  type RunEstimate
} from '#shared/ai-pipeline'
import {
  fullAnswerSchema,
  incrementalAnswerSchema,
  proposalFromFullAnswer,
  proposalFromIncrementalAnswer,
  type ProposalMode,
  type ProposalResult
} from '#shared/proposal'
import type { RunStatus } from '#shared/ai-run'

const MAX_OUTPUT_TOKENS: Record<AiProvider, number> = {
  // Non-streaming SDK calls stay well under the SDK's long-request limit.
  anthropic: 16_000,
  // Gemini counts thinking tokens against this limit too.
  gemini: 32_768
}

let current: { status: RunStatus, controller: AbortController } | null = null

export function getRunStatus(): RunStatus | null {
  return current?.status ?? null
}

export function cancelRun(): RunStatus | null {
  if (current?.status.state === 'running') current.controller.abort(new DOMException('Cancelled by the user.', 'AbortError'))
  return getRunStatus()
}

export async function estimateAiRun(mode: ProposalMode): Promise<RunEstimate> {
  const ctx = await proposalContext()
  return estimateRun(mode, ctx.episodes, ctx.current, ctx.unassigned)
}

/** Starts a grouping run in the background. The result becomes the open proposal. */
export async function startRun(provider: AiProvider, mode: ProposalMode): Promise<RunStatus> {
  if (current?.status.state === 'running') throw createError({ statusCode: 409, message: 'A grouping run is already in progress.' })

  const settings = await getSettings()
  const { apiKey, model } = settings[provider]
  if (!apiKey) throw createError({ statusCode: 400, message: `No ${provider === 'anthropic' ? 'Anthropic' : 'Gemini'} API key saved. Add one in Settings.` })

  const ctx = await proposalContext()
  if (mode === 'incremental' && !ctx.unassigned.length) {
    throw createError({ statusCode: 409, message: 'There are no unassigned episodes to place.' })
  }

  const estimate = estimateRun(mode, ctx.episodes, ctx.current, ctx.unassigned)
  const status: RunStatus = {
    id: crypto.randomUUID(),
    provider,
    model,
    mode,
    state: 'running',
    step: 0,
    totalSteps: estimate.requests,
    message: 'Starting…',
    log: [],
    usage: { input: 0, output: 0, requests: 0 },
    error: null,
    startedAt: new Date().toISOString(),
    finishedAt: null
  }
  const controller = new AbortController()
  current = { status, controller }

  const generate = provider === 'anthropic' ? anthropicGenerator(apiKey, model) : geminiGenerator(apiKey, model)
  const log = (text: string) => {
    status.log.push({ at: new Date().toISOString(), text })
    status.message = text
  }

  async function call<S extends z.ZodType>(label: string, prompt: string, schema: S): Promise<z.output<S>> {
    log(`${label}…`)
    const result = await generate({ system: SYSTEM_PROMPT, prompt, schema, maxOutputTokens: MAX_OUTPUT_TOKENS[provider], signal: controller.signal })
    status.usage.input += result.usage.input
    status.usage.output += result.usage.output
    status.usage.requests++
    status.step++
    return result.data
  }

  async function runFull(): Promise<ProposalResult> {
    const plan = await call('Planning the playlists', buildPlanPrompt(ctx.episodes, ctx.current), planOutputSchema)
    if (!plan.playlists.length) throw new AiError('The model proposed no playlists.')
    log(`Planned ${plan.playlists.length} playlists`)

    const assignments: AssignOutput['episodes'] = []
    const parts = batches(ctx.episodes)
    for (const [i, batch] of parts.entries()) {
      const from = i * ASSIGN_BATCH_SIZE + 1
      const output = await call(`Assigning episodes ${from}–${from + batch.length - 1} of ${ctx.episodes.length}`, buildAssignPrompt(batch, ctx.episodes, plan), assignOutputSchema)
      assignments.push(...output.episodes)
    }

    const { answer, warnings } = assembleFullAnswer(plan, assignments, ctx.episodes)
    const result = proposalFromFullAnswer(fullAnswerSchema.parse(answer), ctx)
    return { content: result.content, warnings: [...warnings, ...result.warnings] }
  }

  async function runIncremental(): Promise<ProposalResult> {
    let content: GroupingContent = ctx.current
    const warnings: string[] = []
    const parts = batches(ctx.unassigned)
    for (const [i, batch] of parts.entries()) {
      const label = parts.length > 1 ? `Placing new episodes (batch ${i + 1} of ${parts.length})` : `Placing ${batch.length} new episodes`
      const output = await call(label, buildIncrementalBatchPrompt(ctx.episodes, content, batch), incrementalOutputSchema)
      const result = proposalFromIncrementalAnswer(incrementalAnswerSchema.parse(toIncrementalAnswer(output)), { ...ctx, current: content, unassigned: batch })
      content = result.content
      warnings.push(...result.warnings)
    }
    return { content, warnings }
  }

  // Runs in the background; the UI polls getRunStatus().
  void (async () => {
    try {
      const result = mode === 'full' ? await runFull() : await runIncremental()
      await storeProposal(mode, provider, result, ctx.revision)
      log(`Done. Proposal ready for review (${status.usage.requests} requests, ${status.usage.input.toLocaleString('en')} input and ${status.usage.output.toLocaleString('en')} output tokens).`)
      status.state = 'done'
    } catch (error) {
      if (controller.signal.aborted) {
        status.state = 'cancelled'
        log('Cancelled. Nothing was saved.')
      } else {
        status.state = 'error'
        status.error = error instanceof AiError ? error.message : `Unexpected error: ${(error as Error).message}`
        log(`Failed: ${status.error}`)
        if (!(error instanceof AiError)) console.error('[grouping run]', error)
      }
    } finally {
      status.finishedAt = new Date().toISOString()
    }
  })()

  return status
}
