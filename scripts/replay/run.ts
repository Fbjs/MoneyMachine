/**
 * Historical replay: runs the production trading cycle (runTradingCycle) minute by minute
 * over cached 1m data, with a simulated clock, as if the cron had been live.
 *
 *   npx tsx --tsconfig tsconfig.json scripts/replay/run.ts [--from 2025-03-01] [--to 2026-11-24]
 *        [--every-minute] [--out public/replay/latest.json]
 *
 * Strategy settings come from the same env vars as production (TIMEFRAME, SIGNAL_RULE, ...).
 */
import { mkdirSync, writeFileSync } from 'fs'
import { dirname } from 'path'
import { getConfig } from '@/lib/config'
import { createInitialState } from '@/lib/state/redis'
import { getExecutor } from '@/lib/execution/factory'
import { intervalToSeconds } from '@/lib/binance/types'
import { runTradingCycle, type ExitReason } from '@/lib/engine/cycle'
import { runBacktest } from '@/lib/backtest/engine'
import type { Candle } from '@/types'
import { loadCandles } from './data'

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`)
  return i >= 0 ? process.argv[i + 1] : undefined
}

export interface ReplayTrade {
  side: string
  entryTime: number // s
  entryPrice: number
  stopLoss: number | null
  takeProfit: number | null
  exitTime: number // s
  exitPrice: number
  exitReason: ExitReason
  stake: number
  fees: number
  pnl: number
}

/** Find the last index with candles[i].time + sec <= t (closed by t), moving forward from `from`. */
function advanceClosed(candles: Candle[], sec: number, t: number, from: number): number {
  let i = from
  while (i + 1 < candles.length && candles[i + 1].time + sec <= t) i++
  return i
}

async function main() {
  const fromSec = Date.parse(arg('from') ?? '2025-03-01') / 1000
  const toArg = arg('to')
  const toSec = toArg ? Date.parse(toArg) / 1000 : Infinity
  const everyMinute = process.argv.includes('--every-minute')
  const out = arg('out') ?? 'public/replay/latest.json'

  const config = { ...getConfig(), paper: true } // replay never touches the exchange
  const tfSec = intervalToSeconds(config.timeframe)
  const trendSec = intervalToSeconds(config.trendTimeframe)
  const trendLimit = Math.min(config.trendEmaSlow * 2 + 50, 1000)

  const m1 = (await loadCandles(config.symbol, '1m', fromSec)).filter(c => c.time + 60 <= toSec)
  const tf = await loadCandles(config.symbol, config.timeframe, fromSec - 260 * tfSec)
  const trend = await loadCandles(config.symbol, config.trendTimeframe, fromSec - (trendLimit + 5) * trendSec)
  if (m1.length === 0) throw new Error('No 1m data in range')

  const state = createInitialState()
  state.config = config
  const executor = getExecutor(config.mode)
  const trades: ReplayTrade[] = []
  const equity: [number, number][] = [[m1[0].time, state.balance.total]]
  type OpenPos = { entryTime: number; entryPrice: number; stopLoss: number | null; takeProfit: number | null; side: string }
  let open = null as OpenPos | null

  let tfIdx = -1
  let trendIdx = -1
  let formOpen = -1
  // Holder object: TS loses track of a loop-reassigned `let` here.
  const agg: { form: Candle | null } = { form: null }
  let cycles = 0
  const started = Date.now()

  for (let i = 0; i < m1.length; i++) {
    const bar = m1[i]
    const t = bar.time + 60 // the cron "runs" when this 1m candle has closed
    const price = bar.close

    // Forming trading candle, aggregated from 1m candles (what Binance would return as the last kline).
    const fo = Math.floor(t / tfSec) * tfSec
    if (fo !== formOpen) {
      formOpen = fo
      agg.form = null
    }
    if (bar.time >= formOpen) {
      const prev = agg.form
      agg.form = prev
        ? { time: formOpen, open: prev.open, high: Math.max(prev.high, bar.high), low: Math.min(prev.low, bar.low), close: bar.close, volume: prev.volume + bar.volume }
        : { time: formOpen, open: bar.open, high: bar.high, low: bar.low, close: bar.close, volume: bar.volume }
    }

    // Fast-forward: flat and no candle closing now → nothing can happen this minute.
    const atCandleClose = t % tfSec === 0
    if (!everyMinute && !state.openPosition && !atCandleClose) continue

    tfIdx = advanceClosed(tf, tfSec, t, tfIdx)
    trendIdx = advanceClosed(trend, trendSec, t, trendIdx)
    if (tfIdx < 0) continue

    const forming: Candle = agg.form ?? { time: formOpen, open: price, high: price, low: price, close: price, volume: 0 }
    const candles = tf.slice(Math.max(0, tfIdx - 199), tfIdx + 1).concat(forming)
    const trendCandles = trendIdx >= 0 ? trend.slice(Math.max(0, trendIdx - trendLimit + 1), trendIdx + 1) : null

    const res = await runTradingCycle(state, { now: t * 1000, config, candles, trendCandles }, { executor })
    cycles++

    for (const ev of res.events) {
      if (ev.type === 'open') {
        open = {
          side: ev.trade.side, entryTime: t, entryPrice: ev.trade.entryPrice,
          stopLoss: ev.trade.stopLossPrice, takeProfit: ev.trade.takeProfitPrice,
        }
      } else if (open !== null) {
        const o: OpenPos = open
        trades.push({
          side: o.side, entryTime: o.entryTime, entryPrice: o.entryPrice, stopLoss: o.stopLoss, takeProfit: o.takeProfit,
          // Report the stop at entry (the trailing stop may have moved it).
          exitTime: t,
          exitPrice: ev.trade.exitPrice ?? price,
          exitReason: ev.reason,
          stake: ev.trade.stake,
          fees: ev.trade.fees ?? 0,
          pnl: ev.trade.pnl ?? 0,
        })
        equity.push([t, state.balance.total])
        open = null
      }
    }
  }

  // Metrics
  const wins = trades.filter(x => x.pnl > 0)
  const grossProfit = wins.reduce((a, x) => a + x.pnl, 0)
  const grossLoss = -trades.filter(x => x.pnl <= 0).reduce((a, x) => a + x.pnl, 0)
  let peak = equity[0][1]
  let maxDd = 0
  for (const [, e] of equity) { peak = Math.max(peak, e); maxDd = Math.max(maxDd, (peak - e) / peak * 100) }
  const firstPrice = m1[0].close
  const lastPrice = m1[m1.length - 1].close
  const metrics = {
    trades: trades.length,
    wins: wins.length,
    losses: trades.length - wins.length,
    winRate: trades.length ? wins.length / trades.length : 0,
    totalPnl: grossProfit - grossLoss,
    profitFactor: grossLoss > 0 ? grossProfit / grossLoss : 0,
    totalFees: trades.reduce((a, x) => a + x.fees, 0),
    maxDrawdownPct: maxDd,
    initialBalance: equity[0][1],
    finalBalance: state.balance.total,
    buyHoldReturnPct: (lastPrice - firstPrice) / firstPrice * 100,
    openPositionAtEnd: open,
  }

  // Compare with the bar-based backtest over the same period and data.
  const bt = runBacktest(config, tf.filter(c => c.time + tfSec <= m1[m1.length - 1].time + 60), trend, {
    tradingIntervalSec: tfSec, trendIntervalSec: trendSec,
  })
  const btTrades = bt.trades
    .map(x => ({ entryTime: x.time - x.barsHeld * tfSec + tfSec, exitReason: x.exitReason, pnl: x.netPnl }))
    .filter(x => x.entryTime >= m1[0].time)
  const replayEntries = new Set(trades.map(x => x.entryTime))
  const btEntries = new Set(btTrades.map(x => x.entryTime))
  const comparison = {
    backtestTrades: btTrades.length,
    backtestPnl: btTrades.reduce((a, x) => a + x.pnl, 0),
    matchedEntries: trades.filter(x => btEntries.has(x.entryTime)).length,
    onlyInReplay: trades.filter(x => !btEntries.has(x.entryTime)).map(x => x.entryTime),
    onlyInBacktest: btTrades.filter(x => !replayEntries.has(x.entryTime)).map(x => x.entryTime),
    differentExit: trades.filter(x => {
      const b = btTrades.find(y => y.entryTime === x.entryTime)
      return b && b.exitReason !== x.exitReason
    }).map(x => x.entryTime),
  }

  const report = {
    generatedAt: new Date().toISOString(),
    config: {
      symbol: config.symbol, mode: config.mode, timeframe: config.timeframe, trendTimeframe: config.trendTimeframe,
      trendEmaFast: config.trendEmaFast, trendEmaSlow: config.trendEmaSlow, signalRule: config.signalRule,
      signalAdxMin: config.signalAdxMin, signalSmaPeriod: config.signalSmaPeriod, slAtrMult: config.slAtrMult, tpAtrMult: config.tpAtrMult,
      trailingAtrMult: config.trailingAtrMult, feeRate: config.feeRate, stakeMode: config.stakeMode,
      stakeFixed: config.stakeFixed, stakePercent: config.stakePercent, maxPositionUsdt: config.maxPositionUsdt,
    },
    period: { from: m1[0].time, to: m1[m1.length - 1].time + 60, granularity: '1m', everyMinute },
    metrics,
    comparison,
    trades,
    equity,
    candles: tf.filter(c => c.time >= m1[0].time - 50 * tfSec && c.time <= m1[m1.length - 1].time)
      .map(c => [c.time, c.open, c.high, c.low, c.close]),
  }
  mkdirSync(dirname(out), { recursive: true })
  writeFileSync(out, JSON.stringify(report))

  const d = (s: number) => new Date(s * 1000).toISOString().slice(0, 16).replace('T', ' ')
  console.log(`\nReplay ${d(report.period.from)} → ${d(report.period.to)} | ${config.timeframe}/${config.trendTimeframe} ${config.signalRule} | ${cycles} ciclos en ${((Date.now() - started) / 1000).toFixed(1)}s`)
  for (const x of trades) {
    console.log(`${d(x.entryTime)} ${x.side} @${x.entryPrice.toFixed(0)}  →  ${d(x.exitTime)} ${x.exitReason.padEnd(5)} @${x.exitPrice.toFixed(0)}  pnl ${x.pnl >= 0 ? '+' : ''}${x.pnl.toFixed(2)}`)
  }
  console.log(`trades ${metrics.trades} | win ${(metrics.winRate * 100).toFixed(0)}% | pnl ${metrics.totalPnl.toFixed(2)} | PF ${metrics.profitFactor.toFixed(2)} | fees ${metrics.totalFees.toFixed(2)} | maxDD ${metrics.maxDrawdownPct.toFixed(2)}% | buy&hold ${metrics.buyHoldReturnPct.toFixed(1)}%`)
  console.log(`backtest: ${comparison.backtestTrades} trades, pnl ${comparison.backtestPnl.toFixed(2)} | entradas coincidentes ${comparison.matchedEntries} | solo replay ${comparison.onlyInReplay.length} | solo backtest ${comparison.onlyInBacktest.length} | salida distinta ${comparison.differentExit.length}`)
  console.log(`→ ${out}`)
}

main().catch(err => { console.error(err); process.exit(1) })
