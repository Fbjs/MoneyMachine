import type { Executor, ExecuteResult, ExecuteContext } from './types'
import type { Trade, TradeSide, BotConfig, AccountBalance } from '@/types'
import { signalToSide } from '@/lib/strategy/signal-engine'

let tradeCounter = 0

export class FuturesExecutor implements Executor {
  name = 'futures'

  async execute(
    signal: { action: string; confidence: number },
    config: BotConfig,
    balance: AccountBalance,
    stake: number,
    ctx: ExecuteContext,
  ): Promise<ExecuteResult> {
    if (signal.action === 'HOLD') {
      return { success: false, error: 'No signal' }
    }

    tradeCounter++
    const side = signalToSide(signal.action as any, 'futures') as TradeSide
    const leverage = 3

    const trade: Trade = {
      id: `fut_${ctx.now}_${tradeCounter}`,
      symbol: config.symbol,
      side,
      mode: 'futures',
      entryPrice: ctx.price,
      exitPrice: null,
      quantity: 0,
      stake,
      pnl: null,
      grossPnl: null,
      fees: null,
      status: 'OPEN',
      confidence: signal.confidence,
      aiScore: null,
      signalReason: `${signal.action} signal (${leverage}x)`,
      openedAt: ctx.now,
      closedAt: null,
      stopLossPrice: null,
      takeProfitPrice: null,
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
