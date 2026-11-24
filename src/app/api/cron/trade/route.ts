import { NextResponse } from 'next/server'
import { getState, setState, createInitialState, acquireCycleLock, releaseCycleLock } from '@/lib/state/redis'
import { getConfig } from '@/lib/config'
import { hasCronSecret, isAuthorized } from '@/lib/auth/cron-secret'
import { closeSpotLive } from '@/lib/execution/spot-executor'
import { binanceClient } from '@/lib/binance/client'
import { parseKline } from '@/lib/binance/types'
import { getExecutor } from '@/lib/execution/factory'
import { sendTelegram } from '@/lib/utils/telegram'
import { runTradingCycle } from '@/lib/engine/cycle'
import type { Candle } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Slightly above maxDuration so a cycle that dies mid-way can't hold the lock forever.
const LOCK_TTL_SECONDS = 70

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export async function POST(request: Request) {
  if (!hasCronSecret()) {
    return NextResponse.json({ status: 'error', errors: ['CRON_SECRET not configured'] }, { status: 500 })
  }
  if (!isAuthorized(request)) {
    return NextResponse.json({ status: 'unauthorized' }, { status: 401 })
  }

  let lockToken: string | null
  try {
    lockToken = await acquireCycleLock(LOCK_TTL_SECONDS)
  } catch (err) {
    return NextResponse.json({ status: 'error', errors: [`Lock unavailable: ${errMsg(err)}`] }, { status: 503 })
  }
  if (!lockToken) {
    return NextResponse.json({ status: 'skipped', reason: 'Another cycle is running' }, { status: 409 })
  }

  try {
    return await runCycle()
  } finally {
    await releaseCycleLock(lockToken).catch(err => console.error('Failed to release cycle lock:', err))
  }
}

async function runCycle() {
  const config = getConfig()
  let state = await getState()
  if (!state) {
    state = createInitialState()
    state.config = config
  }
  state.config = config

  const errors: string[] = []
  const now = Date.now()

  if (state.lastCronRun && now - state.lastCronRun < 30000) {
    return NextResponse.json({ status: 'skipped', reason: 'Rate limited', errors })
  }

  const isLive = !config.paper && binanceClient.hasCredentials()

  try {
    if (isLive) {
      try {
        const account = await binanceClient.getAccount()
        const usdt = account.balances.find((b) => b.asset === 'USDT')
        if (usdt) {
          const total = parseFloat(usdt.free) + parseFloat(usdt.locked)
          state.balance.total = total
          state.balance.available = parseFloat(usdt.free)
        }
      } catch (err) {
        errors.push(`Balance sync failed: ${errMsg(err)}`)
      }
    }

    // 201 = 200 closed candles for indicators + the still-forming one (live price / chart).
    const klines = await binanceClient.getKlines(config.symbol, config.timeframe, 201)
    const candles = klines.map(parseKline)

    let trendCandles: Candle[] | null = null
    try {
      // Same warmup as the backtest (2x slow EMA) so both compute the same trend values.
      const trendLimit = Math.min(config.trendEmaSlow * 2 + 50, 1000)
      const trendKlines = await binanceClient.getKlines(config.symbol, config.trendTimeframe, trendLimit)
      trendCandles = trendKlines.map(parseKline)
    } catch (err) {
      errors.push(`Trend calculation failed: ${errMsg(err)}`)
    }

    const out = await runTradingCycle(state, { now, config, candles, trendCandles }, {
      executor: getExecutor(config.mode),
      notify: sendTelegram,
      liveClose: isLive ? closeSpotLive : undefined,
      syncBalanceAfterClose: isLive ? () => binanceClient.getFreeBalance('USDT') : undefined,
    })

    state.errors = [...errors, ...out.errors]
    await setState(state)
    if (out.status === 'waiting_data') {
      return NextResponse.json({ status: 'waiting_data', errors: state.errors })
    }
    return NextResponse.json({ ...out.result, lastCronRun: state.lastCronRun, errors: state.errors })
  } catch (err) {
    errors.push(errMsg(err))
    state.errors = errors
    await setState(state)
    return NextResponse.json({ status: 'error', errors }, { status: 500 })
  }
}
