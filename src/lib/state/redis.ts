import { Redis } from '@upstash/redis'
import type { BotState } from '@/types'
import { getEnv, getConfig } from '@/lib/config'

const STATE_KEY = 'money_machine:state'

let redisClient: Redis | null = null
let memoryState: BotState | null = null

function getRedis(): Redis | null {
  if (redisClient) return redisClient
  const env = getEnv()
  if (env.UPSTASH_REDIS_URL && env.UPSTASH_REDIS_TOKEN) {
    redisClient = new Redis({
      url: env.UPSTASH_REDIS_URL,
      token: env.UPSTASH_REDIS_TOKEN,
    })
  }
  return redisClient
}

export async function getState(): Promise<BotState | null> {
  const redis = getRedis()
  if (redis) {
    try {
      const remote = await redis.get<BotState>(STATE_KEY)
      if (remote) return remote
    } catch { /* fall through to memory */ }
  }
  return memoryState
}

export async function setState(state: BotState): Promise<void> {
  const redis = getRedis()
  if (redis) {
    try {
      await redis.set(STATE_KEY, state)
    } catch (err) {
      console.error('Failed to save state to Redis:', err)
    }
  }
  memoryState = state
}

export async function updateState(updater: (state: BotState) => BotState): Promise<BotState | null> {
  const current = await getState()
  if (!current) return null
  const updated = updater(current)
  await setState(updated)
  return updated
}

export function createInitialState(): BotState {
  const config = getConfig()
  return {
    config,
    price: 0,
    candles: [],
    indicators: null,
    lastSignal: null,
    trend: 'SIDEWAYS',
    balance: { total: 1000, available: 1000, inPosition: 0 },
    openPosition: null,
    trades: [],
    performance: {
      totalTrades: 0, wins: 0, losses: 0, winRate: 0,
      profitFactor: 0, expectancy: 0, totalPnl: 0,
      bestTrade: 0, worstTrade: 0, avgWin: 0, avgLoss: 0,
    },
    risk: {
      currentDrawdown: 0, maxDrawdown: 0, dailyPnl: 0,
      dailyPnlDate: null, dayStartBalance: 1000, equityPeak: 1000,
      consecutiveLosses: 0, inCooldown: false,
      cooldownEnd: 0, tradingDisabled: false,
    },
    lastCronRun: null,
    errors: [],
  }
}
