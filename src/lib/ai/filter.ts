import type { Signal } from '@/types'

export interface AiFilterResult {
  passed: boolean
  score: number
}

export function aiFilter(signal: Signal): AiFilterResult {
  const { indicators, confidence } = signal
  const { ema3, ema8, atr, adx, rsi } = indicators

  const emaGapRatio = ema8 === 0 ? 0 : Math.min(1, Math.abs(ema3 - ema8) / ema8)
  const adxScore = Math.min(1, adx / 40)
  const volatilityScore = Math.min(1, atr / indicators.volatilityRatio || 0)
  const rsiNeutrality = 1 - Math.abs(50 - rsi) / 50

  const score = (
    emaGapRatio * 0.30 +
    adxScore * 0.30 +
    volatilityScore * 0.20 +
    rsiNeutrality * 0.20
  )

  return {
    passed: score >= 0.75,
    score: parseFloat(score.toFixed(4)),
  }
}
