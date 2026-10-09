export interface GameTarget {
  processId: number
  startedAt: string
}
export interface GameInstance extends GameTarget {
  windowTitle?: string
  windowHandle?: string
  character: string | null
  profession: string | null
  level: number | null
  error: string | null
  monitorOpen: boolean
}
export interface HelperContext {
  target: GameTarget | null
  preview: Pick<GameInstance, 'character' | 'profession' | 'level'> | null
}
export interface GameSample {
  timestamp: number
  character: string | null
  profession: string | null
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
  getContext(): Promise<HelperContext>
  listGames(): Promise<GameInstance[]>
  openMonitor(target: GameTarget): Promise<HelperContext>
  backToEntrance(): Promise<HelperContext>
  getSnapshot(): Promise<MonitorSnapshot>
  start(): Promise<MonitorSnapshot>
  stop(): Promise<MonitorSnapshot>
  onSnapshot(callback: (snapshot: MonitorSnapshot) => void): () => void
}
