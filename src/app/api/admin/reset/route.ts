import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { hasCronSecret, isAuthorized } from '@/lib/auth/cron-secret'
import {
  acquireCycleLock, releaseCycleLock, backupState, getState, setState, createInitialState,
} from '@/lib/state/redis'

export const dynamic = 'force-dynamic'

/**
 * Reset trades, performance, risk and balance to a fresh state.
 * The previous state is backed up in Redis for 30 days first.
 * Refuses in live mode while a position is open (it would orphan it).
 */
export async function POST(request: Request) {
  if (!hasCronSecret()) {
    return NextResponse.json({ status: 'error', error: 'CRON_SECRET not configured' }, { status: 500 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ status: 'unauthorized' }, { status: 401 })
  }

  // Take the cycle lock so a cron run can't overwrite the reset with stale state.
  const lockToken = await acquireCycleLock(70)
  if (!lockToken) {
    return NextResponse.json({ status: 'busy', error: 'A trading cycle is running, retry in a few seconds' }, { status: 409 })
  }

  try {
    const config = getConfig()
    const current = await getState()
    if (!config.paper && current?.openPosition) {
      return NextResponse.json(
        { status: 'error', error: 'Live mode with an open position: close it before resetting' },
        { status: 409 },
      )
    }

    const backupKey = await backupState()
    const fresh = createInitialState()
    fresh.config = config
    // Keep the candle marker so the next cycle doesn't re-evaluate an already-seen candle.
    fresh.lastEvaluatedCandleTime = current?.lastEvaluatedCandleTime ?? null
    await setState(fresh)

    return NextResponse.json({
      status: 'ok',
      backupKey,
      previous: current
        ? { trades: current.performance.totalTrades, totalPnl: current.performance.totalPnl, balance: current.balance.total }
        : null,
      balance: fresh.balance.total,
    })
  } finally {
    await releaseCycleLock(lockToken).catch(err => console.error('Failed to release lock:', err))
  }
}
