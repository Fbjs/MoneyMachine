import { NextResponse } from 'next/server'
import { getState, setState, createInitialState } from '@/lib/state/redis'
import { getConfig } from '@/lib/config'
import { binanceClient } from '@/lib/binance/client'
import { parseKline } from '@/lib/binance/types'
import { computeIndicators } from '@/lib/strategy/indicators'
import { generateSignal } from '@/lib/strategy/signal-engine'
import { aiFilter } from '@/lib/ai/filter'
import { RiskManager } from '@/lib/risk/manager'
import { getExecutor } from '@/lib/execution/factory'
import { sendTelegram, formatTradeMessage } from '@/lib/utils/telegram'
import type { BotState } from '@/types'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const config = getConfig()
  let state = await getState()
  if (!state) {
    state = createInitialState()
    state.config = config
  }

  const errors: string[] = []
  let result: Record<string, any> = { status: 'ok' }

  try {
    const klines = await binanceClient.getKlines(config.symbol, config.timeframe, 100)
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

    const signal = generateSignal(indicators)
    state.lastSignal = signal

    if (signal.action === 'HOLD') {
      result.signal = 'HOLD'
      state.errors = errors
      await setState(state)
      return NextResponse.json({ ...result, errors })
    }

    const filterResult = aiFilter(signal)
    if (!filterResult.passed) {
      result.signal = 'FILTERED'
      result.filterScore = filterResult.score
      state.errors = errors
      await setState(state)
      return NextResponse.json({ ...result, errors })
    }

    if (state.openPosition) {
      const executor = getExecutor(config.mode)
      const exit = executor.checkExit(state.openPosition, state.price)
      if (exit.shouldExit) {
        state.openPosition.exitPrice = exit.exitPrice
        state.openPosition.pnl = exit.pnl
        state.openPosition.status = exit.pnl >= 0 ? 'WIN' : 'LOSS'
        state.openPosition.closedAt = Date.now()

        state.balance.total += exit.pnl
        state.balance.available = state.balance.total
        state.balance.inPosition = 0

        state.trades.push(state.openPosition)
        state.openPosition = null

        const perf = state.performance
        perf.totalTrades++
        if (exit.pnl >= 0) {
          perf.wins++
          perf.avgWin = perf.avgWin === 0 ? exit.pnl : (perf.avgWin * (perf.wins - 1) + exit.pnl) / perf.wins
        } else {
          perf.losses++
          perf.avgLoss = perf.avgLoss === 0 ? Math.abs(exit.pnl) : (perf.avgLoss * (perf.losses - 1) + Math.abs(exit.pnl)) / perf.losses
        }
        perf.winRate = perf.totalTrades > 0 ? perf.wins / perf.totalTrades : 0
        perf.totalPnl += exit.pnl
        perf.profitFactor = perf.avgLoss > 0 ? perf.avgWin / perf.avgLoss : 0
        perf.expectancy = (perf.winRate * perf.avgWin) - ((1 - perf.winRate) * perf.avgLoss)

        const riskMgr = new RiskManager(1000)
        riskMgr.load(state.risk)

        await sendTelegram(formatTradeMessage(
          'TRADE CLOSED', config.symbol,
          'EXIT', 0, exit.exitPrice, 0,
          config.mode, config.paper, exit.pnl,
        ))
      }
    }

    if (!state.openPosition) {
      const riskMgr = new RiskManager(1000)
      riskMgr.load(state.risk)
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
        executeResult.trade.stake = auth.stake
        executeResult.trade.entryPrice = state.price
        executeResult.trade.quantity = state.balance.total > 0 ? auth.stake / state.price : 0

        state.openPosition = executeResult.trade
        state.balance.available = state.balance.total - auth.stake
        state.balance.inPosition = auth.stake
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
    result.confidence = signal.confidence
    return NextResponse.json(result)
  } catch (err: any) {
    errors.push(err.message)
    state.errors = errors
    await setState(state)
    return NextResponse.json({ status: 'error', errors }, { status: 500 })
  }
}
