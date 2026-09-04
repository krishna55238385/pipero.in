import { describe, it, expect, vi, beforeEach } from 'vitest'

// Regression coverage for the 2026-09-04 "Send now" production incident on
// ICP #62: engage-worker.ts calls Supabase-query-builder methods (.not,
// .gte, .lte, and `.select(cols, { count: 'exact', head: true })`) that
// RDSQuery — this file's hand-rolled Supabase-compatible shim over raw
// Postgres — didn't implement. Because `createClient()` is typed `Promise<any>`,
// TypeScript never caught the mismatch; `.not(...)` threw a plain
// "not is not a function" TypeError at runtime, uncaught anywhere in the
// sendNowForIcp -> ensureAutoCampaignForRun -> runEngageWorker chain, which
// is exactly what surfaces to the browser as Next.js's redacted
// "Application error: a server-side exception has occurred" digest.

const mockQuery = vi.hoisted(() => vi.fn())
vi.mock('@/lib/db', () => ({
  default: { query: mockQuery },
}))
vi.mock('@/lib/auth', () => ({
  getSessionUser: vi.fn(),
}))

import { createClient } from '@/lib/supabase/server'

describe('RDSQuery (Supabase-compatible shim over raw Postgres)', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockQuery.mockResolvedValue({ rows: [] })
  })

  it('.not(col, "is", null) compiles to IS NOT NULL instead of throwing', async () => {
    const supabase = await createClient()
    await supabase
      .from('engage_campaigns')
      .select('*')
      .eq('origin', 'auto')
      .eq('status', 'running')
      .not('icp_id', 'is', null)

    const [sql] = mockQuery.mock.calls[0]
    expect(sql).toContain('"icp_id" IS NOT NULL')
  })

  it('.not() with any other operator throws a clear error instead of silently dropping the filter', async () => {
    const supabase = await createClient()
    // .not() throws synchronously while the chain is being built (before any
    // `await`), so the assertion wraps a plain function call, not a promise.
    expect(() =>
      supabase.from('engage_campaigns').select('*').not('status', 'eq', 'done'),
    ).toThrow(/does not support operator "eq"/)
  })

  it('.gte() and .lte() compile to real comparisons', async () => {
    const supabase = await createClient()
    await supabase
      .from('outreach_log')
      .select('id')
      .eq('status', 'sent')
      .gte('created_at', '2026-09-04T00:00:00.000Z')

    const [sql1] = mockQuery.mock.calls[0]
    expect(sql1).toContain('"created_at" >= $2')

    await supabase
      .from('engage_campaign_recipients')
      .select('*')
      .lte('next_run_at', '2026-09-04T00:00:00.000Z')

    const [sql2] = mockQuery.mock.calls[1]
    expect(sql2).toContain('"next_run_at" <= $1')
  })

  it('.select(cols, { count: "exact", head: true }) returns a real numeric count, not undefined', async () => {
    mockQuery.mockResolvedValueOnce({ rows: [{ count: 3 }] })
    const supabase = await createClient()
    const { data, count } = await supabase
      .from('engage_campaign_recipients')
      .select('id', { count: 'exact', head: true })
      .eq('campaign_id', 'campaign-1')
      .in('status', ['pending', 'in_progress'])

    expect(count).toBe(3)
    expect(data).toBeNull()
    const [sql] = mockQuery.mock.calls[0]
    expect(sql).toMatch(/^SELECT COUNT\(\*\)::int AS count FROM/)
  })

  it('an unrecognized filter operator throws instead of silently omitting itself from the WHERE clause', async () => {
    // Guards against a repeat of the same failure class: a filter that
    // compiles (because the client is typed `any`) but isn't wired into
    // whereClause() must fail loudly, not return a broader-than-intended
    // result set silently.
    class Probe {
      // @ts-expect-error - reaching into the private filters array is the
      // only way to construct an "unknown operator" case for this test,
      // since every public method already maps to a known operator.
      static inject(query: any) { query.filters.push({ op: '???', col: 'x', val: 1 }); return query }
    }
    const supabase = await createClient()
    const query = supabase.from('engage_campaigns').select('*')
    Probe.inject(query)
    await expect(query).rejects.toThrow(/unsupported filter operator/)
  })
})
