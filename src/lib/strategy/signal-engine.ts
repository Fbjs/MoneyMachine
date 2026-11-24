import type { Signal, Indicators, TrendDirection, SignalAction, SignalRule } from '@/types'

export interface SignalOptions {
  rule?: SignalRule
  /** Minimum ADX for the adx_di rule. */
  adxMin?: number
}

/**
 * Entry signal from closed-candle indicators and the higher-timeframe trend.
 *
 * - `momentum` (legacy): trend + ADX >= 14 + RSI 30-70 + volatility; meant to be followed by aiFilter.
 * - `adx_di`: trend + ADX >= adxMin + DI alignment + close on the trend side of EMA50.
 *   Best of the walk-forward research on 4h/1d; does not use aiFilter.
 */
export function generateSignal(
  indicators: Indicators,
  trend: TrendDirection = 'SIDEWAYS',
  options: SignalOptions = {},
): Signal {
  const rule = options.rule ?? 'momentum'
  const { ema3, ema8, ema50, adx, rsi, plusDi, minusDi, volatilityRatio, close } = indicators
  let action: SignalAction = 'HOLD'
  let confidence = 0
  let reason = ''
  const trendNote = `trend ${trend}`
  const diag = `ADX=${adx.toFixed(1)}, RSI=${rsi.toFixed(1)}, +DI=${plusDi.toFixed(1)}, −DI=${minusDi.toFixed(1)}`

  if (rule === 'adx_di') {
    const adxMin = options.adxMin ?? 30
    const strong = adx >= adxMin
    if (strong && trend === 'UP' && plusDi > minusDi && close > ema50) {
      action = 'BUY'
    } else if (strong && trend === 'DOWN' && minusDi > plusDi && close < ema50) {
      action = 'SELL'
    }
    confidence = Math.min(1, adx / 50)
    reason = action === 'HOLD'
      ? `HOLD: ADX/DI not aligned (${trendNote}, ${diag}, ADX min ${adxMin})`
      : `ADX/DI ${action}: ${diag}, ${trendNote}`
  } else {
    const emaGap = ema8 === 0 ? 0 : Math.abs(ema3 - ema8) / ema8
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
      reason = `HOLD: no aligned signal (${trendNote}, ${diag})`
    }
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
