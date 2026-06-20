import { NextRequest, NextResponse } from 'next/server'
import { generateJson } from '@/lib/llm'

// Generate a reusable email template (name + subject + body) from a free-form
// prompt. Body keeps {{name}} / {{company}} merge tags so it works as a template.
export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as { prompt?: string }
    const instruction = (body.prompt || '').trim()
    if (!instruction) {
      return NextResponse.json({ error: 'Tell the AI what the template should say (a prompt).' }, { status: 400 })
    }

    const prompt = [
      'You are an expert B2B outbound copywriter. Create ONE reusable cold-email',
      'TEMPLATE based on the brief below. Keep it concise (≈70–120 words), natural,',
      'and non-spammy, with a single clear ask.',
      'Use the merge tags {{name}} (recipient first name) and {{company}} (their',
      'company) where personalization belongs — this is a template, not a one-off.',
      '',
      `Brief: ${instruction}`,
      '',
      'Respond with a JSON object with exactly these keys:',
      '  "name": a short internal label for this template (e.g. "Intro — ops automation")',
      '  "subject": the email subject line (plain text, may use {{company}})',
      '  "body": the email body as PLAIN TEXT with real line breaks (\\n), using',
      '          {{name}} / {{company}}. Do NOT use HTML tags.',
    ].join('\n')

    const raw = await generateJson(prompt, 'engage_template_ai')
    let parsed: { name?: string; subject?: string; body?: string }
    try {
      parsed = JSON.parse(raw)
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      parsed = m ? JSON.parse(m[0]) : {}
    }

    return NextResponse.json({
      name: parsed.name || 'AI template',
      subject: parsed.subject || 'Quick question for {{company}}',
      body: parsed.body || 'Hi {{name}},\n\n',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'ai_generation_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
