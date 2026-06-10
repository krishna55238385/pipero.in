"use server"

import { generateText } from "@/lib/llm"

export type DialerCallSummary = {
  overview: string
  key_points: string[]
  objections: string[]
  next_steps: string[]
  sentiment?: string
  risk_flags?: string[]
}

function stripCodeFences(input: string) {
  const t = input.trim()
  if (t.startsWith("```")) {
    return t.replace(/^```[a-zA-Z0-9_-]*\s*/m, "").replace(/```$/m, "").trim()
  }
  return t
}

export async function summarizeDialerCall(input: {
  transcript: string
  lead?: { name?: string; company?: string; phone?: string; title?: string }
}): Promise<DialerCallSummary> {
  const transcript = input.transcript?.trim()
  if (!transcript) {
    throw new Error("Transcript is required for summary")
  }

  const leadLine = input.lead
    ? `Lead context: name=${input.lead.name ?? ""}, company=${input.lead.company ?? ""}, title=${input.lead.title ?? ""}, phone=${input.lead.phone ?? ""}`
    : "Lead context: (none)"

  const prompt = [
    "You are an expert sales call coach. Summarize the following phone call transcript.",
    "Return STRICT JSON only (no markdown, no code fences) with this schema:",
    `{ "overview": string, "key_points": string[], "objections": string[], "next_steps": string[], "sentiment"?: "positive"|"neutral"|"negative", "risk_flags"?: string[] }`,
    "",
    leadLine,
    "",
    "Transcript:",
    transcript,
  ].join("\n")

  const raw = await generateText(prompt, 'dialer_summary')
  const cleaned = stripCodeFences(raw)

  try {
    const parsed = JSON.parse(cleaned) as DialerCallSummary
    if (!parsed || typeof parsed.overview !== "string") throw new Error("Invalid summary JSON")
    return {
      overview: parsed.overview,
      key_points: Array.isArray(parsed.key_points) ? parsed.key_points.map(String) : [],
      objections: Array.isArray(parsed.objections) ? parsed.objections.map(String) : [],
      next_steps: Array.isArray(parsed.next_steps) ? parsed.next_steps.map(String) : [],
      sentiment: parsed.sentiment ? String(parsed.sentiment) : undefined,
      risk_flags: Array.isArray(parsed.risk_flags) ? parsed.risk_flags.map(String) : undefined,
    }
  } catch {
    // Fallback: attempt to salvage by extracting first JSON object.
    const m = cleaned.match(/\{[\s\S]*\}/)
    if (m) {
      const parsed = JSON.parse(m[0]) as DialerCallSummary
      return {
        overview: typeof parsed?.overview === "string" ? parsed.overview : "Summary generated.",
        key_points: Array.isArray(parsed?.key_points) ? parsed.key_points.map(String) : [],
        objections: Array.isArray(parsed?.objections) ? parsed.objections.map(String) : [],
        next_steps: Array.isArray(parsed?.next_steps) ? parsed.next_steps.map(String) : [],
        sentiment: parsed?.sentiment ? String(parsed.sentiment) : undefined,
        risk_flags: Array.isArray(parsed?.risk_flags) ? parsed.risk_flags.map(String) : undefined,
      }
    }
    throw new Error("Failed to parse AI summary output")
  }
}

