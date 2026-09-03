// 远程双设备模式的出站 WS 长连接（服务端调用客户端通道）
// 设计（PRD tasks/服务端指令.md §2/§6）：
//   - 客户端不监听端口，只发一条出站连接——出站是唯一网络行为，检测面最小
//   - 连接后首消息 {"type":"auth","token"} 鉴权，收到 auth_ok 才算测试通过
//   - 收 screenshot 指令 → 复用 take-screenshot → 同连接回传 base64（答案不进客户端）
//   - 断线指数退避自动重连（1s→2s→…→30s 封顶）；「从未连接成功过」的失败不重连，
//     由模式选择页引导用户重填（令牌错或 URL 错重连无意义）
// 抗检测纪律：不注册任何全局快捷键（远程模式由 renderer 跳过 initShortcuts，
//   见 App.tsx）；本模块只维护网络 + 指令执行，不碰 AI（key 全在服务端）
import { app, BrowserWindow, ipcMain } from 'electron'
import WebSocket from 'ws'
import { takeScreenshot } from './take-screenshot'
import { devLog } from './dev-log'

export type ServerLinkStatus = 'idle' | 'connecting' | 'connected' | 'reconnecting' | 'error'

const AUTH_TIMEOUT_MS = 3000
const RECONNECT_BASE_MS = 1000
const RECONNECT_MAX_MS = 30000

let ws: WebSocket | null = null
let serverUrl = ''
let currentToken = ''
let linkStatus: ServerLinkStatus = 'idle'
let linkError = ''
/** 是否曾拿到 auth_ok：决定断线后走「自动重连」还是「报错待重填」 */
let everConnected = false
let reconnectAttempt = 0
let reconnectTimer: NodeJS.Timeout | null = null
let authTimer: NodeJS.Timeout | null = null

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
}

function scheduleReconnect(): void {
  reconnectAttempt += 1
  const delay = Math.min(RECONNECT_BASE_MS * 2 ** (reconnectAttempt - 1), RECONNECT_MAX_MS)
  setStatus('reconnecting', `${Math.round(delay / 1000)}s 后重连`)
  reconnectTimer = setTimeout(connect, delay)
}

/** 建立新连接（首次或重连共用）*/
function connect(): void {
  clearTimers()
  ws = new WebSocket(serverUrl)
  setStatus(reconnectAttempt === 0 ? 'connecting' : 'reconnecting')

  ws.on('open', () => {
    // 首消息鉴权；服务端 3s 未收到/错误即关闭连接
    ws?.send(JSON.stringify({ type: 'auth', token: currentToken }))
    authTimer = setTimeout(() => {
      ws?.close()
    }, AUTH_TIMEOUT_MS)
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
      reconnectAttempt = 0
      setStatus('connected')
      return
    }
    if (message.type === 'auth_failed') {
      clearTimers()
      setStatus('error', '配对令牌被拒绝')
      ws?.close()
      return
    }
    // 服务端指令（id + method，回传同 id 的 result/error）；params 暂不使用（预留多屏等扩展）
    if (typeof message.id === 'string' && typeof message.method === 'string') {
      void handleCommand(String(message.id), String(message.method))
    }
  })

  ws.on('error', (error) => {
    // 首次连接失败（URL/网络问题）→ 报错待重填；曾连接成功过 → 自动重连
    devLog('link-ws', `ws error: ${error instanceof Error ? error.message : String(error)}`)
    clearTimers()
    if (everConnected) {
      scheduleReconnect()
    } else {
      setStatus('error', '服务端不可达（检查 URL/网络）')
    }
  })

  ws.on('close', (code, reason) => {
    devLog(
      'link-ws',
      `ws close code=${code} reason=${reason?.toString?.() ?? ''} attempt=${reconnectAttempt}`
    )
    clearTimers()
    if (everConnected) {
      scheduleReconnect()
    } else {
      setStatus('error', '连接被服务端关闭（配对令牌错误或服务端不存在）')
    }
  })
}

/** 执行服务端指令：目前仅 screenshot，回传同一 id 的 result/error */
async function handleCommand(id: string, method: string): Promise<void> {
  if (method !== 'screenshot') {
    ws?.send(JSON.stringify({ id, error: { code: 'UNSUPPORTED', message: `未知指令：${method}` } }))
    return
  }
  try {
    devLog('cmd', `screenshot start id=${id}`)
    const startedAt = Date.now()
    const image = await takeScreenshot()
    if (!image) throw new Error('截图失败：无屏幕源')
    devLog('cmd', `screenshot ok id=${id} bytes=${image.length} took=${Date.now() - startedAt}ms`)
    ws?.send(JSON.stringify({ id, result: { image } }))
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
  reconnectAttempt = 0
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
  reconnectAttempt = 0
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
