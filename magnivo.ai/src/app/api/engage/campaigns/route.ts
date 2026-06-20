import { NextResponse } from 'next/server'
import { getEngageCampaigns } from '@/app/actions/engage'

export async function GET() {
  try {
    const campaigns = await getEngageCampaigns()
    return NextResponse.json({ campaigns })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'failed'
    return NextResponse.json({ campaigns: [], error: message }, { status: 500 })
  }
}

