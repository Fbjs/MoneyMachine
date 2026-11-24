import type { Candle, BotConfig, TrendDirection } from '@/types'
import { computeIndicators, ema } from '@/lib/strategy/indicators'
import { generateSignal } from '@/lib/strategy/signal-engine'
import { aiFilter } from '@/lib/ai/filter'

const LONG_SIDES = ['BUY', 'CALL', 'LONG']
const SHORT_SIDES = ['SELL', 'PUT', 'SHORT']

export interface BacktestTrade {
  index: number
  time: number
  side: string
  entryPrice: number
  exitPrice: number
  stake: number
  grossPnl: number
  fees: number
  netPnl: number
  aiScore: number
  exitReason: 'SL' | 'TP' | 'TREND'
  barsHeld: number
}

export interface BacktestMetrics {
  initialBalance: number
  finalBalance: number
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number
  totalPnl: number
  totalFees: number
  maxDrawdownPct: number
  expectancy: number
  avgWin: number
  avgLoss: number
  buyHoldReturnPct: number
}

export interface BacktestMeta {
  startTime: number | null
  endTime: number | null
  barsEvaluated: number
  /** Bars where the higher-timeframe EMAs were still warming up (no usable trend). */
  barsWithoutTrend: number
  barsUp: number
  barsDown: number
  barsSideways: number
}

export interface BacktestResult {
  config: { symbol: string; timeframe: string; trendTimeframe: string; mode: string }
  metrics: BacktestMetrics
  meta: BacktestMeta
  trades: BacktestTrade[]
}

export interface BacktestOptions {
  /** Duration of one trading candle, in seconds. */
  tradingIntervalSec: number
  /** Duration of one trend (higher timeframe) candle, in seconds. */
  trendIntervalSec: number
  initialBalance?: number
}

interface Position {
  side: string
  entryPrice: number
  stake: number
  quantity: number
  stopLossPrice: number
  takeProfitPrice: number
  aiScore: number
  openedAt: number
  openedIndex: number
}

type TrendPoint = { availableAt: number; dir: TrendDirection | null }

/**
 * Replays the strategy over closed candles.
 *
 * Timing model (no look-ahead):
 * - Each trading bar is evaluated at its close, using indicators up to and including that bar.
 * - A trend candle only becomes visible once it has closed (open time + trend interval).
 * - Entries fill at the close of the signal bar; SL/TP are checked from the next bar on,
 *   against its high/low. If both are touched in the same bar, SL is assumed (conservative).
 */
export function runBacktest(
  config: BotConfig,
  tradingCandles: Candle[],
  trendCandles: Candle[],
  options: BacktestOptions,
): BacktestResult {
  const initialBalance = options.initialBalance ?? 1000
  const trades: BacktestTrade[] = []
  let balance = initialBalance
  let position: Position | null = null
  let wins = 0
  let losses = 0
  let totalPnl = 0
  let totalFees = 0
  let equityPeak = initialBalance
  let maxDrawdownPct = 0
  let consecutiveLosses = 0
  const meta: BacktestMeta = {
    startTime: null, endTime: null, barsEvaluated: 0,
    barsWithoutTrend: 0, barsUp: 0, barsDown: 0, barsSideways: 0,
  }

  // Precompute the trend series; `dir: null` while the slow EMA is still warming up.
  const trendClose = trendCandles.map(c => c.close)
  const trendFast = ema(trendClose, config.trendEmaFast)
  const trendSlow = ema(trendClose, config.trendEmaSlow)
  const trendSeries: TrendPoint[] = trendCandles.map((c, i) => {
    const f = trendFast[i]
    const sl = trendSlow[i]
    const dir: TrendDirection | null = !sl ? null : f > sl ? 'UP' : f < sl ? 'DOWN' : 'SIDEWAYS'
    return { availableAt: c.time + options.trendIntervalSec, dir }
  })

  // Trading bars are visited in time order, so a forward-only pointer is enough.
  let trendIdx = -1
  function trendAt(time: number): TrendDirection | null {
    while (trendIdx + 1 < trendSeries.length && trendSeries[trendIdx + 1].availableAt <= time) {
      trendIdx++
    }
    return trendIdx >= 0 ? trendSeries[trendIdx].dir : null
  }

  function stakeFor(bal: number): number {
    let stake: number
    if (config.stakeMode === 'fixed') {
      stake = Math.min(config.stakeFixed, config.maxPositionUsdt, bal)
    } else {
      stake = Math.min(bal * (config.stakePercent / 100), config.maxPositionUsdt, bal)
    }
    if (consecutiveLosses >= 2) stake = stake / 2
    return parseFloat(stake.toFixed(2))
  }

  function closePosition(pos: Position, i: number, time: number, exitPrice: number, exitReason: BacktestTrade['exitReason']) {
    const isLong = LONG_SIDES.includes(pos.side)
    const grossPnl = isLong
      ? (exitPrice - pos.entryPrice) * pos.quantity
      : (pos.entryPrice - exitPrice) * pos.quantity
    const fees = pos.stake * config.feeRate * 2
    const netPnl = grossPnl - fees

    balance += netPnl
    totalPnl += netPnl
    totalFees += fees
    equityPeak = Math.max(equityPeak, balance)
    const dd = equityPeak > 0 ? ((equityPeak - balance) / equityPeak) * 100 : 0
    maxDrawdownPct = Math.max(maxDrawdownPct, dd)

    if (netPnl >= 0) {
      wins++
      consecutiveLosses = 0
    } else {
      losses++
      consecutiveLosses++
    }

    trades.push({
      index: i,
      time,
      side: pos.side,
      entryPrice: pos.entryPrice,
      exitPrice,
      stake: pos.stake,
      grossPnl,
      fees,
      netPnl,
      aiScore: pos.aiScore,
      exitReason,
      barsHeld: i - pos.openedIndex,
    })
  }

  const warmup = 60
  for (let i = warmup; i < tradingCandles.length; i++) {
    const candle = tradingCandles[i]
    const price = candle.close
    const barClose = candle.time + options.tradingIntervalSec
    const trendDir = trendAt(barClose)
    const dir: TrendDirection = trendDir ?? 'SIDEWAYS'
    const window = tradingCandles.slice(Math.max(0, i - 199), i + 1)
    const indicators = computeIndicators(window)
    if (!indicators) continue

    meta.barsEvaluated++
    if (meta.startTime === null) meta.startTime = candle.time
    meta.endTime = candle.time
    if (trendDir === null) meta.barsWithoutTrend++
    else if (trendDir === 'UP') meta.barsUp++
    else if (trendDir === 'DOWN') meta.barsDown++
    else meta.barsSideways++

    if (position) {
      const isLong = LONG_SIDES.includes(position.side)
      const isShort = SHORT_SIDES.includes(position.side)
      const sl = position.stopLossPrice
      const tp = position.takeProfitPrice

      const hitSl = isLong ? candle.low <= sl : candle.high >= sl
      const hitTp = isLong ? candle.high >= tp : candle.low <= tp

      if (hitSl) {
        // A gap through the stop fills at the open, not at the stop price.
        const fill = isLong ? Math.min(sl, candle.open) : Math.max(sl, candle.open)
        closePosition(position, i, candle.time, fill, 'SL')
        position = null
      } else if (hitTp) {
        const fill = isLong ? Math.max(tp, candle.open) : Math.min(tp, candle.open)
        closePosition(position, i, candle.time, fill, 'TP')
        position = null
      } else if ((isLong && dir === 'DOWN') || (isShort && dir === 'UP')) {
        closePosition(position, i, candle.time, price, 'TREND')
        position = null
      } else if (config.trailingAtrMult > 0 && indicators.atr > 0) {
        // Ratchet the trailing stop at bar close; it applies from the next bar on.
        const trail = config.trailingAtrMult * indicators.atr
        if (isLong && price - trail > sl) position.stopLossPrice = price - trail
        if (isShort && price + trail < sl) position.stopLossPrice = price + trail
      }
    }

    if (!position) {
      const signal = generateSignal(indicators, dir)
      if (signal.action === 'HOLD') continue
      if (config.mode === 'spot' && signal.action === 'SELL') continue

      const filterResult = aiFilter(signal)
      if (!filterResult.passed) continue

      if (price > 0 && indicators.atr > 0) {
        const expectedMovePct = indicators.atr / price
        const minMovePct = config.feeRate * 2 * config.minExpectedMoveAtr
        if (expectedMovePct < minMovePct) continue
      }

      const stake = stakeFor(balance)
      if (stake <= 0) continue

      const side = signal.action === 'BUY' ? 'BUY' : 'SELL'
      const isLong = side === 'BUY'
      const quantity = price > 0 ? stake / price : 0

      position = {
        side,
        entryPrice: price,
        stake,
        quantity,
        stopLossPrice: isLong ? price - config.slAtrMult * indicators.atr : price + config.slAtrMult * indicators.atr,
        takeProfitPrice: isLong ? price + config.tpAtrMult * indicators.atr : price - config.tpAtrMult * indicators.atr,
        aiScore: filterResult.score,
        openedAt: candle.time,
        openedIndex: i,
      }
    }
  }

  const totalTrades = trades.length
  const avgWin = wins > 0 ? trades.filter(t => t.netPnl >= 0).reduce((a, t) => a + t.netPnl, 0) / wins : 0
  const avgLoss = losses > 0 ? Math.abs(trades.filter(t => t.netPnl < 0).reduce((a, t) => a + t.netPnl, 0)) / losses : 0
  const firstPrice = tradingCandles[warmup]?.close ?? tradingCandles[0]?.close ?? 0
  const lastPrice = tradingCandles[tradingCandles.length - 1]?.close ?? 0
  const buyHoldReturnPct = firstPrice > 0 ? ((lastPrice - firstPrice) / firstPrice) * 100 : 0

  return {
    config: { symbol: config.symbol, timeframe: config.timeframe, trendTimeframe: config.trendTimeframe, mode: config.mode },
    metrics: {
      initialBalance,
      finalBalance: parseFloat(balance.toFixed(4)),
      totalTrades,
      wins,
      losses,
      winRate: totalTrades > 0 ? wins / totalTrades : 0,
      profitFactor: avgLoss > 0 ? avgWin / avgLoss : 0,
      totalPnl: parseFloat(totalPnl.toFixed(4)),
      totalFees: parseFloat(totalFees.toFixed(4)),
      maxDrawdownPct: parseFloat(maxDrawdownPct.toFixed(3)),
      expectancy: totalTrades > 0 ? totalPnl / totalTrades : 0,
      avgWin: parseFloat(avgWin.toFixed(4)),
      avgLoss: parseFloat(avgLoss.toFixed(4)),
      buyHoldReturnPct: parseFloat(buyHoldReturnPct.toFixed(3)),
    },
    meta,
    trades,
  }
}
