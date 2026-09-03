import { ipcMain, screen } from 'electron'
import { applyDockVisibility, settings } from './settings'

ipcMain.handle('updateAppState', (_event, _state) => {
  const prevRunMode = state.runMode
  Object.assign(state, _state)
  if (state.runMode !== prevRunMode) {
    applyRunModeWindowProfile(state.runMode)
  }
})

export const state = {
  inCoderPage: false,
  ignoreMouse: false,
  /** 运行模式（''=选择页 / local / remote），renderer 经 updateAppState 同步，驱动窗口形态 */
  runMode: '' as '' | 'local' | 'remote'
}

export type AppState = typeof state

/**
 * 按运行模式调整主窗口形态（mac 联调反馈修复）：
 * - 选择页/远程：层级用 floating（约 kCGFloatingWindowLevel）——启动默认的 screen-saver
 *   级别（kCGScreenSaverWindowLevel ≈1000）会盖住 Spotlight 面板（≈101），表现为
 *   Command+Space「按了没反应」（Spotlight 其实弹出了，只是被置顶窗罩住）。floating
 *   依然置顶于普通窗口之上，但不遮蔽系统面板。
 * - 远程（隐身胶囊）：窗口缩到右上角小条 + Dock 隐藏 + 无任何按钮——退出靠
 *   Activity Monitor 杀进程（PRD §9 窗口形态规则）。屏幕共享不可见由窗口级
 *   setContentProtection 承担（main-window.ts ready-to-show 时已设置）。
 * - 本地：完全恢复原程序行为（screen-saver 级别 + 用户自己的 hideDockIcon 设置）；
 *   bounds 不动——本地模式有自己的手动 resize 体系（window-resize.ts）。
 */
function applyRunModeWindowProfile(runMode: '' | 'local' | 'remote'): void {
  const win = global.mainWindow
  if (!win || win.isDestroyed()) return

  if (runMode === 'remote') {
    win.setAlwaysOnTop(true, 'floating', 1)
    const { workArea } = screen.getPrimaryDisplay()
    const width = 360
    const height = 56
    win.setBounds({
      width,
      height,
      x: workArea.x + workArea.width - width - 24,
      y: workArea.y + 24
    })
    applyDockVisibility(true)
  } else if (runMode === 'local') {
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    applyDockVisibility(settings.hideDockIcon)
  } else {
    // 选择页：恢复表单所需尺寸；层级同样降到 floating，避免盖住 Spotlight
    win.setAlwaysOnTop(true, 'floating', 1)
    win.setBounds({ width: 900, height: 670 })
    applyDockVisibility(settings.hideDockIcon)
  }
}
