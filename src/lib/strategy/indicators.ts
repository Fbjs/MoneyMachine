import type { Indicators, Candle } from '@/types'

export function ema(data: number[], period: number): number[] {
  const k = 2 / (period + 1)
  const result: number[] = []
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      sum += data[i]
      result.push(i === period - 1 ? sum / period : 0)
    } else {
      result.push(data[i] * k + result[i - 1] * (1 - k))
    }
  }
  return result
}

export function atr(candles: Candle[], period: number): number[] {
  const tr: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low)
    } else {
      const prev = candles[i - 1]
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prev.close),
        Math.abs(candles[i].low - prev.close)
      ))
    }
  }
  const k = 2 / (period + 1)
  const result: number[] = []
  let sum = 0
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      sum += tr[i]
      result.push(i === period - 1 ? sum / period : 0)
    } else {
      result.push(tr[i] * k + result[i - 1] * (1 - k))
    }
  }
  return result
}

export function adx(candles: Candle[], period: number): number[] {
  const tr: number[] = []
  const plusDM: number[] = []
  const minusDM: number[] = []
  for (let i = 0; i < candles.length; i++) {
    if (i === 0) {
      tr.push(candles[i].high - candles[i].low)
      plusDM.push(0)
      minusDM.push(0)
    } else {
      const prev = candles[i - 1]
      tr.push(Math.max(
        candles[i].high - candles[i].low,
        Math.abs(candles[i].high - prev.close),
        Math.abs(candles[i].low - prev.close)
      ))
      const upMove = candles[i].high - prev.high
      const downMove = prev.low - candles[i].low
      plusDM.push(upMove > downMove && upMove > 0 ? upMove : 0)
      minusDM.push(downMove > upMove && downMove > 0 ? downMove : 0)
    }
  }
  const k = 2 / (period + 1)
  const atrVals: number[] = []
  const plusSmooth: number[] = []
  const minusSmooth: number[] = []
  let sumTR = 0, sumPlus = 0, sumMinus = 0
  for (let i = 0; i < tr.length; i++) {
    if (i < period) {
      sumTR += tr[i]
      sumPlus += plusDM[i]
      sumMinus += minusDM[i]
      atrVals.push(i === period - 1 ? sumTR / period : 0)
      plusSmooth.push(i === period - 1 ? sumPlus / period : 0)
      minusSmooth.push(i === period - 1 ? sumMinus / period : 0)
    } else {
      atrVals.push(tr[i] * k + atrVals[i - 1] * (1 - k))
      plusSmooth.push(plusDM[i] * k + plusSmooth[i - 1] * (1 - k))
      minusSmooth.push(minusDM[i] * k + minusSmooth[i - 1] * (1 - k))
    }
  }
  const dx: number[] = []
  for (let i = 0; i < atrVals.length; i++) {
    if (atrVals[i] === 0 || i < period) {
      dx.push(0)
    } else {
      const pdi = (plusSmooth[i] / atrVals[i]) * 100
      const mdi = (minusSmooth[i] / atrVals[i]) * 100
      const diff = Math.abs(pdi - mdi)
      const sum = pdi + mdi
      dx.push(sum === 0 ? 0 : (diff / sum) * 100)
    }
  }
  const adxVals: number[] = []
  let sumDX = 0
  for (let i = 0; i < dx.length; i++) {
    if (i < period * 2) {
      sumDX += dx[i]
      adxVals.push(i === period * 2 - 1 ? sumDX / period : 0)
    } else {
      adxVals.push((dx[i] * k + adxVals[i - 1] * (1 - k)))
    }
  }
  return adxVals
}

export function rsi(data: number[], period: number): number[] {
  const result: number[] = new Array(data.length).fill(0)
  const gains: number[] = []
  const losses: number[] = []

  for (let i = 1; i < data.length; i++) {
    const diff = data[i] - data[i - 1]
    gains.push(diff > 0 ? diff : 0)
    losses.push(diff < 0 ? -diff : 0)
  }

  if (gains.length < period) return result

  let avgGain = 0
  let avgLoss = 0

  for (let i = 0; i < period; i++) {
    avgGain += gains[i]
    avgLoss += losses[i]
  }

  avgGain /= period
  avgLoss /= period

  const rs0 = avgLoss === 0 ? Infinity : avgGain / avgLoss
  result[period] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs0)

  for (let i = period + 1; i < data.length; i++) {
    const gain = gains[i - 1]
    const loss = losses[i - 1]
    avgGain = (avgGain * (period - 1) + gain) / period
    avgLoss = (avgLoss * (period - 1) + loss) / period
    const rs = avgLoss === 0 ? Infinity : avgGain / avgLoss
    result[i] = avgLoss === 0 ? 100 : 100 - 100 / (1 + rs)
  }

  return result
}

export function computeIndicators(candles: Candle[]): Indicators | null {
  if (candles.length < 60) return null
  const closes = candles.map(c => c.close)
  const ema3Vals = ema(closes, 3)
  const ema8Vals = ema(closes, 8)
  const ema50Vals = ema(closes, 50)
  const atrVals = atr(candles, 14)
  const adxVals = adx(candles, 14)
  const rsiVals = rsi(closes, 14)
  const last = candles.length - 1
  const currentPrice = candles[last].close
  const avgPrice = (candles[last].high + candles[last].low + candles[last].close) / 3
  return {
    ema3: ema3Vals[last],
    ema8: ema8Vals[last],
    ema50: ema50Vals[last],
    atr: atrVals[last],
    adx: adxVals[last],
    rsi: rsiVals[last],
    volatilityRatio: avgPrice === 0 ? 0 : (atrVals[last] / avgPrice) * 1000,
  }
}
