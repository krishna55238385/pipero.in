import { createClient } from '@/lib/supabase/server'

/**
 * Records LLM/AI spend produced by the CRM itself (OpenAI calls) into the
 * shared `llm_usage` table — the SAME table the Python phases write to and the
 * GTM usage dashboard reads. This is the user's internal cost-tracking surface;
 * it never affects customer-facing behaviour.
 *
 * Rows use phase='crm' (vs 'phase1'/'phase2'/'phase3') so the dashboard's
 * "By Phase" view cleanly separates product spend from pipeline spend.
 */
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

async function resolveOrgId(supabase: any): Promise<string | undefined> {
  // Mirror gtm.ts getDefaultOrgId(): single-tenant dev picks the first org.
  const { data } = await supabase.from('organizations').select('id').limit(1).single()
  return data?.id
}

/**
 * Fire-and-forget: persist one usage row. Never throws — usage logging must not
 * break the AI feature it is measuring.
 */
export async function logLlmUsage(input: LlmUsageInput): Promise<void> {
  try {
    const supabase = await createClient()
    if (!supabase) return
    const org = await resolveOrgId(supabase)
    const promptTokens = input.promptTokens ?? 0
    const completionTokens = input.completionTokens ?? 0
    const totalTokens = input.totalTokens ?? promptTokens + completionTokens
    const cost =
      input.estimatedCostUsd ?? estimateCostUsd(input.model, promptTokens, completionTokens)

    await supabase.from('llm_usage').insert({
      organization_id: org ?? null,
      agent: input.agent,
      model: input.model,
      phase: input.phase ?? 'crm',
      prompt_tokens: promptTokens,
      completion_tokens: completionTokens,
      total_tokens: totalTokens,
      estimated_cost_usd: cost,
      icp_id: input.icpId ?? null,
    })
  } catch (err) {
    console.error('[llm-usage] failed to log usage:', err)
  }
}
