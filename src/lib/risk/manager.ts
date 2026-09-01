import type { RiskMetrics, Trade } from '@/types'
import { getConfig } from '@/lib/config'

function todayKey(): string {
  return new Date().toISOString().slice(0, 10)
}

export class RiskManager {
  private metrics: RiskMetrics = {
    currentDrawdown: 0,
    maxDrawdown: 0,
    dailyPnl: 0,
    dailyPnlDate: null,
    dayStartBalance: null,
    equityPeak: null,
    consecutiveLosses: 0,
    inCooldown: false,
    cooldownEnd: 0,
    tradingDisabled: false,
  }

  constructor(private initialBalance: number) {
    this.metrics.equityPeak = initialBalance
    this.metrics.dayStartBalance = initialBalance
  }

  load(metrics: RiskMetrics) {
    this.metrics = metrics
    if (this.metrics.equityPeak === null || this.metrics.equityPeak === undefined) {
      this.metrics.equityPeak = this.initialBalance
    }
    if (this.metrics.dayStartBalance === null || this.metrics.dayStartBalance === undefined) {
      this.metrics.dayStartBalance = this.initialBalance
    }
  }

  getMetrics(): RiskMetrics {
    return { ...this.metrics }
  }

  authorize(currentBalance: number): { approved: boolean; stake: number; reason?: string } {
    const config = getConfig()

    if (this.metrics.tradingDisabled) {
      return { approved: false, stake: 0, reason: 'Trading disabled for the day' }
    }

    if (this.metrics.inCooldown) {
      if (Date.now() < this.metrics.cooldownEnd) {
        const remaining = Math.ceil((this.metrics.cooldownEnd - Date.now()) / 1000)
        return { approved: false, stake: 0, reason: `Cooldown ${remaining}s remaining` }
      }
      this.metrics.inCooldown = false
    }

    const today = todayKey()
    if (this.metrics.dailyPnlDate !== today) {
      this.metrics.dailyPnlDate = today
      this.metrics.dailyPnl = 0
      this.metrics.dayStartBalance = currentBalance
      this.metrics.tradingDisabled = false
      this.metrics.consecutiveLosses = 0
    }

    const peak = Math.max(this.metrics.equityPeak ?? currentBalance, currentBalance)
    this.metrics.equityPeak = peak
    const drawdownPct = peak > 0 ? ((peak - currentBalance) / peak) * 100 : 0
    this.metrics.currentDrawdown = drawdownPct
    this.metrics.maxDrawdown = Math.max(this.metrics.maxDrawdown, drawdownPct)

    if (drawdownPct > config.maxDailyDrawdownPct) {
      this.metrics.tradingDisabled = true
      return { approved: false, stake: 0, reason: `Max drawdown ${config.maxDailyDrawdownPct}% exceeded` }
    }

    const dayStart = this.metrics.dayStartBalance ?? this.initialBalance
    if (dayStart > 0 && this.metrics.dailyPnl <= -(config.dailyStopLossPct / 100) * dayStart) {
      this.metrics.tradingDisabled = true
      return { approved: false, stake: 0, reason: `Daily stop loss ${config.dailyStopLossPct}% reached` }
    }

    let stake: number
    if (config.stakeMode === 'fixed') {
      stake = Math.min(config.stakeFixed, config.maxPositionUsdt, currentBalance)
    } else {
      stake = Math.min(currentBalance * (config.stakePercent / 100), config.maxPositionUsdt, currentBalance)
    }

    if (this.metrics.consecutiveLosses >= 2) {
      stake = stake / 2
    }

    return { approved: true, stake: parseFloat(stake.toFixed(2)) }
  }

  onTradeResult(trade: Trade) {
    const config = getConfig()
    const pnl = trade.pnl || 0
    if (trade.status === 'LOSS') {
      this.metrics.consecutiveLosses++
      this.metrics.dailyPnl += pnl
      if (this.metrics.consecutiveLosses >= 5) {
        this.metrics.inCooldown = true
        this.metrics.cooldownEnd = Date.now() + config.lossCooldownSeconds * 1000 * 6
      } else if (this.metrics.consecutiveLosses >= 3) {
        this.metrics.inCooldown = true
        this.metrics.cooldownEnd = Date.now() + config.lossCooldownSeconds * 1000
      }
    } else if (trade.status === 'WIN') {
      this.metrics.consecutiveLosses = 0
      this.metrics.dailyPnl += pnl
      this.metrics.inCooldown = true
      this.metrics.cooldownEnd = Date.now() + config.cooldownSeconds * 1000
    }
  }
}
