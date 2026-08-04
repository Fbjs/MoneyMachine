import type { Executor, ExecuteResult } from './types'
import type { Trade, TradeSide, BotConfig, AccountBalance } from '@/types'
import { signalToSide } from '@/lib/strategy/signal-engine'

let tradeCounter = 0

export class FuturesExecutor implements Executor {
  name = 'futures'

  async execute(
    signal: { action: string; confidence: number },
    config: BotConfig,
    balance: AccountBalance,
  ): Promise<ExecuteResult> {
    if (signal.action === 'HOLD') {
      return { success: false, error: 'No signal' }
    }

    tradeCounter++
    const side = signalToSide(signal.action as any, 'futures') as TradeSide
    const leverage = 3

    const trade: Trade = {
      id: `fut_${Date.now()}_${tradeCounter}`,
      symbol: config.symbol,
      side,
      mode: 'futures',
      entryPrice: 0,
      exitPrice: null,
      quantity: 0,
      stake: config.stakeFixed,
      pnl: null,
      status: 'OPEN',
      confidence: signal.confidence,
      signalReason: `${signal.action} signal (${leverage}x)`,
      openedAt: Date.now(),
      closedAt: null,
    }

    return { success: true, trade }
  }

  checkExit(position: Trade, currentPrice: number): { shouldExit: boolean; exitPrice: number; pnl: number } {
    const leverage = 3
    const priceChangePct = position.side === 'LONG'
      ? (currentPrice - position.entryPrice) / position.entryPrice
      : (position.entryPrice - currentPrice) / position.entryPrice
    const pnl = position.stake * priceChangePct * leverage
    return { shouldExit: true, exitPrice: currentPrice, pnl }
  }
}
