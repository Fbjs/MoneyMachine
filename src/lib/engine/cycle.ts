import type { BotConfig, BotState, Candle, Trade, TrendDirection } from '@/types'
import type { Executor } from '@/lib/execution/types'
import type { SpotCloseResult } from '@/lib/execution/spot-executor'
import { intervalToSeconds, closedCandles } from '@/lib/binance/types'
import { computeIndicators } from '@/lib/strategy/indicators'
import { generateSignal } from '@/lib/strategy/signal-engine'
import { computeTrend } from '@/lib/strategy/trend'
import { filterForRule } from '@/lib/ai/filter'
import { RiskManager } from '@/lib/risk/manager'
import { formatTradeMessage } from '@/lib/utils/telegram'

const LONG_SIDES = ['BUY', 'CALL', 'LONG']
const SHORT_SIDES = ['SELL', 'PUT', 'SHORT']

export type ExitReason = 'SL' | 'TP' | 'TREND' | 'SIGNAL'

export interface CycleInput {
  /** Current time in ms (wall clock in production, simulated in replay). */
  now: number
  config: BotConfig
  /** Trading-timeframe candles, oldest first; may include the still-forming one last. */
  candles: Candle[]
  /** Trend-timeframe candles, or null if they could not be loaded (trend = SIDEWAYS). */
  trendCandles: Candle[] | null
}

export interface CycleDeps {
  executor: Executor
  notify?: (message: string) => Promise<void>
  /** Live spot only: sell the position on the exchange. Throw to keep the position open. */
  liveClose?: (position: Trade) => Promise<SpotCloseResult>
  /** Live spot only: exchange USDT balance after a close. */
  syncBalanceAfterClose?: () => Promise<number>
}

export type CycleEvent =
  | { type: 'open'; trade: Trade }
  | { type: 'close'; trade: Trade; reason: ExitReason }

export interface CycleOutput {
  status: 'ok' | 'waiting_data'
  result: Record<string, unknown>
  events: CycleEvent[]
  errors: string[]
}

function errMsg(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

export function isActiveHours(hoursSpec: string, now: number): boolean {
  if (!hoursSpec) return true
  const ranges = hoursSpec.split(',').map(s => s.trim()).filter(Boolean)
  if (ranges.length === 0) return true
  const hour = new Date(now).getUTCHours()
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

/**
 * One trading cycle: manage the open position's exits, then evaluate a new entry.
 * Mutates `state`. Shared by the production cron and the historical replay, so both run
 * exactly the same decision logic; all I/O and the clock come from `input` and `deps`.
 */
export async function runTradingCycle(state: BotState, input: CycleInput, deps: CycleDeps): Promise<CycleOutput> {
  const { now, config, candles } = input
  const errors: string[] = []
  const events: CycleEvent[] = []
  const result: Record<string, unknown> = { status: 'ok' }
  const notify = deps.notify ?? (async () => {})
  const finish = (status: CycleOutput['status'] = 'ok'): CycleOutput => {
    state.errors = errors
    return { status, result, events, errors }
  }

  state.price = candles[candles.length - 1].close
  state.candles = candles
  state.lastCronRun = now

  // Signals use closed candles only, exactly like the backtest. Exits (SL/TP) still use the live price.
  const closed = closedCandles(candles, intervalToSeconds(config.timeframe), now)
  const lastClosedTime = closed.length > 0 ? closed[closed.length - 1].time : null
  // Entries are only evaluated on the first cycle that sees a newly closed candle (= backtest bar close).
  const isNewCandle = lastClosedTime !== null && lastClosedTime !== state.lastEvaluatedCandleTime
  state.lastEvaluatedCandleTime = lastClosedTime
  result.newCandle = isNewCandle

  const indicators = computeIndicators(closed, config.signalSmaPeriod)
  if (!indicators) {
    errors.push('Not enough data for indicators')
    result.status = 'waiting_data'
    return finish('waiting_data')
  }
  state.indicators = indicators

  let trend: TrendDirection = 'SIDEWAYS'
  if (input.trendCandles) {
    const trendClosed = closedCandles(input.trendCandles, intervalToSeconds(config.trendTimeframe), now)
    trend = computeTrend(trendClosed, config.trendEmaFast, config.trendEmaSlow)
  }
  state.trend = trend
  result.trend = trend

  const signal = generateSignal(indicators, trend, {
    rule: config.signalRule, adxMin: config.signalAdxMin, smaPeriod: config.signalSmaPeriod,
  })
  // sma_trend exits on its own opposite signal; the other rules exit when the higher-timeframe trend flips.
  const exitsOnSignal = config.signalRule === 'sma_trend'
  state.lastSignal = signal

  const riskMgr = new RiskManager(state.balance.total)
  riskMgr.load(state.risk)

  // Always manage open position exits (SL/TP/trend reversal) regardless of signal.
  if (state.openPosition) {
    const exit = deps.executor.checkExit(state.openPosition, state.price)

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

    // Persist the ratcheted trailing stop so it never moves back.
    if (sl > 0) pos.stopLossPrice = sl

    const hitSl = sl > 0 && (isLong ? state.price <= sl : state.price >= sl)
    const hitTp = tp > 0 && (isLong ? state.price >= tp : state.price <= tp)
    const trendReversed = !exitsOnSignal && ((isLong && trend === 'DOWN') || (isShort && trend === 'UP'))
    const signalExit = exitsOnSignal && ((isLong && signal.action !== 'BUY') || (isShort && signal.action !== 'SELL'))
    const shouldExit = hitSl || hitTp || trendReversed || signalExit

    const isLiveSpot = !!deps.liveClose && config.mode === 'spot' && pos.side === 'BUY'
    let closeConfirmed = true
    let exitPrice = exit.exitPrice
    let grossPnl = exit.pnl

    if (shouldExit && isLiveSpot && deps.liveClose) {
      try {
        const sold = await deps.liveClose(pos)
        if (sold.status === 'filled') {
          exitPrice = sold.exitPrice
          grossPnl = (sold.exitPrice - pos.entryPrice) * sold.quantity
          if (sold.leftover > 0) {
            errors.push(`Close left ${sold.leftover} unsold (below LOT_SIZE step)`)
          }
        } else {
          // Nothing sellable on the exchange (sold manually or dust): drop it from state.
          errors.push(`Position not found on exchange (free=${sold.free}); closing in state at market price`)
        }
      } catch (err) {
        // Keep the position open so the next cycle retries the sell.
        closeConfirmed = false
        errors.push(`Close order failed, position kept open: ${errMsg(err)}`)
      }
    }

    if (shouldExit && closeConfirmed) {
      const balanceBeforeTrade = state.balance.total
      const fees = pos.stake * config.feeRate * 2
      const netPnl = grossPnl - fees

      pos.exitPrice = exitPrice
      pos.pnl = netPnl
      pos.grossPnl = grossPnl
      pos.fees = fees
      pos.status = netPnl >= 0 ? 'WIN' : 'LOSS'
      pos.closedAt = now
      pos.stopLossPrice = sl > 0 ? sl : pos.stopLossPrice

      if (isLiveSpot && deps.syncBalanceAfterClose) {
        // Live: the exchange is the source of truth for the balance.
        try {
          const usdt = await deps.syncBalanceAfterClose()
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
      // Profit factor = gross profit / gross loss.
      const grossLoss = perf.avgLoss * perf.losses
      perf.profitFactor = grossLoss > 0 ? (perf.avgWin * perf.wins) / grossLoss : 0
      perf.expectancy = (perf.winRate * perf.avgWin) - ((1 - perf.winRate) * perf.avgLoss)

      riskMgr.onTradeResult(pos, balanceBeforeTrade, now)
      state.risk = riskMgr.getMetrics()

      const exitReason: ExitReason = hitSl ? 'SL' : hitTp ? 'TP' : signalExit ? 'SIGNAL' : 'TREND'
      events.push({ type: 'close', trade: pos, reason: exitReason })
      await notify(formatTradeMessage(
        'TRADE CLOSED', config.symbol,
        `${pos.side} (${exitReason})`, 0, exitPrice, 0,
        config.mode, config.paper, netPnl,
      ))
    }
  }

  // Still holding a position this cycle: wait for SL/TP/trend exit.
  if (state.openPosition) {
    result.signal = signal.action
    return finish()
  }

  if (!isNewCandle) {
    result.signal = config.mode === 'spot' && signal.action === 'SELL' ? 'HOLD' : signal.action
    result.reason = 'Waiting for next candle close'
    return finish()
  }

  if (signal.action === 'HOLD') {
    result.signal = 'HOLD'
    return finish()
  }

  const filterResult = filterForRule(signal, config.signalRule)
  if (!filterResult.passed) {
    result.signal = 'FILTERED'
    result.filterScore = filterResult.score
    return finish()
  }

  // Spot is long-only: don't open a short when trend is DOWN.
  if (config.mode === 'spot' && signal.action === 'SELL') {
    result.signal = 'HOLD'
    return finish()
  }

  if (!isActiveHours(config.tradeActiveHours, now)) {
    result.signal = 'SKIPPED'
    result.reason = 'Outside active hours'
    return finish()
  }

  if (state.price > 0 && indicators.atr > 0) {
    const expectedMovePct = indicators.atr / state.price
    const minMovePct = config.feeRate * 2 * config.minExpectedMoveAtr
    if (expectedMovePct < minMovePct) {
      result.signal = 'SKIPPED'
      result.reason = 'Expected move below fees threshold'
      return finish()
    }
  }

  const auth = riskMgr.authorize(state.balance.total, now)
  state.risk = riskMgr.getMetrics()

  if (!auth.approved) {
    result.auth = auth.reason
    return finish()
  }

  const executeResult = await deps.executor.execute(
    { action: signal.action, confidence: signal.confidence },
    config,
    state.balance,
    auth.stake,
    { price: state.price, now },
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

    // A multiplier <= 0 disables that level (e.g. sma_trend exits only on its signal).
    if (indicators.atr > 0) {
      const isLong = LONG_SIDES.includes(trade.side)
      if (config.slAtrMult > 0) {
        trade.stopLossPrice = isLong
          ? trade.entryPrice - config.slAtrMult * indicators.atr
          : trade.entryPrice + config.slAtrMult * indicators.atr
      }
      if (config.tpAtrMult > 0) {
        trade.takeProfitPrice = isLong
          ? trade.entryPrice + config.tpAtrMult * indicators.atr
          : trade.entryPrice - config.tpAtrMult * indicators.atr
      }
    }

    state.openPosition = trade
    state.balance.available = state.balance.total - trade.stake
    state.balance.inPosition = trade.stake
    events.push({ type: 'open', trade })

    await notify(formatTradeMessage(
      'NEW TRADE', config.symbol,
      trade.side, trade.stake, trade.entryPrice,
      signal.confidence, config.mode, config.paper,
    ))
  } else {
    errors.push(executeResult.error || 'Execution failed')
  }

  state.trades = state.trades.slice(-100)
  result.signal = signal.action
  result.confidence = signal.confidence
  return finish()
}
