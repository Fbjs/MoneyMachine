'use client'

import { useEffect, useRef } from 'react'
import type { Candle } from '@/types'
import { createChart, CandlestickSeries, LineSeries, type IChartApi, type ISeriesApi, type CandlestickData, type LineData } from 'lightweight-charts'

interface Props {
  candles: Candle[]
  ema3?: number
  ema8?: number
  ema50?: number
}

export default function Chart({ candles, ema3, ema8, ema50 }: Props) {
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
        background: { color: '#0a0a0a' },
        textColor: '#888',
      },
      grid: {
        vertLines: { color: '#1a1a1a' },
        horzLines: { color: '#1a1a1a' },
      },
      width: containerRef.current.clientWidth,
      height: 400,
      crosshair: { mode: 0 },
      timeScale: {
        borderColor: '#333',
        timeVisible: true,
      },
      rightPriceScale: {
        borderColor: '#333',
      },
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

    const ema3Series = chart.addSeries(LineSeries, { color: '#3b82f6', lineWidth: 1 })
    const ema8Series = chart.addSeries(LineSeries, { color: '#a855f7', lineWidth: 1 })
    const ema50Series = chart.addSeries(LineSeries, { color: '#f59e0b', lineWidth: 1 })
    ema3Ref.current = ema3Series
    ema8Ref.current = ema8Series
    ema50Ref.current = ema50Series

    chart.timeScale().fitContent()

    return () => {
      chart.remove()
    }
  }, [])

  useEffect(() => {
    if (!candleRef.current || candles.length === 0) return
    const cd: CandlestickData[] = candles.map(c => ({
      time: c.time as any,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }))
    candleRef.current.setData(cd)
  }, [candles])

  useEffect(() => {
    if (!ema3Ref.current || !ema3 || candles.length === 0) return
    const data: LineData[] = candles.map(c => ({
      time: c.time as any,
      value: ema3,
    }))
    ema3Ref.current.setData(data)
  }, [candles, ema3])

  useEffect(() => {
    if (!ema8Ref.current || !ema8 || candles.length === 0) return
    const data: LineData[] = candles.map(c => ({
      time: c.time as any,
      value: ema8,
    }))
    ema8Ref.current.setData(data)
  }, [candles, ema8])

  useEffect(() => {
    if (!ema50Ref.current || !ema50 || candles.length === 0) return
    const data: LineData[] = candles.map(c => ({
      time: c.time as any,
      value: ema50,
    }))
    ema50Ref.current.setData(data)
  }, [candles, ema50])

  return <div ref={containerRef} className="w-full rounded-lg overflow-hidden" />
}
