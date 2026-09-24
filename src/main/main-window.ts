import { join } from 'node:path'
import { BrowserWindow, screen } from 'electron'
import { is } from '@electron-toolkit/utils'
import { devLog } from './dev-log'
import { hideDockIcon } from './settings'

export function createWindow(): void {
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    title: '',
    frame: false,
    transparent: true,
    hasShadow: false,
    resizable: false,
    alwaysOnTop: false,
    skipTaskbar: true,
    hiddenInMissionControl: true,
    show: false,
    autoHideMenuBar: true,
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false,
      backgroundThrottling: false
    }
  })
  global.mainWindow = mainWindow

  mainWindow.on('page-title-updated', (event) => {
    event.preventDefault()
    mainWindow.setTitle('')
  })

  mainWindow.on('ready-to-show', () => {
    // 连接前允许用户输入配置；连接成功后生产包隐藏窗口，调试包缩成状态胶囊。
    mainWindow.show()
    mainWindow.setContentProtection(true)
  })
  mainWindow.on('show', () => mainWindow.setContentProtection(true))

  mainWindow.webContents.setWindowOpenHandler(() => ({ action: 'deny' }))

  if (is.dev && process.env.ELECTRON_RENDERER_URL) {
    void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  } else {
    void mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

export function enterConnectedMode(): void {
  const window = global.mainWindow
  if (!window || window.isDestroyed()) return

  hideDockIcon()
  if (__DEV_BUILD__ || (is.dev && Boolean(process.env.ELECTRON_RENDERER_URL))) {
    const { workArea } = screen.getPrimaryDisplay()
    const width = 360
    const height = 56
    window.setBounds({
      width,
      height,
      x: workArea.x + workArea.width - width - 24,
      y: workArea.y + 24
    })
    window.setAlwaysOnTop(true, 'floating', 1)
    window.showInactive()
    devLog('window', '调试包进入已连接胶囊态')
  } else {
    window.hide()
  }
}
