import { expect, test } from 'claude-code/testing'

import { bar, count, emptyTally, hitRate, isEarlyCold, isRepeat, isRewrite, lifetimeOf, report, slugOf, statusText } from './register'

const use = (read: number, write: number, input = 2) => ({
  input_tokens: input,
  output_tokens: 100,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

const T0 = 1_000_000_000_000
const min = (n: number) => n * 60_000

// 300k read, 10k written, 10k fresh = 320k input, 93.75% → 94%
const warmTally = { ...emptyTally(), read: 300_000, write: 10_000, fresh: 10_000 }

test('writing a large context whole is a rewrite', async () => {
  expect(isRewrite(use(0, 120_000))).toBe(true)
  expect(isRewrite(use(110_000, 10_000))).toBe(false)
  // a small context is not counted even when rewritten
  expect(isRewrite(use(0, 30_000))).toBe(false)
})

test('only a rewrite within the hour counts as early cold', async () => {
  const cold = use(0, 200_000)
  expect(isEarlyCold(12, cold)).toBe(true)
  expect(isEarlyCold(3, cold)).toBe(false)
  expect(isEarlyCold(70, cold)).toBe(false)
  expect(isEarlyCold(12, use(195_000, 5_000))).toBe(false)
})

test('the alarm needs a second early cold within the hour', async () => {
  expect(isRepeat(undefined, T0)).toBe(false)
  expect(isRepeat(T0, T0 + min(40))).toBe(true)
  expect(isRepeat(T0, T0 + min(180))).toBe(false)
})

test('the bar fills one cell per 12 minutes left', async () => {
  expect(bar(60)).toBe('▰▰▰▰▰')
  expect(bar(47)).toBe('▰▰▰▰▱')
  expect(bar(12)).toBe('▰▱▱▱▱')
  expect(bar(1)).toBe('▰▱▱▱▱')
})

test('hit rate and misses add up per request', async () => {
  expect(hitRate(emptyTally())).toBe(undefined)
  expect(hitRate(warmTally)).toBe(94)
  const t = count(count(emptyTally(), use(0, 100_000, 0), false), use(0, 120_000, 0), true)
  expect(t.misses).toBe(1)
  expect(t.rewritten).toBe(120_000)
  expect(t.write).toBe(220_000)
  expect(hitRate(t)).toBe(0)
})

test('the status line shows time left, context, hit rate and misses', async () => {
  expect(statusText(T0 + min(13), T0, 312_000, warmTally)).toBe('🔥 cache warm ▰▰▰▰▱ 47m · 312k · hit 94%')
  expect(statusText(T0 + min(61), T0, 312_000, { ...warmTally, misses: 2 })).toBe('🧊 cache cold · next message rewrites 312k · hit 94% · 2 misses')
  expect(statusText(T0, undefined, 312_000, warmTally)).toBe(undefined)
  expect(statusText(T0 + min(13), T0, 1_250_000, { ...warmTally, misses: 1 })).toBe('🔥 cache warm ▰▰▰▰▱ 47m · 1.3M · hit 94% · 1 miss')
  expect(statusText(T0 + min(13), T0, 312_000, { ...warmTally, misses: 1 }, 'ko')).toBe('🔥 캐시 warm ▰▰▰▰▱ 47분 · 312k · 적중 94% · 놓침 1회')
  expect(statusText(T0 + min(61), T0, 312_000, warmTally, 'ko')).toBe('🧊 캐시 cold · 다음 메시지 312k 재기록 · 적중 94%')
})

test('the report spells out the session', async () => {
  const t = { ...warmTally, misses: 1, rewritten: 210_000, earlyColds: 1 }
  expect(report(T0 + min(13), T0, 312_000, t)).toBe(
    [
      'Prompt cache — main thread, this session',
      '- Now: warm, 47 min left (last request 13 min ago)',
      '- Context: 312k tokens — rewritten whole once the cache expires',
      '- Hit rate: 94% — 300k of 320k input tokens read from cache',
      '- Misses: 1 — 210k tokens rewritten',
      '- 5-minute TTL: watching (inferred: 1 cold after a 5–55 min gap)',
    ].join('\n'),
  )
  expect(report(T0 + min(70), T0, 312_000, { ...t, isAlarmed: true }, 'ko').split('\n').slice(1, 2)).toEqual(['- 지금: cold (마지막 요청 70분 전)'])
  expect(report(T0 + min(70), T0, 312_000, { ...t, isAlarmed: true }, 'ko').endsWith('- 5분 TTL: 의심 (추정) — 설정 promptCacheTtl: "1h" 를 확인하라')).toBe(true)
  expect(report(T0, undefined, 0, emptyTally())).toBe('cache-keep: no main-thread request yet in this session.')
  // a first request reads nothing from cache: plain zeros, not "0k"
  expect(report(T0, T0, 46_000, { ...emptyTally(), write: 46_000 }).split('\n').slice(3, 5)).toEqual([
    '- Hit rate: 0% — 0 of 46k input tokens read from cache',
    '- Misses: 0 — 0 tokens rewritten',
  ])
})

// One transcript line for an assistant request with the given cache write split
const row = (h1: number, m5: number, isSidechain = false) =>
  JSON.stringify({
    type: 'assistant',
    isSidechain,
    message: { id: 'msg', usage: { cache_creation: { ephemeral_1h_input_tokens: h1, ephemeral_5m_input_tokens: m5 } } },
  })

test('the TTL is the newest main-thread cache write in the transcript', async () => {
  expect(lifetimeOf([row(44_500, 0), '{"type":"user"}'].join('\n'))).toBe('1h')
  expect(lifetimeOf([row(44_500, 0), row(0, 3_000)].join('\n'))).toBe('5m')
  // a subagent's 5m write says nothing about the main thread
  expect(lifetimeOf([row(44_500, 0), row(0, 3_000, true)].join('\n'))).toBe('1h')
  // a request that wrote nothing leaves the earlier write standing
  expect(lifetimeOf([row(0, 3_000), row(0, 0)].join('\n'))).toBe('5m')
  // tail cuts the first line in half; it is skipped, not fatal
  expect(lifetimeOf(['_tokens":0}}}}', row(1_200, 0)].join('\n'))).toBe('1h')
  expect(lifetimeOf('{"_tokens":0,"ephemeral_5m_inp')).toBe(undefined)
  expect(lifetimeOf('{"type":"user"}\n')).toBe(undefined)
})

test('a measured 5-minute TTL shortens the countdown and says so', async () => {
  const short = { ...warmTally, measured: '5m' as const }
  expect(bar(4, 5)).toBe('▰▰▰▰▱')
  expect(statusText(T0 + min(1), T0, 312_000, short)).toBe('🔥 cache warm ▰▰▰▰▱ 4m · 312k · hit 94% · 5m TTL')
  expect(statusText(T0 + min(6), T0, 312_000, short)).toBe('🧊 cache cold · next message rewrites 312k · hit 94% · 5m TTL')
  expect(statusText(T0 + min(1), T0, 312_000, short, 'ko')).toBe('🔥 캐시 warm ▰▰▰▰▱ 4분 · 312k · 적중 94% · 5분 TTL')
  // a measured 1 hour reads as before
  expect(statusText(T0 + min(13), T0, 312_000, { ...warmTally, measured: '1h' })).toBe('🔥 cache warm ▰▰▰▰▱ 47m · 312k · hit 94%')
})

test('the report names a measured TTL over the inference', async () => {
  const t = { ...warmTally, earlyColds: 1 }
  expect(report(T0 + min(13), T0, 312_000, { ...t, measured: '1h' }).split('\n').slice(-1)).toEqual(['- Cache TTL: 1 hour (measured from the transcript)'])
  const short = report(T0 + min(3), T0, 312_000, { ...t, measured: '5m' }).split('\n')
  expect(short[1]).toBe('- Now: warm, 2 min left (last request 3 min ago)')
  expect(short[5]).toBe('- Cache TTL: 5 minutes (measured from the transcript) — check setting promptCacheTtl: "1h"')
  expect(report(T0 + min(13), T0, 312_000, { ...t, measured: '1h' }, 'ko').split('\n').slice(-1)).toEqual(['- 캐시 TTL: 1시간 (전사에서 측정)'])
})

test('a session directory maps to its projects folder name', async () => {
  expect(slugOf('/Users/alex/Projects/cache-keep')).toBe('-Users-alex-Projects-cache-keep')
  expect(slugOf('/private/tmp/work/-Users-alex-.claude-spares')).toBe('-private-tmp-work--Users-alex--claude-spares')
})
