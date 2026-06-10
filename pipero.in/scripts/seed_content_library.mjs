import { createClient } from '@supabase/supabase-js'
import dotenv from 'dotenv'

dotenv.config({ path: '.env.local' })

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
const supabaseAnonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY

if (!supabaseUrl || !supabaseAnonKey) {
  console.error('Missing NEXT_PUBLIC_SUPABASE_URL or NEXT_PUBLIC_SUPABASE_ANON_KEY in .env.local')
  process.exit(1)
}

const supabase = createClient(supabaseUrl, supabaseAnonKey)

async function getOrgId() {
  const { data, error } = await supabase.from('organizations').select('id').limit(1).single()
  if (error) throw error
  return data.id
}

async function insertSeed(orgId) {
  const now = new Date().toISOString()
  const items = [
    {
      organization_id: orgId,
      title: 'Founder intro (short) — WhatsApp',
      description: 'First-touch WhatsApp script for founders. Warm, concise, curiosity CTA.',
      content_type: 'whatsapp_script',
      funnel_stage: 'awareness',
      persona: 'Founder',
      industry: 'SaaS',
      tags: ['outbound', 'first-touch', 'whatsapp'],
      content_body: { type: 'markdown', markdown: 'Hi {{name}} — quick one. Noticed {{company}} is growing.\n\nAre you open to a 2-minute idea to reduce follow-up time for your team?\n\n— {{sender_name}}' },
      performance_metrics: { usage_count: 12, opened: 7, replied: 3, converted: 1 },
      current_version: 1,
      embedding: null,
      updated_at: now,
    },
    {
      organization_id: orgId,
      title: 'Pricing objection reply — Email',
      description: 'Handles “too expensive” with value framing + proof + CTA.',
      content_type: 'email_template',
      funnel_stage: 'consideration',
      persona: 'CMO',
      industry: 'Fintech',
      tags: ['pricing', 'objection', 'email'],
      content_body: { type: 'markdown', markdown: 'Subject: Re: pricing\n\nHi {{name}},\n\nTotally fair. Usually the question is whether we can save more than we cost.\n\nFor teams like {{company}}, the biggest win is {{primary_value}}.\n\nIf helpful, I can share 2 short examples and a calculator.\n\nWant me to send it?\n\n— {{sender_name}}' },
      performance_metrics: { usage_count: 8, opened: 5, replied: 2, converted: 0 },
      current_version: 1,
      embedding: null,
      updated_at: now,
    },
    {
      organization_id: orgId,
      title: 'Call script — discovery (7 mins)',
      description: 'Structured discovery call: context → pain → impact → next step.',
      content_type: 'call_script',
      funnel_stage: 'consideration',
      persona: 'Founder',
      industry: 'Edtech',
      tags: ['call', 'discovery', 'script'],
      content_body: {
        type: 'json',
        sections: [
          { name: 'Opener', bullets: ['Thanks for the time', 'Agenda: learn current workflow, share 1-2 ideas, align next steps'] },
          { name: 'Current workflow', questions: ['How do you handle inbound leads today?', 'Where do leads get stuck?'] },
          { name: 'Impact', questions: ['What happens when follow-up is delayed?', 'What’s a win in 30 days?'] },
          { name: 'Next step', bullets: ['Propose small pilot', 'Confirm owner + date'] },
        ],
      },
      performance_metrics: { usage_count: 5, opened: 0, replied: 0, converted: 1 },
      current_version: 1,
      embedding: null,
      updated_at: now,
    },
  ]

  const { data, error } = await supabase.from('content_library').insert(items).select('id,title')
  if (error) throw error
  return data
}

async function run() {
  const orgId = await getOrgId()
  const inserted = await insertSeed(orgId)
  console.log('Seeded content_library:', inserted)
  console.log('Note: embeddings are NULL. Open and save an item (or add a backfill) to generate embeddings with Gemini.')
}

run().catch((e) => {
  console.error('Seed failed:', e)
  process.exit(1)
})

