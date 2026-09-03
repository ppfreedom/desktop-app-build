import { useEffect, useState } from 'react'
import { HashRouter, Routes, Route, useLocation } from 'react-router'
import { Toaster } from 'sonner'
import CoderPage from '@/coder'
import SettingsPage from '@/settings'
import HelpPage from '@/help'
import { OverlayToolbar } from '@/coder/OverlayToolbar'
import { useSettingsStore } from '@/lib/store/settings'
import { useShortcutsStore } from '@/lib/store/shortcuts'
import { useRunModeStore } from '@/lib/store/runMode'
import { getCloneableFields } from '@/lib/utils'
import { WindowResizeHandles } from '@/components/WindowResizeHandles'
import ModeSelectPage from '@/mode/ModeSelectPage'
import RemoteStatusPage from '@/mode/RemoteStatusPage'

export default function App() {
  const [initialized, setInitialized] = useState(false)
  const settingsStore = useSettingsStore()
  const { shortcuts } = useShortcutsStore()

  useEffect(() => {
    window.api.getAppSettings().then((settings) => {
      const blankFields = Object.keys(settings).filter(
        (key) => settings[key] && !settingsStore[key]
      )
      settingsStore.syncSettings(
        blankFields.reduce(
          (acc, key) => {
            acc[key] = settings[key]
            return acc
          },
          {} as Partial<typeof settingsStore>
        )
      )
      setInitialized(true)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (initialized) {
      window.api.updateAppSettings(getCloneableFields(settingsStore))
    }
  }, [initialized, settingsStore])

  const mode = useRunModeStore((state) => state.mode)

  useEffect(() => {
    // 远程双设备模式不注册全局快捷键（蓝队有键盘监听：本地热键留下「截屏前的异常组合键」
    // 记录；且系统级热键注册本身是足迹，还会与监考软件抢注组合键）。本地模式不受影响。
    if (mode !== 'local') return
    console.log('App initShortcuts:', shortcuts) // DEBUG: 检查新键
    window.api.initShortcuts(shortcuts)
    window.api.getShortcuts().then((shortcutsStatus) => {
      console.log('Shortcuts registered:', shortcutsStatus) // DEBUG: 主进程状态
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode])

  return (
    <>
      {/* 启动模式门：未选择强制选模式；远程双设备只出连接状态页（答案在服务端操作台）*/}
      <RunModeGate>
        <HashRouter>
          <ToolbarVisibilityController />
          <WindowResizeController />
          <Routes>
            <Route index element={<CoderPage />} />
            <Route path="settings" element={<SettingsPage />} />
            <Route path="help" element={<HelpPage />} />
            <Route path="toolbar" element={<OverlayToolbar />} />
          </Routes>
        </HashRouter>
      </RunModeGate>

      <Toaster />
    </>
  )
}

/**
 * 按运行模式分流首屏：''→选择页，remote→远程状态页，local→原应用界面。
 * 工具条窗口（#toolbar hash 加载）跳过模式门：它是主窗口的附属（本地模式鼠标触发用），
 * 其 store 是独立副本却共用同一 localStorage key——若也挂模式门，其 ModeSelectPage 会
 * 监听连接状态广播并把主窗口持久化的 serverUrl/token 用空值覆写掉（跨窗口 persist 互踩）。
 */
const isToolbarWindow = window.location.hash.startsWith('#toolbar')

function RunModeGate({ children }: { children: React.ReactNode }) {
  const mode = useRunModeStore((state) => state.mode)
  if (isToolbarWindow) return <>{children}</>
  if (mode === '') return <ModeSelectPage />
  if (mode === 'remote') return <RemoteStatusPage />
  return <>{children}</>
}

/** The toolbar window renders its own handles; this covers the main window's routes */
function WindowResizeController() {
  const location = useLocation()
  const resizable = useSettingsStore((state) => state.resizable)

  if (location.pathname === '/toolbar') return null
  return <WindowResizeHandles enabled={resizable} />
}

function ToolbarVisibilityController() {
  const location = useLocation()
  const showOverlayToolbar = useSettingsStore((state) => state.showOverlayToolbar)

  useEffect(() => {
    // The toolbar window renders this app too, but must not drive its own visibility
    if (location.pathname === '/toolbar') return
    void window.api.setToolbarVisible(location.pathname === '/' && showOverlayToolbar)
  }, [location.pathname, showOverlayToolbar])

  return null
}
