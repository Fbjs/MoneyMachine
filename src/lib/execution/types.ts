import type { Trade, TradeSide, TradeStatus, BotConfig, AccountBalance } from '@/types'

/** Market context for an execution: last price and the (possibly simulated) current time. */
export interface ExecuteContext {
  price: number
  now: number
}

export interface ExecuteResult {
  success: boolean
  trade?: Trade
  error?: string
}

export interface Executor {
  execute(signal: { action: string; confidence: number }, config: BotConfig, balance: AccountBalance, stake: number, ctx: ExecuteContext): Promise<ExecuteResult>
  checkExit(position: Trade, currentPrice: number): { shouldExit: boolean; exitPrice: number; pnl: number }
  name: string
}
