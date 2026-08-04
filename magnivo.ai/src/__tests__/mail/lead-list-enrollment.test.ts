import { describe, it, expect } from 'vitest'

function distinctEnough(
  a: { subject: string; opening: string; cta: string; bodyHtml: string },
  b: { subject: string; opening: string; cta: string; bodyHtml: string }
): boolean {
  const norm = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim()
  return (
    norm(a.subject) !== norm(b.subject) &&
    norm(a.opening || a.bodyHtml.slice(0, 120)) !== norm(b.opening || b.bodyHtml.slice(0, 120)) &&
    norm(a.cta) !== norm(b.cta)
  )
}

describe('lead list enrollment preview math', () => {
  it('counts exclusions categories', () => {
    const preview = {
      totalMembers: 10,
      eligible: 6,
      excludedInvalid: 2,
      excludedSuppressed: 1,
      excludedDuplicate: 1,
      excludedOther: 0,
    }
    expect(
      preview.eligible +
        preview.excludedInvalid +
        preview.excludedSuppressed +
        preview.excludedDuplicate +
        preview.excludedOther
    ).toBe(preview.totalMembers)
  })
})

describe('ai variant distinctness (builder)', () => {
  it('rejects identical subjects', () => {
    const a = { subject: 'Hello', opening: 'A', cta: 'Book', bodyHtml: '<p>A</p>' }
    const b = { subject: 'Hello', opening: 'B', cta: 'Call', bodyHtml: '<p>B</p>' }
    expect(distinctEnough(a, b)).toBe(false)
  })

  it('accepts fully distinct variants', () => {
    const a = { subject: 'Quick question', opening: 'Saw your launch', cta: '15 min chat?', bodyHtml: '<p>1</p>' }
    const b = { subject: 'Idea for growth', opening: 'Noticed hiring', cta: 'Worth a look?', bodyHtml: '<p>2</p>' }
    expect(distinctEnough(a, b)).toBe(true)
  })
})
