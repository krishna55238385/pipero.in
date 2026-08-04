import crypto from 'crypto'
import pool from '@/lib/db'

/**
 * Outbound webhook enqueue + delivery worker (PRD §6.8.21).
 */
export async function enqueueWebhookEvent(
  orgId: string,
  eventType: string,
  payload: Record<string, unknown>
): Promise<number> {
  const hooks = await pool
    .query<{ id: string; events: string[] }>(
      `SELECT id, events FROM public.mail_webhooks
       WHERE organization_id = $1 AND is_active = TRUE`,
      [orgId]
    )
    .catch(() => ({ rows: [] as { id: string; events: string[] }[] }))

  let queued = 0
  for (const h of hooks.rows) {
    const events = h.events || []
    if (events.length > 0 && !events.includes(eventType) && !events.includes('*')) continue
    await pool.query(
      `INSERT INTO public.mail_webhook_deliveries
        (organization_id, webhook_id, event_type, payload, status, next_attempt_at)
       VALUES ($1,$2,$3,$4::jsonb,'pending',NOW())`,
      [orgId, h.id, eventType, JSON.stringify(payload)]
    )
    queued++
  }
  return queued
}

export async function processWebhookDeliveries(limit = 40): Promise<{
  delivered: number
  failed: number
}> {
  const due = await pool
    .query<{
      id: string
      organization_id: string
      webhook_id: string
      event_type: string
      payload: Record<string, unknown>
      attempts: number
      url: string
      secret: string
    }>(
      `SELECT d.id, d.organization_id, d.webhook_id, d.event_type, d.payload, d.attempts,
              w.url, w.secret
       FROM public.mail_webhook_deliveries d
       JOIN public.mail_webhooks w ON w.id = d.webhook_id AND w.organization_id = d.organization_id
       WHERE d.status IN ('pending', 'failed')
         AND d.next_attempt_at <= NOW()
         AND w.is_active = TRUE
       ORDER BY d.next_attempt_at ASC
       LIMIT $1`,
      [limit]
    )
    .catch(() => ({ rows: [] as Array<{
      id: string
      organization_id: string
      webhook_id: string
      event_type: string
      payload: Record<string, unknown>
      attempts: number
      url: string
      secret: string
    }> }))

  let delivered = 0
  let failed = 0

  for (const row of due.rows) {
    await pool.query(
      `UPDATE public.mail_webhook_deliveries SET status = 'processing', updated_at = NOW() WHERE id = $1`,
      [row.id]
    )

    const body = JSON.stringify({
      id: row.id,
      type: row.event_type,
      organizationId: row.organization_id,
      data: row.payload,
      createdAt: new Date().toISOString(),
    })
    const signature = crypto.createHmac('sha256', row.secret || '').update(body).digest('hex')
    const started = Date.now()

    try {
      const res = await fetch(row.url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Magnivo-Signature': signature,
          'X-Magnivo-Event': row.event_type,
        },
        body,
        signal: AbortSignal.timeout(15000),
      })
      const durationMs = Date.now() - started
      const text = await res.text().catch(() => '')

      await pool.query(
        `INSERT INTO public.mail_webhook_logs
          (organization_id, webhook_id, event_type, status_code, success, request_body, response_body, duration_ms)
         VALUES ($1,$2,$3,$4,$5,$6::jsonb,$7,$8)`,
        [
          row.organization_id,
          row.webhook_id,
          row.event_type,
          res.status,
          res.ok,
          body,
          text.slice(0, 2000),
          durationMs,
        ]
      )

      if (res.ok) {
        await pool.query(
          `UPDATE public.mail_webhook_deliveries
           SET status = 'delivered', attempts = attempts + 1, last_error = NULL, updated_at = NOW()
           WHERE id = $1`,
          [row.id]
        )
        await pool.query(
          `UPDATE public.mail_webhooks
           SET failure_count = 0, last_success_at = NOW(), updated_at = NOW()
           WHERE id = $1 AND organization_id = $2`,
          [row.webhook_id, row.organization_id]
        )
        delivered++
      } else {
        throw new Error(`HTTP ${res.status}`)
      }
    } catch (err) {
      failed++
      const attempts = row.attempts + 1
      const message = err instanceof Error ? err.message.slice(0, 500) : 'delivery_failed'
      const dead = attempts >= 8
      const backoffMin = Math.min(360, Math.pow(2, attempts))
      const next = new Date(Date.now() + backoffMin * 60_000)

      await pool.query(
        `UPDATE public.mail_webhook_deliveries SET
           status = $2,
           attempts = $3,
           last_error = $4,
           next_attempt_at = $5,
           updated_at = NOW()
         WHERE id = $1`,
        [row.id, dead ? 'dead' : 'failed', attempts, message, next.toISOString()]
      )
      await pool.query(
        `UPDATE public.mail_webhooks
         SET failure_count = failure_count + 1, last_failure_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [row.webhook_id, row.organization_id]
      )
      await pool
        .query(
          `INSERT INTO public.mail_webhook_logs
            (organization_id, webhook_id, event_type, status_code, success, request_body, error_message, duration_ms)
           VALUES ($1,$2,$3,NULL,FALSE,$4::jsonb,$5,$6)`,
          [
            row.organization_id,
            row.webhook_id,
            row.event_type,
            body,
            message,
            Date.now() - started,
          ]
        )
        .catch(() => {})
    }
  }

  return { delivered, failed }
}
