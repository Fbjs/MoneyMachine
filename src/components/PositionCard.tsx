'use client'

import type { Trade } from '@/types'

interface Props {
  position: Trade | null
  price: number
}

const LONG_SIDES = ['BUY', 'CALL', 'LONG']

export default function PositionCard({ position, price }: Props) {
  if (!position) {
    return (
      <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
        <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Position</h3>
        <p className="text-zinc-600 text-sm">No open position</p>
      </div>
    )
  }

  const isLong = LONG_SIDES.includes(position.side)
  const sideColor = isLong ? 'text-green-400' : 'text-red-400'
  const unrealized = isLong
    ? (price - position.entryPrice) * position.quantity
    : (position.entryPrice - price) * position.quantity
  const unrealizedColor = unrealized >= 0 ? 'text-green-400' : 'text-red-400'

  return (
    <div className="bg-zinc-900 rounded-lg p-4 border border-zinc-800">
      <h3 className="text-sm font-semibold text-zinc-400 mb-3 uppercase tracking-wider">Position</h3>

      <div className="flex items-center justify-between mb-3">
        <span className={`text-xl font-bold ${sideColor}`}>{position.side}</span>
        <span className={`text-sm font-mono ${unrealizedColor}`}>
          {unrealized >= 0 ? '+' : ''}${unrealized.toFixed(2)}
        </span>
      </div>

      <div className="space-y-2 text-sm">
        <div className="flex justify-between"><span className="text-zinc-500">Entry</span><span className="font-mono">${position.entryPrice.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Stake</span><span className="font-mono">${position.stake.toFixed(2)}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Qty</span><span className="font-mono">{position.quantity.toFixed(6)}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Stop Loss</span><span className="font-mono text-red-400">{position.stopLossPrice ? `$${position.stopLossPrice.toFixed(2)}` : '-'}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Take Profit</span><span className="font-mono text-green-400">{position.takeProfitPrice ? `$${position.takeProfitPrice.toFixed(2)}` : '-'}</span></div>
        <div className="flex justify-between"><span className="text-zinc-500">Opened</span><span className="font-mono">{new Date(position.openedAt).toLocaleTimeString()}</span></div>
      </div>
    </div>
  )
}
