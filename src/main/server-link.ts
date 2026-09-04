// 远程双设备模式的出站 WS 长连接（服务端调用客户端通道）
// 设计（PRD tasks/服务端指令.md §2/§6 + tasks/远程连接稳定性.md）：
//   - 客户端不监听端口，只发一条出站连接——出站是唯一网络行为，检测面最小
//   - 连接后首消息 {"type":"auth","token"} 鉴权，收到 auth_ok 才算测试通过
//   - 收 screenshot 指令 → 复用 take-screenshot → 同连接回传 base64（答案不进客户端）
//   - 客户端主动 ping 心跳：半开连接（NAT 静默超时/吞包）下服务端 terminate 的 RST
//     可能穿不回本端，只有本端自己 ping 才能在 90s 级别发现死链并重连
//   - 断线固定区间随机重连（2~6s 均匀分布整数秒）：无累积跳级、序列不可被流量
//     切片学习（蓝队无法用「重连节奏指纹」刻画客户端）
//   - close code 4003/4004（令牌被拒/配对码已换）按阶段分流：首连报错待重填（用户
//     在屏幕前）；运行中静默 app.quit()——回主界面 = show 窗口 = 共享中暴露
//   - 「从未连接成功过」的失败不重连，由模式选择页引导用户重填（令牌/URL 错重连无意义）
// 抗检测纪律：不注册任何全局快捷键（远程模式由 renderer 跳过 initShortcuts，
//   见 App.tsx）；本模块只维护网络 + 指令执行，不碰 AI（key 全在服务端）
import { app, BrowserWindow, ipcMain } from 'electron'
import WebSocket from 'ws'
import { takeScreenshotWithMeta } from './take-screenshot'
import { devLog } from './dev-log'

export type ServerLinkStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

const AUTH_TIMEOUT_MS = 3000
/** 心跳基准间隔：与服务端同量级（服务端 30s±5s 抖动，本端 30s 固定 + 3 轮判死） */
const PING_INTERVAL_MS = 30_000
/** 连续多少轮 ping 无 pong 判死：≥3 轮（90s）容忍单次 pong 丢包，与服务端 60s 判死互为冗余 */
const PING_MAX_MISSED = 3
/** 重连延迟（PRD §2.3）：基础 1s + 随机 1~5s → 2~6s 均匀分布整数秒 */
const RECONNECT_BASE_MS = 1000
const RECONNECT_JITTER_MAX_MS = 5000

/** 服务端应用层 close code（与 server/protocol.mjs CLOSE_CODES 对应，双端各自登记） */
const CLOSE_AUTH_FAILED = 4003 // 配对码被拒（码错 / 离线期间被换）
const CLOSE_PAIRING_ROTATED = 4004 // 在线期间被改码踢出

let ws: WebSocket | null = null
let serverUrl = ''
let currentToken = ''
let linkStatus: ServerLinkStatus = 'idle'
let linkError = ''
/** 是否曾拿到 auth_ok：决定断线后走「自动重连」还是「报错待重填」 */
let everConnected = false
let reconnectTimer: NodeJS.Timeout | null = null
let authTimer: NodeJS.Timeout | null = null
let heartbeatTimer: NodeJS.Timeout | null = null
/** 连续 ping 无 pong 计数（pong 回来归零；达 PING_MAX_MISSED 判死强断） */
let missedPongs = 0

/** 把连接状态广播给所有渲染进程（模式选择页 / 远程状态页都监听）*/
function emitStatus(): void {
  for (const win of BrowserWindow.getAllWindows()) {
    if (!win.isDestroyed()) win.webContents.send('server-link-status', linkStatus, linkError)
  }
}

function setStatus(status: ServerLinkStatus, error = ''): void {
  linkStatus = status
  linkError = error
  devLog('link', `status=${status}${error ? ` error=${error}` : ''} url=${serverUrl || '(none)'}`)
  emitStatus()
}

function clearTimers(): void {
  if (reconnectTimer) {
    clearTimeout(reconnectTimer)
    reconnectTimer = null
  }
  if (authTimer) {
    clearTimeout(authTimer)
    authTimer = null
  }
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

function scheduleReconnect(): void {
  // 固定区间随机重连（PRD §2.3）：基础 1s + 随机 1~5s → 2~6s 均匀分布整数秒，
  // 每次独立采样、无累积跳级——重连序列无可学习规律，蓝队流量切片无法用
  // 「重连节奏指纹」刻画客户端
  const delayMs =
    RECONNECT_BASE_MS + 1000 + Math.floor(Math.random() * (RECONNECT_JITTER_MAX_MS / 1000)) * 1000
  setStatus('reconnecting', `${Math.round(delayMs / 1000)}s 后重连`)
  reconnectTimer = setTimeout(connect, delayMs)
}

/** 启动客户端主动心跳（open+auth_ok 后调用）：半开连接的发现不依赖服务端 RST 能穿回 */
function startHeartbeat(): void {
  stopHeartbeat()
  missedPongs = 0
  heartbeatTimer = setInterval(() => {
    if (!ws || ws.readyState !== WebSocket.OPEN) return
    // 连续 3 轮无 pong → 半死连接：close 握手必失败，只能 terminate 强断，
    // 强断触发 close 事件 → 走既有重连路径自愈
    if (missedPongs >= PING_MAX_MISSED) {
      devLog('link-hb', `连续 ${missedPongs} 轮 ping 无 pong，判定半开连接，强断重连`)
      ws.terminate()
      return
    }
    missedPongs += 1
    ws.ping()
  }, PING_INTERVAL_MS)
}

function stopHeartbeat(): void {
  if (heartbeatTimer) {
    clearInterval(heartbeatTimer)
    heartbeatTimer = null
  }
}

/** 建立新连接（首次或重连共用）*/
function connect(): void {
  clearTimers()
  ws = new WebSocket(serverUrl)
  setStatus(everConnected ? 'reconnecting' : 'connecting')

  ws.on('open', () => {
    // 首消息鉴权；服务端 3s 未收到/错误即关闭连接。
    // client 字段自报身份：服务端日志/操作台据此分辨连接来源（多客户端互踢排障的
    // 关键——曾因 Ubuntu 残留旧客户端与 mac dev 包互抢槽位，日志却分不清谁是谁）
    ws?.send(
      JSON.stringify({
        type: 'auth',
        token: currentToken,
        client: {
          app: app.getName(),
          version: app.getVersion(),
          platform: process.platform,
          arch: process.arch
        }
      })
    )
    authTimer = setTimeout(() => {
      ws?.close()
    }, AUTH_TIMEOUT_MS)
  })

  ws.on('pong', () => {
    missedPongs = 0
  })

  ws.on('message', (data) => {
    let message: Record<string, unknown>
    try {
      message = JSON.parse(data.toString())
    } catch {
      return
    }
    if (message.type === 'auth_ok') {
      if (authTimer) {
        clearTimeout(authTimer)
        authTimer = null
      }
      everConnected = true
      startHeartbeat()
      // 上线即落盘一条身份日志：终端启动可见「谁连上了、什么版本」
      devLog('link', `已连接并鉴权成功（${app.getName()} v${app.getVersion()}）`)
      setStatus('connected')
      return
    }
    // 服务端指令（id + method，回传同 id 的 result/error）；params 暂不使用（预留多屏等扩展）
    // auth_failed 应用层消息不再处理：服务端发完必 close 4003，close code 是唯一权威信号
    if (typeof message.id === 'string' && typeof message.method === 'string') {
      void handleCommand(String(message.id), String(message.method))
    }
  })

  ws.on('error', (error) => {
    // 只记日志不调度：ws 库 error 后必触发 close，重连调度统一收口在 close handler
    // （双入口各自调度会造成 attempt 一次断线 +2、退避跳级）
    devLog('link-ws', `ws error: ${error instanceof Error ? error.message : String(error)}`)
  })

  ws.on('close', (code) => {
    devLog('link-ws', `ws close code=${code} everConnected=${everConnected}`)
    clearTimers()

    // 令牌/配对码类终局错误分流（PRD §2.2）：
    //   首连阶段 → 报错待重填（用户还在屏幕前，选择页可见不构成暴露）
    //   运行中   → 静默退出：主窗口已 hidden，回选择页 = show = 共享中弹窗暴露，
    //              app.quit() 是唯一零暴露出路；will-quit → stopServerLink 已挂好
    if (code === CLOSE_AUTH_FAILED || code === CLOSE_PAIRING_ROTATED) {
      if (everConnected) {
        devLog('link', `配对码失效(code=${code})，静默退出`)
        setStatus('idle')
        app.quit()
        return
      }
      setStatus('error', code === CLOSE_PAIRING_ROTATED ? '配对码已更换' : '配对令牌被拒绝')
      return
    }

    if (everConnected) {
      scheduleReconnect()
    } else {
      setStatus('error', '连接被服务端关闭（配对令牌错误或服务端不存在）')
    }
  })
}

/** 执行服务端指令：目前仅 screenshot，回传同一 id 的 result/error（image + 诊断 meta）*/
async function handleCommand(id: string, method: string): Promise<void> {
  if (method !== 'screenshot') {
    ws?.send(JSON.stringify({ id, error: { code: 'UNSUPPORTED', message: `未知指令：${method}` } }))
    return
  }
  try {
    devLog('cmd', `screenshot start id=${id}`)
    const startedAt = Date.now()
    const shot = await takeScreenshotWithMeta()
    if (!shot) throw new Error('截图失败：无屏幕源')
    devLog(
      'cmd',
      `screenshot ok id=${id} bytes=${shot.image.length} took=${Date.now() - startedAt}ms ${shot.meta.summary}`
    )
    // 诊断 meta 广播到所有窗口（dev 胶囊显示；生产包窗口隐藏，send 无害）
    for (const win of BrowserWindow.getAllWindows()) {
      if (!win.isDestroyed()) win.webContents.send('screenshot-meta', shot.meta)
    }
    ws?.send(JSON.stringify({ id, result: { image: shot.image, meta: shot.meta } }))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    devLog('cmd', `screenshot fail id=${id} error=${message}`)
    ws?.send(JSON.stringify({ id, error: { code: 'CAPTURE_FAILED', message } }))
  }
}

/** 建立（或重建）连接。测试连接与正式连接是同一条：auth_ok 即保持进入远程模式 */
export function startServerLink(config: { url: string; token: string }): ServerLinkStatus {
  const url = config.url.trim()
  const token = config.token.trim()
  if (!url || !token) {
    setStatus('error', '服务端 URL 与配对令牌均必填')
    return linkStatus
  }
  stopServerLink()
  everConnected = false
  serverUrl = url
  currentToken = token
  connect()
  return linkStatus
}

/** 主动断开（退出应用 / 用户返回重选模式）*/
export function stopServerLink(): void {
  clearTimers()
  if (ws) {
    ws.removeAllListeners()
    ws.close()
    ws = null
  }
  everConnected = false
  missedPongs = 0
  setStatus('idle')
}

app.on('will-quit', () => {
  stopServerLink()
})

// ---- IPC（renderer 通过 preload 调用）----
ipcMain.handle('startServerLink', (_event, config: { url: string; token: string }) => {
  startServerLink(config)
  return { status: linkStatus, error: linkError }
})
ipcMain.handle('stopServerLink', () => {
  stopServerLink()
  return { status: linkStatus, error: linkError }
})
ipcMain.handle('getServerLinkStatus', () => ({ status: linkStatus, error: linkError }))
