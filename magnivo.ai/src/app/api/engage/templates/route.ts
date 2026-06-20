import { NextResponse } from 'next/server'
import { getEngageTemplates } from '@/app/actions/engage'

export async function GET() {
  try {
    const templates = await getEngageTemplates()
    return NextResponse.json({ templates })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'failed'
    return NextResponse.json({ templates: [], error: message }, { status: 500 })
  }
}

