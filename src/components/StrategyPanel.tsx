'use client'

import type { Signal, Indicators, BotConfig, TrendDirection } from '@/types'

interface Props {
  lastSignal: Signal | null
  indicators: Indicators | null
  config: BotConfig
  trend: TrendDirection
  openPosition: boolean
}

export default function StrategyPanel({ lastSignal, indicators, config, trend, openPosition }: Props) {
  const getSignalColor = (action: string) => {
    switch (action) {
      case 'BUY': case 'CALL': case 'LONG': return 'text-green-400'
      case 'SELL': case 'PUT': case 'SHORT': return 'text-red-400'
      default: return 'text-zinc-500'
    }
  }

  const getSignalBg = (action: string) => {
    switch (action) {
      case 'BUY': case 'CALL': case 'LONG': return 'bg-green-900/30 border-green-700'
      case 'SELL': case 'PUT': case 'SHORT': return 'bg-red-900/30 border-red-700'
      default: return 'bg-zinc-900 border-zinc-700'
    }
  }

  const trendLabel = trend === 'UP' ? 'ALCISTA' : trend === 'DOWN' ? 'BAJISTA' : 'LATERAL'
  const trendColor = trend === 'UP' ? 'text-green-400 bg-green-900/30 border-green-700' : trend === 'DOWN' ? 'text-red-400 bg-red-900/30 border-red-700' : 'text-zinc-400 bg-zinc-800/50 border-zinc-700'

  return (
    <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
      <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Strategy</h3>

      <div className="flex items-center justify-between mb-3">
        <span className="text-xs text-zinc-500">Tendencia</span>
        <span className={`text-xs font-semibold px-2 py-0.5 rounded border ${trendColor}`}>{trendLabel}</span>
      </div>

      {lastSignal ? (
        <div className={`p-3 rounded-lg border mb-3 ${getSignalBg(lastSignal.action)}`}>
          <div className="flex items-center justify-between">
            <span className={`text-xl font-bold ${getSignalColor(lastSignal.action)}`}>
              {lastSignal.action}
            </span>
            <span className="text-sm text-zinc-400">
              {(lastSignal.confidence * 100).toFixed(1)}%
            </span>
          </div>
          {lastSignal.reason && (
            <div className="mt-2 text-xs text-zinc-500 leading-relaxed">{lastSignal.reason}</div>
          )}
        </div>
      ) : (
        <div className="p-3 rounded-lg border border-zinc-700 bg-zinc-800/50 mb-3">
          <span className="text-zinc-500">Waiting for signal...</span>
        </div>
      )}

      {indicators && (
        <div className="space-y-2 text-sm">
          <div className="flex justify-between"><span className="text-zinc-500">EMA 3 / 8 / 50</span><span className="font-mono">{indicators.ema3.toFixed(1)} / {indicators.ema8.toFixed(1)} / {indicators.ema50.toFixed(1)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">ATR (14)</span><span className="font-mono">{indicators.atr.toFixed(2)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">ADX (14)</span><span className="font-mono">{indicators.adx.toFixed(1)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">+DI / −DI</span><span className="font-mono">{indicators.plusDi.toFixed(1)} / {indicators.minusDi.toFixed(1)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">RSI (14)</span><span className="font-mono">{indicators.rsi.toFixed(1)}</span></div>
          <div className="flex justify-between"><span className="text-zinc-500">Vol Ratio</span><span className="font-mono">{indicators.volatilityRatio.toFixed(4)}</span></div>
        </div>
      )}

      <div className="mt-3 pt-3 border-t border-zinc-800 text-xs text-zinc-600 space-y-1">
        <div>Mode: <span className="text-zinc-400">{config.mode}</span></div>
        <div>Paper: <span className="text-zinc-400">{config.paper ? 'Yes' : 'No'}</span></div>
        <div>Stake: <span className="text-zinc-400">{config.stakeMode === 'fixed' ? `$${config.stakeFixed}` : `${config.stakePercent}%`}</span></div>
        <div>Timeframe: <span className="text-zinc-400">{config.timeframe} / {config.trendTimeframe}</span></div>
        <div>Fee: <span className="text-zinc-400">{(config.feeRate * 100).toFixed(2)}%</span></div>
        <div>SL / TP: <span className="text-zinc-400">{config.slAtrMult}× / {config.tpAtrMult}× ATR</span></div>
        <div>Position: <span className={openPosition ? 'text-yellow-400' : 'text-zinc-500'}>{openPosition ? 'OPEN' : 'NONE'}</span></div>
      </div>
    </div>
  )
}
