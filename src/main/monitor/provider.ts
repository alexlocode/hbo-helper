import { app } from 'electron'
import { spawn, type ChildProcessWithoutNullStreams } from 'node:child_process'
import { createInterface } from 'node:readline'
import { join } from 'node:path'
import type { GameSample } from '../../shared/types'

export interface GameDataProvider {
  read(): Promise<GameSample>
  dispose(): void
}
interface PendingRead {
  resolve: (sample: GameSample) => void
  reject: (error: Error) => void
  timer: ReturnType<typeof setTimeout>
}
export class WindowsGameProvider implements GameDataProvider {
  private child: ChildProcessWithoutNullStreams | null = null
  private pending: PendingRead | null = null
  private disposed = false

  private fail(error: Error): void {
    if (this.pending) {
      clearTimeout(this.pending.timer)
      this.pending.reject(error)
      this.pending = null
    }
  }
  private launch(): void {
    if (process.platform !== 'win32') throw new Error('此讀取功能目前僅支援 Windows。')
    const path = app.isPackaged
      ? join(process.resourcesPath, 'native', 'HboReader.exe')
      : join(__dirname, '../../native/bin/HboReader.exe')
    this.child = spawn(path, [], { windowsHide: true, stdio: 'pipe' })
    this.child.on('error', () => this.fail(new Error('無法啟動遊戲讀取模組，請確認解壓縮了完整資料夾。')))
    this.child.on('exit', () => {
      this.fail(new Error('遊戲讀取已中斷，請重新開始監測。'))
      this.disposed = true
    })
    this.child.stdin.on('error', () => this.fail(new Error('遊戲讀取已中斷。')))
    this.child.stderr.on('data', data => console.error(String(data)))
    const lines = createInterface({ input: this.child.stdout })
    lines.on('line', line => {
      try {
        const message = JSON.parse(line.replace(/^\uFEFF/, ''))
        if (message.type === 'error') {
          this.fail(new Error(String(message.message)))
          return
        }
        const sample = message.sample as GameSample
        if (message.type !== 'sample' || !sample ||
            !Number.isFinite(sample.timestamp) || !Number.isFinite(sample.experience) ||
            !Number.isFinite(sample.earnedExperience) ||
            !Number.isFinite(sample.experienceRequired) || sample.experienceRequired <= 0 ||
            sample.experience < 0 || sample.experience >= sample.experienceRequired) {
          throw new Error('遊戲數據格式驗證失敗。')
        }
        if (this.pending) {
          const pending = this.pending
          this.pending = null
          clearTimeout(pending.timer)
          pending.resolve(sample)
        }
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  read(): Promise<GameSample> {
    if (this.disposed) return Promise.reject(new Error('讀取模組已關閉。'))
    if (this.pending) return Promise.reject(new Error('已有讀取進行中。'))
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.fail(new Error('讀取遊戲逾時，請確認已登入角色後重新開始。'))
        this.dispose()
      }, 10_000)
      this.pending = { resolve, reject, timer }
      try {
        if (!this.child) this.launch()
        this.child!.stdin.write('read\n')
      } catch (error) { this.fail(error instanceof Error ? error : new Error(String(error))) }
    })
  }
  dispose(): void {
    this.disposed = true
    this.fail(new Error('監測已停止。'))
    this.child?.kill()
    this.child = null
  }
}
