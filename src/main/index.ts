import { app, BrowserWindow, ipcMain, type IpcMainInvokeEvent } from 'electron'
import { join } from 'node:path'
import { MonitorService } from './monitor/service'
import { listGames, stopDiscovery } from './monitor/provider'
import type { GameInstance, GameTarget, HelperContext } from '../shared/types'

const windows = new Map<number, { window: BrowserWindow; target: GameTarget | null; preview: HelperContext['preview']; monitor: MonitorService | null; navigation: number }>()
let listing: Promise<GameInstance[]> | null = null
const key = (target: GameTarget) => `${target.processId}:${target.startedAt}`
function scan(): Promise<GameInstance[]> {
  if (!listing) listing = listGames().finally(() => { listing = null })
  return listing
}
function sender(event: IpcMainInvokeEvent) {
  const entry = windows.get(event.sender.id)
  if (!entry || event.sender !== entry.window.webContents || event.senderFrame !== event.sender.mainFrame)
    throw new Error('Unknown IPC sender')
  return entry
}
function createWindow(target: GameTarget | null = null, preview: HelperContext['preview'] = null): BrowserWindow {
  const window = new BrowserWindow({
    width: 1120, height: 860, minWidth: 880, minHeight: 660,
    title: target ? `HBO Helper · ${preview?.character ?? `PID ${target.processId}`}` : 'HBO Helper · 選擇角色',
    backgroundColor: '#10151c', autoHideMenuBar: true,
    webPreferences: { preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true }
  })
  const monitor = target ? new MonitorService(target) : null
  const id = window.webContents.id
  windows.set(id, { window, target, preview, monitor, navigation: 0 })
  if (app.isPackaged) {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: { ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"] } })
    })
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('closed', () => { windows.get(id)?.monitor?.dispose(); windows.delete(id) })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void window.loadFile(join(__dirname, '../renderer/index.html'))
  return window
}
app.whenReady().then(() => {
  ipcMain.handle('helper:context', event => {
    const entry = sender(event)
    return { target: entry.target, preview: entry.preview }
  })
  ipcMain.handle('helper:list', async event => {
    if (sender(event).target) throw new Error('請從入口選擇角色。')
    return (await scan()).map(game => ({ ...game, monitorOpen: [...windows.values()].some(entry => entry.target && key(entry.target) === key(game)) }))
  })
  ipcMain.handle('helper:open', async (event, target: GameTarget) => {
    const entry = sender(event)
    if (!target || !Number.isSafeInteger(target.processId) || target.processId <= 0 ||
        typeof target.startedAt !== 'string' || !/^\d{1,19}$/.test(target.startedAt)) throw new Error('遊戲選擇無效。')
    if (entry.target) {
      if (key(entry.target) === key(target)) return { target: entry.target, preview: entry.preview }
      throw new Error('請先回入口再選擇其他角色。')
    }
    const navigation = ++entry.navigation
    const game = (await scan()).find(game => key(game) === key(target))
    sender(event)
    if (entry.navigation !== navigation) throw new Error('角色選擇已取消。')
    if (!game) throw new Error('所選遊戲已關閉，請重新偵測。')
    entry.target = { processId: game.processId, startedAt: game.startedAt }
    entry.preview = { character: game.character, profession: game.profession, level: game.level }
    entry.monitor = new MonitorService(entry.target)
    entry.window.setTitle(`HBO Helper · ${game.character ?? `PID ${game.processId}`}`)
    return { target: entry.target, preview: entry.preview }
  })
  ipcMain.handle('helper:back', event => {
    const entry = sender(event)
    entry.navigation++
    entry.monitor?.dispose()
    entry.monitor = null; entry.target = null; entry.preview = null
    entry.window.setTitle('HBO Helper · 選擇角色')
    return { target: null, preview: null }
  })
  for (const channel of ['monitor:get', 'monitor:start', 'monitor:stop'] as const) {
    ipcMain.handle(channel, event => {
      const { window, monitor } = sender(event)
      if (!monitor) throw new Error('請先選擇要監測的角色。')
      if (channel === 'monitor:start') return monitor.start(snapshot => {
        if (!window.isDestroyed() && windows.get(window.webContents.id)?.monitor === monitor)
          window.webContents.send('monitor:snapshot', snapshot)
      })
      return channel === 'monitor:stop' ? monitor.stop() : monitor.snapshot()
    })
  }
  createWindow()
  app.on('activate', () => { if (windows.size === 0) createWindow() })
}).catch(error => { console.error(error); app.quit() })
app.on('before-quit', () => { stopDiscovery(); for (const entry of windows.values()) entry.monitor?.dispose() })
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
