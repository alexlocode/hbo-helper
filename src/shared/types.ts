export interface GameSample {
  timestamp: number
  character: string | null
  level: number | null
  experience: number
  experienceRequired: number
  gold: number | null
  earnedExperience: number
  processId?: number
}
export interface MonitorStatus {
  mode: 'live'
  phase: 'idle' | 'connecting' | 'connected' | 'error'
  error: string | null
  running: boolean
  intervalMs: number
}
export interface MonitorSnapshot {
  status: MonitorStatus
  sample: GameSample | null
  startedAt: number | null
  experience10m: number
  experience30m: number
  experienceSession: number
  goldSession: number | null
  experiencePerHour: number | null
  etaSeconds: number | null
}
export interface HelperApi {
  getSnapshot(): Promise<MonitorSnapshot>
  start(): Promise<MonitorSnapshot>
  stop(): Promise<MonitorSnapshot>
  onSnapshot(callback: (snapshot: MonitorSnapshot) => void): () => void
}
