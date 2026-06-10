// CRM LLM helper — OpenAI only (single API key for the whole project).
// All text generation + embeddings use OPENAI_API_KEY, and every call is recorded
// in `llm_usage` (phase='crm') so it shows in the GTM usage dashboard. Uses fetch
// (no SDK dependency).
import { logLlmUsage, estimateCostUsd } from '@/lib/llm-usage'

const OPENAI_API_KEY = process.env.OPENAI_API_KEY
const OPENAI_MODEL = process.env.OPENAI_MODEL || 'gpt-4o-mini'
const EMBED_MODEL = 'text-embedding-3-small'
const EMBED_DIMS = 768 // matches pgvector(768) columns

function requireKey() {
  if (!OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is missing')
  return OPENAI_API_KEY
}

// Single text-generation path so EVERY call records token usage into llm_usage.
// `agent` labels the feature; `model` defaults to the configured OPENAI_MODEL.
export async function generateText(
  prompt: string,
  agent = 'crm_ai',
  model = OPENAI_MODEL,
): Promise<string> {
  const key = requireKey()
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.2,
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI chat error ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const u = data.usage ?? {}
  const promptTokens = u.prompt_tokens ?? 0
  const completionTokens = u.completion_tokens ?? 0
  await logLlmUsage({
    agent,
    model,
    promptTokens,
    completionTokens,
    totalTokens: u.total_tokens ?? promptTokens + completionTokens,
    estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
  })
  return data.choices?.[0]?.message?.content ?? ''
}

// Like generateText, but forces OpenAI JSON mode so the reply is always a valid
// JSON object. The prompt MUST mention "json" (OpenAI requirement). Returns the
// raw JSON string for the caller to parse/validate.
export async function generateJson(
  prompt: string,
  agent = 'crm_ai_json',
  model = OPENAI_MODEL,
): Promise<string> {
  const key = requireKey()
  const res = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model,
      messages: [{ role: 'user', content: prompt }],
      temperature: 0.4,
      response_format: { type: 'json_object' },
    }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI chat error ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const u = data.usage ?? {}
  const promptTokens = u.prompt_tokens ?? 0
  const completionTokens = u.completion_tokens ?? 0
  await logLlmUsage({
    agent,
    model,
    promptTokens,
    completionTokens,
    totalTokens: u.total_tokens ?? promptTokens + completionTokens,
    estimatedCostUsd: estimateCostUsd(model, promptTokens, completionTokens),
  })
  return data.choices?.[0]?.message?.content ?? '{}'
}

export async function embedText(input: string, agent = 'crm_embed'): Promise<number[]> {
  const key = requireKey()
  const res = await fetch('https://api.openai.com/v1/embeddings', {
    method: 'POST',
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model: EMBED_MODEL, input, dimensions: EMBED_DIMS }),
  })
  if (!res.ok) {
    const body = await res.text().catch(() => '')
    throw new Error(`OpenAI embedding error ${res.status}: ${body.slice(0, 200)}`)
  }
  const data = await res.json()
  const values = data.data?.[0]?.embedding
  if (!values || !Array.isArray(values)) throw new Error('OpenAI embedding failed')
  const u = data.usage ?? {}
  const promptTokens = u.prompt_tokens ?? Math.ceil(input.length / 4)
  await logLlmUsage({
    agent,
    model: EMBED_MODEL,
    promptTokens,
    totalTokens: u.total_tokens ?? promptTokens,
    estimatedCostUsd: estimateCostUsd(EMBED_MODEL, promptTokens, 0),
  })
  return values
}

export function renderTemplateVariables(template: string, vars: Record<string, string>) {
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_m, key) => vars[key] ?? '')
}
