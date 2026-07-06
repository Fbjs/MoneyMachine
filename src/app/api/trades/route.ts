import { NextResponse } from 'next/server'
import { getState, createInitialState } from '@/lib/state/redis'

export const dynamic = 'force-dynamic'

export async function GET() {
  let state = await getState()
  if (!state) {
    state = createInitialState()
  }
  return NextResponse.json(state.trades.slice(-50))
}
