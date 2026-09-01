import type { Executor, ExecuteResult } from './types'
import type { Trade, TradeSide, BotConfig, AccountBalance } from '@/types'
import { signalToSide } from '@/lib/strategy/signal-engine'

let tradeCounter = 0

export class BinaryExecutor implements Executor {
  name = 'binary'

  async execute(
    signal: { action: string; confidence: number },
    config: BotConfig,
    balance: AccountBalance,
  ): Promise<ExecuteResult> {
    if (signal.action === 'HOLD') {
      return { success: false, error: 'No signal' }
    }

    tradeCounter++
    const side = signalToSide(signal.action as any, 'binary') as TradeSide
    const trade: Trade = {
      id: `bin_${Date.now()}_${tradeCounter}`,
      symbol: config.symbol,
      side,
      mode: 'binary',
      entryPrice: 0,
      exitPrice: null,
      quantity: 0,
      stake: 0,
      pnl: null,
      grossPnl: null,
      fees: null,
      status: 'OPEN',
      confidence: signal.confidence,
      aiScore: null,
      signalReason: `${signal.action} signal`,
      openedAt: Date.now(),
      closedAt: null,
      stopLossPrice: null,
      takeProfitPrice: null,
    }

    return { success: true, trade }
  }

  checkExit(position: Trade, currentPrice: number): { shouldExit: boolean; exitPrice: number; pnl: number } {
    const isCallWin = position.side === 'CALL' && currentPrice > position.entryPrice
    const isPutWin = position.side === 'PUT' && currentPrice < position.entryPrice
    const payout = position.stake * 0.90
    const pnl = (isCallWin || isPutWin) ? payout : -position.stake

    return {
      shouldExit: true,
      exitPrice: currentPrice,
      pnl,
    }
  }
}
