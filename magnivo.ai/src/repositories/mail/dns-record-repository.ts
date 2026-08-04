import pool from '@/lib/db'
import type { DnsRecord, DnsRecordType } from '@/types/deliverability'

type DnsRecordRow = {
  id: string
  domain_id: string
  record_type: DnsRecordType
  record_name: string
  record_value: string
  ttl: number | null
  is_active: boolean
  verified_at: string | null
  created_at: string
  updated_at: string
}

function mapDnsRecordRow(row: DnsRecordRow): DnsRecord {
  return {
    id: row.id,
    domainId: row.domain_id,
    recordType: row.record_type,
    recordName: row.record_name,
    recordValue: row.record_value,
    ttl: row.ttl,
    isActive: row.is_active,
    verifiedAt: row.verified_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}

export async function findDnsRecordsByDomain(domainId: string): Promise<DnsRecord[]> {
  const result = await pool.query<DnsRecordRow>(
    `SELECT * FROM public.mail_dns_records
     WHERE domain_id = $1
     ORDER BY record_type, record_name`,
    [domainId]
  )
  return result.rows.map(mapDnsRecordRow)
}

export async function findDnsRecordsByDomainAndType(
  domainId: string,
  recordType: DnsRecordType
): Promise<DnsRecord[]> {
  const result = await pool.query<DnsRecordRow>(
    `SELECT * FROM public.mail_dns_records
     WHERE domain_id = $1 AND record_type = $2
     ORDER BY record_name`,
    [domainId, recordType]
  )
  return result.rows.map(mapDnsRecordRow)
}

export async function findDnsRecordById(id: string): Promise<DnsRecord | null> {
  const result = await pool.query<DnsRecordRow>(
    `SELECT * FROM public.mail_dns_records WHERE id = $1`,
    [id]
  )
  return result.rows[0] ? mapDnsRecordRow(result.rows[0]) : null
}

export async function upsertDnsRecord(data: {
  domainId: string
  recordType: DnsRecordType
  recordName: string
  recordValue: string
  ttl?: number | null
  isActive?: boolean
}): Promise<DnsRecord> {
  const result = await pool.query<DnsRecordRow>(
    `INSERT INTO public.mail_dns_records
      (domain_id, record_type, record_name, record_value, ttl, is_active, verified_at)
     VALUES ($1, $2, $3, $4, $5, $6, NOW())
     ON CONFLICT (domain_id, record_type, record_name)
     DO UPDATE SET
       record_value = EXCLUDED.record_value,
       ttl = EXCLUDED.ttl,
       is_active = EXCLUDED.is_active,
       verified_at = NOW(),
       updated_at = NOW()
     RETURNING *`,
    [data.domainId, data.recordType, data.recordName, data.recordValue, data.ttl ?? null, data.isActive ?? true]
  )
  return mapDnsRecordRow(result.rows[0])
}

export async function deactivateDnsRecords(domainId: string, recordType: DnsRecordType): Promise<void> {
  await pool.query(
    `UPDATE public.mail_dns_records
     SET is_active = FALSE, updated_at = NOW()
     WHERE domain_id = $1 AND record_type = $2 AND is_active = TRUE`,
    [domainId, recordType]
  )
}

export async function deleteDnsRecordsByDomain(domainId: string): Promise<void> {
  await pool.query(
    `DELETE FROM public.mail_dns_records WHERE domain_id = $1`,
    [domainId]
  )
}
