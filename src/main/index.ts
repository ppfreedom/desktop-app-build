import { app } from 'electron'
import { electronApp, optimizer } from '@electron-toolkit/utils'
import './server-link'
import './settings'
import { createWindow } from './main-window'
import { devLog } from './dev-log'

process.on('unhandledRejection', (error) => console.error(error))
process.on('uncaughtException', (error) => console.error(error))

devLog(
  'app',
  `startup userData=${app.getPath('userData')} version=${app.getVersion()} packaged=${app.isPackaged}`
)

app.whenReady().then(() => {
  electronApp.setAppUserModelId('org.headset.recorder')
  // 连接前用户需填写 URL 与配对令牌；连接成功后才由 main-window 隐去 Dock 和窗口。
  app.on('browser-window-created', (_, window) => {
    if (!__DEV_BUILD__) optimizer.watchWindowShortcuts(window)
  })
  createWindow()
  app.on('activate', () => {
    // 远程运行中的窗口不得借由 Dock/Finder 重开而暴露。
    if (global.mainWindow && !global.mainWindow.isDestroyed()) return
  })
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})
