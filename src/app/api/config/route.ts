import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'

export const dynamic = 'force-dynamic'

export async function GET() {
  return NextResponse.json(getConfig())
}

export async function PUT(request: Request) {
  try {
    const body = await request.json()
    return NextResponse.json({ success: true, config: { ...getConfig(), ...body } })
  } catch (err: any) {
    return NextResponse.json({ success: false, error: err.message }, { status: 400 })
  }
}
