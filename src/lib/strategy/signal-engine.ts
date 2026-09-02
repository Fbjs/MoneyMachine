import type { Signal, Indicators, TrendDirection } from '@/types'
import type { SignalAction } from '@/types'

export function generateSignal(indicators: Indicators, trend: TrendDirection = 'SIDEWAYS'): Signal {
  const { ema3, ema8, ema50, adx, rsi, plusDi, minusDi, volatilityRatio } = indicators
  const currentPrice = ema3
  let action: SignalAction = 'HOLD'
  let confidence = 0
  const emaGap = ema8 === 0 ? 0 : Math.abs(ema3 - ema8) / ema8
  let reason = ''

  const hasMomentum = volatilityRatio >= 0.4 && adx >= 14 && rsi > 30 && rsi < 70

  if (hasMomentum && trend === 'UP') {
    action = 'BUY'
    confidence = Math.min(1, emaGap * 5 + adx / 100)
    reason = `Momentum UP: ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}, trend UP`
  } else if (hasMomentum && trend === 'DOWN') {
    action = 'SELL'
    confidence = Math.min(1, emaGap * 5 + adx / 100)
    reason = `Momentum DOWN: ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}, trend DOWN`
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
