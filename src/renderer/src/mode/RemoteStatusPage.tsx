import { useEffect } from 'react'
import { Wifi, WifiOff, Loader2, RefreshCw, ArrowLeft } from 'lucide-react'
import { useRunModeStore } from '@/lib/store/runMode'

// 远程双设备模式运行页：仅显示连接状态（答案在操作台 WebUI 查看，本机不渲染答案）
// 抗检测要点：本页无快捷键操作、无答案内容、唯一的网络行为是那一条出站长连接
const STATUS_VIEW: Record<
  string,
  { icon: React.ReactNode; tone: string; title: string; desc: string }
> = {
  connecting: {
    icon: <Loader2 className="h-8 w-8 animate-spin" />,
    tone: 'text-blue-600',
    title: '连接中…',
    desc: '正在连接服务端并校验配对令牌'
  },
  connected: {
    icon: <Wifi className="h-8 w-8" />,
    tone: 'text-emerald-600',
    title: '已连接',
    desc: '长连接保持中，等待服务端指令（答案在操作台查看）'
  },
  reconnecting: {
    icon: <RefreshCw className="h-8 w-8 animate-spin" />,
    tone: 'text-amber-600',
    title: '重连中…',
    desc: '连接中断，正在自动重连（指数退避）'
  },
  error: {
    icon: <WifiOff className="h-8 w-8" />,
    tone: 'text-red-600',
    title: '连接异常',
    desc: '连接失败或已被服务端拒绝'
  },
  idle: { icon: <WifiOff className="h-8 w-8" />, tone: 'text-gray-500', title: '未连接', desc: '' }
}

export default function RemoteStatusPage() {
  const { serverStatus, serverError, resetMode } = useRunModeStore()

  useEffect(() => {
    const { setServerStatus } = useRunModeStore.getState()
    window.api.getServerLinkStatus().then((s) => setServerStatus(s.status, s.error))
    window.api.onServerLinkStatus((status, error) => setServerStatus(status, error))
    return () => window.api.removeServerLinkStatusListener()
  }, [])

  const disconnect = async () => {
    await window.api.stopServerLink()
    resetMode()
  }

  const view = STATUS_VIEW[serverStatus] ?? STATUS_VIEW.idle

  return (
    <div className="flex h-screen items-center justify-center bg-white">
      <div className="w-full max-w-md px-8 text-center">
        <div className={`${view.tone} flex justify-center mb-4`}>{view.icon}</div>
        <h1 className="text-xl font-bold mb-1">{view.title}</h1>
        <p className="text-sm text-gray-500 mb-2">{view.desc}</p>
        {serverStatus === 'error' && (
          <p className="text-sm text-red-600 mb-2">{serverError || '连接异常'}</p>
        )}

        <div className="rounded-lg border border-gray-200 p-4 my-6 text-left text-sm text-gray-500 space-y-2">
          <p>• 本机不显示答案，答案实时呈现在红队操作台 WebUI</p>
          <p>• 远程模式不注册任何全局快捷键（键盘监听检测面最小）</p>
          <p>• 唯一的对外连接：一条到服务端的出站长连接</p>
        </div>

        <button
          onClick={disconnect}
          className="inline-flex items-center gap-2 rounded-md border border-gray-300 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50"
        >
          <ArrowLeft className="h-4 w-4" /> 断开并返回模式选择
        </button>
      </div>
    </div>
  )
}
