import { getEnv } from '@/lib/config'

function timingSafeEqual(a: string, b: string): boolean {
  const enc = new TextEncoder()
  const ab = enc.encode(a)
  const bb = enc.encode(b)
  let diff = ab.length ^ bb.length
  for (let i = 0; i < Math.max(ab.length, bb.length); i++) {
    diff |= (ab[i] ?? 0) ^ (bb[i] ?? 0)
  }
  return diff === 0
}

/** True if CRON_SECRET is configured. */
export function hasCronSecret(): boolean {
  return getEnv().CRON_SECRET.length > 0
}

/** Checks `Authorization: Bearer <CRON_SECRET>` in constant time. */
export function isAuthorized(request: Request): boolean {
  const secret = getEnv().CRON_SECRET
  if (!secret) return false
  const header = request.headers.get('authorization') ?? ''
  const token = header.startsWith('Bearer ') ? header.slice(7) : ''
  return token.length > 0 && timingSafeEqual(token, secret)
}
