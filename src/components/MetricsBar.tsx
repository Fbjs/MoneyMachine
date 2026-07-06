'use client'

import type { AccountBalance, Performance, RiskMetrics } from '@/types'

interface Props {
  price: number
  balance: AccountBalance
  performance: Performance
  risk: RiskMetrics
  symbol: string
}

export default function MetricsBar({ price, balance, performance, risk, symbol }: Props) {
  const cards = [
    { label: symbol, value: `$${price.toFixed(2)}`, color: 'text-blue-400' },
    { label: 'Balance', value: `$${balance.total.toFixed(2)}`, color: 'text-green-400' },
    { label: 'Win Rate', value: `${(performance.winRate * 100).toFixed(1)}%`, color: 'text-purple-400' },
    { label: 'Trades', value: performance.totalTrades.toString(), color: 'text-yellow-400' },
    { label: 'P&L', value: `${performance.totalPnl >= 0 ? '+' : ''}$${performance.totalPnl.toFixed(2)}`, color: performance.totalPnl >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'Drawdown', value: `${risk.currentDrawdown.toFixed(2)}%`, color: risk.currentDrawdown > 2 ? 'text-red-400' : 'text-zinc-400' },
  ]

  return (
    <div className="grid grid-cols-3 md:grid-cols-6 gap-3">
      {cards.map(c => (
        <div key={c.label} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
          <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}
