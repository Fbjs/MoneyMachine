import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { binanceClient } from '@/lib/binance/client'
import { parseKline, intervalToSeconds, closedCandles } from '@/lib/binance/types'
import { runBacktest } from '@/lib/backtest/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const MAX_TRADING_CANDLES = 5000
const MAX_TREND_CANDLES = 5000

export async function GET(request: Request) {
  const config = getConfig()
  const url = new URL(request.url)
  const requested = parseInt(url.searchParams.get('limit') || '1000', 10)
  const limit = Math.min(Math.max(Number.isNaN(requested) ? 1000 : requested, 100), MAX_TRADING_CANDLES)
  const symbol = url.searchParams.get('symbol') || config.symbol
  const timeframe = url.searchParams.get('timeframe') || config.timeframe
  const trendTimeframe = url.searchParams.get('trendTimeframe') || config.trendTimeframe

  try {
    const tradingSec = intervalToSeconds(timeframe)
    const trendSec = intervalToSeconds(trendTimeframe)

    // +1 because the last kline is the still-forming candle and gets dropped.
    const tradingKlines = await binanceClient.getKlinesHistory(symbol, timeframe, limit + 1)
    const tradingCandles = closedCandles(tradingKlines.map(parseKline), tradingSec)
    if (tradingCandles.length < 100) {
      return NextResponse.json({ error: 'Not enough trading candles' }, { status: 400 })
    }

    // Cover the whole trading window plus a warmup long enough for the slow EMA to converge.
    const windowSec = tradingCandles.length * tradingSec
    const trendWarmup = config.trendEmaSlow * 2
    const trendNeeded = Math.ceil(windowSec / trendSec) + trendWarmup + 2
    const trendLimit = Math.min(trendNeeded, MAX_TREND_CANDLES)
    const trendKlines = await binanceClient.getKlinesHistory(symbol, trendTimeframe, trendLimit)
    const trendCandles = closedCandles(trendKlines.map(parseKline), trendSec)

    const result = runBacktest(config, tradingCandles, trendCandles, {
      tradingIntervalSec: tradingSec,
      trendIntervalSec: trendSec,
    })
    result.config.symbol = symbol
    result.config.timeframe = timeframe
    result.config.trendTimeframe = trendTimeframe

    const warnings: string[] = []
    if (trendLimit < trendNeeded) {
      warnings.push(`Trend history capped at ${trendLimit} candles (needed ${trendNeeded}); early bars may lack a trend`)
    }
    if (result.meta.barsWithoutTrend > 0) {
      warnings.push(`${result.meta.barsWithoutTrend} of ${result.meta.barsEvaluated} bars had no usable trend (EMA warmup)`)
    }

    return NextResponse.json({ ...result, warnings })
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : String(err) }, { status: 500 })
  }
}
