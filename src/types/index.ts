export type BotMode = 'binary' | 'spot' | 'futures'
export type StakeMode = 'fixed' | 'percent'
export type SignalAction = 'BUY' | 'SELL' | 'HOLD'
export type TradeSide = 'CALL' | 'PUT' | 'BUY' | 'SELL' | 'LONG' | 'SHORT'
export type TradeStatus = 'OPEN' | 'WIN' | 'LOSS' | 'CLOSED'
export type TradeMode = 'binary' | 'spot' | 'futures'

export interface Candle {
  time: number
  open: number
  high: number
  low: number
  close: number
  volume: number
}

export interface Indicators {
  ema3: number
  ema8: number
  ema50: number
  atr: number
  adx: number
  rsi: number
  volatilityRatio: number
}

export interface Signal {
  action: SignalAction
  confidence: number
  indicators: Indicators
  timestamp: number
}

export interface Trade {
  id: string
  symbol: string
  side: TradeSide
  mode: TradeMode
  entryPrice: number
  exitPrice: number | null
  quantity: number
  stake: number
  pnl: number | null
  status: TradeStatus
  confidence: number
  signalReason: string
  openedAt: number
  closedAt: number | null
}

export interface Performance {
  totalTrades: number
  wins: number
  losses: number
  winRate: number
  profitFactor: number
  expectancy: number
  totalPnl: number
  bestTrade: number
  worstTrade: number
  avgWin: number
  avgLoss: number
}

export interface RiskMetrics {
  currentDrawdown: number
  maxDrawdown: number
  dailyPnl: number
  consecutiveLosses: number
  inCooldown: boolean
  cooldownEnd: number
  tradingDisabled: boolean
}

export interface AccountBalance {
  total: number
  available: number
  inPosition: number
}

export interface BotConfig {
  mode: BotMode
  paper: boolean
  symbol: string
  timeframe: string
  stakeMode: StakeMode
  stakeFixed: number
  stakePercent: number
  maxPositionUsdt: number
  riskPct: number
  cooldownSeconds: number
  lossCooldownSeconds: number
  maxDailyDrawdownPct: number
}

export interface BotState {
  config: BotConfig
  price: number
  candles: Candle[]
  indicators: Indicators | null
  lastSignal: Signal | null
  balance: AccountBalance
  openPosition: Trade | null
  trades: Trade[]
  performance: Performance
  risk: RiskMetrics
  lastCronRun: number | null
  errors: string[]
}
