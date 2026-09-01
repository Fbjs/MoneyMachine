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

export interface BacktestResult {
  config: { symbol: string; timeframe: string; trendTimeframe: string; mode: string }
  metrics: BacktestMetrics
  trades: BacktestTrade[]
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

export function runBacktest(
  config: BotConfig,
  tradingCandles: Candle[],
  trendCandles: Candle[],
  initialBalance = 1000,
): BacktestResult {
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

  // Precompute trend EMA series over the higher timeframe.
  const trendClose = trendCandles.map(c => c.close)
  const trendFast = ema(trendClose, config.trendEmaFast)
  const trendSlow = ema(trendClose, config.trendEmaSlow)
  const trendSeries: { time: number; dir: TrendDirection }[] = trendCandles.map((c, i) => {
    const f = trendFast[i]
    const s = trendSlow[i]
    const dir: TrendDirection = !s ? 'SIDEWAYS' : f > s ? 'UP' : f < s ? 'DOWN' : 'SIDEWAYS'
    return { time: c.time, dir }
  })

  function trendAt(time: number): TrendDirection {
    let dir: TrendDirection = 'SIDEWAYS'
    for (const p of trendSeries) {
      if (p.time <= time) dir = p.dir
      else break
    }
    return dir
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

  const warmup = 60
  for (let i = warmup; i < tradingCandles.length; i++) {
    const candle = tradingCandles[i]
    const price = candle.close
    const dir = trendAt(candle.time)
    const window = tradingCandles.slice(Math.max(0, i - 199), i + 1)
    const indicators = computeIndicators(window)
    if (!indicators) continue

    if (position) {
      const isLong = LONG_SIDES.includes(position.side)
      const isShort = SHORT_SIDES.includes(position.side)

      let sl = position.stopLossPrice
      if (config.trailingAtrMult > 0 && indicators.atr > 0) {
        const trail = config.trailingAtrMult * indicators.atr
        if (isLong && price - trail > sl) sl = price - trail
        if (isShort && price + trail < sl) sl = price + trail
      }

      const hitSl = isLong ? price <= sl : price >= sl
      const hitTp = isLong ? price >= position.takeProfitPrice : price <= position.takeProfitPrice
      const trendReversed = (isLong && dir === 'DOWN') || (isShort && dir === 'UP')

      if (hitSl || hitTp || trendReversed) {
        const grossPnl = isLong
          ? (price - position.entryPrice) * position.quantity
          : (position.entryPrice - price) * position.quantity
        const fees = position.stake * config.feeRate * 2
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
          time: candle.time,
          side: position.side,
          entryPrice: position.entryPrice,
          exitPrice: price,
          stake: position.stake,
          grossPnl,
          fees,
          netPnl,
          aiScore: position.aiScore,
          exitReason: hitSl ? 'SL' : hitTp ? 'TP' : 'TREND',
          barsHeld: i - position.openedIndex,
        })
        position = null
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

      const isLong = LONG_SIDES.includes(signal.action === 'BUY' ? 'BUY' : 'SELL')
      const side = signal.action === 'BUY' ? 'BUY' : 'SELL'
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
    trades,
  }
}
