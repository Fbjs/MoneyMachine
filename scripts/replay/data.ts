/**
 * Historical klines cache for the replay. Stored as NDJSON rows [openTimeSec, o, h, l, c, v]
 * under .cache/replay/, and updated incrementally.
 */
import { existsSync, mkdirSync, readFileSync, appendFileSync, writeFileSync } from 'fs'
import { join } from 'path'
import { binanceClient } from '@/lib/binance/client'
import { parseKline, intervalToSeconds } from '@/lib/binance/types'
import type { Candle } from '@/types'

const CACHE_DIR = join(process.cwd(), '.cache', 'replay')
const CHUNK_MS = 7 * 24 * 3600 * 1000 // fetch a week at a time so progress is saved

function cacheFile(symbol: string, interval: string) {
  return join(CACHE_DIR, `${symbol}-${interval}.ndjson`)
}

function readCache(file: string): Candle[] {
  if (!existsSync(file)) return []
  return readFileSync(file, 'utf8').split('\n').filter(Boolean).map(line => {
    const [time, open, high, low, close, volume] = JSON.parse(line) as number[]
    return { time, open, high, low, close, volume }
  })
}

/** Load closed candles from startSec to now, downloading whatever is missing. */
export async function loadCandles(symbol: string, interval: string, startSec: number, log = true): Promise<Candle[]> {
  mkdirSync(CACHE_DIR, { recursive: true })
  const file = cacheFile(symbol, interval)
  const sec = intervalToSeconds(interval)
  let candles = readCache(file)

  if (candles.length > 0 && candles[0].time > startSec) {
    // Backfill the missing older range and rewrite the cache.
    const raw = await binanceClient.getKlinesRange(symbol, interval, startSec * 1000, candles[0].time * 1000 - 1)
    const older = raw.map(parseKline).filter(c => c.time < candles[0].time)
    candles = older.concat(candles)
    writeFileSync(file, candles.map(c => JSON.stringify([c.time, c.open, c.high, c.low, c.close, c.volume])).join('\n') + '\n')
    if (log) console.log(`${interval}: backfilled ${older.length} older candles`)
  }

  const nowMs = Date.now()
  let fromMs = candles.length > 0 ? (candles[candles.length - 1].time + sec) * 1000 : startSec * 1000
  // Only closed candles: the last one must have closed before now.
  const endMs = nowMs - sec * 1000
  while (fromMs <= endMs) {
    const toMs = Math.min(fromMs + CHUNK_MS - 1, endMs)
    const raw = await binanceClient.getKlinesRange(symbol, interval, fromMs, toMs)
    const fresh = raw.map(parseKline).filter(c => (c.time + sec) * 1000 <= nowMs)
    if (fresh.length > 0) {
      appendFileSync(file, fresh.map(c => JSON.stringify([c.time, c.open, c.high, c.low, c.close, c.volume])).join('\n') + '\n')
      candles = candles.concat(fresh)
    }
    if (log) process.stdout.write(`\r${interval}: ${new Date(toMs).toISOString().slice(0, 10)} (${candles.length} velas)   `)
    fromMs = toMs + 1
    await new Promise(r => setTimeout(r, 100))
  }
  if (log) process.stdout.write('\n')
  return candles.filter(c => c.time >= startSec)
}

// CLI: npx tsx scripts/replay/data.ts 2025-03-01
if (process.argv[1]?.endsWith('data.ts')) {
  const from = Date.parse(process.argv[2] ?? '2025-03-01') / 1000
  ;(async () => {
    for (const [tf, back] of [['1d', 200 * 86400], ['4h', 260 * 14400], ['1m', 0]] as const) {
      await loadCandles('BTCUSDT', tf, from - back)
    }
  })().catch(err => { console.error(err); process.exit(1) })
}
