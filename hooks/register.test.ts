import { expect, test } from 'claude-code/testing'

import { bar, count, emptyTally, hitRate, isEarlyCold, isRepeat, isRewrite, report, statusText } from './register'

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
      '- 5-minute TTL: watching (1 cold after a 5–55 min gap)',
    ].join('\n'),
  )
  expect(report(T0 + min(70), T0, 312_000, { ...t, isAlarmed: true }, 'ko').split('\n').slice(1, 2)).toEqual(['- 지금: cold (마지막 요청 70분 전)'])
  expect(report(T0 + min(70), T0, 312_000, { ...t, isAlarmed: true }, 'ko').endsWith('- 5분 TTL: 의심 — 설정 promptCacheTtl: "1h" 를 확인하라')).toBe(true)
  expect(report(T0, undefined, 0, emptyTally())).toBe('cache-keep: no main-thread request yet in this session.')
  // a first request reads nothing from cache: plain zeros, not "0k"
  expect(report(T0, T0, 46_000, { ...emptyTally(), write: 46_000 }).split('\n').slice(3, 5)).toEqual([
    '- Hit rate: 0% — 0 of 46k input tokens read from cache',
    '- Misses: 0 — 0 tokens rewritten',
  ])
})
