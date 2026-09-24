import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export type ServerLinkStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

interface ConnectionState {
  serverUrl: string
  token: string
  status: ServerLinkStatus
  error: string
  screenshotMetaSummary: string
  setConfig: (config: { serverUrl: string; token: string }) => void
  setStatus: (status: ServerLinkStatus, error: string) => void
  setScreenshotMetaSummary: (summary: string) => void
}

export const useConnectionStore = create<ConnectionState>()(
  persist(
    (set) => ({
      serverUrl: '',
      token: '',
      status: 'idle',
      error: '',
      screenshotMetaSummary: '',
      setConfig: ({ serverUrl, token }) => set({ serverUrl, token }),
      setStatus: (status, error) => set({ status, error }),
      setScreenshotMetaSummary: (screenshotMetaSummary) => set({ screenshotMetaSummary })
    }),
    {
      // 复用既有存储键，覆盖安装合并版时保留已经填过的 URL 与配对令牌。
      name: 'headset-recorder-prefs',
      partialize: (state) => ({ serverUrl: state.serverUrl, token: state.token }),
      version: 1
    }
  )
)
