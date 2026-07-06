'use client'

import type { Trade } from '@/types'

interface Props {
  trades: Trade[]
}

export default function TradeHistory({ trades }: Props) {
  if (trades.length === 0) {
    return (
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Trade History</h3>
        <p className="text-zinc-600 text-sm">No trades yet</p>
      </div>
    )
  }

  return (
    <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
      <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">
        Trade History ({trades.length})
      </h3>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-zinc-500 border-b border-zinc-800">
              <th className="text-left py-2 pr-3">Side</th>
              <th className="text-right py-2 pr-3">Entry</th>
              <th className="text-right py-2 pr-3">Exit</th>
              <th className="text-right py-2 pr-3">Stake</th>
              <th className="text-right py-2 pr-3">P&L</th>
              <th className="text-right py-2">Status</th>
            </tr>
          </thead>
          <tbody>
            {trades.slice().reverse().map(t => (
              <tr key={t.id} className="border-b border-zinc-800/50 hover:bg-zinc-800/30">
                <td className={`py-2 pr-3 font-medium ${t.side === 'CALL' || t.side === 'BUY' || t.side === 'LONG' ? 'text-green-400' : 'text-red-400'}`}>
                  {t.side}
                </td>
                <td className="text-right py-2 pr-3 font-mono">${t.entryPrice.toFixed(2)}</td>
                <td className="text-right py-2 pr-3 font-mono">{t.exitPrice ? `$${t.exitPrice.toFixed(2)}` : '-'}</td>
                <td className="text-right py-2 pr-3 font-mono">${t.stake.toFixed(2)}</td>
                <td className={`text-right py-2 pr-3 font-mono ${t.pnl !== null ? (t.pnl >= 0 ? 'text-green-400' : 'text-red-400') : ''}`}>
                  {t.pnl !== null ? `${t.pnl >= 0 ? '+' : ''}$${t.pnl.toFixed(2)}` : '-'}
                </td>
                <td className={`text-right py-2 ${t.status === 'WIN' ? 'text-green-400' : t.status === 'LOSS' ? 'text-red-400' : 'text-yellow-400'}`}>
                  {t.status}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}
