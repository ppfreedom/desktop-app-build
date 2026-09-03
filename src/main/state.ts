import { is } from '@electron-toolkit/utils'
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
 * 按运行模式调整主窗口形态（PRD tasks/服务端指令.md §6 全隐身）：
 * - 远程：**全隐身**——主窗口 hide() + Dock 隐藏，屏幕上零可见内容（状态胶囊仅
 *   electron-vite dev server 下豁免保留，便于调试）。选 hide 而非销毁：take-screenshot 依赖 mainWindow 存在，
 *   销毁会弄断截屏链路；mac 上 hide + 无 Dock 图标后 WindowServer 层不存在该窗口，
 *   共享零痕迹，隐身效果等同。状态确认在操作台「客户端在线」徽标；断线由 server-link
 *   自动重连，本机无恢复入口（Activity Monitor 杀进程重来）。
 * - 选择页/远程：层级用 floating——启动默认的 screen-saver 级别
 *   （kCGScreenSaverWindowLevel ≈1000）会盖住 Spotlight 面板（≈101），表现为
 *   Command+Space「按了没反应」（Spotlight 其实弹出了，只是被置顶窗罩住）。
 * - 本地：完全恢复原程序行为（screen-saver 级别 + 用户自己的 hideDockIcon 设置）；
 *   bounds 不动——本地模式有自己的手动 resize 体系（window-resize.ts）。
 *   从远程回本地不存在直接路径（隐身后无恢复入口，杀进程重来），选择页分支负责兜底恢复可见。
 */
function applyRunModeWindowProfile(runMode: '' | 'local' | 'remote'): void {
  const win = global.mainWindow
  if (!win || win.isDestroyed()) return

  if (runMode === 'remote') {
    if ((is.dev && process.env.ELECTRON_RENDERER_URL) || __DEV_BUILD__) {
      // dev 豁免：electron-vite dev server 与 CI 调试包（__DEV_BUILD__，build-mac-dev.yml
      // 出的包）保留 360×56 状态胶囊便于调试；生产包与直接跑 out/ 产物均严格隐身
      // （is.dev 只是 !app.isPackaged，未打包跑构建产物时也须隐身，故以 dev server
      // 环境变量为准；打包产物则由 __DEV_BUILD__ 编译期字面量区分）
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
      win.show()
    } else {
      win.hide()
    }
    applyDockVisibility(true)
  } else if (runMode === 'local') {
    win.setAlwaysOnTop(true, 'screen-saver', 1)
    applyDockVisibility(settings.hideDockIcon)
  } else {
    // 选择页：确保可见（兜底恢复）、表单所需尺寸；层级 floating 避免盖住 Spotlight
    win.setAlwaysOnTop(true, 'floating', 1)
    win.setBounds({ width: 900, height: 670 })
    win.show()
    applyDockVisibility(settings.hideDockIcon)
  }
}
