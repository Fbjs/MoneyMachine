import { NextResponse } from 'next/server'
import { getState, setState, createInitialState, acquireCycleLock, releaseCycleLock } from '@/lib/state/redis'
import { getConfig, getEnv } from '@/lib/config'
import { closeSpotLive } from '@/lib/execution/spot-executor'
import { binanceClient } from '@/lib/binance/client'
import { parseKline } from '@/lib/binance/types'
import { computeIndicators } from '@/lib/strategy/indicators'
import { generateSignal } from '@/lib/strategy/signal-engine'
import { computeTrend } from '@/lib/strategy/trend'
import { aiFilter } from '@/lib/ai/filter'
import { RiskManager } from '@/lib/risk/manager'
import { getExecutor } from '@/lib/execution/factory'
import { sendTelegram, formatTradeMessage } from '@/lib/utils/telegram'
import type { TrendDirection, Trade } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

// Slightly above maxDuration so a cycle that dies mid-way can't hold the lock forever.
const LOCK_TTL_SECONDS = 70

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

const LONG_SIDES = ['BUY', 'CALL', 'LONG']
const SHORT_SIDES = ['SELL', 'PUT', 'SHORT']

function isActiveHours(hoursSpec: string): boolean {
  if (!hoursSpec) return true
  const ranges = hoursSpec.split(',').map(s => s.trim()).filter(Boolean)
  if (ranges.length === 0) return true
  const hour = new Date().getUTCHours()
  for (const range of ranges) {
    const [startStr, endStr] = range.split('-').map(s => parseInt(s, 10))
    if (Number.isNaN(startStr) || Number.isNaN(endStr)) continue
    if (startStr <= endStr) {
      if (hour >= startStr && hour < endStr) return true
    } else {
      if (hour >= startStr || hour < endStr) return true
    }
  }
  return false
}

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

function isAuthorized(request: Request): boolean {
  const secret = getEnv().CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return token.length > 0 && timingSafeEqual(token, secret)
}

export async function POST(request: Request) {
  if (!getEnv().CRON_SECRET) {
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
  const result: Record<string, unknown> = { status: 'ok' }

  if (state.lastCronRun && Date.now() - state.lastCronRun < 30000) {
    return NextResponse.json({ status: 'skipped', reason: 'Rate limited', errors })
  }

  try {
    if (!config.paper && binanceClient.hasCredentials()) {
      try {
        const account = await binanceClient.getAccount()
        const usdt = account.balances.find((b) => b.asset === 'USDT')
        if (usdt) {
          const total = parseFloat(usdt.free) + parseFloat(usdt.locked)
          state.balance.total = total
          state.balance.available = parseFloat(usdt.free)
        }
      } catch (err: any) {
        errors.push(`Balance sync failed: ${err.message}`)
      }
    }

    const klines = await binanceClient.getKlines(config.symbol, config.timeframe, 200)
    const candles = klines.map(parseKline)
    state.price = candles[candles.length - 1].close
    state.candles = candles
    state.lastCronRun = Date.now()

    const indicators = computeIndicators(candles)
    if (!indicators) {
      errors.push('Not enough data for indicators')
      state.errors = errors
      await setState(state)
      return NextResponse.json({ status: 'waiting_data', errors })
    }
    state.indicators = indicators

    let trend: TrendDirection = 'SIDEWAYS'
    try {
      const trendLimit = Math.min(config.trendEmaSlow + 50, 1000)
      const trendKlines = await binanceClient.getKlines(config.symbol, config.trendTimeframe, trendLimit)
      trend = computeTrend(trendKlines.map(parseKline), config.trendEmaFast, config.trendEmaSlow)
    } catch (err: any) {
      errors.push(`Trend calculation failed: ${err.message}`)
    }
    state.trend = trend

    const signal = generateSignal(indicators, trend)
    state.lastSignal = signal

    const riskMgr = new RiskManager(state.balance.total)
    riskMgr.load(state.risk)

    // Always manage open position exits (SL/TP/trend reversal) regardless of signal.
    if (state.openPosition) {
      const executor = getExecutor(config.mode)
      const exit = executor.checkExit(state.openPosition, state.price)

      const pos = state.openPosition
      const isLong = LONG_SIDES.includes(pos.side)
      const isShort = SHORT_SIDES.includes(pos.side)

      let sl = pos.stopLossPrice ?? 0
      const tp = pos.takeProfitPrice ?? 0

      if (sl > 0 && config.trailingAtrMult > 0 && indicators.atr > 0) {
        const trail = config.trailingAtrMult * indicators.atr
        if (isLong && state.price - trail > sl) sl = state.price - trail
        if (isShort && state.price + trail < sl) sl = state.price + trail
      }

      const hitSl = sl > 0 && (isLong ? state.price <= sl : state.price >= sl)
      const hitTp = tp > 0 && (isLong ? state.price >= tp : state.price <= tp)
      const trendReversed = (isLong && trend === 'DOWN') || (isShort && trend === 'UP')

      const isLiveSpot = !config.paper && config.mode === 'spot' && binanceClient.hasCredentials() && pos.side === 'BUY'
      let closeConfirmed = true
      let exitPrice = exit.exitPrice
      let grossPnl = exit.pnl

      if ((hitSl || hitTp || trendReversed) && isLiveSpot) {
        try {
          const closed = await closeSpotLive(pos)
          if (closed.status === 'filled') {
            exitPrice = closed.exitPrice
            grossPnl = (closed.exitPrice - pos.entryPrice) * closed.quantity
            if (closed.leftover > 0) {
              errors.push(`Close left ${closed.leftover} unsold (below LOT_SIZE step)`)
            }
          } else {
            // Nothing sellable on the exchange (sold manually or dust): drop it from state.
            errors.push(`Position not found on exchange (free=${closed.free}); closing in state at market price`)
          }
        } catch (err) {
          // Keep the position open so the next cycle retries the sell.
          closeConfirmed = false
          errors.push(`Close order failed, position kept open: ${errMsg(err)}`)
        }
      }

      if ((hitSl || hitTp || trendReversed) && closeConfirmed) {
        const balanceBeforeTrade = state.balance.total
        const fees = pos.stake * config.feeRate * 2
        const netPnl = grossPnl - fees

        pos.exitPrice = exitPrice
        pos.pnl = netPnl
        pos.grossPnl = grossPnl
        pos.fees = fees
        pos.status = netPnl >= 0 ? 'WIN' : 'LOSS'
        pos.closedAt = Date.now()
        pos.stopLossPrice = sl > 0 ? sl : pos.stopLossPrice

        if (isLiveSpot) {
          // Live: the exchange is the source of truth for the balance.
          try {
            const usdt = await binanceClient.getFreeBalance('USDT')
            state.balance.total = usdt
            state.balance.available = usdt
          } catch (err) {
            state.balance.total += pos.stake + netPnl
            state.balance.available = state.balance.total
            errors.push(`Balance resync after close failed: ${errMsg(err)}`)
          }
        } else {
          state.balance.total += netPnl
          state.balance.available = state.balance.total
        }
        state.balance.inPosition = 0

        state.trades.push(pos)
        state.openPosition = null

        const perf = state.performance
        perf.totalTrades++
        if (netPnl >= 0) {
          perf.wins++
          perf.avgWin = perf.avgWin === 0 ? netPnl : (perf.avgWin * (perf.wins - 1) + netPnl) / perf.wins
          if (netPnl > perf.bestTrade) perf.bestTrade = netPnl
        } else {
          perf.losses++
          perf.avgLoss = perf.avgLoss === 0 ? Math.abs(netPnl) : (perf.avgLoss * (perf.losses - 1) + Math.abs(netPnl)) / perf.losses
          if (netPnl < perf.worstTrade) perf.worstTrade = netPnl
        }
        perf.winRate = perf.totalTrades > 0 ? perf.wins / perf.totalTrades : 0
        perf.totalPnl += netPnl
        perf.profitFactor = perf.avgLoss > 0 ? perf.avgWin / perf.avgLoss : 0
        perf.expectancy = (perf.winRate * perf.avgWin) - ((1 - perf.winRate) * perf.avgLoss)

        riskMgr.onTradeResult(state.trades[state.trades.length - 1], balanceBeforeTrade)
        state.risk = riskMgr.getMetrics()

        const exitReason = hitSl ? 'SL' : hitTp ? 'TP' : 'TREND'
        await sendTelegram(formatTradeMessage(
          'TRADE CLOSED', config.symbol,
          `${pos.side} (${exitReason})`, 0, exitPrice, 0,
          config.mode, config.paper, netPnl,
        ))
      }
    }

    // Still holding a position this cycle: wait for SL/TP/trend exit.
    if (state.openPosition) {
      state.errors = errors
      await setState(state)
      result.signal = signal.action
      result.trend = trend
      return NextResponse.json({ ...result, errors })
    }

    if (signal.action === 'HOLD') {
      result.signal = 'HOLD'
      result.trend = trend
      state.errors = errors
      await setState(state)
      return NextResponse.json({ ...result, errors })
    }

    const filterResult = aiFilter(signal)
    if (!filterResult.passed) {
      result.signal = 'FILTERED'
      result.filterScore = filterResult.score
      result.trend = trend
      state.errors = errors
      await setState(state)
      return NextResponse.json({ ...result, errors })
    }

    // Spot is long-only: don't open a short when trend is DOWN.
    if (config.mode === 'spot' && signal.action === 'SELL') {
      result.signal = 'HOLD'
      result.trend = trend
      state.errors = errors
      await setState(state)
      return NextResponse.json({ ...result, errors })
    }

    if (!state.openPosition) {
      if (!isActiveHours(config.tradeActiveHours)) {
        result.signal = 'SKIPPED'
        result.reason = 'Outside active hours'
        state.errors = errors
        await setState(state)
        return NextResponse.json({ ...result, errors })
      }

      if (state.price > 0 && indicators.atr > 0) {
        const expectedMovePct = indicators.atr / state.price
        const minMovePct = config.feeRate * 2 * config.minExpectedMoveAtr
        if (expectedMovePct < minMovePct) {
          result.signal = 'SKIPPED'
          result.reason = 'Expected move below fees threshold'
          state.errors = errors
          await setState(state)
          return NextResponse.json({ ...result, errors })
        }
      }

      const auth = riskMgr.authorize(state.balance.total)
      state.risk = riskMgr.getMetrics()

      if (!auth.approved) {
        result.auth = auth.reason
        state.errors = errors
        await setState(state)
        return NextResponse.json({ ...result, errors })
      }

      const executor = getExecutor(config.mode)
      const executeResult = await executor.execute(
        { action: signal.action, confidence: signal.confidence },
        config,
        state.balance,
        auth.stake,
      )

      if (executeResult.success && executeResult.trade) {
        const trade: Trade = executeResult.trade
        // Executors that report real fills (live spot) set these; paper ones fall back to the last price.
        if (!trade.stake) trade.stake = auth.stake
        if (!trade.entryPrice) trade.entryPrice = state.price
        trade.aiScore = filterResult.score
        if (!trade.quantity || trade.quantity === 0) {
          trade.quantity = trade.entryPrice > 0 ? trade.stake / trade.entryPrice : 0
        }

        if (indicators.atr > 0) {
          const isLong = LONG_SIDES.includes(trade.side)
          trade.stopLossPrice = isLong
            ? trade.entryPrice - config.slAtrMult * indicators.atr
            : trade.entryPrice + config.slAtrMult * indicators.atr
          trade.takeProfitPrice = isLong
            ? trade.entryPrice + config.tpAtrMult * indicators.atr
            : trade.entryPrice - config.tpAtrMult * indicators.atr
        }

        state.openPosition = trade
        state.balance.available = state.balance.total - trade.stake
        state.balance.inPosition = trade.stake

        await sendTelegram(formatTradeMessage(
          'NEW TRADE', config.symbol,
          trade.side, trade.stake, trade.entryPrice,
          signal.confidence, config.mode, config.paper,
        ))
      } else {
        errors.push(executeResult.error || 'Execution failed')
      }
    }

    state.trades = state.trades.slice(-100)
    if (state.errors.length > 50) state.errors = state.errors.slice(-50)
    state.errors = errors

    await setState(state)
    result.lastCronRun = state.lastCronRun
    result.signal = signal.action
    result.trend = trend
    result.confidence = signal.confidence
    return NextResponse.json(result)
  } catch (err: any) {
    errors.push(err.message)
    state.errors = errors
    await setState(state)
    return NextResponse.json({ status: 'error', errors }, { status: 500 })
  }
}
