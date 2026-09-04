import pool from '@/lib/db'
import { getSessionUser } from '@/lib/auth'

class RDSQuery {
  private table: string
  private command: 'select' | 'insert' | 'upsert' | 'update' = 'select'
  private selectCols = '*'
  private filters: { op: string; col: string; val: unknown }[] = []
  private orderClauses: string[] = []
  private limitVal?: number
  private singleVal = false
  private insertRows: Record<string, unknown>[] = []
  private updateData: Record<string, unknown> | null = null
  private conflictCol?: string
  private _params: unknown[] = []
  private countExact = false
  private headOnly = false

  constructor(table: string) { this.table = table }

  // `opts` mirrors Supabase's `.select(columns, { count: 'exact', head: true })`
  // — used by callers to get a row count without fetching rows. Found missing
  // here in production (2026-09-04): it silently accepted the call (extra arg
  // ignored) and always returned `count: undefined`, so every caller's
  // `count ?? 0` treated the count as always zero.
  select(columns?: string, opts?: { count?: 'exact'; head?: boolean }): this {
    this.command = 'select'
    this.selectCols = columns ?? '*'
    this.countExact = opts?.count === 'exact'
    this.headOnly = !!opts?.head
    return this
  }
  eq(col: string, val: unknown): this { this.filters.push({ op: '=', col, val }); return this }
  in(col: string, vals: unknown[]): this { this.filters.push({ op: 'IN', col, val: vals }); return this }
  ilike(col: string, val: string): this { this.filters.push({ op: 'ILIKE', col, val }); return this }
  gte(col: string, val: unknown): this { this.filters.push({ op: '>=', col, val }); return this }
  lte(col: string, val: unknown): this { this.filters.push({ op: '<=', col, val }); return this }
  gt(col: string, val: unknown): this { this.filters.push({ op: '>', col, val }); return this }
  lt(col: string, val: unknown): this { this.filters.push({ op: '<', col, val }); return this }
  neq(col: string, val: unknown): this { this.filters.push({ op: '<>', col, val }); return this }
  // Supabase's `.not(column, operator, value)` negates that operator. Only
  // the `is`/null form is used anywhere in this codebase today (production
  // crash source: engage-worker.ts calling `.not('icp_id', 'is', null)` on
  // an RDSQuery instance that had no `.not` method at all — a plain
  // "not is not a function" TypeError, uncaught, on every auto-campaign
  // enrollment). Any other operator throws loudly rather than silently
  // producing the wrong WHERE clause.
  not(col: string, operator: string, val: unknown): this {
    if (operator === 'is' && val === null) {
      this.filters.push({ op: 'IS NOT NULL', col, val: undefined })
      return this
    }
    throw new Error(`RDSQuery.not() does not support operator "${operator}" (value: ${JSON.stringify(val)})`)
  }

  order(col: string, opts?: { ascending?: boolean }): this {
    this.orderClauses.push(`"${col}" ${opts?.ascending !== false ? 'ASC' : 'DESC'}`)
    return this
  }
  limit(n: number): this { this.limitVal = n; return this }
  single(): this { this.singleVal = true; return this }
  maybeSingle(): this { this.singleVal = true; return this }

  insert(rows: Record<string, unknown> | Record<string, unknown>[]): this {
    this.command = 'insert'
    this.insertRows = Array.isArray(rows) ? rows : [rows]
    return this
  }
  upsert(rows: Record<string, unknown> | Record<string, unknown>[], opts?: { onConflict?: string }): this {
    this.command = 'upsert'
    this.insertRows = Array.isArray(rows) ? rows : [rows]
    this.conflictCol = opts?.onConflict
    return this
  }
  update(data: Record<string, unknown>): this { this.command = 'update'; this.updateData = data; return this }

  private param(v: unknown): string {
    this._params.push(v)
    return `$${this._params.length}`
  }

  private whereClause(): string {
    if (!this.filters.length) return ''
    const parts: string[] = []
    for (const f of this.filters) {
      if (f.op === '=') {
        parts.push(`"${f.col}" = ${this.param(f.val)}`)
      } else if (f.op === 'IN') {
        const vals = f.val as unknown[]
        if (!vals.length) { parts.push('1=0'); continue }
        parts.push(`"${f.col}" IN (${vals.map((v) => this.param(v)).join(',')})`)
      } else if (f.op === 'ILIKE') {
        parts.push(`"${f.col}" ILIKE ${this.param(f.val)}`)
      } else if (f.op === '>=' || f.op === '<=' || f.op === '>' || f.op === '<' || f.op === '<>') {
        parts.push(`"${f.col}" ${f.op} ${this.param(f.val)}`)
      } else if (f.op === 'IS NOT NULL') {
        parts.push(`"${f.col}" IS NOT NULL`)
      } else {
        // A filter operator that isn't wired up here must fail loudly, not
        // silently drop out of the WHERE clause — a dropped filter returns
        // MORE rows than intended, a wrong-but-quiet result rather than a
        // crash. That silent-drop pattern (Supabase-shaped calls compiling
        // fine against this shim's `any`-typed client but doing the wrong
        // thing at runtime) is exactly what caused the 2026-09-04 "Send now"
        // production incident.
        throw new Error(`RDSQuery: unsupported filter operator "${f.op}"`)
      }
    }
    return 'WHERE ' + parts.join(' AND ')
  }

  private async exec(): Promise<{ data: unknown; error: Error | null; count?: number }> {
    const params = this._params
    const schemaTable = `public.${this.table}`

    if (this.command === 'select') {
      if (this.countExact) {
        const sql = `SELECT COUNT(*)::int AS count FROM ${schemaTable} ${this.whereClause()}`.trim()
        const r = await pool.query(sql, params)
        const count = Number(r.rows[0]?.count ?? 0)
        return { data: this.headOnly ? null : r.rows, error: null, count }
      }
      const order = this.orderClauses.length ? `ORDER BY ${this.orderClauses.join(', ')}` : ''
      const limit = this.limitVal ? `LIMIT ${this.limitVal}` : ''
      const sql = `SELECT ${this.selectCols} FROM ${schemaTable} ${this.whereClause()} ${order} ${limit}`.trim()
      const r = await pool.query(sql, params)
      return { data: this.singleVal ? (r.rows[0] ?? null) : r.rows, error: null }
    }

    if (this.command === 'insert') {
      if (!this.insertRows.length) return { data: null, error: new Error('No rows to insert') }
      const cols = Object.keys(this.insertRows[0])
      const valueRows = this.insertRows.map((row) => {
        const placeholders = cols.map((c) => {
          this._params.push(row[c])
          return `$${this._params.length}`
        })
        return `(${placeholders.join(',')})`
      })
      const sql = `INSERT INTO ${schemaTable} (${cols.map((c) => `"${c}"`).join(',')}) VALUES ${valueRows.join(',')} RETURNING *`
      const r = await pool.query(sql, this._params)
      return { data: this.singleVal ? (r.rows[0] ?? null) : r.rows, error: null }
    }

    if (this.command === 'upsert') {
      if (!this.insertRows.length) return { data: null, error: new Error('No rows to upsert') }
      const cols = Object.keys(this.insertRows[0])
      const valueRows = this.insertRows.map((row) => {
        const placeholders = cols.map((c) => {
          this._params.push(row[c])
          return `$${this._params.length}`
        })
        return `(${placeholders.join(',')})`
      })
      const updateSet = cols.map((c) => `"${c}" = EXCLUDED."${c}"`).join(',')
      const conflict = this.conflictCol ? `ON CONFLICT (${this.conflictCol})` : ''
      const sql = `INSERT INTO ${schemaTable} (${cols.map((c) => `"${c}"`).join(',')}) VALUES ${valueRows.join(',')} ${conflict} DO UPDATE SET ${updateSet} RETURNING *`
      const r = await pool.query(sql, this._params)
      return { data: r.rows, error: null }
    }

    if (this.command === 'update') {
      if (!this.updateData) return { data: null, error: new Error('No update data') }
      const setClause = Object.entries(this.updateData)
        .map(([k, v]) => `"${k}" = ${this.param(v)}`)
        .join(',')
      const sql = `UPDATE ${schemaTable} SET ${setClause} ${this.whereClause()} RETURNING *`
      const r = await pool.query(sql, this._params)
      return { data: this.singleVal ? (r.rows[0] ?? null) : r.rows, error: null }
    }

    return { data: null, error: new Error(`Unknown command: ${this.command}`) }
  }

  async then<TResult1 = { data: unknown; error: Error | null; count?: number }, TResult2 = never>(
    onfulfilled?: ((value: { data: unknown; error: Error | null; count?: number }) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: Error) => TResult2 | PromiseLike<TResult2>) | null,
  ): Promise<TResult1 | TResult2> {
    try {
      const result = await this.exec()
      if (onfulfilled) return onfulfilled(result as any)
      return result as any
    } catch (e) {
      const err = e instanceof Error ? e : new Error(String(e))
      if (onrejected) return onrejected(err)
      throw err
    }
  }
}

class RDSClient {
  from(table: string): RDSQuery {
    return new RDSQuery(table)
  }

  auth = {
    getUser: async () => {
      const s = await getSessionUser()
      return { data: { user: s ? { id: s.userId, email: s.email } : null }, error: null }
    },
  }
}

export async function createClient(): Promise<any> {
  return new RDSClient()
}
