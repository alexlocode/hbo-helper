import { contextBridge, ipcRenderer } from 'electron'
import type { HelperApi, MonitorSnapshot } from '../shared/types'

const api: HelperApi = {
  getSnapshot: () => ipcRenderer.invoke('monitor:get'),
  start: () => ipcRenderer.invoke('monitor:start'),
  stop: () => ipcRenderer.invoke('monitor:stop'),
  onSnapshot: callback => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: MonitorSnapshot) => callback(snapshot)
    ipcRenderer.on('monitor:snapshot', listener)
    return () => ipcRenderer.removeListener('monitor:snapshot', listener)
  }
}
contextBridge.exposeInMainWorld('hboHelper', api)
