import type { Candle, TrendDirection } from '@/types'
import { ema } from './indicators'

export function computeTrend(
  candles: Candle[],
  fastPeriod: number,
  slowPeriod: number,
): TrendDirection {
  if (candles.length < slowPeriod + 1) return 'SIDEWAYS'
  const closes = candles.map(c => c.close)
  const fast = ema(closes, fastPeriod)
  const slow = ema(closes, slowPeriod)
  const last = closes.length - 1
  const fastLast = fast[last]
  const slowLast = slow[last]
  if (!slowLast) return 'SIDEWAYS'
  if (fastLast > slowLast) return 'UP'
  if (fastLast < slowLast) return 'DOWN'
  return 'SIDEWAYS'
}
