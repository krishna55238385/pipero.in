import pool from '@/lib/db'
import type { MailApiResult } from '@/types/mail'

export type DeadLetterJob = {
  id: string
  originalJobId: string
  organizationId: string
  mailboxId: string | null
  toEmail: string
  subject: string
  lastError: string | null
  attempts: number
  maxAttempts: number
  movedToDlqAt: string
  reviewedAt: string | null
  reviewedBy: string | null
  replayedAt: string | null
  notes: string | null
  createdAt: string
}

export type DeadLetterJobFilters = {
  limit?: number
  offset?: number
  unreplayedOnly?: boolean
  dateFrom?: string
  dateTo?: string
  search?: string
}

export type DeadLetterStats = {
  total: number
  unreplayed: number
  replayed: number
  oldestEntryDays: number | null
}

export async function moveToDeadLetter(jobId: string, reason: string): Promise<MailApiResult<DeadLetterJob>> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const jobResult = await client.query(
      `SELECT id, organization_id, mailbox_id, to_email, subject, attempts, max_attempts,
              last_error, created_at
       FROM public.mail_send_jobs
       WHERE id = $1 FOR UPDATE`,
      [jobId]
    )
    if (jobResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return { success: false, error: 'Send job not found' }
    }
    const job = jobResult.rows[0]

    const dlqResult = await client.query(
      `INSERT INTO public.mail_send_jobs_dlq
        (organization_id, original_job_id, mailbox_id, to_email, subject, last_error, attempts, max_attempts, notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING *`,
      [job.organization_id, job.id, job.mailbox_id, job.to_email, job.subject, job.last_error, job.attempts, job.max_attempts, reason]
    )

    await client.query(
      `UPDATE public.mail_send_jobs
       SET status = 'dead_letter', updated_at = NOW()
       WHERE id = $1`,
      [jobId]
    )

    await client.query(
      `INSERT INTO public.mailbox_audit_log
        (organization_id, mailbox_id, actor_user_id, actor_email, action, previous_status, new_status, metadata)
       VALUES ($1,$2,'00000000-0000-0000-0000-000000000000','system@magnivo.ai','dead_letter_move','failed','dead_letter',$3::jsonb)`,
      [
        job.organization_id,
        job.mailbox_id || '00000000-0000-0000-0000-000000000000',
        JSON.stringify({ jobId, reason, originalCreatedAt: job.created_at }),
      ]
    ).catch(() => {})

    await client.query('COMMIT')

    const row = dlqResult.rows[0]
    return {
      success: true,
      data: mapRow(row),
    }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return { success: false, error: err instanceof Error ? err.message : 'Failed to move job to dead-letter queue' }
  } finally {
    client.release()
  }
}

export async function listDeadLetterJobs(
  orgId: string,
  opts?: DeadLetterJobFilters
): Promise<DeadLetterJob[]> {
  const limit = opts?.limit ?? 50
  const offset = opts?.offset ?? 0
  const params: unknown[] = [orgId]
  const conditions: string[] = ['organization_id = $1']

  if (opts?.unreplayedOnly) {
    conditions.push(`replayed_at IS NULL`)
  }
  if (opts?.dateFrom) {
    params.push(opts.dateFrom)
    conditions.push(`moved_to_dlq_at >= $${params.length}::timestamptz`)
  }
  if (opts?.dateTo) {
    params.push(opts.dateTo)
    conditions.push(`moved_to_dlq_at <= $${params.length}::timestamptz`)
  }
  if (opts?.search) {
    params.push(`%${opts.search}%`)
    const idx = params.length
    conditions.push(`(to_email ILIKE $${idx} OR subject ILIKE $${idx} OR last_error ILIKE $${idx})`)
  }

  params.push(limit)
  const limitIdx = params.length
  params.push(offset)
  const offsetIdx = params.length

  const result = await pool.query(
    `SELECT id, original_job_id, organization_id, mailbox_id, to_email, subject,
            last_error, attempts, max_attempts, moved_to_dlq_at,
            reviewed_at, reviewed_by, replayed_at, notes, created_at
     FROM public.mail_send_jobs_dlq
     WHERE ${conditions.join(' AND ')}
     ORDER BY moved_to_dlq_at DESC
     LIMIT $${limitIdx} OFFSET $${offsetIdx}`,
    params
  )
  return result.rows.map(mapRow)
}

export async function replayDeadLetterJob(jobId: string, orgId: string): Promise<MailApiResult<boolean>> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const dlqResult = await client.query(
      `SELECT * FROM public.mail_send_jobs_dlq
       WHERE id = $1 AND organization_id = $2
       FOR UPDATE`,
      [jobId, orgId]
    )
    if (dlqResult.rows.length === 0) {
      await client.query('ROLLBACK')
      return { success: false, error: 'Dead-letter job not found' }
    }
    const dlq = dlqResult.rows[0]

    if (dlq.replayed_at) {
      await client.query('ROLLBACK')
      return { success: false, error: 'Dead-letter job has already been replayed' }
    }

    const updateResult = await client.query(
      `UPDATE public.mail_send_jobs
       SET status = 'pending', last_error = NULL, attempts = 0, next_attempt_at = NOW(), updated_at = NOW()
       WHERE id = $1 AND organization_id = $2`,
      [dlq.original_job_id, orgId]
    )

    if ((updateResult.rowCount ?? 0) === 0) {
      await client.query(
        `INSERT INTO public.mail_send_jobs
          (organization_id, mailbox_id, to_email, subject, body_html, body_text, status, attempts, max_attempts, next_attempt_at, scheduled_for, metadata)
         SELECT $1, $2, $3, $4, '', '', 'pending', 0, $5, NOW(), NOW(), $6::jsonb
         WHERE NOT EXISTS (SELECT 1 FROM public.mail_send_jobs WHERE id = $7)`,
        [
          orgId,
          dlq.mailbox_id,
          dlq.to_email,
          dlq.subject,
          dlq.max_attempts,
          JSON.stringify({ replayedFromDlq: true, originalJobId: dlq.original_job_id }),
          dlq.original_job_id,
        ]
      )
    }

    await client.query(
      `UPDATE public.mail_send_jobs_dlq
       SET replayed_at = NOW(), notes = COALESCE(notes, '') || ' [Replayed ' || NOW()::text || ']'
       WHERE id = $1`,
      [jobId]
    )

    const mailboxId = dlq.mailbox_id || '00000000-0000-0000-0000-000000000000'
    await client.query(
      `INSERT INTO public.mailbox_audit_log
        (organization_id, mailbox_id, actor_user_id, actor_email, action, previous_status, new_status, metadata)
       VALUES ($1,$2,'00000000-0000-0000-0000-000000000000','system@magnivo.ai','dead_letter_replay','dead_letter','pending',$3::jsonb)`,
      [
        orgId,
        mailboxId,
        JSON.stringify({ dlqJobId: jobId, originalJobId: dlq.original_job_id }),
      ]
    ).catch(() => {})

    await client.query('COMMIT')
    return { success: true, data: true }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return { success: false, error: err instanceof Error ? err.message : 'Failed to replay dead-letter job' }
  } finally {
    client.release()
  }
}

export async function replayAllDeadLetterJobs(orgId: string): Promise<MailApiResult<{ replayed: number }>> {
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const dlqList = await client.query(
      `SELECT * FROM public.mail_send_jobs_dlq
       WHERE organization_id = $1 AND replayed_at IS NULL`,
      [orgId]
    )

    let count = 0
    for (const dlq of dlqList.rows) {
      const updateResult = await client.query(
        `UPDATE public.mail_send_jobs
         SET status = 'pending', last_error = NULL, attempts = 0, next_attempt_at = NOW(), updated_at = NOW()
         WHERE id = $1 AND organization_id = $2`,
        [dlq.original_job_id, orgId]
      )

      if ((updateResult.rowCount ?? 0) === 0) {
        await client.query(
          `INSERT INTO public.mail_send_jobs
            (organization_id, mailbox_id, to_email, subject, body_html, body_text, status, attempts, max_attempts, next_attempt_at, scheduled_for, metadata)
           SELECT $1, $2, $3, $4, '', '', 'pending', 0, $5, NOW(), NOW(), $6::jsonb
           WHERE NOT EXISTS (SELECT 1 FROM public.mail_send_jobs WHERE id = $7)`,
          [
            orgId,
            dlq.mailbox_id,
            dlq.to_email,
            dlq.subject,
            dlq.max_attempts,
            JSON.stringify({ replayedFromDlq: true, originalJobId: dlq.original_job_id }),
            dlq.original_job_id,
          ]
        )
      }

      await client.query(
        `UPDATE public.mail_send_jobs_dlq
         SET replayed_at = NOW(), notes = COALESCE(notes, '') || ' [Replayed ' || NOW()::text || ']'
         WHERE id = $1`,
        [dlq.id]
      )

      await client.query(
        `INSERT INTO public.mailbox_audit_log
          (organization_id, mailbox_id, actor_user_id, actor_email, action, previous_status, new_status, metadata)
         VALUES ($1,$2,'00000000-0000-0000-0000-000000000000','system@magnivo.ai','dead_letter_replay','dead_letter','pending',$3::jsonb)`,
        [
          orgId,
          dlq.mailbox_id || '00000000-0000-0000-0000-000000000000',
          JSON.stringify({ dlqJobId: dlq.id, originalJobId: dlq.original_job_id }),
        ]
      ).catch(() => {})

      count++
    }

    await client.query('COMMIT')
    return { success: true, data: { replayed: count } }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return { success: false, error: err instanceof Error ? err.message : 'Failed to replay all dead-letter jobs' }
  } finally {
    client.release()
  }
}

export async function getDeadLetterStats(orgId: string): Promise<DeadLetterStats> {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE replayed_at IS NULL)::int AS unreplayed,
       COUNT(*) FILTER (WHERE replayed_at IS NOT NULL)::int AS replayed,
       MIN(moved_to_dlq_at) AS oldest
     FROM public.mail_send_jobs_dlq
     WHERE organization_id = $1`,
    [orgId]
  )
  const row = result.rows[0]
  const oldestEntryDays = row.oldest
    ? Math.floor((Date.now() - new Date(row.oldest).getTime()) / (1000 * 60 * 60 * 24))
    : null
  return {
    total: row.total,
    unreplayed: row.unreplayed,
    replayed: row.replayed,
    oldestEntryDays,
  }
}

export async function purgeDeadLetterJobs(olderThanDays: number): Promise<MailApiResult<{ purged: number }>> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000).toISOString()
  const client = await pool.connect()
  try {
    await client.query('BEGIN')

    const toPurge = await client.query(
      `SELECT * FROM public.mail_send_jobs_dlq
       WHERE moved_to_dlq_at < $1::timestamptz AND replayed_at IS NULL`,
      [cutoff]
    )

    const result = await client.query(
      `DELETE FROM public.mail_send_jobs_dlq
       WHERE moved_to_dlq_at < $1::timestamptz AND replayed_at IS NULL`,
      [cutoff]
    )

    for (const row of toPurge.rows) {
      await client.query(
        `INSERT INTO public.mailbox_audit_log
          (organization_id, mailbox_id, actor_user_id, actor_email, action, metadata)
         VALUES ($1,$2,'00000000-0000-0000-0000-000000000000','system@magnivo.ai','dead_letter_purge',$3::jsonb)`,
        [
          row.organization_id,
          row.mailbox_id || '00000000-0000-0000-0000-000000000000',
          JSON.stringify({ dlqJobId: row.id, originalJobId: row.original_job_id, olderThanDays }),
        ]
      ).catch(() => {})
    }

    await client.query('COMMIT')
    return { success: true, data: { purged: result.rowCount ?? 0 } }
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {})
    return { success: false, error: err instanceof Error ? err.message : 'Failed to purge dead-letter jobs' }
  } finally {
    client.release()
  }
}

function mapRow(row: Record<string, unknown>): DeadLetterJob {
  return {
    id: row.id as string,
    originalJobId: row.original_job_id as string,
    organizationId: row.organization_id as string,
    mailboxId: row.mailbox_id as string | null,
    toEmail: row.to_email as string,
    subject: row.subject as string,
    lastError: row.last_error as string | null,
    attempts: row.attempts as number,
    maxAttempts: row.max_attempts as number,
    movedToDlqAt: row.moved_to_dlq_at as string,
    reviewedAt: row.reviewed_at as string | null,
    reviewedBy: row.reviewed_by as string | null,
    replayedAt: row.replayed_at as string | null,
    notes: row.notes as string | null,
    createdAt: row.created_at as string,
  }
}
