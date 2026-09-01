'use client'

import type { AccountBalance, Performance, RiskMetrics } from '@/types'

interface Props {
  price: number
  balance: AccountBalance
  performance: Performance
  risk: RiskMetrics
  symbol: string
  totalFees: number
}

export default function MetricsBar({ price, balance, performance, risk, symbol, totalFees }: Props) {
  const pnl = performance.totalPnl
  const cards = [
    { label: symbol, value: `$${price.toFixed(2)}`, color: 'text-blue-400' },
    { label: 'Balance', value: `$${balance.total.toFixed(2)}`, color: 'text-green-400' },
    { label: 'Win Rate', value: `${(performance.winRate * 100).toFixed(1)}%`, color: 'text-purple-400' },
    { label: 'Trades', value: performance.totalTrades.toString(), color: 'text-yellow-400' },
    { label: 'P&L', value: `${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`, color: pnl >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'Daily P&L', value: `${risk.dailyPnl >= 0 ? '+' : ''}$${risk.dailyPnl.toFixed(2)}`, color: risk.dailyPnl >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'Profit Factor', value: performance.profitFactor.toFixed(2), color: performance.profitFactor >= 1 ? 'text-green-400' : 'text-red-400' },
    { label: 'Expectancy', value: `${performance.expectancy >= 0 ? '+' : ''}$${performance.expectancy.toFixed(3)}`, color: performance.expectancy >= 0 ? 'text-green-400' : 'text-red-400' },
    { label: 'Max DD', value: `${risk.maxDrawdown.toFixed(2)}%`, color: risk.maxDrawdown > 2 ? 'text-red-400' : 'text-zinc-400' },
    { label: 'Fees', value: `$${totalFees.toFixed(2)}`, color: 'text-zinc-400' },
  ]

  return (
    <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 xl:grid-cols-5 gap-3">
      {cards.map(c => (
        <div key={c.label} className="bg-zinc-900 rounded-lg p-3 border border-zinc-800">
          <div className="text-xs text-zinc-500 mb-1">{c.label}</div>
          <div className={`text-lg font-bold ${c.color}`}>{c.value}</div>
        </div>
      ))}
    </div>
  )
}
