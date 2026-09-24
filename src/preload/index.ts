import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const api = {
  startServerLink: (config: { url: string; token: string }) =>
    ipcRenderer.invoke('startServerLink', config) as Promise<{
      status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'
      error: string
    }>,
  getServerLinkStatus: () =>
    ipcRenderer.invoke('getServerLinkStatus') as Promise<{
      status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'
      error: string
    }>,
  onServerLinkStatus: (
    callback: (
      status: 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error',
      error: string
    ) => void
  ) => {
    ipcRenderer.on('server-link-status', (_event, status, error) => callback(status, error))
  },
  removeServerLinkStatusListener: () => ipcRenderer.removeAllListeners('server-link-status'),
  onScreenshotMeta: (callback: (meta: { summary: string }) => void) => {
    ipcRenderer.on('screenshot-meta', (_event, meta) => callback(meta))
  },
  removeScreenshotMetaListener: () => ipcRenderer.removeAllListeners('screenshot-meta')
}

export type MainAPI = typeof api

if (process.contextIsolated) {
  contextBridge.exposeInMainWorld('electron', electronAPI)
  contextBridge.exposeInMainWorld('api', api)
} else {
  // @ts-ignore -- preload 的 Window 类型声明在 index.d.ts 中
  window.electron = electronAPI
  // @ts-ignore -- preload 的 Window 类型声明在 index.d.ts 中
  window.api = api
}
