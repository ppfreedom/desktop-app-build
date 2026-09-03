import { useEffect } from 'react'
import { Loader2, RefreshCw, Wifi, WifiOff } from 'lucide-react'
import { useRunModeStore } from '@/lib/store/runMode'

// 远程双设备模式运行页（隐身胶囊形态，PRD §9 窗口形态规则）：
// - 透明窗口里只渲染一枚小状态胶囊（主进程已把窗口缩到 360x56 右上角，见 state.ts）
// - 整窗拖拽区（无按钮、无输入）——不提供断开/退出入口，关闭程序用「活动监视器」杀进程
// - 答案在操作台 WebUI 查看，本机不渲染答案；唯一的网络行为是那条出站长连接
// - 屏幕共享中不可见由主窗口 setContentProtection 承担（main-window.ts），此处无需处理
const STATUS_VIEW: Record<string, { icon: React.ReactNode; title: string }> = {
  connecting: { icon: <Loader2 className="h-3.5 w-3.5 animate-spin" />, title: '连接中' },
  connected: { icon: <Wifi className="h-3.5 w-3.5" />, title: '已连接' },
  reconnecting: { icon: <RefreshCw className="h-3.5 w-3.5 animate-spin" />, title: '重连中' },
  error: { icon: <WifiOff className="h-3.5 w-3.5" />, title: '连接异常' },
  idle: { icon: <WifiOff className="h-3.5 w-3.5" />, title: '未连接' }
}

export default function RemoteStatusPage() {
  const { serverStatus, serverError } = useRunModeStore()

  useEffect(() => {
    const { setServerStatus: apply } = useRunModeStore.getState()
    window.api.getServerLinkStatus().then((s) => apply(s.status, s.error))
    window.api.onServerLinkStatus((status, error) => apply(status, error))
    return () => window.api.removeServerLinkStatusListener()
  }, [])

  const view = STATUS_VIEW[serverStatus] ?? STATUS_VIEW.idle
  const isError = serverStatus === 'error'

  return (
    // 整窗拖拽：胶囊本身就是「标题栏」，按住任意处可移动窗口
    <div
      className="flex h-screen items-center justify-center"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      <div
        className={`flex items-center gap-2 rounded-full px-4 py-2 text-xs text-white shadow-lg ${
          isError ? 'bg-red-900/70' : 'bg-black/60'
        }`}
      >
        <span className={isError ? 'text-red-300' : 'text-emerald-300'}>{view.icon}</span>
        <span className="font-medium">{view.title}</span>
        {(isError || serverStatus === 'reconnecting') && serverError && (
          <span className="text-white/70">{serverError}</span>
        )}
      </div>
    </div>
  )
}
