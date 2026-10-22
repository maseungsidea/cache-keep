import type { ModelUsage, Register, Timer } from 'claude-code'

// Subscription main-thread cache TTL = 1 hour. Makes no model calls — it only shows and warns.
const TTL_MIN = 60
const EARLY_MIN = 5
const EARLY_MAX_MIN = 55
const BIG = 50_000

const MIN_MS = 60_000

export type Lang = 'en' | 'ko'

const k = (n: number) => `${Math.round(n / 1000)}k`

const TEXT = {
  en: {
    warm: (left: number, tokens: number) => `cache warm ${left}m · ${k(tokens)}`,
    cold: (tokens: number) => `cache cold · next message rewrites ${k(tokens)}`,
    alarm: 'Prompt cache went cold twice within an hour — 5-minute TTL suspected. Check setting promptCacheTtl: "1h"',
  },
  ko: {
    warm: (left: number, tokens: number) => `캐시 warm ${left}분 · ${k(tokens)}`,
    cold: (tokens: number) => `캐시 cold · 다음 메시지 ${k(tokens)} 재기록`,
    alarm: '캐시가 1시간 안에 2번 식었다 — 5분 TTL 의심. 설정 promptCacheTtl: "1h" 를 확인하라',
  },
}

export function contextOf(u: ModelUsage): number {
  return u.input_tokens + u.cache_read_input_tokens + u.cache_creation_input_tokens
}

// A large context written almost whole = the cache was empty
export function isRewrite(u: ModelUsage): boolean {
  const ctx = contextOf(u)
  return ctx >= BIG && u.cache_creation_input_tokens >= ctx * 0.5
}

// A full rewrite after a gap a 1-hour cache should survive = TTL may have dropped to 5 minutes
export function isEarlyCold(gapMin: number, u: ModelUsage): boolean {
  return gapMin >= EARLY_MIN && gapMin < EARLY_MAX_MIN && isRewrite(u)
}

// A second early cold within an hour points at the TTL rather than chance (a changed prefix)
export function isRepeat(prevAt: number | undefined, now: number): boolean {
  return prevAt !== undefined && now - prevAt < TTL_MIN * MIN_MS
}

export function statusText(now: number, lastAt: number | undefined, tokens: number, lang: Lang = 'en'): string | undefined {
  if (lastAt === undefined || tokens === 0) return undefined
  const left = TTL_MIN - Math.floor((now - lastAt) / MIN_MS)
  return left > 0 ? TEXT[lang].warm(left, tokens) : TEXT[lang].cold(tokens)
}

let timer: Timer | undefined
let lastAt: number | undefined
let tokens = 0
let lastModel: string | undefined
let isCompacted = false
let earlyAt: number | undefined
let isAlarmed = false

export const register: Register = (on, options) => {
  const lang: Lang = options.language === 'ko' ? 'ko' : 'en'

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    lastAt = undefined
    tokens = 0
    lastModel = undefined
    isCompacted = false
    earlyAt = undefined
    isAlarmed = false
    timer?.cancel()
    timer = $.clock.every(MIN_MS, async () => {
      $.ui.status(statusText(await $.clock.now(), lastAt, tokens, lang))
    })
    return result
  })

  on('session.compact', async ($, e, next) => {
    if (!e.agentId) isCompacted = true
    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId || !r.usage) return r
    const now = await $.clock.now()
    const u = r.usage
    // A rewrite right after compaction or a model switch is not the TTL's doing
    if (lastAt !== undefined && !isCompacted && u.model === lastModel && isEarlyCold((now - lastAt) / MIN_MS, u)) {
      if (!isAlarmed && isRepeat(earlyAt, now)) {
        isAlarmed = true
        $.ui.toast(TEXT[lang].alarm)
      }
      earlyAt = now
    }
    lastAt = now
    tokens = contextOf(u)
    lastModel = u.model
    isCompacted = false
    $.ui.status(statusText(now, lastAt, tokens, lang))
    return r
  })
}
