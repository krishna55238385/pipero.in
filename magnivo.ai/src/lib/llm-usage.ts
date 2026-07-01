import pool from '@/lib/db'

export type LlmUsageInput = {
  /** Feature that made the call, e.g. 'dialer_summary', 'content_ai'. */
  agent: string
  /** Model id reported by the provider, e.g. 'gpt-4o-mini'. */
  model: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  estimatedCostUsd?: number
  phase?: string
  icpId?: number | null
}

// USD per 1M tokens. Cost reporting only — keep in sync with provider pricing.
const PRICING: Record<string, { input: number; output: number }> = {
  // OpenAI (the project's single provider)
  'gpt-4o-mini': { input: 0.15, output: 0.6 },
  'gpt-4o': { input: 2.5, output: 10.0 },
  'gpt-4-turbo': { input: 10.0, output: 30.0 },
  'text-embedding-3-small': { input: 0.02, output: 0.0 },
  'text-embedding-3-large': { input: 0.13, output: 0.0 },
}
const DEFAULT_PRICING = { input: 0.15, output: 0.6 }

export function estimateCostUsd(model: string, promptTokens: number, completionTokens: number): number {
  const p = PRICING[model] ?? DEFAULT_PRICING
  return (promptTokens * p.input + completionTokens * p.output) / 1_000_000
}

async function resolveOrgId(): Promise<string | undefined> {
  const r = await pool.query('SELECT id FROM public.organizations LIMIT 1')
  return r.rows[0]?.id
}

/**
 * Fire-and-forget: persist one usage row. Never throws — usage logging must not
 * break the AI feature it is measuring.
 */
export async function logLlmUsage(input: LlmUsageInput): Promise<void> {
  try {
    const org = await resolveOrgId()
    const promptTokens = input.promptTokens ?? 0
    const completionTokens = input.completionTokens ?? 0
    const totalTokens = input.totalTokens ?? promptTokens + completionTokens
    const cost = input.estimatedCostUsd ?? estimateCostUsd(input.model, promptTokens, completionTokens)

    await pool.query(
      `INSERT INTO public.llm_usage (organization_id, agent, model, phase, prompt_tokens, completion_tokens, total_tokens, estimated_cost_usd, icp_id)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [org ?? null, input.agent, input.model, input.phase ?? 'crm', promptTokens, completionTokens, totalTokens, cost, input.icpId ?? null]
    )
  } catch (err) {
    console.error('[llm-usage] failed to log usage:', err)
  }
}
