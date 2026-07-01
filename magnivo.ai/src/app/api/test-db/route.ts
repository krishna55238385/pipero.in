import { NextResponse } from 'next/server'
import pool from '@/lib/db'

export async function GET() {
  try {
    const result = await pool.query('SELECT COUNT(*) FROM organizations')
    return NextResponse.json({ success: true, count: result.rows[0].count })
  } catch (error) {
    return NextResponse.json({ success: false, error: String(error) })
  }
}
