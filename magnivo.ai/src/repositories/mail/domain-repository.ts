import pool from '@/lib/db'
import type {
  DeliverabilityDomain,
  DomainHealthLevel,
  DnsRecordStatus,
  DomainPurpose,
  DnsProvider,
} from '@/types/deliverability'

type DomainRow = {
  id: string
  organization_id: string
  domain: string
  health_score: number
  health_status: DomainHealthLevel
  spf_status: DnsRecordStatus
  dkim_status: DnsRecordStatus
  dmarc_status: DnsRecordStatus
  tracking_status: DnsRecordStatus
  return_path_status: DnsRecordStatus
  mx_status?: DnsRecordStatus
  bimi_status?: DnsRecordStatus | 'not_configured'
  dkim_selector: string
  dkim_cname_target: string | null
  spf_raw: string | null
  dmarc_raw: string | null
  dmarc_policy: string | null
  tracking_domain: string | null
  tracking_cname_target: string | null
  return_path_domain: string | null
  return_path_cname_target: string | null
  purpose?: DomainPurpose
  tags?: string[]
  notes?: string
  dns_provider?: string | null
  ownership_verified?: boolean
  ownership_verified_at?: string | null
  bimi_selector?: string
  bimi_svg_url?: string | null
  bimi_vmc_url?: string | null
  last_checked_at: string | null
  next_check_at: string | null
  check_interval_hours: number
  metadata: Record<string, unknown>
  created_at: string
  updated_at: string
}

function mapDomainRow(row: DomainRow): DeliverabilityDomain {
  return {
    id: row.id,
    organizationId: row.organization_id,
    domain: row.domain,
    healthScore: row.health_score,
    healthStatus: row.health_status,
    spfStatus: row.spf_status,
    dkimStatus: row.dkim_status,
    dmarcStatus: row.dmarc_status,
    trackingStatus: row.tracking_status,
    returnPathStatus: row.return_path_status,
    mxStatus: row.mx_status ?? 'unverified',
    bimiStatus: row.bimi_status ?? 'not_configured',
    dkimSelector: row.dkim_selector,
    dkimCnameTarget: row.dkim_cname_target,
    spfRaw: row.spf_raw,
    dmarcRaw: row.dmarc_raw,
    dmarcPolicy: row.dmarc_policy,
    trackingDomain: row.tracking_domain,
    trackingCnameTarget: row.tracking_cname_target,
    returnPathDomain: row.return_path_domain,
    returnPathCnameTarget: row.return_path_cname_target,
    purpose: row.purpose ?? 'sending',
    tags: Array.isArray(row.tags) ? row.tags : [],
    notes: row.notes ?? '',
    dnsProvider: (row.dns_provider as DnsProvider | null) ?? null,
    ownershipVerified: Boolean(row.ownership_verified),
    ownershipVerifiedAt: row.ownership_verified_at ?? null,
    bimiSelector: row.bimi_selector ?? 'default',
    bimiSvgUrl: row.bimi_svg_url ?? null,
    bimiVmcUrl: row.bimi_vmc_url ?? null,
    lastCheckedAt: row.last_checked_at,
    nextCheckAt: row.next_check_at,
    checkIntervalHours: row.check_interval_hours,
    metadata: row.metadata || {},
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findDomainsByOrg(orgId: string): Promise<DeliverabilityDomain[]> {
  const result = await pool.query<DomainRow>(
    `SELECT * FROM public.mail_deliverability_domains
     WHERE organization_id = $1
     ORDER BY domain ASC`,
    [orgId]
  )
  return result.rows.map(mapDomainRow)
}

export async function findDomainById(id: string, orgId: string): Promise<DeliverabilityDomain | null> {
  const result = await pool.query<DomainRow>(
    `SELECT * FROM public.mail_deliverability_domains
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return result.rows[0] ? mapDomainRow(result.rows[0]) : null
}

export async function findDomainByName(domain: string, orgId: string): Promise<DeliverabilityDomain | null> {
  const result = await pool.query<DomainRow>(
    `SELECT * FROM public.mail_deliverability_domains
     WHERE LOWER(domain) = LOWER($1) AND organization_id = $2`,
    [domain, orgId]
  )
  return result.rows[0] ? mapDomainRow(result.rows[0]) : null
}

export async function insertDomain(data: {
  organizationId: string
  domain: string
  dkimSelector?: string
  checkIntervalHours?: number
  purpose?: DomainPurpose
  tags?: string[]
  notes?: string
  dnsProvider?: DnsProvider
}): Promise<DeliverabilityDomain> {
  const result = await pool.query<DomainRow>(
    `INSERT INTO public.mail_deliverability_domains
      (organization_id, domain, dkim_selector, check_interval_hours, purpose, tags, notes, dns_provider)
     VALUES ($1, $2, $3, $4, COALESCE($5, 'sending'), COALESCE($6, '{}'), COALESCE($7, ''), $8)
     RETURNING *`,
    [
      data.organizationId,
      data.domain,
      data.dkimSelector ?? 'default',
      data.checkIntervalHours ?? 24,
      data.purpose ?? 'sending',
      data.tags ?? [],
      data.notes ?? '',
      data.dnsProvider ?? null,
    ]
  )
  return mapDomainRow(result.rows[0])
}

export async function updateDomain(
  id: string,
  orgId: string,
  data: {
    healthScore?: number
    healthStatus?: DomainHealthLevel
    spfStatus?: DnsRecordStatus
    dkimStatus?: DnsRecordStatus
    dmarcStatus?: DnsRecordStatus
    trackingStatus?: DnsRecordStatus
    returnPathStatus?: DnsRecordStatus
    mxStatus?: DnsRecordStatus
    bimiStatus?: DnsRecordStatus | 'not_configured'
    dkimSelector?: string
    dkimCnameTarget?: string | null
    spfRaw?: string | null
    dmarcRaw?: string | null
    dmarcPolicy?: string | null
    trackingDomain?: string | null
    trackingCnameTarget?: string | null
    returnPathDomain?: string | null
    returnPathCnameTarget?: string | null
    lastCheckedAt?: string
    nextCheckAt?: string
    checkIntervalHours?: number
    purpose?: DomainPurpose
    tags?: string[]
    notes?: string
    dnsProvider?: DnsProvider | null
    ownershipVerified?: boolean
    ownershipVerifiedAt?: string | null
    bimiSelector?: string
    bimiSvgUrl?: string | null
    bimiVmcUrl?: string | null
  }
): Promise<DeliverabilityDomain | null> {
  const setClauses: string[] = []
  const values: (string | number | boolean | null | string[])[] = []
  let paramIndex = 1

  const keyMap: Record<string, string> = {
    healthScore: 'health_score',
    healthStatus: 'health_status',
    spfStatus: 'spf_status',
    dkimStatus: 'dkim_status',
    dmarcStatus: 'dmarc_status',
    trackingStatus: 'tracking_status',
    returnPathStatus: 'return_path_status',
    mxStatus: 'mx_status',
    bimiStatus: 'bimi_status',
    dkimSelector: 'dkim_selector',
    dkimCnameTarget: 'dkim_cname_target',
    spfRaw: 'spf_raw',
    dmarcRaw: 'dmarc_raw',
    dmarcPolicy: 'dmarc_policy',
    trackingDomain: 'tracking_domain',
    trackingCnameTarget: 'tracking_cname_target',
    returnPathDomain: 'return_path_domain',
    returnPathCnameTarget: 'return_path_cname_target',
    lastCheckedAt: 'last_checked_at',
    nextCheckAt: 'next_check_at',
    checkIntervalHours: 'check_interval_hours',
    purpose: 'purpose',
    tags: 'tags',
    notes: 'notes',
    dnsProvider: 'dns_provider',
    ownershipVerified: 'ownership_verified',
    ownershipVerifiedAt: 'ownership_verified_at',
    bimiSelector: 'bimi_selector',
    bimiSvgUrl: 'bimi_svg_url',
    bimiVmcUrl: 'bimi_vmc_url',
  }

  for (const [key, value] of Object.entries(data)) {
    if (value !== undefined && keyMap[key]) {
      setClauses.push(`${keyMap[key]} = $${paramIndex}`)
      values.push(value as string | number | boolean | null | string[])
      paramIndex++
    }
  }

  if (setClauses.length === 0) return null

  setClauses.push(`updated_at = NOW()`)
  values.push(id, orgId)

  const result = await pool.query<DomainRow>(
    `UPDATE public.mail_deliverability_domains
     SET ${setClauses.join(', ')}
     WHERE id = $${paramIndex} AND organization_id = $${paramIndex + 1}
     RETURNING *`,
    values
  )
  return result.rows[0] ? mapDomainRow(result.rows[0]) : null
}

export async function deleteDomain(id: string, orgId: string): Promise<boolean> {
  const result = await pool.query(
    `DELETE FROM public.mail_deliverability_domains
     WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  )
  return (result.rowCount ?? 0) > 0
}

export async function findDomainsDueForCheck(): Promise<DeliverabilityDomain[]> {
  const result = await pool.query<DomainRow>(
    `SELECT * FROM public.mail_deliverability_domains
     WHERE next_check_at IS NOT NULL AND next_check_at <= NOW()
     ORDER BY next_check_at ASC
     LIMIT 50`
  )
  return result.rows.map(mapDomainRow)
}

export async function countDomainsByOrg(orgId: string): Promise<{
  total: number
  healthy: number
  needsAttention: number
  failed: number
  avgHealth: number
}> {
  const result = await pool.query<{
    total: string
    healthy: string
    needs_attention: string
    failed: string
    avg_health: string
  }>(
    `SELECT
       COUNT(*)::text AS total,
       COUNT(*) FILTER (WHERE health_status IN ('excellent', 'good'))::text AS healthy,
       COUNT(*) FILTER (WHERE health_status IN ('fair', 'poor'))::text AS needs_attention,
       COUNT(*) FILTER (WHERE health_status = 'unknown' OR spf_status = 'missing')::text AS failed,
       COALESCE(AVG(health_score), 0)::text AS avg_health
     FROM public.mail_deliverability_domains
     WHERE organization_id = $1`,
    [orgId]
  )
  const row = result.rows[0]
  return {
    total: Number(row?.total ?? 0),
    healthy: Number(row?.healthy ?? 0),
    needsAttention: Number(row?.needs_attention ?? 0),
    failed: Number(row?.failed ?? 0),
    avgHealth: Number(row?.avg_health ?? 0),
  }
}
