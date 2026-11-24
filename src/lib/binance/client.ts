import type { BinanceAccountInfo, BinanceOrderResult } from './types'
import { getEnv } from '@/lib/config'

export interface SymbolFilters {
  baseAsset: string
  quoteAsset: string
  stepSize: number
  stepDecimals: number
  minQty: number
  minNotional: number
}

function decimalsOf(step: string): number {
  const trimmed = step.replace(/0+$/, '')
  const dot = trimmed.indexOf('.')
  return dot === -1 ? 0 : trimmed.length - dot - 1
}

/** Round a quantity DOWN to the symbol's LOT_SIZE step and format it for the API. */
export function formatQuantity(qty: number, filters: SymbolFilters): string {
  const steps = Math.floor(qty / filters.stepSize + 1e-9)
  return (steps * filters.stepSize).toFixed(filters.stepDecimals)
}

interface ExchangeFilter {
  filterType: string
  stepSize?: string
  minQty?: string
  minNotional?: string
}

interface ExchangeInfo {
  symbols: Array<{ baseAsset: string; quoteAsset: string; filters: ExchangeFilter[] }>
}

class BinanceClient {
  private apiKey: string
  private secretKey: string
  private baseUrl = 'https://api.binance.com'
  private filtersCache = new Map<string, SymbolFilters>()

  constructor() {
    const env = getEnv()
    this.apiKey = env.BINANCE_API_KEY
    this.secretKey = env.BINANCE_SECRET_KEY
  }

  private async sign(queryString: string): Promise<string> {
    const encoder = new TextEncoder()
    const key = await crypto.subtle.importKey(
      'raw', encoder.encode(this.secretKey),
      { name: 'HMAC', hash: 'SHA-256' },
      false, ['sign']
    )
    const signature = await crypto.subtle.sign(
      'HMAC', key, encoder.encode(queryString)
    )
    return Array.from(new Uint8Array(signature))
      .map(b => b.toString(16).padStart(2, '0'))
      .join('')
  }

  private async request<T>(endpoint: string, params?: Record<string, string>): Promise<T> {
    const url = new URL(`${this.baseUrl}${endpoint}`)
    if (params) {
      Object.entries(params).forEach(([k, v]) => url.searchParams.set(k, v))
    }
    const headers: Record<string, string> = {}
    if (this.apiKey) {
      headers['X-MBX-APIKEY'] = this.apiKey
    }
    const res = await fetch(url.toString(), { headers })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Binance API error ${res.status}: ${text}`)
    }
    return res.json()
  }

  private async signedRequest<T>(
    method: 'GET' | 'POST' | 'DELETE',
    endpoint: string,
    params: Record<string, string>,
  ): Promise<T> {
    const allParams: Record<string, string> = {
      ...params,
      recvWindow: '5000',
      timestamp: Date.now().toString(),
    }
    const queryString = new URLSearchParams(allParams).toString()
    const signature = await this.sign(queryString)
    const url = `${this.baseUrl}${endpoint}?${queryString}&signature=${signature}`
    const res = await fetch(url, {
      method,
      headers: { 'X-MBX-APIKEY': this.apiKey },
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`Binance API error ${res.status}: ${text}`)
    }
    return res.json()
  }

  async getKlines(symbol: string, interval: string, limit = 100): Promise<any[][]> {
    return this.request<any[][]>('/api/v3/klines', {
      symbol,
      interval,
      limit: limit.toString(),
    })
  }

  async getPrice(symbol: string): Promise<{ price: string }> {
    return this.request<{ symbol: string; price: string }>('/api/v3/ticker/price', { symbol })
  }

  async getSymbolFilters(symbol: string): Promise<SymbolFilters> {
    const cached = this.filtersCache.get(symbol)
    if (cached) return cached

    const info = await this.request<ExchangeInfo>('/api/v3/exchangeInfo', { symbol })
    const s = info.symbols?.[0]
    if (!s) throw new Error(`Symbol ${symbol} not found in exchangeInfo`)

    const lot = s.filters.find(f => f.filterType === 'LOT_SIZE')
    const marketLot = s.filters.find(f => f.filterType === 'MARKET_LOT_SIZE')
    const notional = s.filters.find(f => f.filterType === 'NOTIONAL' || f.filterType === 'MIN_NOTIONAL')
    if (!lot?.stepSize || !lot.minQty) throw new Error(`LOT_SIZE filter missing for ${symbol}`)

    // MARKET_LOT_SIZE may report stepSize "0.00000000" meaning "use LOT_SIZE".
    const marketStepStr = marketLot?.stepSize
    const stepStr = marketStepStr && parseFloat(marketStepStr) > 0 ? marketStepStr : lot.stepSize
    const filters: SymbolFilters = {
      baseAsset: s.baseAsset,
      quoteAsset: s.quoteAsset,
      stepSize: parseFloat(stepStr),
      stepDecimals: decimalsOf(stepStr),
      minQty: Math.max(parseFloat(lot.minQty), parseFloat(marketLot?.minQty ?? '0')),
      minNotional: parseFloat(notional?.minNotional ?? '0'),
    }
    this.filtersCache.set(symbol, filters)
    return filters
  }

  async getAccount(): Promise<BinanceAccountInfo> {
    return this.signedRequest<BinanceAccountInfo>('GET', '/api/v3/account', {
      omitZeroBalances: 'true',
    })
  }

  async getFreeBalance(asset: string): Promise<number> {
    const account = await this.getAccount()
    const bal = account.balances.find(b => b.asset === asset)
    return bal ? parseFloat(bal.free) : 0
  }

  async marketBuy(symbol: string, quoteQuantity: string): Promise<BinanceOrderResult> {
    return this.signedRequest<BinanceOrderResult>('POST', '/api/v3/order', {
      symbol,
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: quoteQuantity,
      newOrderRespType: 'FULL',
    })
  }

  async marketSell(symbol: string, quantity: string): Promise<BinanceOrderResult> {
    return this.signedRequest<BinanceOrderResult>('POST', '/api/v3/order', {
      symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity,
      newOrderRespType: 'FULL',
    })
  }

  hasCredentials(): boolean {
    return !!(this.apiKey && this.secretKey)
  }
}

export const binanceClient = new BinanceClient()

/** Average fill price of an executed order. */
export function avgFillPrice(order: BinanceOrderResult): number {
  const qty = parseFloat(order.executedQty)
  const quote = parseFloat(order.cummulativeQuoteQty)
  return qty > 0 ? quote / qty : 0
}

/** Commission paid in a given asset across all fills. */
export function commissionIn(order: BinanceOrderResult, asset: string): number {
  return (order.fills ?? [])
    .filter(f => f.commissionAsset === asset)
    .reduce((acc, f) => acc + parseFloat(f.commission), 0)
}
