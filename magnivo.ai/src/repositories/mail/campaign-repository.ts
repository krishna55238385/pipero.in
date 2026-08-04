import pool from '@/lib/db'
import type { Campaign, CampaignStatus, CampaignSearchRequest, TriggerType } from '@/types/campaign'

// ============================================================
// Row Types
// ============================================================

type CampaignRow = {
  id: string
  organization_id: string
  folder_id: string | null
  name: string
  description: string
  status: CampaignStatus
  subject: string
  body_html: string
  body_text: string
  preview_text: string
  from_name: string
  from_email: string
  reply_to: string
  pool_id: string | null
  timezone: string
  trigger_type: string
  owner_id: string | null
  version: number
  is_deleted: boolean
  deleted_at: string | null
  archived_at: string | null
  scheduled_at: string | null
  started_at: string | null
  stopped_at: string | null
  completed_at: string | null
  last_paused_at: string | null
  recipient_count: number
  sent_count: number
  open_count: number
  click_count: number
  reply_count: number
  bounce_count: number
  unsubscribe_count: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

// ============================================================
// Mappers
// ============================================================

function mapRow(row: CampaignRow): Campaign {
  return {
    id: row.id,
    organizationId: row.organization_id,
    folderId: row.folder_id,
    name: row.name,
    description: row.description,
    status: row.status,
    subject: row.subject,
    bodyHtml: row.body_html,
    bodyText: row.body_text,
    previewText: row.preview_text,
    fromName: row.from_name,
    fromEmail: row.from_email,
    replyTo: row.reply_to,
    poolId: row.pool_id,
    timezone: row.timezone,
    triggerType: row.trigger_type as TriggerType,
    ownerId: row.owner_id,
    version: row.version,
    isDeleted: row.is_deleted,
    deletedAt: row.deleted_at,
    archivedAt: row.archived_at,
    scheduledAt: row.scheduled_at,
    startedAt: row.started_at,
    stoppedAt: row.stopped_at,
    completedAt: row.completed_at,
    lastPausedAt: row.last_paused_at,
    recipientCount: row.recipient_count,
    sentCount: row.sent_count,
    openCount: row.open_count,
    clickCount: row.click_count,
    replyCount: row.reply_count,
    bounceCount: row.bounce_count,
    unsubscribeCount: row.unsubscribe_count,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

// ============================================================
// CRUD
// ============================================================

export async function findCampaignById(id: string, orgId: string): Promise<Campaign | null> {
  const result = await pool.query<CampaignRow>(
    `SELECT * FROM public.campaigns WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findCampaignsByOrg(
  orgId: string,
  options?: { status?: CampaignStatus; folderId?: string | null; search?: string; isDeleted?: boolean }
): Promise<Campaign[]> {
  const conditions: string[] = ['organization_id = $1']
  const values: unknown[] = [orgId]
  let paramIndex = 2

  if (options?.status) {
    conditions.push(`status = $${paramIndex++}`)
    values.push(options.status)
  }

  if (options?.folderId !== undefined) {
    if (options.folderId === null) {
      conditions.push(`folder_id IS NULL`)
    } else {
      conditions.push(`folder_id = $${paramIndex++}`)
      values.push(options.folderId)
    }
  }

  if (options?.search && options.search.trim()) {
    conditions.push(`(name ILIKE $${paramIndex} OR subject ILIKE $${paramIndex})`)
    values.push(`%${options.search.trim()}%`)
    paramIndex++
  }

  if (options?.isDeleted !== undefined) {
    conditions.push(`is_deleted = $${paramIndex++}`)
    values.push(options.isDeleted)
  }

  const result = await pool.query<CampaignRow>(
    `SELECT * FROM public.campaigns WHERE ${conditions.join(' AND ')} ORDER BY created_at DESC`,
    values
  )
  return result.rows.map(mapRow)
}

export async function insertCampaign(data: {
  organizationId: string
  folderId?: string | null
  name: string
  description?: string
  status?: CampaignStatus
  subject?: string
  bodyHtml?: string
  bodyText?: string
  previewText?: string
  fromName?: string
  fromEmail?: string
  replyTo?: string
  poolId?: string | null
  timezone?: string
  triggerType?: string
  ownerId?: string | null
  recipientCount?: number
  metadata?: Record<string, unknown>
}): Promise<Campaign> {
  const result = await pool.query<CampaignRow>(
    `INSERT INTO public.campaigns
      (organization_id, folder_id, name, description, status, subject, body_html, body_text,
       preview_text, from_name, from_email, reply_to, pool_id, timezone, trigger_type,
       owner_id, recipient_count, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18)
     RETURNING *`,
    [
      data.organizationId,
      data.folderId ?? null,
      data.name,
      data.description ?? '',
      data.status ?? 'draft',
      data.subject ?? '',
      data.bodyHtml ?? '',
      data.bodyText ?? '',
      data.previewText ?? '',
      data.fromName ?? '',
      data.fromEmail ?? '',
      data.replyTo ?? '',
      data.poolId ?? null,
      data.timezone ?? 'UTC',
      data.triggerType ?? 'manual',
      data.ownerId ?? null,
      data.recipientCount ?? 0,
      JSON.stringify(data.metadata ?? {}),
    ]
  )
  return mapRow(result.rows[0])
}

export async function updateCampaign(
  id: string,
  orgId: string,
  data: Record<string, unknown>
): Promise<Campaign | null> {
  const fieldMap: Record<string, string> = {
    folderId: 'folder_id', name: 'name', description: 'description',
    status: 'status', subject: 'subject', bodyHtml: 'body_html',
    bodyText: 'body_text', previewText: 'preview_text', fromName: 'from_name',
    fromEmail: 'from_email', replyTo: 'reply_to', poolId: 'pool_id',
    timezone: 'timezone', triggerType: 'trigger_type', ownerId: 'owner_id',
    scheduledAt: 'scheduled_at', startedAt: 'started_at', stoppedAt: 'stopped_at',
    completedAt: 'completed_at', lastPausedAt: 'last_paused_at',
    recipientCount: 'recipient_count', sentCount: 'sent_count',
    openCount: 'open_count', clickCount: 'click_count',
    replyCount: 'reply_count', bounceCount: 'bounce_count',
    unsubscribeCount: 'unsubscribe_count', metadata: 'metadata',
  }

  const setClauses: string[] = []
  const values: unknown[] = []
  let paramIndex = 1

  for (const [key, dbCol] of Object.entries(fieldMap)) {
    const val = data[key]
    if (val !== undefined) {
      setClauses.push(`${dbCol} = $${paramIndex++}`)
      values.push(key === 'metadata' ? JSON.stringify(val) : val)
    }
  }

  setClauses.push(`version = version + 1`)
  setClauses.push(`updated_at = NOW()`)

  values.push(id, orgId)

  const result = await pool.query<CampaignRow>(
    `UPDATE public.campaigns SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function softDeleteCampaign(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.campaigns SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND is_deleted = FALSE`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function restoreCampaign(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.campaigns SET is_deleted = FALSE, deleted_at = NULL, updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND is_deleted = TRUE`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function archiveCampaign(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `UPDATE public.campaigns SET archived_at = NOW(), updated_at = NOW()
     WHERE id = $1 AND organization_id = $2 AND is_deleted = FALSE`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function countCampaignsByOrg(orgId: string): Promise<Record<CampaignStatus, number>> {
  const result = await pool.query(
    `SELECT status, COUNT(*)::int AS count
     FROM public.campaigns WHERE organization_id = $1 AND is_deleted = FALSE
     GROUP BY status`,
    [orgId]
  )
  const counts: Record<string, number> = {}
  for (const row of result.rows) {
    counts[row.status] = row.count
  }
  return counts as Record<CampaignStatus, number>
}

export async function countCampaignsByStatus(status: CampaignStatus): Promise<number> {
  const result = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.campaigns WHERE status = $1 AND is_deleted = FALSE`,
    [status]
  )
  return result.rows[0]?.count ?? 0
}

export async function searchCampaigns(
  orgId: string,
  params: CampaignSearchRequest
): Promise<{ campaigns: Campaign[]; total: number }> {
  const conditions: string[] = ['c.organization_id = $1', 'c.is_deleted = FALSE']
  const values: unknown[] = [orgId]
  let paramIndex = 2

  if (params.search && params.search.trim()) {
    conditions.push(`(c.name ILIKE $${paramIndex} OR c.subject ILIKE $${paramIndex})`)
    values.push(`%${params.search.trim()}%`)
    paramIndex++
  }

  if (params.status && params.status !== 'all') {
    conditions.push(`c.status = $${paramIndex++}`)
    values.push(params.status)
  }

  if (params.folderId && params.folderId !== 'all') {
    conditions.push(`c.folder_id = $${paramIndex++}`)
    values.push(params.folderId)
  }

  if (params.ownerId && params.ownerId !== 'all') {
    conditions.push(`c.owner_id = $${paramIndex++}`)
    values.push(params.ownerId)
  }

  if (params.poolId && params.poolId !== 'all') {
    conditions.push(`c.pool_id = $${paramIndex++}`)
    values.push(params.poolId)
  }

  if (params.tagId && params.tagId !== 'all') {
    conditions.push(`c.id IN (SELECT campaign_id FROM public.campaign_campaign_tags WHERE tag_id = $${paramIndex})`)
    values.push(params.tagId)
    paramIndex++
  }

  if (params.labelId && params.labelId !== 'all') {
    conditions.push(`c.id IN (SELECT campaign_id FROM public.campaign_campaign_labels WHERE label_id = $${paramIndex})`)
    values.push(params.labelId)
    paramIndex++
  }

  const where = conditions.join(' AND ')

  const countResult = await pool.query(
    `SELECT COUNT(*)::int AS count FROM public.campaigns c WHERE ${where}`,
    values
  )
  const total = countResult.rows[0]?.count ?? 0

  const sortColMap: Record<string, string> = {
    name: 'c.name', status: 'c.status', sentCount: 'c.sent_count',
    createdAt: 'c.created_at', updatedAt: 'c.updated_at',
  }
  const sortCol = sortColMap[params.sortBy ?? 'createdAt'] ?? 'c.created_at'
  const sortDir = params.sortDirection === 'asc' ? 'ASC' : 'DESC'
  const page = params.page ?? 1
  const pageSize = params.pageSize ?? 20
  const offset = (page - 1) * pageSize

  values.push(pageSize, offset)

  const result = await pool.query<CampaignRow>(
    `SELECT c.* FROM public.campaigns c
     WHERE ${where}
     ORDER BY ${sortCol} ${sortDir} NULLS LAST
     LIMIT $${paramIndex} OFFSET $${paramIndex + 1}`,
    values
  )

  return { campaigns: result.rows.map(mapRow), total }
}

export async function moveCampaignToFolder(
  id: string,
  orgId: string,
  folderId: string | null
): Promise<Campaign | null> {
  const result = await pool.query<CampaignRow>(
    `UPDATE public.campaigns SET folder_id = $1, updated_at = NOW()
     WHERE id = $2 AND organization_id = $3
     RETURNING *`,
    [folderId, id, orgId]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function duplicateCampaign(
  id: string,
  orgId: string,
  newData?: { name?: string }
): Promise<Campaign | null> {
  const existing = await findCampaignById(id, orgId)
  if (!existing) return null

  const result = await pool.query<CampaignRow>(
    `INSERT INTO public.campaigns
      (organization_id, folder_id, name, description, status, subject, body_html, body_text,
       preview_text, from_name, from_email, reply_to, pool_id, timezone, trigger_type,
       owner_id, metadata)
     SELECT organization_id, folder_id, $3, description, 'draft', subject, body_html, body_text,
       preview_text, from_name, from_email, reply_to, pool_id, timezone, trigger_type,
       owner_id, metadata
     FROM public.campaigns WHERE id = $1 AND organization_id = $2
     RETURNING *`,
    [id, orgId, newData?.name ? `${existing.name} (Copy)` : `${existing.name} (Copy)`]
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findCampaignByName(
  orgId: string,
  name: string,
  folderId: string | null,
  excludeId?: string
): Promise<Campaign | null> {
  const conditions: string[] = ['organization_id = $1', 'LOWER(name) = LOWER($2)', 'is_deleted = FALSE']
  const values: unknown[] = [orgId, name]
  let paramIndex = 3

  if (folderId === null) {
    conditions.push('folder_id IS NULL')
  } else {
    conditions.push(`folder_id = $${paramIndex++}`)
    values.push(folderId)
  }

  if (excludeId) {
    conditions.push(`id != $${paramIndex++}`)
    values.push(excludeId)
  }

  const result = await pool.query<CampaignRow>(
    `SELECT * FROM public.campaigns WHERE ${conditions.join(' AND ')} LIMIT 1`,
    values
  )
  return result.rows[0] ? mapRow(result.rows[0]) : null
}

export async function findCampaignsByPoolId(poolId: string, orgId: string): Promise<Campaign[]> {
  const result = await pool.query<CampaignRow>(
    `SELECT * FROM public.campaigns WHERE pool_id = $1 AND organization_id = $2 AND is_deleted = FALSE ORDER BY created_at DESC`,
    [poolId, orgId]
  )
  return result.rows.map(mapRow)
}

export async function getDashboardStats(orgId: string): Promise<{
  totalCampaigns: number
  draft: number
  scheduled: number
  running: number
  paused: number
  completed: number
  archived: number
  failed: number
  totalSent: number
  totalOpened: number
  totalClicked: number
  avgOpenRate: number
  avgClickRate: number
}> {
  const result = await pool.query(
    `SELECT
       COUNT(*)::int AS total_campaigns,
       COUNT(*) FILTER (WHERE status = 'draft' AND archived_at IS NULL)::int AS draft,
       COUNT(*) FILTER (WHERE status = 'scheduled' AND archived_at IS NULL)::int AS scheduled,
       COUNT(*) FILTER (WHERE status = 'running' AND archived_at IS NULL)::int AS running,
       COUNT(*) FILTER (WHERE status = 'paused' AND archived_at IS NULL)::int AS paused,
       COUNT(*) FILTER (WHERE status = 'completed' AND archived_at IS NULL)::int AS completed,
       COUNT(*) FILTER (WHERE archived_at IS NOT NULL)::int AS archived,
       COUNT(*) FILTER (WHERE status = 'failed' AND archived_at IS NULL)::int AS failed,
       COALESCE(SUM(sent_count), 0)::int AS total_sent,
       COALESCE(SUM(open_count), 0)::int AS total_opened,
       COALESCE(SUM(click_count), 0)::int AS total_clicked
     FROM public.campaigns
     WHERE organization_id = $1 AND is_deleted = FALSE`,
    [orgId]
  )
  const row = result.rows[0]
  const totalSent = row?.total_sent ?? 0
  const totalOpened = row?.total_opened ?? 0
  const totalClicked = row?.total_clicked ?? 0
  return {
    totalCampaigns: row?.total_campaigns ?? 0,
    draft: row?.draft ?? 0,
    scheduled: row?.scheduled ?? 0,
    running: row?.running ?? 0,
    paused: row?.paused ?? 0,
    completed: row?.completed ?? 0,
    archived: row?.archived ?? 0,
    failed: row?.failed ?? 0,
    totalSent,
    totalOpened,
    totalClicked,
    avgOpenRate: totalSent > 0 ? totalOpened / totalSent : 0,
    avgClickRate: totalSent > 0 ? totalClicked / totalSent : 0,
  }
}

export async function bulkUpdateCampaignStatus(
  ids: string[],
  orgId: string,
  status: CampaignStatus
): Promise<number> {
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `UPDATE public.campaigns SET status = $${ids.length + 1}, updated_at = NOW()
     WHERE id IN (${placeholders}) AND organization_id = $${ids.length + 2} AND is_deleted = FALSE`,
    [...ids, status, orgId]
  )
  return result.rowCount ?? 0
}

export async function bulkArchiveCampaigns(ids: string[], orgId: string): Promise<number> {
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `UPDATE public.campaigns SET archived_at = NOW(), updated_at = NOW()
     WHERE id IN (${placeholders}) AND organization_id = $${ids.length + 1} AND is_deleted = FALSE AND status != 'running'`,
    [...ids, orgId]
  )
  return result.rowCount ?? 0
}

export async function bulkSoftDeleteCampaigns(ids: string[], orgId: string): Promise<number> {
  if (ids.length === 0) return 0
  const placeholders = ids.map((_, i) => `$${i + 1}`).join(', ')
  const result = await pool.query(
    `UPDATE public.campaigns SET is_deleted = TRUE, deleted_at = NOW(), updated_at = NOW()
     WHERE id IN (${placeholders}) AND organization_id = $${ids.length + 1} AND is_deleted = FALSE AND status NOT IN ('running', 'scheduled')`,
    [...ids, orgId]
  )
  return result.rowCount ?? 0
}

export async function attachTagsToCampaign(campaignId: string, tagIds: string[]): Promise<void> {
  if (tagIds.length === 0) return
  for (const tagId of tagIds) {
    await pool.query(
      `INSERT INTO public.campaign_campaign_tags (campaign_id, tag_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [campaignId, tagId]
    )
  }
}

export async function detachTagsFromCampaign(campaignId: string): Promise<void> {
  await pool.query(
    `DELETE FROM public.campaign_campaign_tags WHERE campaign_id = $1`,
    [campaignId]
  )
}

export async function attachLabelsToCampaign(campaignId: string, labelIds: string[]): Promise<void> {
  if (labelIds.length === 0) return
  for (const labelId of labelIds) {
    await pool.query(
      `INSERT INTO public.campaign_campaign_labels (campaign_id, label_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [campaignId, labelId]
    )
  }
}

export async function detachLabelsFromCampaign(campaignId: string): Promise<void> {
  await pool.query(
    `DELETE FROM public.campaign_campaign_labels WHERE campaign_id = $1`,
    [campaignId]
  )
}

export async function findTagsByCampaignId(campaignId: string): Promise<import('@/types/campaign').CampaignTag[]> {
  const result = await pool.query(
    `SELECT t.* FROM public.campaign_tags t
     JOIN public.campaign_campaign_tags ct ON ct.tag_id = t.id
     WHERE ct.campaign_id = $1
     ORDER BY t.name ASC`,
    [campaignId]
  )
  return result.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    color: r.color,
    metadata: r.metadata || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export async function findLabelsByCampaignId(campaignId: string): Promise<import('@/types/campaign').CampaignLabel[]> {
  const result = await pool.query(
    `SELECT l.* FROM public.campaign_labels l
     JOIN public.campaign_campaign_labels cl ON cl.label_id = l.id
     WHERE cl.campaign_id = $1
     ORDER BY l.name ASC`,
    [campaignId]
  )
  return result.rows.map((r) => ({
    id: r.id,
    organizationId: r.organization_id,
    name: r.name,
    color: r.color,
    metadata: r.metadata || {},
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  }))
}

export async function getCampaignsByTag(tagId: string, orgId: string): Promise<Campaign[]> {
  const result = await pool.query<CampaignRow>(
    `SELECT c.* FROM public.campaigns c
     JOIN public.campaign_campaign_tags ct ON ct.campaign_id = c.id
     WHERE ct.tag_id = $1 AND c.organization_id = $2 AND c.is_deleted = FALSE
     ORDER BY c.created_at DESC`,
    [tagId, orgId]
  )
  return result.rows.map(mapRow)
}

export async function getCampaignsByLabel(labelId: string, orgId: string): Promise<Campaign[]> {
  const result = await pool.query<CampaignRow>(
    `SELECT c.* FROM public.campaigns c
     JOIN public.campaign_campaign_labels cl ON cl.campaign_id = c.id
     WHERE cl.label_id = $1 AND c.organization_id = $2 AND c.is_deleted = FALSE
     ORDER BY c.created_at DESC`,
    [labelId, orgId]
  )
  return result.rows.map(mapRow)
}
