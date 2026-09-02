import type { Signal, Indicators, TrendDirection } from '@/types'
import type { SignalAction } from '@/types'

export function generateSignal(indicators: Indicators, trend: TrendDirection = 'SIDEWAYS'): Signal {
  const { ema3, ema8, ema50, adx, rsi, plusDi, minusDi, volatilityRatio } = indicators
  const currentPrice = ema3
  let action: SignalAction = 'HOLD'
  let confidence = 0
  const emaGap = ema8 === 0 ? 0 : Math.abs(ema3 - ema8) / ema8
  let reason = ''

  const bullish = ema3 > ema8 && volatilityRatio >= 0.4 && adx >= 18 && rsi < 70
  const bearish = ema3 < ema8 && volatilityRatio >= 0.4 && adx >= 18 && rsi > 30

  if (bullish && trend === 'UP') {
    action = 'BUY'
    confidence = Math.min(1, emaGap * 5 + adx / 100)
    reason = `Bullish: EMA3>EMA8, trend UP, ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}`
  } else if (bearish && trend === 'DOWN') {
    action = 'SELL'
    confidence = Math.min(1, emaGap * 5 + adx / 100)
    reason = `Bearish: EMA3<EMA8, trend DOWN, ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}`
  } else {
    const trendNote = trend === 'UP' ? 'trend UP' : trend === 'DOWN' ? 'trend DOWN' : 'trend SIDEWAYS'
    reason = `HOLD: no aligned signal (trend=${trendNote}, ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}, +DI=${plusDi.toFixed(1)}, −DI=${minusDi.toFixed(1)})`
  }

  return {
    action,
    confidence: parseFloat(confidence.toFixed(4)),
    indicators,
    timestamp: Date.now(),
    reason,
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
