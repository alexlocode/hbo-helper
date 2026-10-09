import { app, BrowserWindow, ipcMain } from 'electron'
import { join } from 'node:path'
import { MonitorService } from './monitor/service'

let window: BrowserWindow | null = null
const monitor = new MonitorService()

function createWindow(): void {
  window = new BrowserWindow({
    width: 1120, height: 860, minWidth: 880, minHeight: 660,
    title: 'HBO Helper', backgroundColor: '#10151c', autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      nodeIntegration: false, contextIsolation: true, sandbox: true
    }
  })
  if (app.isPackaged) {
    window.webContents.session.webRequest.onHeadersReceived((details, callback) => {
      callback({ responseHeaders: {
        ...details.responseHeaders,
        'Content-Security-Policy': ["default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; img-src 'self' data:"]
      } })
    })
  }
  window.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))
  window.webContents.on('will-navigate', event => event.preventDefault())
  window.on('closed', () => { monitor.stop(); window = null })
  if (!app.isPackaged && process.env.ELECTRON_RENDERER_URL) {
    void window.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void window.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

app.whenReady().then(async () => {
  await monitor.initialize()
  for (const channel of ['monitor:get', 'monitor:start', 'monitor:stop'] as const) {
    ipcMain.handle(channel, async event => {
      if (!window || event.sender !== window.webContents ||
          event.senderFrame !== window.webContents.mainFrame) {
        throw new Error('Unknown IPC sender')
      }
      if (channel === 'monitor:start') {
        return monitor.start(snapshot => {
          if (window && !window.isDestroyed()) window.webContents.send('monitor:snapshot', snapshot)
        })
      }
      return channel === 'monitor:stop' ? monitor.stop() : monitor.snapshot()
    })
  }
  createWindow()
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow() })
}).catch(error => { console.error(error); app.quit() })

app.on('before-quit', () => monitor.dispose())
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit() })
