import type { GameSample, MonitorSnapshot, MonitorStatus } from '../../shared/types'
import { WindowsGameProvider, type GameDataProvider } from './provider'
import { sessionStatistics } from './statistics'

export class MonitorService {
  private provider: GameDataProvider | null = null
  private samples: GameSample[] = []
  private timer: ReturnType<typeof setInterval> | undefined
  private startedAt: number | null = null
  private sampling = false
  private generation = 0
  private starting: Promise<MonitorSnapshot> | null = null
  private phase: MonitorStatus['phase'] = 'idle'
  private error: string | null = null
  private readonly intervalMs = 5000

  async initialize(): Promise<void> {}
  snapshot(): MonitorSnapshot {
    return {
      status: { mode: 'live', phase: this.phase, error: this.error,
        running: this.timer !== undefined, intervalMs: this.intervalMs },
      sample: this.samples.at(-1) ?? null,
      startedAt: this.startedAt,
      ...(this.samples.length ? sessionStatistics(this.samples) : {
        experience10m: 0, experience30m: 0, experienceSession: 0,
        goldSession: null, experiencePerHour: null, etaSeconds: null
      })
    }
  }
  start(publish: (snapshot: MonitorSnapshot) => void): Promise<MonitorSnapshot> {
    if (this.starting) return this.starting
    if (this.timer) return Promise.resolve(this.snapshot())
    this.starting = this.connect(publish).finally(() => { this.starting = null })
    return this.starting
  }
  private async connect(publish: (snapshot: MonitorSnapshot) => void): Promise<MonitorSnapshot> {
    this.provider?.dispose()
    const provider = this.provider = new WindowsGameProvider()
    const generation = ++this.generation
    this.samples = []
    this.startedAt = null
    this.phase = 'connecting'
    this.error = null
    publish(this.snapshot())
    try {
      const first = await provider.read()
      if (generation !== this.generation) return this.snapshot()
      this.samples = [first]
      this.startedAt = first.timestamp
      this.phase = 'connected'
      this.timer = setInterval(() => {
        if (this.sampling) return
        this.sampling = true
        void provider.read().then(sample => {
          if (generation !== this.generation) return
          this.samples.push(sample)
          const cutoff = sample.timestamp - 1_800_000
          // Preserve session baseline and the last sample before the 30-minute boundary.
          while (this.samples.length > 2 && this.samples[2].timestamp <= cutoff) this.samples.splice(1, 1)
          publish(this.snapshot())
        }).catch(error => {
          if (generation !== this.generation) return
          this.stop()
          this.phase = 'error'
          this.error = error instanceof Error ? error.message : String(error)
          publish(this.snapshot())
        }).finally(() => { this.sampling = false })
      }, this.intervalMs)
    } catch (error) {
      if (generation === this.generation) {
        provider.dispose()
        this.phase = 'error'
        this.error = error instanceof Error ? error.message : String(error)
      }
    }
    publish(this.snapshot())
    return this.snapshot()
  }
  stop(): MonitorSnapshot {
    this.generation++
    if (this.timer) clearInterval(this.timer)
    this.timer = undefined
    this.phase = 'idle'
    this.provider?.dispose()
    this.provider = null
    return this.snapshot()
  }
  dispose(): void { this.stop() }
}
