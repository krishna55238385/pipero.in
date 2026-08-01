'use server'

import pool from '@/lib/db'
import { getSessionUser, requireAdmin as requireAdminSession } from '@/lib/auth'

// Lets a client organization supply their own SerpAPI key and pick their own
// LLM (via OpenRouter) instead of always riding the platform's shared keys —
// isolates one org's quota exhaustion from every other org's pipeline runs.
// The raw key is encrypted at rest (pgcrypto pgp_sym_encrypt, keyed off the
// server-only API_KEY_ENCRYPTION_SECRET env var) and is NEVER read back to
// the browser once saved — only a masked "is a key set" boolean.

export type ApiKeyProvider = 'serpapi' | 'openrouter'

async function getDefaultOrgId(): Promise<string | null> {
  const session = await getSessionUser()
  return session?.orgId ?? null
}

async function requireAdmin() {
  const { isAdmin, user, error } = await requireAdminSession()
  if (!user) return { isAdmin, user: null, error }
  return { isAdmin, user: { id: user.userId, email: user.email, role: user.role }, error }
}

function encryptionSecret(): string {
  const secret = process.env.API_KEY_ENCRYPTION_SECRET
  if (!secret) throw new Error('API_KEY_ENCRYPTION_SECRET is not configured on the server')
  return secret
}

export type OrgApiKeyStatus = {
  serpapi: { isSet: boolean; updatedAt: string | null }
  openrouter: { isSet: boolean; model: string | null; updatedAt: string | null }
}

// ─── getOrgApiKeyStatus ─────────────────────────────────────────────────────
// Read-only status for the settings page — never returns the actual key.

export async function getOrgApiKeyStatus(): Promise<OrgApiKeyStatus> {
  const empty: OrgApiKeyStatus = {
    serpapi: { isSet: false, updatedAt: null },
    openrouter: { isSet: false, model: null, updatedAt: null },
  }
  const orgId = await getDefaultOrgId()
  if (!orgId) return empty
  try {
    const r = await pool.query(
      `SELECT provider, model, updated_at FROM public.organization_api_keys WHERE organization_id = $1`,
      [orgId]
    )
    for (const row of r.rows) {
      if (row.provider === 'serpapi') {
        empty.serpapi = { isSet: true, updatedAt: row.updated_at }
      } else if (row.provider === 'openrouter') {
        empty.openrouter = { isSet: true, model: row.model || null, updatedAt: row.updated_at }
      }
    }
    return empty
  } catch (err: any) {
    console.error('getOrgApiKeyStatus error:', err.message)
    return empty
  }
}

// ─── saveOrgApiKey ──────────────────────────────────────────────────────────
// Admin-only. Encrypts server-side via a parameterized pgp_sym_encrypt call —
// the raw key never gets string-interpolated into SQL, and is encrypted by
// Postgres itself before it's written to disk.

export async function saveOrgApiKey(
  provider: ApiKeyProvider,
  apiKey: string,
  model?: string
): Promise<{ ok: boolean; error?: string }> {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { ok: false, error: 'No organization found' }
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { ok: false, error: authError || 'Unauthorized' }
  if (!apiKey || !apiKey.trim()) return { ok: false, error: 'API key is required' }
  if (provider !== 'serpapi' && provider !== 'openrouter') {
    return { ok: false, error: 'Unknown provider' }
  }
  try {
    await pool.query(
      `INSERT INTO public.organization_api_keys (organization_id, provider, encrypted_key, model, updated_at)
       VALUES ($1, $2, pgp_sym_encrypt($3, $4), $5, NOW())
       ON CONFLICT (organization_id, provider)
       DO UPDATE SET encrypted_key = pgp_sym_encrypt($3, $4), model = $5, updated_at = NOW()`,
      [orgId, provider, apiKey.trim(), encryptionSecret(), model?.trim() || null]
    )
    return { ok: true }
  } catch (err: any) {
    console.error('saveOrgApiKey error:', err.message)
    return { ok: false, error: err.message }
  }
}

// ─── deleteOrgApiKey ────────────────────────────────────────────────────────

export async function deleteOrgApiKey(provider: ApiKeyProvider): Promise<{ ok: boolean; error?: string }> {
  const orgId = await getDefaultOrgId()
  if (!orgId) return { ok: false, error: 'No organization found' }
  const { isAdmin, error: authError } = await requireAdmin()
  if (!isAdmin) return { ok: false, error: authError || 'Unauthorized' }
  try {
    await pool.query(
      `DELETE FROM public.organization_api_keys WHERE organization_id = $1 AND provider = $2`,
      [orgId, provider]
    )
    return { ok: true }
  } catch (err: any) {
    console.error('deleteOrgApiKey error:', err.message)
    return { ok: false, error: err.message }
  }
}
