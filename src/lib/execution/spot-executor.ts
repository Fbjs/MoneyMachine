import type { Executor, ExecuteResult } from './types'
import type { Trade, TradeSide, BotConfig, AccountBalance } from '@/types'
import { binanceClient } from '@/lib/binance/client'

let tradeCounter = 0

export class SpotExecutor implements Executor {
  name = 'spot'

  async execute(
    signal: { action: string; confidence: number },
    config: BotConfig,
    balance: AccountBalance,
  ): Promise<ExecuteResult> {
    if (signal.action === 'HOLD') {
      return { success: false, error: 'No signal' }
    }

    // Spot is long-only: there is no real shorting in spot markets.
    if (signal.action === 'SELL') {
      return { success: false, error: 'Cannot open SELL in spot (long-only)' }
    }

    tradeCounter++
    const side = signal.action === 'BUY' ? 'BUY' : 'SELL'

    try {
      const { price } = await binanceClient.getPrice(config.symbol)
      const entryPrice = parseFloat(price)
      let trade: Trade

      if (!config.paper && binanceClient.hasCredentials()) {
        const order = await binanceClient.marketBuy(config.symbol, config.stakeFixed.toString())

        trade = {
          id: `spot_${Date.now()}_${tradeCounter}`,
          symbol: config.symbol,
          side: side as TradeSide,
          mode: 'spot',
          entryPrice,
          exitPrice: null,
          quantity: parseFloat(order.executedQty),
          stake: config.stakeFixed,
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
      } else {
        trade = {
          id: `spot_paper_${Date.now()}_${tradeCounter}`,
          symbol: config.symbol,
          side: side as TradeSide,
          mode: 'spot',
          entryPrice,
          exitPrice: null,
          quantity: config.stakeFixed / entryPrice,
          stake: config.stakeFixed,
          pnl: null,
          grossPnl: null,
          fees: null,
          status: 'OPEN',
          confidence: signal.confidence,
          aiScore: null,
          signalReason: `${signal.action} signal (paper)`,
          openedAt: Date.now(),
          closedAt: null,
          stopLossPrice: null,
          takeProfitPrice: null,
        }
      }

      return { success: true, trade }
    } catch (err: any) {
      return { success: false, error: err.message }
    }
  }

  checkExit(position: Trade, currentPrice: number): { shouldExit: boolean; exitPrice: number; pnl: number } {
    const pnl = position.side === 'BUY'
      ? (currentPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - currentPrice) * position.quantity
    return { shouldExit: true, exitPrice: currentPrice, pnl }
  }
}
