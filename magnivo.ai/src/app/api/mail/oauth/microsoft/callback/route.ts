import { NextRequest } from 'next/server'
import { handleMailOAuthCallback } from '../../_shared'

export async function GET(req: NextRequest) {
  return handleMailOAuthCallback(req, 'outlook')
}
