import { NextRequest, NextResponse } from 'next/server'
import { executeAutomationFlows } from '@/app/actions/automation'

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as {
      triggerType?: string
      entityType?: 'lead' | 'deal'
      entityId?: string
      data?: Record<string, unknown>
    }
    if (!body.triggerType || !body.entityType || !body.entityId) {
      return NextResponse.json({ error: 'triggerType, entityType and entityId are required' }, { status: 400 })
    }
    const res = await executeAutomationFlows(body.triggerType, body.entityType, body.entityId, body.data || {})
    return NextResponse.json({ result: res })
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'execution_failed'
    return NextResponse.json({ error: message }, { status: 500 })
  }
}

