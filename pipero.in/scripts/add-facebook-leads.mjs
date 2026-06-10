/**
 * One-off: POST Facebook Lead Ads export rows to CRM public API.
 * Usage: node scripts/add-facebook-leads.mjs
 */

const CRM_API = 'https://pipero-in.vercel.app/api/public/leads'

const leads = [
  {
    email: 'pickiei@yahoo.com',
    full_name: 'Indira Bhagwandin',
    phone_number: 'p:+16083525712',
    campaign_name: 'US-Form-12032026',
    adset_name: 'US-Females-Indian',
    platform: 'fb',
  },
  {
    email: 'suhagiyasonal12@gmail.com',
    full_name: 'Soni Suhagiya USA',
    phone_number: 'p:+919904216680',
    campaign_name: 'US-Form-12032026',
    adset_name: 'US-Females-Indian',
    platform: 'ig',
  },
  {
    email: 'jasminewilson@gmail.com',
    full_name: 'Jasmine Wilson',
    phone_number: 'p:+18035537820',
    campaign_name: 'US-Form-12032026',
    adset_name: 'US-Females-Indian',
    platform: 'fb',
  },
]

function normalizePhone(raw) {
  if (!raw) return ''
  return String(raw).replace(/^p:/i, '').replace(/\D/g, '').trim() || ''
}

async function main() {
  for (const row of leads) {
    const phone = normalizePhone(row.phone_number)
    const payload = {
      company: row.full_name,
      name: row.full_name,
      email: row.email?.trim() || undefined,
      phone: phone || undefined,
      source: 'Facebook Lead Ads',
      campaign: row.campaign_name,
      utm: { campaign: row.campaign_name, adset: row.adset_name, platform: row.platform },
    }
    try {
      const res = await fetch(CRM_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      const data = await res.json()
      if (data.success) {
        console.log(`Added: ${row.full_name} (${data.leadId})`)
      } else {
        console.error(`Failed ${row.full_name}:`, data.error)
      }
    } catch (e) {
      console.error(`Error ${row.full_name}:`, e.message)
    }
  }
}

main()
