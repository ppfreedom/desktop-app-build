import { desktopCapturer, screen } from 'electron'
import { devLog } from './dev-log'

export function takeScreenshot(): Promise<string | void> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return Promise.resolve()

  // Get the primary display's size.
  const primaryDisplay = screen.getPrimaryDisplay()
  const { width, height } = primaryDisplay.size

  const startedAt = Date.now()
  return desktopCapturer
    .getSources({ types: ['screen'], thumbnailSize: { width, height } })
    .then((sources) => {
      // dev 埋点：诊断 TCC 拒绝的两种静默表现——getSources 挂起超时 / 返回全黑缩略图
      // （macOS 无屏录权限时 API 不抛错，黑像素或空源是唯一线索）
      devLog(
        'capture',
        `sources=${sources.length} names=[${sources.map((s) => s.name).join(', ')}] took=${Date.now() - startedAt}ms`
      )
      if (sources.length > 0) {
        const screenshot = sources[0]?.thumbnail.toPNG()
        const base64Data = screenshot.toString('base64')
        return base64Data
      }
      return undefined
    })
    .catch((error) => {
      console.error('Error taking screenshot:', error)
      devLog('capture', `error=${error instanceof Error ? error.message : String(error)}`)
    })
}
