import { getEnv } from '@/lib/config'

let lastMessageId = 0

export async function sendTelegram(message: string): Promise<void> {
  const env = getEnv()
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) return

  lastMessageId++
  const prefix = `🤖 MoneyMachine #${lastMessageId}`
  const text = `${prefix}\n\n${message}`

  try {
    const url = `https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`
    await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text,
        parse_mode: 'HTML',
      }),
    })
  } catch (err) {
    console.error('Telegram send failed:', err)
  }
}

export function formatTradeMessage(
  action: string,
  symbol: string,
  side: string,
  stake: number,
  entryPrice: number,
  confidence: number,
  mode: string,
  isPaper: boolean,
  pnl?: number,
): string {
  const emoji = pnl !== undefined ? (pnl >= 0 ? '✅' : '❌') : '🟡'
  const modeLabel = isPaper ? '📄 PAPER' : '🔴 LIVE'
  let msg = `${emoji} <b>${action}</b> ${modeLabel}\n`
  msg += `└ ${symbol} ${side} | $${stake}\n`
  const priceLabel = pnl !== undefined ? 'Exit' : 'Entry'
  msg += `└ ${priceLabel}: $${entryPrice}\n`
  msg += `└ Mode: ${mode.toUpperCase()}\n`
  msg += `└ Confidence: ${(confidence * 100).toFixed(1)}%`
  if (pnl !== undefined) {
    msg += `\n└ P&L: ${pnl >= 0 ? '+' : ''}$${pnl.toFixed(2)}`
  }
  return msg
}
