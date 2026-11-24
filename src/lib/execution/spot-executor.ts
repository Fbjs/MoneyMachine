import type { Executor, ExecuteResult, ExecuteContext } from './types'
import type { Trade, BotConfig, AccountBalance } from '@/types'
import { binanceClient, formatQuantity, avgFillPrice, commissionIn } from '@/lib/binance/client'

let tradeCounter = 0

function baseTrade(id: string, config: BotConfig, confidence: number, reason: string, now: number): Trade {
  return {
    id,
    symbol: config.symbol,
    side: 'BUY',
    mode: 'spot',
    entryPrice: 0,
    exitPrice: null,
    quantity: 0,
    stake: 0,
    pnl: null,
    grossPnl: null,
    fees: null,
    status: 'OPEN',
    confidence,
    aiScore: null,
    signalReason: reason,
    openedAt: now,
    closedAt: null,
    stopLossPrice: null,
    takeProfitPrice: null,
  }
}

export class SpotExecutor implements Executor {
  name = 'spot'

  async execute(
    signal: { action: string; confidence: number },
    config: BotConfig,
    _balance: AccountBalance,
    stake: number,
    ctx: ExecuteContext,
  ): Promise<ExecuteResult> {
    if (signal.action === 'HOLD') {
      return { success: false, error: 'No signal' }
    }

    // Spot is long-only: there is no real shorting in spot markets.
    if (signal.action === 'SELL') {
      return { success: false, error: 'Cannot open SELL in spot (long-only)' }
    }

    if (!(stake > 0)) {
      return { success: false, error: `Invalid stake: ${stake}` }
    }

    tradeCounter++

    try {
      if (!config.paper && binanceClient.hasCredentials()) {
        const filters = await binanceClient.getSymbolFilters(config.symbol)
        if (stake < filters.minNotional) {
          return { success: false, error: `Stake ${stake} below min notional ${filters.minNotional}` }
        }

        const order = await binanceClient.marketBuy(config.symbol, stake.toFixed(2))
        const executedQty = parseFloat(order.executedQty)
        if (!(executedQty > 0)) {
          return { success: false, error: `Buy order ${order.orderId} not filled (status ${order.status})` }
        }

        // Commission charged in the base asset reduces what we actually hold.
        const heldQty = executedQty - commissionIn(order, filters.baseAsset)

        const trade = baseTrade(`spot_${order.orderId}`, config, signal.confidence, `${signal.action} signal`, ctx.now)
        trade.entryPrice = avgFillPrice(order)
        trade.quantity = heldQty
        trade.stake = parseFloat(order.cummulativeQuoteQty)
        return { success: true, trade }
      }

      // Paper: fill at the cycle's price (live ticker in production, historical price in replay).
      const entryPrice = ctx.price
      const trade = baseTrade(`spot_paper_${ctx.now}_${tradeCounter}`, config, signal.confidence, `${signal.action} signal (paper)`, ctx.now)
      trade.entryPrice = entryPrice
      trade.quantity = stake / entryPrice
      trade.stake = stake
      return { success: true, trade }
    } catch (err) {
      return { success: false, error: err instanceof Error ? err.message : String(err) }
    }
  }

  checkExit(position: Trade, currentPrice: number): { shouldExit: boolean; exitPrice: number; pnl: number } {
    const pnl = position.side === 'BUY'
      ? (currentPrice - position.entryPrice) * position.quantity
      : (position.entryPrice - currentPrice) * position.quantity
    return { shouldExit: true, exitPrice: currentPrice, pnl }
  }
}

export type SpotCloseResult =
  | { status: 'filled'; exitPrice: number; quantity: number; leftover: number }
  | { status: 'nothing_to_sell'; free: number }

/**
 * Sell a live spot position. Sells min(position qty, free balance), rounded down to the
 * LOT_SIZE step. Throws if the order fails so the caller keeps the position open.
 */
export async function closeSpotLive(position: Trade): Promise<SpotCloseResult> {
  const filters = await binanceClient.getSymbolFilters(position.symbol)
  const free = await binanceClient.getFreeBalance(filters.baseAsset)

  const sellable = Math.min(position.quantity, free)
  const qtyStr = formatQuantity(sellable, filters)
  const qty = parseFloat(qtyStr)

  const { price } = await binanceClient.getPrice(position.symbol)
  const notional = qty * parseFloat(price)
  if (qty <= 0 || qty < filters.minQty || notional < filters.minNotional) {
    return { status: 'nothing_to_sell', free }
  }

  const order = await binanceClient.marketSell(position.symbol, qtyStr)
  const executedQty = parseFloat(order.executedQty)
  if (!(executedQty > 0)) {
    throw new Error(`Sell order ${order.orderId} not filled (status ${order.status})`)
  }

  return {
    status: 'filled',
    exitPrice: avgFillPrice(order),
    quantity: executedQty,
    leftover: Math.max(0, position.quantity - executedQty),
  }
}
