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
