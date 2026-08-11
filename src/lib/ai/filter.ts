import type { Signal } from '@/types'

export interface AiFilterResult {
  passed: boolean
  score: number
}

export function aiFilter(signal: Signal): AiFilterResult {
  const { indicators } = signal
  const { ema3, ema8, adx, rsi } = indicators

  const emaGapRatio = ema8 === 0 ? 0 : Math.min(1, Math.abs(ema3 - ema8) / ema8)
  const adxScore = Math.min(1, adx / 40)
  const volatilityScore = Math.min(1, indicators.volatilityRatio)
  const rsiMomentum = Math.abs(50 - rsi) / 50

  const score = (
    emaGapRatio * 0.20 +
    adxScore * 0.40 +
    volatilityScore * 0.20 +
    rsiMomentum * 0.20
  )

  return {
    passed: score >= 0.60,
    score: parseFloat(score.toFixed(4)),
  }
}
