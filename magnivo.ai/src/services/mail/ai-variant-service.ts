import { generateJson } from '@/lib/llm'

export type AiEmailVariant = {
  subject: string
  bodyHtml: string
  opening: string
  cta: string
}

export type GenerateAiVariantsInput = {
  baseSubject?: string
  baseBodyHtml?: string
  goal?: string
  audience?: string
  tone?: string
  leadContext?: {
    name?: string
    company?: string
    jobTitle?: string
    email?: string
  }
  /** Magnivo research-agent fields when available (PRD §6.4) */
  researchContext?: {
    companySummary?: string
    painPoints?: string[]
    recentSignals?: string[]
    icpFitNotes?: string
  }
  count?: number
}

export type GenerateAiVariantsResult = {
  variants: AiEmailVariant[]
}

function normalizeBodyHtml(raw: string): string {
  if (!raw) return '<p>Hi {{name}},</p>'
  if (/<[a-z][\s\S]*>/i.test(raw)) return raw
  return raw
    .split(/\n{2,}/)
    .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
    .join('')
}

function parseVariantsPayload(raw: string, count: number): AiEmailVariant[] {
  let parsed: { variants?: Array<Record<string, string>> }
  try {
    parsed = JSON.parse(raw)
  } catch {
    const match = raw.match(/\{[\s\S]*\}/)
    parsed = match ? JSON.parse(match[0]) : { variants: [] }
  }

  const rows = Array.isArray(parsed.variants) ? parsed.variants : []
  const variants: AiEmailVariant[] = []

  for (let i = 0; i < rows.length && variants.length < count; i++) {
    const row = rows[i]
    const subject = (row.subject || row.Subject || '').trim()
    const bodyHtml = normalizeBodyHtml(row.bodyHtml || row.body || '')
    const opening = (row.opening || row.openingLine || '').trim()
    const cta = (row.cta || row.callToAction || '').trim()
    if (!subject || !bodyHtml) continue
    variants.push({ subject, bodyHtml, opening, cta })
  }

  return variants
}

function distinctEnough(a: AiEmailVariant, b: AiEmailVariant): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return (
    norm(a.subject) !== norm(b.subject) &&
    norm(a.opening || a.bodyHtml.slice(0, 120)) !== norm(b.opening || b.bodyHtml.slice(0, 120)) &&
    norm(a.cta) !== norm(b.cta)
  )
}

/**
 * Generates distinct outreach variants (subject, opening, CTA, structure) via the
 * same LLM path used by Engage compose AI.
 */
export async function generateAiEmailVariants(
  input: GenerateAiVariantsInput
): Promise<GenerateAiVariantsResult> {
  const count = Math.min(Math.max(input.count ?? 3, 1), 5)
  const lead = input.leadContext
  const research = input.researchContext
  const brief = [
    input.goal ? `Goal: ${input.goal}` : '',
    input.audience ? `Audience: ${input.audience}` : '',
    input.tone ? `Tone: ${input.tone}` : '',
    input.baseSubject ? `Base subject (vary, do not copy): ${input.baseSubject}` : '',
    input.baseBodyHtml ? `Base body inspiration (rewrite fully): ${input.baseBodyHtml.slice(0, 800)}` : '',
    lead?.name ? `Lead name: ${lead.name}` : '',
    lead?.company ? `Lead company: ${lead.company}` : '',
    lead?.jobTitle ? `Lead title: ${lead.jobTitle}` : '',
    lead?.email ? `Lead email: ${lead.email}` : '',
    research?.companySummary ? `Research summary: ${research.companySummary}` : '',
    research?.painPoints?.length ? `Pain points: ${research.painPoints.join('; ')}` : '',
    research?.recentSignals?.length ? `Signals: ${research.recentSignals.join('; ')}` : '',
    research?.icpFitNotes ? `ICP notes: ${research.icpFitNotes}` : '',
  ]
    .filter(Boolean)
    .join('\n')

  const prompt = [
    'You are an expert outbound sales copywriter.',
    `Write exactly ${count} DISTINCT cold-email variants for the brief below.`,
    'Each variant MUST differ in subject line, opening hook, CTA wording, and paragraph structure.',
    'No two variants may share the same subject or opening sentence.',
    'When research context is provided, personalize using those facts — do not invent fake specifics.',
    'Keep each email concise (60–120 words). Use {{name}}, {{company}}, {{job_title}}, {{first_name}} merge tags where helpful.',
    '',
    brief || 'Write versatile B2B outreach variants.',
    '',
    'Respond with JSON only:',
    '{',
    '  "variants": [',
    '    {',
    '      "subject": "...",',
    '      "opening": "first sentence or hook (plain text)",',
    '      "cta": "call-to-action line (plain text)",',
    '      "bodyHtml": "full email as simple HTML <p> paragraphs"',
    '    }',
    '  ]',
    '}',
  ].join('\n')

  const raw = await generateJson(prompt, 'mail_campaign_ai_variants')
  const variants = parseVariantsPayload(raw, count)

  const unique: AiEmailVariant[] = []
  for (const variant of variants) {
    if (unique.every((existing) => distinctEnough(existing, variant))) {
      unique.push(variant)
    }
  }

  if (unique.length === 0) {
    throw new Error('AI did not return usable distinct variants')
  }

  return { variants: unique }
}
