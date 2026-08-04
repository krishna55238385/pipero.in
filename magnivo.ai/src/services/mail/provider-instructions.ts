import type { DnsProvider, ProviderDnsInstruction } from '@/types/deliverability'

type ProviderConfig = {
  id: DnsProvider
  name: string
  baseUrl: string
  supportUrl: string
}

const PROVIDERS: ProviderConfig[] = [
  { id: 'cloudflare', name: 'Cloudflare', baseUrl: 'https://dash.cloudflare.com', supportUrl: 'https://developers.cloudflare.com/dns/' },
  { id: 'route53', name: 'AWS Route 53', baseUrl: 'https://console.aws.amazon.com/route53', supportUrl: 'https://docs.aws.amazon.com/Route53/latest/DeveloperGuide/' },
  { id: 'godaddy', name: 'GoDaddy', baseUrl: 'https://dcc.godaddy.com', supportUrl: 'https://www.godaddy.com/help/' },
  { id: 'namecheap', name: 'Namecheap', baseUrl: 'https://ap.www.namecheap.com', supportUrl: 'https://www.namecheap.com/support/' },
  { id: 'squarespace', name: 'Squarespace', baseUrl: 'https://domains.squarespace.com', supportUrl: 'https://support.squarespace.com/' },
  { id: 'zoho', name: 'Zoho', baseUrl: 'https://www.zoho.com/mail/', supportUrl: 'https://www.zoho.com/mail/help/' },
  { id: 'google', name: 'Google Domains', baseUrl: 'https://domains.google', supportUrl: 'https://support.google.com/domains/' },
  { id: 'other', name: 'Other Provider', baseUrl: '', supportUrl: '' },
]

function spfInstructions(domain: string, provider: DnsProvider): ProviderDnsInstruction[] {
  return [
    {
      provider,
      providerName: PROVIDERS.find(p => p.id === provider)?.name ?? provider,
      recordType: 'TXT',
      host: domain,
      value: 'v=spf1 include:_spf.google.com ~all',
      ttl: 3600,
      notes: 'Update the value based on your email provider. For Google Workspace use include:_spf.google.com. For Microsoft 365 include:spf.protection.outlook.com',
      steps: getProviderSteps(provider, 'SPF'),
    },
  ]
}

function dkimInstructions(domain: string, selector: string, provider: DnsProvider): ProviderDnsInstruction[] {
  return [
    {
      provider,
      providerName: PROVIDERS.find(p => p.id === provider)?.name ?? provider,
      recordType: 'TXT',
      host: `${selector}._domainkey.${domain}`,
      value: 'v=DKIM1; k=rsa; p=YOUR_DKIM_PUBLIC_KEY_HERE',
      ttl: 3600,
      notes: 'The DKIM public key is provided by your email provider (Google, Microsoft, etc.). Copy the full value from your provider\'s DKIM setup page.',
      steps: getProviderSteps(provider, 'DKIM'),
    },
  ]
}

function dmarcInstructions(domain: string, provider: DnsProvider): ProviderDnsInstruction[] {
  return [
    {
      provider,
      providerName: PROVIDERS.find(p => p.id === provider)?.name ?? provider,
      recordType: 'TXT',
      host: `_dmarc.${domain}`,
      value: `v=DMARC1; p=none; rua=mailto:dmarc-reports@${domain}; pct=100`,
      ttl: 3600,
      notes: 'Start with p=none to monitor, then upgrade to p=quarantine or p=reject. Add your email for aggregate reports in rua=.',
      steps: getProviderSteps(provider, 'DMARC'),
    },
  ]
}

function trackingInstructions(domain: string, provider: DnsProvider): ProviderDnsInstruction[] {
  return [
    {
      provider,
      providerName: PROVIDERS.find(p => p.id === provider)?.name ?? provider,
      recordType: 'CNAME',
      host: `track.${domain}`,
      value: 'track.magnivo.ai',
      ttl: 3600,
      notes: 'This CNAME enables open and click tracking for your emails. Records are created automatically when tracking is enabled.',
      steps: getProviderSteps(provider, 'Tracking'),
    },
  ]
}

function returnPathInstructions(domain: string, provider: DnsProvider): ProviderDnsInstruction[] {
  return [
    {
      provider,
      providerName: PROVIDERS.find(p => p.id === provider)?.name ?? provider,
      recordType: 'CNAME',
      host: `bounce.${domain}`,
      value: 'bounce.magnivo.ai',
      ttl: 3600,
      notes: 'This CNAME ensures bounced emails are routed correctly back to us for processing.',
      steps: getProviderSteps(provider, 'Return Path'),
    },
  ]
}

function getProviderSteps(provider: DnsProvider, recordType: string): string[] {
  const steps: Record<DnsProvider, string[]> = {
    cloudflare: [
      `Log in to Cloudflare Dashboard and select your domain.`,
      `Go to DNS > Records.`,
      `Click "Add record".`,
      `Select type "${recordType}".`,
      `Enter the host and value as specified above.`,
      `Set Proxy status to "DNS only" (gray cloud).`,
      `Save the record.`,
    ],
    route53: [
      `Log in to AWS Console and go to Route 53.`,
      `Select your hosted zone.`,
      `Click "Create record".`,
      `Enter the record name and type "${recordType}".`,
      `Paste the value in the "Value" field.`,
      `Set TTL to 3600 seconds.`,
      `Click "Create records".`,
    ],
    godaddy: [
      `Log in to GoDaddy and go to your Domain Settings.`,
      `Click "Manage" next to DNS for your domain.`,
      `Click "Add" to create a new record.`,
      `Select type "${recordType}".`,
      `Enter the host and value as specified.`,
      `Set TTL to 1 Hour.`,
      `Click "Add" to save.`,
    ],
    namecheap: [
      `Log in to Namecheap and go to Domain List.`,
      `Click "Manage" next to your domain.`,
      `Go to the "Advanced DNS" tab.`,
      `Click "Add new record".`,
      `Select type "${recordType}".`,
      `Enter the host and value.`,
      `Save the changes.`,
    ],
    squarespace: [
      `Log in to Squarespace and go to Settings.`,
      `Click "Domains" and select your domain.`,
      `Go to "DNS Settings".`,
      `Click "Add Record".`,
      `Select type "${recordType}".`,
      `Enter the host and value.`,
      `Save the record.`,
    ],
    zoho: [
      `Log in to Zoho Mail and go to Control Panel.`,
      `Navigate to Domains > DNS Configuration.`,
      `Click "Add Record".`,
      `Select type "${recordType}".`,
      `Enter the host name and value.`,
      `Save the DNS record.`,
    ],
    google: [
      `Log in to Google Domains.`,
      `Select your domain.`,
      `Go to DNS settings.`,
      `Under "Custom records", click "Create new record".`,
      `Select type "${recordType}".`,
      `Enter the host and value.`,
      `Save the record.`,
    ],
    other: [
      `Log in to your DNS provider's dashboard.`,
      `Find the DNS management section for your domain.`,
      `Add a new record with type "${recordType}".`,
      `Enter the host and value as specified.`,
      `Save the record and wait for propagation (may take up to 48 hours).`,
    ],
  }

  return steps[provider] ?? steps.other
}

export function getProviderDnsInstructions(
  domain: string,
  recordType: 'spf' | 'dkim' | 'dmarc' | 'tracking' | 'return_path',
  provider: DnsProvider,
  dkimSelector: string = 'default'
): ProviderDnsInstruction[] {
  switch (recordType) {
    case 'spf': return spfInstructions(domain, provider)
    case 'dkim': return dkimInstructions(domain, dkimSelector, provider)
    case 'dmarc': return dmarcInstructions(domain, provider)
    case 'tracking': return trackingInstructions(domain, provider)
    case 'return_path': return returnPathInstructions(domain, provider)
  }
}

export function getAllProviders(): { id: DnsProvider; name: string }[] {
  return PROVIDERS.map(p => ({ id: p.id, name: p.name }))
}

export function getProviderConfig(provider: DnsProvider): ProviderConfig | undefined {
  return PROVIDERS.find(p => p.id === provider)
}

export function detectDnsProvider(domain: string): DnsProvider {
  const lowerDomain = domain.toLowerCase()
  if (lowerDomain.includes('cloudflare')) return 'cloudflare'
  if (lowerDomain.includes('aws')) return 'route53'
  return 'other'
}
