import type { RiskMetrics, Trade } from '@/types'
import { getConfig } from '@/lib/config'

export class RiskManager {
  private metrics: RiskMetrics = {
    currentDrawdown: 0,
    maxDrawdown: 0,
    dailyPnl: 0,
    consecutiveLosses: 0,
    inCooldown: false,
    cooldownEnd: 0,
    tradingDisabled: false,
  }

  constructor(private initialBalance: number) {}

  load(metrics: RiskMetrics) {
    this.metrics = metrics
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

    const drawdownPct = this.initialBalance > 0
      ? ((this.initialBalance - currentBalance) / this.initialBalance) * 100
      : 0
    this.metrics.currentDrawdown = drawdownPct
    this.metrics.maxDrawdown = Math.max(this.metrics.maxDrawdown, drawdownPct)

    if (drawdownPct > config.maxDailyDrawdownPct) {
      this.metrics.tradingDisabled = true
      return { approved: false, stake: 0, reason: `Max drawdown ${config.maxDailyDrawdownPct}% exceeded` }
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
    if (trade.status === 'LOSS') {
      this.metrics.consecutiveLosses++
      this.metrics.dailyPnl -= (trade.stake || 0)
      if (this.metrics.consecutiveLosses >= 3) {
        this.metrics.inCooldown = true
        this.metrics.cooldownEnd = Date.now() + getConfig().lossCooldownSeconds * 1000
      }
    } else if (trade.status === 'WIN') {
      this.metrics.consecutiveLosses = 0
      this.metrics.dailyPnl += (trade.pnl || 0)
      this.metrics.inCooldown = true
      this.metrics.cooldownEnd = Date.now() + getConfig().cooldownSeconds * 1000
    }
  }
}
