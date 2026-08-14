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

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function POST() {
  const config = getConfig()
  let state = await getState()
  if (!state) {
    state = createInitialState()
    state.config = config
  }
  state.config = config

  const errors: string[] = []
  let result: Record<string, unknown> = { status: 'ok' }

  // Rate limiting: minimum 30s between runs
  if (state.lastCronRun && Date.now() - state.lastCronRun < 30000) {
    return NextResponse.json({ status: 'skipped', reason: 'Rate limited', errors })
  }

  try {
    // Sync balance from Binance if live trading
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

    // Single RiskManager instance for this cycle
    const riskMgr = new RiskManager(state.balance.total)
    riskMgr.load(state.risk)

    // Handle open position: check TP/SL first, then opposite signal
    if (state.openPosition) {
      const executor = getExecutor(config.mode)
      const exit = executor.checkExit(state.openPosition, state.price)

      const positionSide = state.openPosition.side
      const isOpposite =
        (positionSide === 'BUY' && signal.action === 'SELL') ||
        (positionSide === 'CALL' && signal.action === 'SELL') ||
        (positionSide === 'LONG' && signal.action === 'SELL') ||
        (positionSide === 'SELL' && signal.action === 'BUY') ||
        (positionSide === 'PUT' && signal.action === 'BUY') ||
        (positionSide === 'SHORT' && signal.action === 'BUY')

      // TP/SL: 3:1 risk/reward ratio using stake percentage
      const stopLoss = -state.openPosition.stake * 0.015
      const takeProfit = state.openPosition.stake * 0.03

      if (exit.pnl <= stopLoss || exit.pnl >= takeProfit || isOpposite) {

        // Execute live close order for spot
        if (!config.paper && config.mode === 'spot' && binanceClient.hasCredentials()) {
          try {
            if (state.openPosition.side === 'BUY') {
              await binanceClient.marketSell(config.symbol, state.openPosition.quantity.toFixed(6))
            }
          } catch (err: any) {
            errors.push(`Close order failed: ${err.message}`)
          }
        }

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
          if (exit.pnl > perf.bestTrade) perf.bestTrade = exit.pnl
        } else {
          perf.losses++
          perf.avgLoss = perf.avgLoss === 0 ? Math.abs(exit.pnl) : (perf.avgLoss * (perf.losses - 1) + Math.abs(exit.pnl)) / perf.losses
          if (exit.pnl < perf.worstTrade) perf.worstTrade = exit.pnl
        }
        perf.winRate = perf.totalTrades > 0 ? perf.wins / perf.totalTrades : 0
        perf.totalPnl += exit.pnl
        perf.profitFactor = perf.avgLoss > 0 ? perf.avgWin / perf.avgLoss : 0
        perf.expectancy = (perf.winRate * perf.avgWin) - ((1 - perf.winRate) * perf.avgLoss)

        riskMgr.onTradeResult(state.trades[state.trades.length - 1])
        state.risk = riskMgr.getMetrics()

        await sendTelegram(formatTradeMessage(
          'TRADE CLOSED', config.symbol,
          'EXIT', 0, exit.exitPrice, 0,
          config.mode, config.paper, exit.pnl,
        ))
      }
    }

    // Open new position if none exists
    if (!state.openPosition) {
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
        if (!executeResult.trade.quantity || executeResult.trade.quantity === 0) {
          executeResult.trade.quantity = state.price > 0 ? auth.stake / state.price : 0
        }

        state.openPosition = executeResult.trade
        state.balance.available = state.balance.total - auth.stake
        state.balance.inPosition = auth.stake

        await sendTelegram(formatTradeMessage(
          'NEW TRADE', config.symbol,
          executeResult.trade.side, auth.stake, state.price,
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
    result.confidence = signal.confidence
    return NextResponse.json(result)
  } catch (err: any) {
    errors.push(err.message)
    state.errors = errors
    await setState(state)
    return NextResponse.json({ status: 'error', errors }, { status: 500 })
  }
}
