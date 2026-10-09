import { contextBridge, ipcRenderer } from 'electron'
import type { HelperApi, MonitorSnapshot } from '../shared/types'

const api: HelperApi = {
  getContext: () => ipcRenderer.invoke('helper:context'),
  listGames: () => ipcRenderer.invoke('helper:list'),
  openMonitor: target => ipcRenderer.invoke('helper:open', target),
  backToEntrance: () => ipcRenderer.invoke('helper:back'),
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
