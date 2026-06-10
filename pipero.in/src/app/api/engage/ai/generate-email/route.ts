import { NextRequest, NextResponse } from 'next/server'
import { generateJson } from '@/lib/llm'

type Body = {
  // Free-form mode (composer "AI Generate"): a single instruction.
  prompt?: string
  to?: string
  // Structured mode (AI Writer panel): goal/audience/tone.
  goal?: string
  audience?: string
  tone?: string
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as Body
    const instruction = (body.prompt || '').trim()
    const hasStructured = body.goal && body.audience && body.tone
    if (!instruction && !hasStructured) {
      return NextResponse.json(
        { error: 'Tell the AI what to write (a prompt), or provide goal, audience and tone.' },
        { status: 400 },
      )
    }

    const brief = instruction
      ? [
          `Instruction from the sender: "${instruction}"`,
          body.to ? `Recipient email: ${body.to}` : '',
        ].filter(Boolean).join('\n')
      : [`Goal: ${body.goal}`, `Audience: ${body.audience}`, `Tone: ${body.tone}`].join('\n')

    const prompt = [
      'You are an expert outbound sales copywriter. Write ONE short, personable',
      'cold/outreach email based on the brief below. Keep it concise (≈60–120',
      'words), with a clear ask and a natural tone — no spammy hype.',
      'You may use the placeholders {{name}} and {{company}} where a personalized',
      'first name or company would go.',
      '',
      brief,
      '',
      'Respond with a JSON object with exactly these keys:',
      '  "subject": a compelling subject line (plain text, no quotes)',
      '  "bodyHtml": the email body as simple HTML using <p> paragraphs (and',
      '              <br> / <ul><li> if useful). Do NOT include <html> or <body> tags.',
    ].join('\n')

    const raw = await generateJson(prompt, 'engage_compose_ai')
    let parsed: { subject?: string; bodyHtml?: string; body?: string }
    try {
      parsed = JSON.parse(raw)
    } catch {
      const m = raw.match(/\{[\s\S]*\}/)
      parsed = m ? JSON.parse(m[0]) : {}
    }

    // Be forgiving about the body key and plain-text bodies.
    let bodyHtml = parsed.bodyHtml || parsed.body || ''
    if (bodyHtml && !/<[a-z][\s\S]*>/i.test(bodyHtml)) {
      bodyHtml = bodyHtml
        .split(/\n{2,}/)
        .map((p) => `<p>${p.replace(/\n/g, '<br>')}</p>`)
        .join('')
    }

    return NextResponse.json({
      subject: parsed.subject || 'Quick note',
      bodyHtml: bodyHtml || '<p>Hi {{name}},</p><p></p>',
    })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'ai_generation_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}
