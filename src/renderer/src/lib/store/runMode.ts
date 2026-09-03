import { create } from 'zustand'
import { persist } from 'zustand/middleware'

// 运行模式（PRD tasks/服务端指令.md §1）：本地 / 远程双设备。每次启动主动选择，未选择不连接
export type RunMode = '' | 'local' | 'remote'

// 与服务端连接状态（主进程 server-link.ts 下发，经 IPC 广播到渲染进程）
export type ServerLinkStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

interface RunModeState {
  /** '' = 尚未选择（启动首屏强制选择）；local / remote 为已选状态 */
  mode: RunMode
  /** 服务端 URL（记忆回填，下次启动免重输）*/
  serverUrl: string
  /** 配对令牌（记忆回填）*/
  token: string
  /** 服务端连接状态（运行时，来自主进程广播，不持久化）*/
  serverStatus: ServerLinkStatus
  serverError: string
  selectMode: (mode: RunMode) => void
  setServerConfig: (config: { serverUrl: string; token: string }) => void
  setServerStatus: (status: ServerLinkStatus, error: string) => void
  /** 断开连接并回到未选择状态（模式选择页）*/
  resetMode: () => void
}

export const useRunModeStore = create<RunModeState>()(
  persist(
    (set) => ({
      mode: '',
      serverUrl: '',
      token: '',
      serverStatus: 'idle',
      serverError: '',
      selectMode: (mode) => set({ mode }),
      setServerConfig: ({ serverUrl, token }) => set({ serverUrl, token }),
      setServerStatus: (serverStatus, serverError) => set({ serverStatus, serverError }),
      resetMode: () => set({ mode: '', serverStatus: 'idle', serverError: '' })
    }),
    {
      // 伪装命名（PRD §9 改名）：与 app 伪装身份一致，避免 runtime 自曝字符串
      name: 'headset-recorder-prefs',
      // partialize：只持久化远程配置（URL/令牌，启动回填免重输）。
      // mode 绝不持久化——PRD §6「模式每次启动主动选择，不自动进入远程模式（选了才连接）」；
      // serverStatus/serverError 是运行时状态，进远程页时由主进程实时下发
      partialize: (state) => ({ serverUrl: state.serverUrl, token: state.token }),
      version: 1
    }
  )
)
