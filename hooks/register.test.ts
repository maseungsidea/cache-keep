import { expect, test } from 'claude-code/testing'

import { isEarlyCold, isRepeat, isRewrite, statusText } from './register'

const use = (read: number, write: number, input = 2) => ({
  input_tokens: input,
  output_tokens: 100,
  cache_read_input_tokens: read,
  cache_creation_input_tokens: write,
})

const T0 = 1_000_000_000_000
const min = (n: number) => n * 60_000

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

test('the status line shows minutes left and context size', async () => {
  expect(statusText(T0 + min(13), T0, 312_000)).toBe('cache warm 47m · 312k')
  expect(statusText(T0 + min(61), T0, 312_000)).toBe('cache cold · next message rewrites 312k')
  expect(statusText(T0, undefined, 312_000)).toBe(undefined)
  expect(statusText(T0 + min(13), T0, 312_000, 'ko')).toBe('캐시 warm 47분 · 312k')
  expect(statusText(T0 + min(61), T0, 312_000, 'ko')).toBe('캐시 cold · 다음 메시지 312k 재기록')
})
