import type { BrowserWindow } from 'electron'

// 文件顶部有 import → 本文件是模块，跨文件的全局声明必须放在 declare global 里。
// __DEV_BUILD__ 的声明在 globals.d.ts（非模块文件，顶层声明天然全局）
declare global {
  var mainWindow: BrowserWindow | null
}
