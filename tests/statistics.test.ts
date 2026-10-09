import test from 'node:test'
import assert from 'node:assert/strict'
import { earnedInWindow, sessionStatistics } from '../src/main/monitor/statistics.ts'
import type { GameSample } from '../src/shared/types.ts'

function sample(timestamp: number, earnedExperience: number, experience = 100, level = 40): GameSample {
  return { timestamp, earnedExperience, experience, level, character: 'Test', profession: null, experienceRequired: 1000, gold: 100 }
}

test('rolling window uses the sample at the window boundary', () => {
  const samples = [sample(0, 0), sample(600_000, 100), sample(1_200_000, 300)]
  assert.equal(earnedInWindow(samples, 600_000), 200)
  assert.equal(earnedInWindow(samples, 1_800_000), 300)
})
test('experience remains correct across a level transition', () => {
  const samples = [sample(0, 0, 990, 40), sample(10_000, 30, 20, 41)]
  assert.equal(sessionStatistics(samples).experienceSession, 30)
  assert.equal(sessionStatistics(samples).experiencePerHour, 10_800)
})
test('negative gold changes remain negative; rate waits for sufficient data', () => {
  const first = sample(0, 0)
  const last = { ...sample(1000, 10), gold: 80 }
  const stats = sessionStatistics([first, last])
  assert.equal(stats.goldSession, -20)
  assert.equal(stats.experiencePerHour, null)
  assert.equal(stats.etaSeconds, null)
})
