import type { Hook, ModelUsage, Register, Timer } from 'claude-code'

// Subscription main-thread cache TTL = 1 hour. Makes no model calls — it only shows and warns.
const TTL_MIN = 60
const EARLY_MIN = 5
const EARLY_MAX_MIN = 55
const BIG = 50_000
const TAIL_BYTES = 262_144

const MIN_MS = 60_000
// The turn's last request reaches the transcript just after Stop returns
const SETTLE_MS = 1_000
// An alarm comes once a session; the default 4 s toast is easy to miss
const ALARM_MS = 15_000

export type Lang = 'en' | 'ko'

// The cache lifetime the API wrote, read from the transcript
export type Lifetime = '1h' | '5m'

type Api = Parameters<Hook<'classic.Stop'>>[0]

// Main-thread totals for this session
export type Tally = {
  read: number
  write: number
  fresh: number
  misses: number
  rewritten: number
  earlyColds: number
  isAlarmed: boolean
  measured: Lifetime | undefined
}

export const emptyTally = (): Tally => ({ read: 0, write: 0, fresh: 0, misses: 0, rewritten: 0, earlyColds: 0, isAlarmed: false, measured: undefined })

export const fmt = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(1)}M` : n >= 1000 ? `${Math.round(n / 1000)}k` : `${n}`)

const TEXT = {
  en: {
    warm: (bar: string, left: number, tokens: number) => `🔥 cache warm ${bar} ${left}m · ${fmt(tokens)}`,
    cold: (tokens: number) => `🧊 cache cold · next message rewrites ${fmt(tokens)}`,
    hit: (pct: number) => `hit ${pct}%`,
    misses: (n: number) => (n === 1 ? '1 miss' : `${n} misses`),
    short: '5m TTL',
    alarm: 'Prompt cache went cold twice within an hour — 5-minute TTL suspected. Check setting promptCacheTtl: "1h"',
    measuredAlarm: 'Prompt cache writes are 5-minute (measured from the transcript): every pause over 5 minutes rewrites the context. Check setting promptCacheTtl: "1h"',
    command: 'Prompt cache report for this session: hit rate, misses, time left',
    none: 'cache-keep: no main-thread request yet in this session.',
    title: 'Prompt cache — main thread, this session',
    nowWarm: (left: number, ago: number) => `Now: warm, ${left} min left (last request ${ago} min ago)`,
    nowCold: (ago: number) => `Now: cold (last request ${ago} min ago)`,
    context: (tokens: number) => `Context: ${fmt(tokens)} tokens — rewritten whole once the cache expires`,
    hitLine: (pct: number, read: number, all: number) => `Hit rate: ${pct}% — ${fmt(read)} of ${fmt(all)} input tokens read from cache`,
    missLine: (n: number, tokens: number) => `Misses: ${n} — ${fmt(tokens)} tokens rewritten`,
    ttl1h: 'Cache TTL: 1 hour (measured from the transcript)',
    ttl5m: 'Cache TTL: 5 minutes (measured from the transcript) — check setting promptCacheTtl: "1h"',
    ttlOk: '5-minute TTL: not suspected (inferred)',
    ttlWatch: (n: number) => `5-minute TTL: watching (inferred: ${n} cold after a 5–55 min gap)`,
    ttlBad: '5-minute TTL: suspected (inferred) — check setting promptCacheTtl: "1h"',
  },
  ko: {
    warm: (bar: string, left: number, tokens: number) => `🔥 캐시 warm ${bar} ${left}분 · ${fmt(tokens)}`,
    cold: (tokens: number) => `🧊 캐시 cold · 다음 메시지 ${fmt(tokens)} 재기록`,
    hit: (pct: number) => `적중 ${pct}%`,
    misses: (n: number) => `놓침 ${n}회`,
    short: '5분 TTL',
    alarm: '캐시가 1시간 안에 2번 식었다 — 5분 TTL 의심. 설정 promptCacheTtl: "1h" 를 확인하라',
    measuredAlarm: '캐시 쓰기가 5분짜리로 측정됐다(전사 기준). 5분 넘게 쉬면 컨텍스트를 통째로 다시 쓴다. 설정 promptCacheTtl: "1h" 를 확인하라',
    command: '이 세션의 프롬프트 캐시 보고: 적중률, 놓친 횟수, 남은 시간',
    none: 'cache-keep: 이 세션에는 아직 메인 요청이 없다.',
    title: '프롬프트 캐시 — 메인 스레드, 이 세션',
    nowWarm: (left: number, ago: number) => `지금: warm, ${left}분 남음 (마지막 요청 ${ago}분 전)`,
    nowCold: (ago: number) => `지금: cold (마지막 요청 ${ago}분 전)`,
    context: (tokens: number) => `컨텍스트: ${fmt(tokens)} 토큰 — 캐시가 식으면 통째로 다시 쓴다`,
    hitLine: (pct: number, read: number, all: number) => `적중률: ${pct}% — 입력 ${fmt(all)} 중 ${fmt(read)} 를 캐시에서 읽음`,
    missLine: (n: number, tokens: number) => `놓침: ${n}회 — ${fmt(tokens)} 토큰 재기록`,
    ttl1h: '캐시 TTL: 1시간 (전사에서 측정)',
    ttl5m: '캐시 TTL: 5분 (전사에서 측정) — 설정 promptCacheTtl: "1h" 를 확인하라',
    ttlOk: '5분 TTL: 의심 없음 (추정)',
    ttlWatch: (n: number) => `5분 TTL: 지켜보는 중 (추정: 5–55분 공백 뒤 식음 ${n}회)`,
    ttlBad: '5분 TTL: 의심 (추정) — 설정 promptCacheTtl: "1h" 를 확인하라',
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

// The lifetime of the newest main-thread cache write in transcript lines; a 1h write wins over a 5m one in the same request
export function lifetimeOf(text: string): Lifetime | undefined {
  const rows = text.split('\n')
  for (let i = rows.length - 1; i >= 0; i--) {
    const line = rows[i]
    if (!line?.includes('"ephemeral_')) continue
    let row
    try {
      row = JSON.parse(line)
    } catch {
      continue // tail cuts the first line
    }
    const split = row?.type === 'assistant' && !row.isSidechain ? row.message?.usage?.cache_creation : undefined
    if (split?.ephemeral_1h_input_tokens > 0) return '1h'
    if (split?.ephemeral_5m_input_tokens > 0) return '5m'
  }
  return undefined
}

export const ttlOf = (t: Tally) => (t.measured === '5m' ? 5 : TTL_MIN)

// Minutes left, as five cells of a fifth of the TTL
export function bar(left: number, ttl = TTL_MIN): string {
  const on = Math.ceil(left / (ttl / 5))
  return '▰'.repeat(on) + '▱'.repeat(5 - on)
}

// Share of input tokens read from cache, in whole percent
export function hitRate(t: Tally): number | undefined {
  const all = t.read + t.write + t.fresh
  return all === 0 ? undefined : Math.round((t.read / all) * 100)
}

// Adds one main-thread request; a miss also counts the tokens it rewrote
export function count(t: Tally, u: ModelUsage, isMiss: boolean): Tally {
  return {
    ...t,
    read: t.read + u.cache_read_input_tokens,
    write: t.write + u.cache_creation_input_tokens,
    fresh: t.fresh + u.input_tokens,
    misses: t.misses + (isMiss ? 1 : 0),
    rewritten: t.rewritten + (isMiss ? u.cache_creation_input_tokens : 0),
  }
}

export function statusText(now: number, lastAt: number | undefined, tokens: number, t: Tally, lang: Lang = 'en'): string | undefined {
  if (lastAt === undefined || tokens === 0) return undefined
  const text = TEXT[lang]
  const ttl = ttlOf(t)
  const left = ttl - Math.floor((now - lastAt) / MIN_MS)
  const parts = [left > 0 ? text.warm(bar(left, ttl), left, tokens) : text.cold(tokens)]
  const pct = hitRate(t)
  if (pct !== undefined) parts.push(text.hit(pct))
  if (t.misses > 0) parts.push(text.misses(t.misses))
  if (t.measured === '5m') parts.push(text.short)
  return parts.join(' · ')
}

export function report(now: number, lastAt: number | undefined, tokens: number, t: Tally, lang: Lang = 'en'): string {
  const text = TEXT[lang]
  if (lastAt === undefined) return text.none
  const ago = Math.floor((now - lastAt) / MIN_MS)
  const left = ttlOf(t) - ago
  const all = t.read + t.write + t.fresh
  const inferred = t.isAlarmed ? text.ttlBad : t.earlyColds > 0 ? text.ttlWatch(t.earlyColds) : text.ttlOk
  const ttl = t.measured === '5m' ? text.ttl5m : t.measured === '1h' ? text.ttl1h : inferred
  return [
    text.title,
    `- ${left > 0 ? text.nowWarm(left, ago) : text.nowCold(ago)}`,
    `- ${text.context(tokens)}`,
    `- ${text.hitLine(hitRate(t) ?? 0, t.read, all)}`,
    `- ${text.missLine(t.misses, t.rewritten)}`,
    `- ${ttl}`,
  ].join('\n')
}

// The transcript's last 256 KiB through tail; where tail is missing, the whole file (a read stops at 4 MiB)
async function readTail($: Api, path: string): Promise<string | undefined> {
  const tail = await $.process.run(['tail', '-c', String(TAIL_BYTES), path]).catch(() => undefined)
  if (tail?.exitCode === 0) return tail.stdout
  return $.fs.read(path).catch(() => undefined)
}

let timer: Timer | undefined
let lastAt: number | undefined
let tokens = 0
let lastModel: string | undefined
let isCompacted = false
let earlyAt: number | undefined
let tally = emptyTally()

// Reads the newest main-thread cache write; a first 5-minute one raises the alarm
async function measure($: Api, path: string, lang: Lang): Promise<void> {
  const text = await readTail($, path)
  const found = text === undefined ? undefined : lifetimeOf(text)
  if (found === undefined || found === tally.measured) return
  tally = { ...tally, measured: found }
  if (found === '5m' && !tally.isAlarmed) {
    tally = { ...tally, isAlarmed: true }
    $.ui.toast(TEXT[lang].measuredAlarm, { timeoutMs: ALARM_MS })
  }
  $.ui.status(statusText(await $.clock.now(), lastAt, tokens, tally, lang))
}

export const register: Register = (on, options) => {
  const lang: Lang = options.language === 'ko' ? 'ko' : 'en'

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    lastAt = undefined
    tokens = 0
    lastModel = undefined
    isCompacted = false
    earlyAt = undefined
    tally = emptyTally()
    await $.command.register({ name: 'cache-keep', description: TEXT[lang].command, immediate: true })
    timer?.cancel()
    timer = $.clock.every(MIN_MS, async () => {
      $.ui.status(statusText(await $.clock.now(), lastAt, tokens, tally, lang))
    })
    return result
  })

  on('command.run', { command: 'cache-keep' }, async $ => ({ text: report(await $.clock.now(), lastAt, tokens, tally, lang) }))

  on('session.compact', async ($, e, next) => {
    if (!e.agentId) isCompacted = true
    return next(e)
  })

  // The usage a mod sees has no 5m/1h split; the transcript has it once the main turn ends. Unread, the inference below stands.
  on('classic.Stop', async ($, e, next) => {
    const result = await next(e)
    const path = e.transcript_path
    if (path) $.clock.after(SETTLE_MS, () => void measure($, path, lang))
    return result
  }).catch(($, e, next) => next(e))

  on('turn.step', async function* ($, e, next) {
    const r = yield* next(e)
    if (e.agentId || !r.usage) return r
    const now = await $.clock.now()
    const u = r.usage
    // A rewrite on the first request, right after compaction or after a model switch is not a miss
    const isComparable = lastAt !== undefined && !isCompacted && u.model === lastModel
    // Once the TTL is measured, an early cold is a changed prefix, not the TTL
    if (isComparable && tally.measured === undefined && isEarlyCold((now - (lastAt ?? now)) / MIN_MS, u)) {
      tally = { ...tally, earlyColds: tally.earlyColds + 1 }
      if (!tally.isAlarmed && isRepeat(earlyAt, now)) {
        tally = { ...tally, isAlarmed: true }
        $.ui.toast(TEXT[lang].alarm, { timeoutMs: ALARM_MS })
      }
      earlyAt = now
    }
    tally = count(tally, u, isComparable && isRewrite(u))
    lastAt = now
    tokens = contextOf(u)
    lastModel = u.model
    isCompacted = false
    $.ui.status(statusText(now, lastAt, tokens, tally, lang))
    return r
  })
}
