import { z } from 'zod'
import { AI_PROVIDERS, type AiProvider } from './settings'
import { PROPOSAL_MODES, type ProposalMode } from './proposal'

/** Status of the (single) AI grouping run, polled by the Grouping page. */
export interface RunStatus {
  id: string
  provider: AiProvider
  model: string
  mode: ProposalMode
  state: 'running' | 'done' | 'error' | 'cancelled'
  /** Requests finished so far, out of totalSteps. */
  step: number
  totalSteps: number
  message: string
  log: { at: string, text: string }[]
  usage: { input: number, output: number, requests: number }
  error: string | null
  startedAt: string
  finishedAt: string | null
}

export const startRunRequestSchema = z.strictObject({
  provider: z.enum(AI_PROVIDERS),
  mode: z.enum(PROPOSAL_MODES)
})

export const estimateRequestSchema = z.strictObject({
  mode: z.enum(PROPOSAL_MODES)
})
