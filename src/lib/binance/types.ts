import type { Candle } from '@/types'

export interface BinanceKline {
  openTime: number
  open: string
  high: string
  low: string
  close: string
  volume: string
  closeTime: number
  quoteVolume: string
  trades: number
  takerBuyBaseVolume: string
  takerBuyQuoteVolume: string
}

export interface BinanceAccountInfo {
  balances: Array<{
    asset: string
    free: string
    locked: string
  }>
}

export interface BinanceOrderResult {
  symbol: string
  orderId: number
  clientOrderId: string
  transactTime: number
  price: string
  origQty: string
  executedQty: string
  cummulativeQuoteQty: string
  status: string
  type: string
  side: string
  fills?: Array<{
    price: string
    qty: string
    commission: string
    commissionAsset: string
  }>
}

export function parseKline(k: any[]): Candle {
  return {
    time: Math.floor(Number(k[0]) / 1000),
    open: parseFloat(k[1]),
    high: parseFloat(k[2]),
    low: parseFloat(k[3]),
    close: parseFloat(k[4]),
    volume: parseFloat(k[5]),
  }
}

const INTERVAL_UNITS: Record<string, number> = { m: 60, h: 3600, d: 86400, w: 604800, M: 2592000 }

/** Binance interval string ("1m", "4h", "1d", ...) to seconds. */
export function intervalToSeconds(interval: string): number {
  const match = /^(\d+)([mhdwM])$/.exec(interval)
  if (!match) throw new Error(`Unsupported interval: ${interval}`)
  return parseInt(match[1], 10) * INTERVAL_UNITS[match[2]]
}

/** Drop candles that have not closed yet (Binance returns the forming candle last). */
export function closedCandles(candles: Candle[], intervalSec: number, nowMs = Date.now()): Candle[] {
  return candles.filter(c => (c.time + intervalSec) * 1000 <= nowMs)
}
