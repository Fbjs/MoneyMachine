import type { Executor, ExecuteResult } from './types'
import type { Trade, TradeSide, BotConfig, AccountBalance } from '@/types'
import { signalToSide } from '@/lib/strategy/signal-engine'
import { sendTelegram, formatTradeMessage } from '@/lib/utils/telegram'

let tradeCounter = 0

export class BinaryExecutor implements Executor {
  name = 'binary'
  private lastPrice: Record<string, number> = {}

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
      status: 'OPEN',
      confidence: signal.confidence,
      signalReason: `${signal.action} signal`,
      openedAt: Date.now(),
      closedAt: null,
    }

    await sendTelegram(formatTradeMessage(
      'NEW TRADE', config.symbol, side, 0, 0, signal.confidence,
      `binary_${config.paper ? 'paper' : 'live'}`, config.paper,
    ))

    return { success: true, trade }
  }

  checkExit(position: Trade, currentPrice: number): { shouldExit: boolean; exitPrice: number; pnl: number } {
    const prevPrice = this.lastPrice[position.id]
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
