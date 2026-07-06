import type { Executor, ExecuteResult } from './types'
import type { Trade, TradeSide, BotConfig, AccountBalance } from '@/types'
import { binanceClient } from '@/lib/binance/client'
import { sendTelegram, formatTradeMessage } from '@/lib/utils/telegram'

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

    tradeCounter++
    const side = signal.action === 'BUY' ? 'BUY' : 'SELL'

    try {
      const { price } = await binanceClient.getPrice(config.symbol)
      const entryPrice = parseFloat(price)
      let trade: Trade

      if (!config.paper && binanceClient.hasCredentials()) {
        const order = signal.action === 'BUY'
          ? await binanceClient.marketBuy(config.symbol, config.stakeFixed.toString())
          : await binanceClient.marketSell(config.symbol, (config.stakeFixed / entryPrice).toFixed(6))

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
          status: 'OPEN',
          confidence: signal.confidence,
          signalReason: `${signal.action} signal`,
          openedAt: Date.now(),
          closedAt: null,
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
          status: 'OPEN',
          confidence: signal.confidence,
          signalReason: `${signal.action} signal (paper)`,
          openedAt: Date.now(),
          closedAt: null,
        }
      }

      await sendTelegram(formatTradeMessage(
        'NEW POSITION', config.symbol, side, config.stakeFixed, entryPrice,
        signal.confidence, `spot_${config.paper ? 'paper' : 'live'}`, config.paper,
      ))

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
