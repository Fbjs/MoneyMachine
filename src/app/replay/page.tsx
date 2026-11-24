'use client'

import { useMemo } from 'react'
import Link from 'next/link'
import useSWR from 'swr'
import type { SeriesMarker, Time, UTCTimestamp } from 'lightweight-charts'
import Chart from '@/components/Chart'
import { intervalToSeconds } from '@/lib/binance/types'
import type { Candle } from '@/types'

interface ReplayTrade {
  side: string
  entryTime: number
  entryPrice: number
  stopLoss: number | null
  takeProfit: number | null
  exitTime: number
  exitPrice: number
  exitReason: 'SL' | 'TP' | 'TREND'
  stake: number
  fees: number
  pnl: number
}

interface ReplayReport {
  generatedAt: string
  config: Record<string, string | number>
  period: { from: number; to: number; granularity: string }
  metrics: {
    trades: number; wins: number; losses: number; winRate: number; totalPnl: number; profitFactor: number
    totalFees: number; maxDrawdownPct: number; initialBalance: number; finalBalance: number; buyHoldReturnPct: number
  }
  comparison: {
    backtestTrades: number; backtestPnl: number; matchedEntries: number
    onlyInReplay: number[]; onlyInBacktest: number[]; differentExit: number[]
  }
  trades: ReplayTrade[]
  candles: [number, number, number, number, number][]
}

const fetcher = (url: string) => fetch(url).then(r => {
  if (!r.ok) throw new Error(`HTTP ${r.status}`)
  return r.json()
})

const fmtDate = (s: number) => new Date(s * 1000).toLocaleString('es-CL', {
  day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit',
})
const money = (v: number) => `${v >= 0 ? '+' : ''}${v.toFixed(2)}`

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'pos' | 'neg' }) {
  const color = tone === 'pos' ? 'text-green-400' : tone === 'neg' ? 'text-red-400' : 'text-white'
  return (
    <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
      <div className="text-xs text-zinc-500 uppercase tracking-wider">{label}</div>
      <div className={`text-lg font-semibold font-mono ${color}`}>{value}</div>
    </div>
  )
}

export default function ReplayPage() {
  const { data, error, isLoading } = useSWR<ReplayReport>('/replay/latest.json', fetcher)

  const { candles, markers } = useMemo(() => {
    if (!data) return { candles: [] as Candle[], markers: [] as SeriesMarker<Time>[] }
    const tfSec = intervalToSeconds(String(data.config.timeframe))
    const snap = (t: number) => (Math.floor(t / tfSec) * tfSec) as UTCTimestamp
    const cs: Candle[] = data.candles.map(([time, open, high, low, close]) => ({ time, open, high, low, close, volume: 0 }))
    const ms: SeriesMarker<Time>[] = []
    for (const t of data.trades) {
      const win = t.pnl > 0
      ms.push({ time: snap(t.entryTime), position: 'belowBar', color: '#3b82f6', shape: 'arrowUp', text: t.side })
      ms.push({
        time: snap(t.exitTime), position: 'aboveBar', color: win ? '#22c55e' : '#ef4444',
        shape: 'arrowDown', text: `${t.exitReason} ${money(t.pnl)}`,
      })
    }
    return { candles: cs, markers: ms }
  }, [data])

  return (
    <div className="flex flex-col min-h-screen p-4 md:p-6 gap-4 max-w-7xl mx-auto w-full">
      <header className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-xl font-bold text-white">Replay histórico</h1>
          <p className="text-xs text-zinc-500">
            El código del cron ejecutado minuto a minuto sobre datos antiguos, como si hubiera estado en vivo.
          </p>
        </div>
        <Link href="/" className="text-xs px-3 py-1.5 rounded border border-zinc-700 text-zinc-300 hover:bg-zinc-800">
          ← Dashboard
        </Link>
      </header>

      {error && (
        <div className="bg-red-900/20 border border-red-800 rounded-lg p-3 text-sm text-red-400">
          No hay reporte de replay. Genéralo con <code>npm run replay</code> y publica <code>public/replay/latest.json</code>.
        </div>
      )}
      {isLoading && <div className="text-zinc-500 py-20 text-center">Cargando replay…</div>}

      {data && (
        <>
          <div className="text-xs text-zinc-400 flex flex-wrap gap-x-4 gap-y-1">
            <span>{fmtDate(data.period.from)} → {fmtDate(data.period.to)}</span>
            <span>{String(data.config.symbol)} · {String(data.config.mode)} · {String(data.config.timeframe)}/{String(data.config.trendTimeframe)}</span>
            <span>regla {String(data.config.signalRule)} (ADX ≥ {String(data.config.signalAdxMin)}) · SL {String(data.config.slAtrMult)} / TP {String(data.config.tpAtrMult)} ATR</span>
            <span>fee {(Number(data.config.feeRate) * 100).toFixed(2)}% · precio cada {data.period.granularity}</span>
            <span className="text-zinc-600">generado {new Date(data.generatedAt).toLocaleString('es-CL')}</span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            <Stat label="Trades" value={`${data.metrics.trades}`} />
            <Stat label="Win rate" value={`${(data.metrics.winRate * 100).toFixed(0)}%`} />
            <Stat label="PnL neto" value={money(data.metrics.totalPnl)} tone={data.metrics.totalPnl >= 0 ? 'pos' : 'neg'} />
            <Stat label="Profit factor" value={data.metrics.profitFactor.toFixed(2)} tone={data.metrics.profitFactor >= 1 ? 'pos' : 'neg'} />
            <Stat label="Max drawdown" value={`${data.metrics.maxDrawdownPct.toFixed(2)}%`} />
            <Stat label="Buy & hold" value={`${data.metrics.buyHoldReturnPct.toFixed(1)}%`} tone={data.metrics.buyHoldReturnPct >= 0 ? 'pos' : 'neg'} />
          </div>

          <div className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
            <Chart candles={candles} position={null} markers={markers} showEmas={false} dateTicks height={460} />
            <p className="text-xs text-zinc-500 mt-2">
              <span className="text-blue-400">▲</span> entrada · <span className="text-green-400">▼</span> salida ganadora ·{' '}
              <span className="text-red-400">▼</span> salida perdedora (TP / SL / TREND = cambio de tendencia)
            </p>
          </div>

          <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800 text-sm">
            <h3 className="text-sm font-semibold text-zinc-400 mb-2 uppercase tracking-wider">Comparación con el backtest</h3>
            <p className="text-zinc-300">
              Backtest (por velas): {data.comparison.backtestTrades} trades, PnL {money(data.comparison.backtestPnl)} ·
              entradas coincidentes {data.comparison.matchedEntries} de {data.metrics.trades} ·
              solo en replay {data.comparison.onlyInReplay.length} · solo en backtest {data.comparison.onlyInBacktest.length} ·
              salida distinta {data.comparison.differentExit.length}
            </p>
            <p className="text-xs text-zinc-500 mt-1">
              El replay revisa SL/TP con el precio de cada minuto y aplica el risk manager (cooldowns, stop diario, stake reducido);
              el backtest usa máximo/mínimo de cada vela y no tiene risk manager.
            </p>
          </div>

          <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
            <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Operaciones ({data.trades.length})</h3>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="text-zinc-500 border-b border-zinc-800">
                    <th className="text-left py-2 pr-3">Entrada</th>
                    <th className="text-right py-2 pr-3">Precio</th>
                    <th className="text-right py-2 pr-3">SL / TP</th>
                    <th className="text-left py-2 pr-3">Salida</th>
                    <th className="text-right py-2 pr-3">Precio</th>
                    <th className="text-left py-2 pr-3">Motivo</th>
                    <th className="text-right py-2">PnL</th>
                  </tr>
                </thead>
                <tbody>
                  {data.trades.map((t, i) => (
                    <tr key={i} className="border-b border-zinc-800/50 font-mono">
                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(t.entryTime)}</td>
                      <td className="py-1.5 pr-3 text-right">{t.entryPrice.toFixed(0)}</td>
                      <td className="py-1.5 pr-3 text-right text-zinc-500 whitespace-nowrap">
                        {t.stopLoss?.toFixed(0) ?? '—'} / {t.takeProfit?.toFixed(0) ?? '—'}
                      </td>
                      <td className="py-1.5 pr-3 whitespace-nowrap">{fmtDate(t.exitTime)}</td>
                      <td className="py-1.5 pr-3 text-right">{t.exitPrice.toFixed(0)}</td>
                      <td className="py-1.5 pr-3">{t.exitReason}</td>
                      <td className={`py-1.5 text-right ${t.pnl > 0 ? 'text-green-400' : 'text-red-400'}`}>{money(t.pnl)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  )
}
