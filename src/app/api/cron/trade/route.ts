import { NextResponse } from 'next/server'
import { getState, setState, createInitialState } from '@/lib/state/redis'
import { getConfig } from '@/lib/config'
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

export async function POST() {
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

      if (hitSl || hitTp || trendReversed) {
        if (!config.paper && config.mode === 'spot' && binanceClient.hasCredentials() && pos.side === 'BUY') {
          try {
            await binanceClient.marketSell(config.symbol, pos.quantity.toFixed(6))
          } catch (err: any) {
            errors.push(`Close order failed: ${err.message}`)
          }
        }

        const fees = pos.stake * config.feeRate * 2
        const netPnl = exit.pnl - fees

        pos.exitPrice = exit.exitPrice
        pos.pnl = netPnl
        pos.grossPnl = exit.pnl
        pos.fees = fees
        pos.status = netPnl >= 0 ? 'WIN' : 'LOSS'
        pos.closedAt = Date.now()
        pos.stopLossPrice = sl > 0 ? sl : pos.stopLossPrice

        state.balance.total += netPnl
        state.balance.available = state.balance.total
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

        riskMgr.onTradeResult(state.trades[state.trades.length - 1])
        state.risk = riskMgr.getMetrics()

        const exitReason = hitSl ? 'SL' : hitTp ? 'TP' : 'TREND'
        await sendTelegram(formatTradeMessage(
          'TRADE CLOSED', config.symbol,
          `${pos.side} (${exitReason})`, 0, exit.exitPrice, 0,
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
      )

      if (executeResult.success && executeResult.trade) {
        const trade: Trade = executeResult.trade
        trade.stake = auth.stake
        trade.entryPrice = state.price
        trade.aiScore = filterResult.score
        if (!trade.quantity || trade.quantity === 0) {
          trade.quantity = state.price > 0 ? auth.stake / state.price : 0
        }

        if (indicators.atr > 0) {
          const isLong = LONG_SIDES.includes(trade.side)
          trade.stopLossPrice = isLong
            ? state.price - config.slAtrMult * indicators.atr
            : state.price + config.slAtrMult * indicators.atr
          trade.takeProfitPrice = isLong
            ? state.price + config.tpAtrMult * indicators.atr
            : state.price - config.tpAtrMult * indicators.atr
        }

        state.openPosition = trade
        state.balance.available = state.balance.total - auth.stake
        state.balance.inPosition = auth.stake

        await sendTelegram(formatTradeMessage(
          'NEW TRADE', config.symbol,
          trade.side, auth.stake, state.price,
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
