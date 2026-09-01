import { NextResponse } from 'next/server'
import { getConfig } from '@/lib/config'
import { binanceClient } from '@/lib/binance/client'
import { parseKline } from '@/lib/binance/types'
import { runBacktest } from '@/lib/backtest/engine'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(request: Request) {
  const config = getConfig()
  const url = new URL(request.url)
  const limit = Math.min(parseInt(url.searchParams.get('limit') || '1000', 10), 1000)
  const symbol = url.searchParams.get('symbol') || config.symbol
  const timeframe = url.searchParams.get('timeframe') || config.timeframe
  const trendTimeframe = url.searchParams.get('trendTimeframe') || config.trendTimeframe

  try {
    const tradingKlines = await binanceClient.getKlines(symbol, timeframe, limit)
    const tradingCandles = tradingKlines.map(parseKline)

    const trendLimit = Math.min(config.trendEmaSlow + 50, 1000)
    const trendKlines = await binanceClient.getKlines(symbol, trendTimeframe, trendLimit)
    const trendCandles = trendKlines.map(parseKline)

    const result = runBacktest(config, tradingCandles, trendCandles)
    result.config.symbol = symbol
    result.config.timeframe = timeframe
    result.config.trendTimeframe = trendTimeframe
    return NextResponse.json(result)
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 500 })
  }
}
