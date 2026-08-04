import dns from 'dns/promises'
import type { SpfLookupResult, DkimLookupResult, DmarcLookupResult, TrackingLookupResult } from '@/types/deliverability'

const DNS_TIMEOUT_MS = 5000

async function resolveTxtWithTimeout(hostname: string, timeoutMs = DNS_TIMEOUT_MS): Promise<string[]> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs)
  )
  const lookup = dns.resolveTxt(hostname)
  const results = await Promise.race([lookup, timeout])
  return results.flat()
}

async function resolveCnameWithTimeout(hostname: string, timeoutMs = DNS_TIMEOUT_MS): Promise<string | null> {
  const timeout = new Promise<never>((_, reject) =>
    setTimeout(() => reject(new Error('DNS_TIMEOUT')), timeoutMs)
  )
  const lookup = dns.resolveCname(hostname)
  const results = await Promise.race([lookup, timeout])
  return results[0] ?? null
}

export async function lookupSpf(domain: string): Promise<SpfLookupResult> {
  try {
    const records = await resolveTxtWithTimeout(domain)
    const spfRecord = records.find((r) => r.toLowerCase().startsWith('v=spf1'))

    if (!spfRecord) {
      return { found: false, raw: null, includes: [], valid: false, errors: ['SPF record not found'], warnings: [] }
    }

    const includes: string[] = []
    const includeMatches = spfRecord.match(/include:([^\s]+)/gi)
    if (includeMatches) {
      for (const match of includeMatches) {
        includes.push(match.replace('include:', '').trim())
      }
    }

    const errors: string[] = []
    const warnings: string[] = []

    if (!spfRecord.includes('include:') && !spfRecord.includes('ip4:') && !spfRecord.includes('ip6:')) {
      warnings.push('SPF record has no include or IP mechanisms')
    }

    if (spfRecord.includes('-all')) {
      errors.push('SPF record uses hard fail (-all) which may cause delivery issues')
    }

    const valid = spfRecord.startsWith('v=spf1') && errors.length === 0

    return { found: true, raw: spfRecord, includes, valid, errors, warnings }
  } catch {
    return { found: false, raw: null, includes: [], valid: false, errors: ['DNS lookup failed'], warnings: [] }
  }
}

export async function lookupDkim(domain: string, selector: string): Promise<DkimLookupResult> {
  try {
    const hostname = `${selector}._domainkey.${domain}`
    const records = await resolveTxtWithTimeout(hostname)
    const dkimRecord = records.find((r) => r.toLowerCase().includes('v=dkim1'))

    if (!dkimRecord) {
      return { found: false, record: null, selector, keyLength: null, valid: false, errors: ['DKIM record not found'] }
    }

    const errors: string[] = []
    let keyLength: number | null = null

    const kMatch = dkimRecord.match(/k=(\w+)/i)
    const kType = kMatch ? kMatch[1].toLowerCase() : 'rsa'

    const lMatch = dkimRecord.match(/h=sha(256|1024)/i)
    if (!lMatch) {
      const kbitsMatch = dkimRecord.match(/p=([A-Za-z0-9+/=]+)/)
      if (kbitsMatch && kbitsMatch[1].length > 100) {
        keyLength = 2048
      } else {
        keyLength = 1024
      }
    } else {
      keyLength = parseInt(lMatch[1], 10) || 256
    }

    if (kType !== 'rsa' && kType !== 'ed25519') {
      errors.push(`Uncommon DKIM key type: ${kType}`)
    }

    const pMatch = dkimRecord.match(/p=([A-Za-z0-9+/=]*)/)
    if (pMatch && !pMatch[1]) {
      errors.push('DKIM record has empty public key (p=)')
    }

    const valid = dkimRecord.includes('v=dkim1') && errors.length === 0

    return { found: true, record: dkimRecord, selector, keyLength, valid, errors }
  } catch {
    return { found: false, record: null, selector, keyLength: null, valid: false, errors: ['DNS lookup failed'] }
  }
}

export async function lookupDmarc(domain: string): Promise<DmarcLookupResult> {
  try {
    const hostname = `_dmarc.${domain}`
    const records = await resolveTxtWithTimeout(hostname)
    const dmarcRecord = records.find((r) => r.toLowerCase().startsWith('v=dmarc1'))

    if (!dmarcRecord) {
      return { found: false, raw: null, policy: null, alignment: null, rua: null, ruf: null, valid: false, errors: ['DMARC record not found'] }
    }

    const errors: string[] = []
    const policyMatch = dmarcRecord.match(/;\s*p=(\w+)/i)
    const policy = policyMatch ? policyMatch[1].toLowerCase() : null
    const ruaMatch = dmarcRecord.match(/rua=([^\s;]+)/i)
    const rufMatch = dmarcRecord.match(/ruf=([^\s;]+)/i)
    const spMatch = dmarcRecord.match(/sp=(\w+)/i)
    const alignmentMatch = dmarcRecord.match(/adkim=(\w+)/i)
    const alignment = alignmentMatch ? alignmentMatch[1] : (spMatch ? spMatch[1] : 'r')

    if (!policy || !['none', 'quarantine', 'reject'].includes(policy)) {
      errors.push('DMARC record missing or invalid policy')
    }

    if (policy === 'none') {
      errors.push('DMARC policy is "none" (monitoring only) — consider upgrading to quarantine or reject')
    }

    if (!ruaMatch) {
      errors.push('DMARC record missing aggregate reporting (rua)')
    }

    const valid = dmarcRecord.startsWith('v=dmarc1') && policy !== null && errors.length === 0

    return {
      found: true,
      raw: dmarcRecord,
      policy,
      alignment,
      rua: ruaMatch ? ruaMatch[1] : null,
      ruf: rufMatch ? rufMatch[1] : null,
      valid,
      errors,
    }
  } catch {
    return { found: false, raw: null, policy: null, alignment: null, rua: null, ruf: null, valid: false, errors: ['DNS lookup failed'] }
  }
}

export async function lookupTrackingDomain(domain: string): Promise<TrackingLookupResult> {
  try {
    const hostname = `track.${domain}`
    const cname = await resolveCnameWithTimeout(hostname)

    if (!cname) {
      return { found: false, cnameTarget: null, valid: false, errors: ['Tracking CNAME not found'] }
    }

    return { found: true, cnameTarget: cname, valid: true, errors: [] }
  } catch {
    return { found: false, cnameTarget: null, valid: false, errors: ['DNS lookup failed'] }
  }
}

export async function lookupReturnPath(domain: string): Promise<TrackingLookupResult> {
  try {
    const hostname = `bounce.${domain}`
    const cname = await resolveCnameWithTimeout(hostname)

    if (!cname) {
      return { found: false, cnameTarget: null, valid: false, errors: ['Return path CNAME not found'] }
    }

    return { found: true, cnameTarget: cname, valid: true, errors: [] }
  } catch {
    return { found: false, cnameTarget: null, valid: false, errors: ['DNS lookup failed'] }
  }
}

export async function lookupMx(domain: string): Promise<{
  found: boolean
  hosts: string[]
  valid: boolean
  errors: string[]
}> {
  try {
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('DNS_TIMEOUT')), DNS_TIMEOUT_MS)
    )
    const records = await Promise.race([dns.resolveMx(domain), timeout])
    const hosts = records
      .sort((a, b) => a.priority - b.priority)
      .map((r) => r.exchange)
    if (hosts.length === 0) {
      return { found: false, hosts: [], valid: false, errors: ['No MX records found'] }
    }
    return { found: true, hosts, valid: true, errors: [] }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'MX lookup failed'
    return { found: false, hosts: [], valid: false, errors: [msg] }
  }
}

export async function lookupBimi(
  domain: string,
  selector = 'default'
): Promise<{
  found: boolean
  raw: string | null
  valid: boolean
  errors: string[]
}> {
  try {
    const hostname = `${selector}._bimi.${domain}`
    const records = await resolveTxtWithTimeout(hostname)
    const bimi = records.find((r) => r.toLowerCase().includes('v=bimi1'))
    if (!bimi) {
      return { found: false, raw: null, valid: false, errors: ['BIMI record not found'] }
    }
    const hasLogo = /l=https?:\/\//i.test(bimi)
    return {
      found: true,
      raw: bimi,
      valid: hasLogo,
      errors: hasLogo ? [] : ['BIMI record missing logo URL (l=)'],
    }
  } catch (err) {
    const msg = err instanceof Error ? err.message : 'BIMI lookup failed'
    return { found: false, raw: null, valid: false, errors: [msg] }
  }
}

export async function lookupAllRecords(domain: string, dkimSelector: string) {
  const [spf, dkim, dmarc, tracking, returnPath, mx, bimi] = await Promise.all([
    lookupSpf(domain),
    lookupDkim(domain, dkimSelector),
    lookupDmarc(domain),
    lookupTrackingDomain(domain),
    lookupReturnPath(domain),
    lookupMx(domain),
    lookupBimi(domain),
  ])

  return { spf, dkim, dmarc, tracking, returnPath, mx, bimi }
}
