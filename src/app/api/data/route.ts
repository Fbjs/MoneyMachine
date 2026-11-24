import { NextResponse } from 'next/server'
import { getState, createInitialState } from '@/lib/state/redis'

export const dynamic = 'force-dynamic'

export async function GET() {
  let state = await getState()
  if (!state) {
    state = createInitialState()
  }
  // Derive profit factor (gross profit / gross loss) so states saved with the old formula display correctly.
  const perf = state.performance
  const grossLoss = perf.avgLoss * perf.losses
  perf.profitFactor = grossLoss > 0 ? (perf.avgWin * perf.wins) / grossLoss : 0
  return NextResponse.json(state)
}
