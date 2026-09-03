import { desktopCapturer, screen, systemPreferences } from 'electron'
import { devLog } from './dev-log'

// 诊断 meta：随远程截图指令回传服务端、并广播 dev 胶囊——让「截到了什么、为何是黑的」自解释。
// 背景（tasks/当前任务.md）：mac 实机出现过 getPrimaryDisplay() 间歇返回 1280x1024 占位屏，
// 叠加 sources[0] 盲取后截到全黑帧；占位态只存在于 Chromium 进程内，system_profiler 等系统
// 工具不可见，只能在截图同一时刻由客户端自报现场。
export interface DisplayInfo {
  id: number
  size: string
  internal: boolean
}

export interface ScreenshotMeta {
  /** mac 屏幕录制 TCC 权限状态（granted/denied/not-determined/...）；非 mac 或查询失败为 unknown */
  permission: string
  /** Electron 此刻眼中的全部显示器——占位屏出现时这里会出现非真实尺寸的条目 */
  displays: DisplayInfo[]
  /** getPrimaryDisplay() 的报告值；与内建屏真实尺寸不符即占位态证据 */
  primaryReported: string
  chosenDisplayId: number | null
  sourceDisplayId: string | null
  /** 纯黑像素采样占比 0~1；null = 尺寸为 0 无法计算 */
  blackRatio: number | null
  pngBytes: number
  /** 一行中文摘要，dev 胶囊直接显示 */
  summary: string
}

export interface ScreenshotWithMeta {
  image: string
  meta: ScreenshotMeta
}

/** mac 屏幕录制权限为只读查询（不触发弹窗、不写 TCC）；其余平台无此概念 */
function queryScreenPermission(): string {
  if (process.platform !== 'darwin') return 'unknown'
  try {
    return systemPreferences.getMediaAccessStatus('screen')
  } catch {
    return 'unknown'
  }
}

/** 纯黑像素采样占比：桌面捕获帧为 BGRA 排布，RGB 全 0 即黑（alpha 恒 255 不计） */
function measureBlackRatio(thumbnail: Electron.NativeImage): number | null {
  const size = thumbnail.getSize()
  if (size.width === 0 || size.height === 0) return null
  const bitmap = thumbnail.toBitmap()
  let sampled = 0
  let black = 0
  // 每 16 像素采 1 个已足够判定全黑帧；步长按 4 字节对齐防越界读到 alpha 之后的内存
  for (let offset = 0; offset + 2 < bitmap.length; offset += 16 * 4) {
    sampled++
    if (bitmap[offset] === 0 && bitmap[offset + 1] === 0 && bitmap[offset + 2] === 0) black++
  }
  return sampled === 0 ? null : black / sampled
}

/** 选屏：锁内建屏（考生看的就是它）；合盖外接等无内建屏场景退回主屏 */
function chooseTargetDisplay(displays: Electron.Display[]): Electron.Display {
  return displays.find((display) => display.internal) ?? screen.getPrimaryDisplay()
}

async function captureScreenshot(): Promise<ScreenshotWithMeta | void> {
  const mainWindow = global.mainWindow
  if (!mainWindow || mainWindow.isDestroyed()) return

  const startedAt = Date.now()
  // displays 用同一次快照贯穿选屏与 meta，避免捕获过程中显示配置变化造成自相矛盾的报告
  const displays = screen.getAllDisplays()
  const primary = screen.getPrimaryDisplay()
  const chosen = chooseTargetDisplay(displays)

  let sources: Electron.DesktopCapturerSource[]
  try {
    sources = await desktopCapturer.getSources({
      types: ['screen'],
      thumbnailSize: chosen.size
    })
  } catch (error) {
    console.error('Error taking screenshot:', error)
    devLog('capture', `getSources error=${error instanceof Error ? error.message : String(error)}`)
    return
  }
  if (sources.length === 0) {
    devLog('capture', 'getSources returned 0 sources')
    return
  }

  // 每个源只测一次黑占比；display_id 精确匹配选中屏，匹配不到时取黑占比最小的源——
  // 杜绝 sources[0] 盲取抽中无内容的占位屏/休眠屏
  const blackRatioBySourceId = new Map(
    sources.map((source) => [source.id, measureBlackRatio(source.thumbnail)])
  )
  const chosenSource =
    sources.find((source) => source.display_id === String(chosen.id)) ??
    [...sources].sort(
      (a, b) => (blackRatioBySourceId.get(a.id) ?? 1) - (blackRatioBySourceId.get(b.id) ?? 1)
    )[0]

  const screenshot = chosenSource.thumbnail.toPNG()
  const blackRatio = blackRatioBySourceId.get(chosenSource.id) ?? null
  const permission = queryScreenPermission()
  const blackPct = blackRatio == null ? '?' : String(Math.round(blackRatio * 100))
  const meta: ScreenshotMeta = {
    permission,
    displays: displays.map((display) => ({
      id: display.id,
      size: `${display.size.width}x${display.size.height}`,
      internal: display.internal
    })),
    primaryReported: `${primary.size.width}x${primary.size.height}`,
    chosenDisplayId: chosen.id,
    sourceDisplayId: chosenSource.display_id || null,
    blackRatio,
    pngBytes: screenshot.length,
    summary: `截${chosen.size.width}×${chosen.size.height} 黑${blackPct}% 屏${displays.length}个 权限${
      permission === 'granted' ? 'ok' : permission
    }`
  }
  devLog(
    'capture',
    `sources=${sources.length} chosen=#${chosen.id} display_id=${chosenSource.display_id} ` +
      `black=${blackPct}% bytes=${screenshot.length} took=${Date.now() - startedAt}ms ` +
      `primary=${meta.primaryReported} displays=[${meta.displays.map((d) => `${d.id}${d.internal ? '(内)' : ''}:${d.size}`).join(', ')}] permission=${permission}`
  )
  return { image: screenshot.toString('base64'), meta }
}

/** 本地模式入口（签名保持不变）：返回 base64，无源/失败时 void */
export async function takeScreenshot(): Promise<string | void> {
  const result = await captureScreenshot()
  return result?.image
}

/** 远程指令入口：base64 + 诊断 meta（服务端黑帧拦截与 dev 胶囊展示依赖它） */
export function takeScreenshotWithMeta(): Promise<ScreenshotWithMeta | void> {
  return captureScreenshot()
}
