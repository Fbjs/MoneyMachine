import type { BinanceAccountInfo, BinanceOrderResult } from './types'
import { getEnv } from '@/lib/config'

class BinanceClient {
  private apiKey: string
  private secretKey: string
  private baseUrl = 'https://api.binance.com'

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
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
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

  private async signedRequest<T>(endpoint: string, params: Record<string, string>): Promise<T> {
    const timestamp = Date.now().toString()
    const allParams: Record<string, string> = { ...params, timestamp }
    const queryString = Object.entries(allParams)
      .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
      .join('&')
    allParams['signature'] = await this.sign(queryString)
    const url = new URL(`${this.baseUrl}${endpoint}`)
    Object.entries(allParams).forEach(([k, v]) => url.searchParams.set(k, v))
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-MBX-APIKEY': this.apiKey,
    }
    const res = await fetch(url.toString(), { headers })
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

  async getAccount(): Promise<BinanceAccountInfo> {
    return this.signedRequest<BinanceAccountInfo>('/api/v3/account', {})
  }

  async marketBuy(symbol: string, quoteQuantity: string): Promise<BinanceOrderResult> {
    return this.signedRequest<BinanceOrderResult>('/api/v3/order', {
      symbol,
      side: 'BUY',
      type: 'MARKET',
      quoteOrderQty: quoteQuantity,
    })
  }

  async marketSell(symbol: string, quantity: string): Promise<BinanceOrderResult> {
    return this.signedRequest<BinanceOrderResult>('/api/v3/order', {
      symbol,
      side: 'SELL',
      type: 'MARKET',
      quantity,
    })
  }

  hasCredentials(): boolean {
    return !!(this.apiKey && this.secretKey)
  }
}

export const binanceClient = new BinanceClient()
