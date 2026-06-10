/**
 * Safe rendering helpers for GTM agent output.
 *
 * Several agent fields are stored as JSONB arrays of *objects* (e.g.
 * likely_pain_points = [{pain, evidence, confidence}], recent_moves =
 * [{date, move_type, summary}]) even though some TypeScript types loosely
 * call them `string[]`. Rendering such an object directly as a React child
 * throws "Objects are not valid as a React child". These helpers coerce any
 * value — string, number, or object — into a display string.
 */

const TEXT_KEYS = [
  'pain', 'flag', 'summary', 'move', 'text', 'hook', 'title', 'action',
  'name', 'label', 'value', 'description', 'point', 'note', 'reason',
] as const

export function toText(value: unknown): string {
  if (value === null || value === undefined) return ''
  if (typeof value === 'string') return value
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  if (Array.isArray(value)) return value.map(toText).filter(Boolean).join(', ')
  if (typeof value === 'object') {
    const obj = value as Record<string, unknown>
    for (const key of TEXT_KEYS) {
      const v = obj[key]
      if (v != null && typeof v !== 'object') return String(v)
    }
    try {
      return JSON.stringify(value)
    } catch {
      return String(value)
    }
  }
  return String(value)
}

/** Coerce an unknown value into a clean list of display strings. */
export function toTextList(items: unknown): string[] {
  if (!Array.isArray(items)) return []
  return items.map(toText).filter((s) => s.trim().length > 0)
}
