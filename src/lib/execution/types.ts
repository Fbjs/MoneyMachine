import type { Trade, TradeSide, TradeStatus, BotConfig, AccountBalance } from '@/types'

export interface ExecuteResult {
  success: boolean
  trade?: Trade
  error?: string
}

export interface Executor {
  execute(signal: { action: string; confidence: number }, config: BotConfig, balance: AccountBalance, stake: number): Promise<ExecuteResult>
  checkExit(position: Trade, currentPrice: number): { shouldExit: boolean; exitPrice: number; pnl: number }
  name: string
}
