import { z } from 'zod'
import type { BotConfig, BotMode, StakeMode } from '@/types'

const envSchema = z.object({
  BOT_MODE: z.enum(['binary', 'spot', 'futures']).default('binary'),
  BOT_PAPER: z.string().default('true').transform(v => v !== 'false'),
  BINANCE_API_KEY: z.string().default(''),
  BINANCE_SECRET_KEY: z.string().default(''),
  SYMBOL: z.string().default('BTCUSDT'),
  TIMEFRAME: z.string().default('1m'),
  STAKE_MODE: z.enum(['fixed', 'percent']).default('fixed'),
  STAKE_FIXED: z.string().default('50').transform(v => parseFloat(v)),
  STAKE_PERCENT: z.string().default('2').transform(v => parseFloat(v)),
  MAX_POSITION_USDT: z.string().default('100').transform(v => parseFloat(v)),
  RISK_PCT: z.string().default('0.01').transform(v => parseFloat(v)),
  COOLDOWN_SECONDS: z.string().default('60').transform(v => parseInt(v)),
  LOSS_COOLDOWN_SECONDS: z.string().default('600').transform(v => parseInt(v)),
  MAX_DAILY_DRAWDOWN_PCT: z.string().default('3').transform(v => parseFloat(v)),
  TREND_TIMEFRAME: z.string().default('1h'),
  TREND_EMA_FAST: z.string().default('50').transform(v => parseInt(v)),
  TREND_EMA_SLOW: z.string().default('200').transform(v => parseInt(v)),
  FEE_RATE: z.string().default('0.001').transform(v => parseFloat(v)),
  MIN_EXPECTED_MOVE_ATR: z.string().default('1.0').transform(v => parseFloat(v)),
  SL_ATR_MULT: z.string().default('1.5').transform(v => parseFloat(v)),
  TP_ATR_MULT: z.string().default('3.0').transform(v => parseFloat(v)),
  TRAILING_ATR_MULT: z.string().default('0').transform(v => parseFloat(v)),
  DAILY_STOP_LOSS_PCT: z.string().default('1.0').transform(v => parseFloat(v)),
  TRADE_ACTIVE_HOURS: z.string().default(''),
  UPSTASH_REDIS_URL: z.string().default(''),
  UPSTASH_REDIS_TOKEN: z.string().default(''),
  TELEGRAM_BOT_TOKEN: z.string().default(''),
  TELEGRAM_CHAT_ID: z.string().default(''),
})

export type EnvVars = z.infer<typeof envSchema>

function loadEnv(): EnvVars {
  try {
    return envSchema.parse(process.env)
  } catch (err) {
    console.warn('Config validation error, using defaults:', err)
    return envSchema.parse({})
  }
}

export function getConfig(): BotConfig {
  const env = loadEnv()
  return {
    mode: env.BOT_MODE as BotMode,
    paper: env.BOT_PAPER,
    symbol: env.SYMBOL,
    timeframe: env.TIMEFRAME,
    stakeMode: env.STAKE_MODE as StakeMode,
    stakeFixed: env.STAKE_FIXED,
    stakePercent: env.STAKE_PERCENT,
    maxPositionUsdt: env.MAX_POSITION_USDT,
    riskPct: env.RISK_PCT,
    cooldownSeconds: env.COOLDOWN_SECONDS,
    lossCooldownSeconds: env.LOSS_COOLDOWN_SECONDS,
    maxDailyDrawdownPct: env.MAX_DAILY_DRAWDOWN_PCT,
    trendTimeframe: env.TREND_TIMEFRAME,
    trendEmaFast: env.TREND_EMA_FAST,
    trendEmaSlow: env.TREND_EMA_SLOW,
    feeRate: env.FEE_RATE,
    minExpectedMoveAtr: env.MIN_EXPECTED_MOVE_ATR,
    slAtrMult: env.SL_ATR_MULT,
    tpAtrMult: env.TP_ATR_MULT,
    trailingAtrMult: env.TRAILING_ATR_MULT,
    dailyStopLossPct: env.DAILY_STOP_LOSS_PCT,
    tradeActiveHours: env.TRADE_ACTIVE_HOURS,
  }
}

export function getEnv(): EnvVars {
  return loadEnv()
}
