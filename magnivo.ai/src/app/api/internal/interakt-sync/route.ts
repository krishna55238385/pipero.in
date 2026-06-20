import { NextRequest, NextResponse } from 'next/server'
import { syncInteraktData } from '@/app/actions/interakt'

export const maxDuration = 60

export async function GET(req: NextRequest) {
  const expectedToken = process.env.INTERAKT_INTERNAL_SYNC_TOKEN
  const token = req.nextUrl.searchParams.get('token')

  if (expectedToken && token !== expectedToken) {
    return NextResponse.json(
      { success: false, error: 'Unauthorized' },
      { status: 401 }
    )
  }

  const result = await syncInteraktData()
  return NextResponse.json(result)
}

