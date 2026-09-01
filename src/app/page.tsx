'use client'

import useSWR from 'swr'
import Chart from '@/components/Chart'
import MetricsBar from '@/components/MetricsBar'
import StrategyPanel from '@/components/StrategyPanel'
import PositionCard from '@/components/PositionCard'
import TradeHistory from '@/components/TradeHistory'
import type { BotState } from '@/types'

const fetcher = (url: string) => fetch(url).then(r => r.json())

export default function Home() {
  const { data, error, isLoading } = useSWR<BotState>('/api/data', fetcher, {
    refreshInterval: 5000,
  })

  return (
    <div className="flex flex-col min-h-screen p-4 md:p-6 gap-4 max-w-7xl mx-auto w-full">
      <header className="flex items-center justify-between mb-2">
        <div>
          <h1 className="text-xl font-bold text-white">MoneyMachine</h1>
          <p className="text-xs text-zinc-500">
            {data?.lastCronRun
              ? `Last run: ${new Date(data.lastCronRun).toLocaleTimeString()}`
              : 'Waiting for first run...'}
          </p>
        </div>
        <div className="flex items-center gap-3">
          {data?.config.paper && (
            <span className="text-xs bg-yellow-900/40 text-yellow-400 px-2 py-1 rounded border border-yellow-700">
              PAPER
            </span>
          )}
          <span className={`text-xs px-2 py-1 rounded border ${isLoading ? 'text-zinc-500 border-zinc-700' : error ? 'text-red-400 border-red-700 bg-red-900/20' : 'text-green-400 border-green-700 bg-green-900/20'}`}>
            {isLoading ? 'LOADING' : error ? 'ERROR' : 'LIVE'}
          </span>
        </div>
      </header>

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-400">
          Connection error. Make sure the server is running.
        </div>
      )}

      {isLoading && !data ? (
        <div className="flex items-center justify-center py-20">
          <div className="text-zinc-500">Loading dashboard...</div>
        </div>
      ) : data ? (
        <>
          <MetricsBar
            price={data.price}
            balance={data.balance}
            performance={data.performance}
            risk={data.risk}
            symbol={data.config.symbol}
            totalFees={data.trades.reduce((acc, t) => acc + (t.fees ?? 0), 0)}
          />

          <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
            <div className="lg:col-span-3 bg-zinc-900 rounded-lg p-3 border border-zinc-800">
              <Chart candles={data.candles} />
            </div>

            <div className="lg:col-span-1 space-y-4">
              <StrategyPanel
                lastSignal={data.lastSignal}
                indicators={data.indicators}
                config={data.config}
                trend={data.trend ?? 'SIDEWAYS'}
                openPosition={!!data.openPosition}
              />
              <PositionCard position={data.openPosition} price={data.price} />
            </div>
          </div>

          <TradeHistory trades={data.trades.slice(-50)} />

          {data.errors.length > 0 && (
            <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
              <h3 className="text-sm font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Errors</h3>
              <div className="space-y-1">
                {data.errors.slice(-5).map((err, i) => (
                  <div key={i} className="text-xs text-red-400 font-mono">{err}</div>
                ))}
              </div>
            </div>
          )}
        </>
      ) : null}
    </div>
  )
}
