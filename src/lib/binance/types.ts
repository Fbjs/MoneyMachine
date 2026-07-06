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

export function parseKline(k: BinanceKline): Candle {
  return {
    time: Math.floor(k.openTime / 1000),
    open: parseFloat(k.open),
    high: parseFloat(k.high),
    low: parseFloat(k.low),
    close: parseFloat(k.close),
    volume: parseFloat(k.volume),
  }
}
