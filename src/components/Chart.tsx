'use client'

import { useEffect, useRef } from 'react'
import type { Candle } from '@/types'
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type UTCTimestamp,
} from 'lightweight-charts'

interface Props {
  candles: Candle[]
}

function emaSeries(data: number[], period: number): (number | null)[] {
  const k = 2 / (period + 1)
  const result: (number | null)[] = []
  let sum = 0
  for (let i = 0; i < data.length; i++) {
    if (i < period) {
      sum += data[i]
      result.push(i === period - 1 ? sum / period : null)
    } else {
      const prev = result[i - 1]
      result.push(prev !== null ? data[i] * k + prev * (1 - k) : null)
    }
  }
  return result
}

function toLineData(candles: Candle[], values: (number | null)[]): LineData[] {
  const out: LineData[] = []
  for (let i = 0; i < candles.length; i++) {
    const v = values[i]
    if (v !== null) out.push({ time: candles[i].time as UTCTimestamp, value: v })
  }
  return out
}

export default function Chart({ candles }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const chartRef = useRef<IChartApi | null>(null)
  const candleRef = useRef<ISeriesApi<'Candlestick'> | null>(null)
  const ema3Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema8Ref = useRef<ISeriesApi<'Line'> | null>(null)
  const ema50Ref = useRef<ISeriesApi<'Line'> | null>(null)

  useEffect(() => {
    if (!containerRef.current) return
    const chart = createChart(containerRef.current, {
      layout: {
        background: { color: '#09090b' },
        textColor: '#a1a1aa',
      },
      grid: {
        vertLines: { color: '#18181b' },
        horzLines: { color: '#18181b' },
      },
      crosshair: { mode: 0 },
      timeScale: {
        borderColor: '#27272a',
        timeVisible: true,
        secondsVisible: false,
        tickMarkFormatter: (time: number) => {
          return new Date(time * 1000).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
        },
      },
      rightPriceScale: {
        borderColor: '#27272a',
      },
      autoSize: true,
    })

    chartRef.current = chart

    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#22c55e',
      downColor: '#ef4444',
      borderDownColor: '#ef4444',
      borderUpColor: '#22c55e',
      wickDownColor: '#ef4444',
      wickUpColor: '#22c55e',
    })
    candleRef.current = candleSeries

    const ema3Series = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 2 })
    const ema8Series = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 2 })
    const ema50Series = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 2 })
    ema3Ref.current = ema3Series
    ema8Ref.current = ema8Series
    ema50Ref.current = ema50Series

    return () => {
      chart.remove()
    }
  }, [])

  useEffect(() => {
    if (!candleRef.current || candles.length === 0) return

    const cd: CandlestickData[] = candles.map((c) => ({
      time: c.time as UTCTimestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
    candleRef.current.setData(cd)

    const closes = candles.map((c) => c.close)
    ema3Ref.current?.setData(toLineData(candles, emaSeries(closes, 3)))
    ema8Ref.current?.setData(toLineData(candles, emaSeries(closes, 8)))
    ema50Ref.current?.setData(toLineData(candles, emaSeries(closes, 50)))

    chartRef.current?.timeScale().fitContent()
  }, [candles])

  return (
    <div
      ref={containerRef}
      className="w-full rounded-lg overflow-hidden"
      style={{ height: 400, minHeight: 400 }}
    />
  )
}
