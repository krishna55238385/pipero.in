import pool from '@/lib/db'
import type { MailSettings } from '@/types/mail'

type SettingsRow = {
  organization_id: string
  default_signature: string | null
  physical_address: string | null
  company_name: string | null
  tracking_enabled: boolean
  open_tracking: boolean
  click_tracking: boolean
  unsubscribe_link: boolean
  daily_send_limit: number
  warmup_enabled: boolean
  business_hours_start?: number
  business_hours_end?: number
  default_timezone?: string
  rotation_strategy?: string
  hourly_send_limit?: number
  created_at: string
  updated_at: string
}

function mapSettings(row: SettingsRow): MailSettings {
  return {
    organizationId: row.organization_id,
    defaultSignature: row.default_signature,
    physicalAddress: row.physical_address,
    companyName: row.company_name,
    trackingEnabled: row.tracking_enabled,
    openTracking: row.open_tracking,
    clickTracking: row.click_tracking,
    unsubscribeLink: row.unsubscribe_link,
    dailySendLimit: row.daily_send_limit,
    warmupEnabled: row.warmup_enabled,
    businessHoursStart: row.business_hours_start ?? 9,
    businessHoursEnd: row.business_hours_end ?? 17,
    defaultTimezone: row.default_timezone ?? 'UTC',
    rotationStrategy: row.rotation_strategy ?? 'round_robin',
    hourlySendLimit: row.hourly_send_limit ?? 50,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

const DEFAULTS: Omit<MailSettings, 'organizationId' | 'createdAt' | 'updatedAt'> = {
  defaultSignature: null,
  physicalAddress: null,
  companyName: null,
  trackingEnabled: true,
  openTracking: true,
  clickTracking: true,
  unsubscribeLink: true,
  dailySendLimit: 500,
  warmupEnabled: true,
  businessHoursStart: 9,
  businessHoursEnd: 17,
  defaultTimezone: 'UTC',
  rotationStrategy: 'round_robin',
  hourlySendLimit: 50,
}

export async function getOrgMailSettings(orgId: string): Promise<MailSettings> {
  const result = await pool.query<SettingsRow>(
    `SELECT * FROM public.mail_org_settings WHERE organization_id = $1`,
    [orgId]
  )
  if (result.rows[0]) return mapSettings(result.rows[0])

  const inserted = await pool.query<SettingsRow>(
    `INSERT INTO public.mail_org_settings (organization_id)
     VALUES ($1)
     ON CONFLICT (organization_id) DO UPDATE SET updated_at = NOW()
     RETURNING *`,
    [orgId]
  )
  if (inserted.rows[0]) return mapSettings(inserted.rows[0])

  const now = new Date().toISOString()
  return { organizationId: orgId, ...DEFAULTS, createdAt: now, updatedAt: now }
}

export async function updateOrgMailSettings(
  orgId: string,
  input: Partial<MailSettings>,
  _actor: { userId: string; email: string }
): Promise<MailSettings> {
  void _actor
  await getOrgMailSettings(orgId)

  // Prefer full update including schedule/rotation columns; fall back if migration not applied.
  try {
    const result = await pool.query<SettingsRow>(
      `UPDATE public.mail_org_settings SET
         default_signature = COALESCE($2, default_signature),
         physical_address = COALESCE($3, physical_address),
         company_name = COALESCE($4, company_name),
         tracking_enabled = COALESCE($5, tracking_enabled),
         open_tracking = COALESCE($6, open_tracking),
         click_tracking = COALESCE($7, click_tracking),
         unsubscribe_link = COALESCE($8, unsubscribe_link),
         daily_send_limit = COALESCE($9, daily_send_limit),
         warmup_enabled = COALESCE($10, warmup_enabled),
         business_hours_start = COALESCE($11, business_hours_start),
         business_hours_end = COALESCE($12, business_hours_end),
         default_timezone = COALESCE($13, default_timezone),
         rotation_strategy = COALESCE($14, rotation_strategy),
         hourly_send_limit = COALESCE($15, hourly_send_limit),
         updated_at = NOW()
       WHERE organization_id = $1
       RETURNING *`,
      [
        orgId,
        input.defaultSignature ?? null,
        input.physicalAddress ?? null,
        input.companyName ?? null,
        input.trackingEnabled ?? null,
        input.openTracking ?? null,
        input.clickTracking ?? null,
        input.unsubscribeLink ?? null,
        input.dailySendLimit ?? null,
        input.warmupEnabled ?? null,
        input.businessHoursStart ?? null,
        input.businessHoursEnd ?? null,
        input.defaultTimezone ?? null,
        input.rotationStrategy ?? null,
        input.hourlySendLimit ?? null,
      ]
    )
    return mapSettings(result.rows[0])
  } catch {
    const result = await pool.query<SettingsRow>(
      `UPDATE public.mail_org_settings SET
         default_signature = COALESCE($2, default_signature),
         physical_address = COALESCE($3, physical_address),
         company_name = COALESCE($4, company_name),
         tracking_enabled = COALESCE($5, tracking_enabled),
         open_tracking = COALESCE($6, open_tracking),
         click_tracking = COALESCE($7, click_tracking),
         unsubscribe_link = COALESCE($8, unsubscribe_link),
         daily_send_limit = COALESCE($9, daily_send_limit),
         warmup_enabled = COALESCE($10, warmup_enabled),
         updated_at = NOW()
       WHERE organization_id = $1
       RETURNING *`,
      [
        orgId,
        input.defaultSignature ?? null,
        input.physicalAddress ?? null,
        input.companyName ?? null,
        input.trackingEnabled ?? null,
        input.openTracking ?? null,
        input.clickTracking ?? null,
        input.unsubscribeLink ?? null,
        input.dailySendLimit ?? null,
        input.warmupEnabled ?? null,
      ]
    )
    return mapSettings(result.rows[0])
  }
}
