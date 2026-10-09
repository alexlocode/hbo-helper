import type { GameSample } from '../../shared/types.ts'

export function earnedInWindow(samples: readonly GameSample[], windowMs: number): number {
  if (samples.length < 2) return 0
  const latest = samples[samples.length - 1]
  const cutoff = latest.timestamp - windowMs
  let baseline = samples[0]
  for (const sample of samples) {
    if (sample.timestamp > cutoff) break
    baseline = sample
  }
  return Math.max(0, latest.earnedExperience - baseline.earnedExperience)
}

export function sessionStatistics(samples: readonly GameSample[]) {
  const first = samples[0]
  const latest = samples[samples.length - 1]
  if (!first || !latest) throw new Error('At least one sample is required')
  const elapsedMs = latest.timestamp - first.timestamp
  const experienceSession = Math.max(0, latest.earnedExperience - first.earnedExperience)
  // Require at least 10 seconds before extrapolating a rate.
  const experiencePerHour = elapsedMs >= 10_000
    ? experienceSession / elapsedMs * 3_600_000 : null
  const remaining = Math.max(0, latest.experienceRequired - latest.experience)
  return {
    experience10m: earnedInWindow(samples, 600_000),
    experience30m: earnedInWindow(samples, 1_800_000),
    experienceSession,
    goldSession: latest.gold !== null && first.gold !== null ? latest.gold - first.gold : null,
    experiencePerHour,
    etaSeconds: experiencePerHour && experiencePerHour > 0
      ? remaining / experiencePerHour * 3600 : null
  }
}
