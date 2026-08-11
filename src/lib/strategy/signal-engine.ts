import type { Signal, Indicators } from '@/types'
import type { SignalAction } from '@/types'

export function generateSignal(indicators: Indicators): Signal {
  const { ema3, ema8, ema50, adx, rsi, atr, volatilityRatio } = indicators
  const currentPrice = ema3
  let action: SignalAction = 'HOLD'
  let confidence = 0
  const emaGap = ema8 === 0 ? 0 : Math.abs(ema3 - ema8) / ema8
  let reason = ''

  const bullish = ema3 > ema8 && currentPrice > ema50 && volatilityRatio >= 0.4 && adx >= 22 && rsi < 70
  const bearish = ema3 < ema8 && currentPrice < ema50 && volatilityRatio >= 0.4 && adx >= 22 && rsi > 30

  if (bullish) {
    action = 'BUY'
    confidence = Math.min(1, emaGap * 5 + adx / 100)
    reason = `Bullish: EMA3>EMA8, price>EMA50, ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}`
  } else if (bearish) {
    action = 'SELL'
    confidence = Math.min(1, emaGap * 5 + adx / 100)
    reason = `Bearish: EMA3<EMA8, price<EMA50, ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}`
  } else {
    reason = `HOLD: no clear signal (ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}, VR=${volatilityRatio.toFixed(2)}, minADX=22)`
  }

  return {
    action,
    confidence: parseFloat(confidence.toFixed(4)),
    indicators,
    timestamp: Date.now(),
  }
}

export function signalToSide(signal: SignalAction, mode: string): string {
  if (mode === 'binary') {
    return signal === 'BUY' ? 'CALL' : signal === 'SELL' ? 'PUT' : 'HOLD'
  }
  if (mode === 'futures') {
    return signal === 'BUY' ? 'LONG' : signal === 'SELL' ? 'SHORT' : 'HOLD'
  }
  return signal
}
