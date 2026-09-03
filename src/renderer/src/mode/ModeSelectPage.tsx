import { useEffect, useState } from 'react'
import { MonitorSmartphone, Wifi, XCircle } from 'lucide-react'
import { useRunModeStore } from '@/lib/store/runMode'

// 启动首屏：本地 / 远程双设备 二选一（PRD §1 模式门控——未选择不连接，本地零出站）
// 远程表单：URL + 配对令牌（记忆回填）→ 连接即测试（auth_ok 亦即测试通过，同一条连接不断开）
export default function ModeSelectPage() {
  const {
    serverUrl,
    token,
    serverStatus,
    serverError,
    selectMode,
    setServerConfig,
    setServerStatus
  } = useRunModeStore()
  const [showRemoteForm, setShowRemoteForm] = useState(false)
  const [inputUrl, setInputUrl] = useState(serverUrl)
  const [inputToken, setInputToken] = useState(token)

  useEffect(() => {
    // 连接状态来自主进程 server-link 广播：connected 即进入远程模式
    window.api.onServerLinkStatus((status, error) => {
      setServerStatus(status, error)
      if (status === 'connected') selectMode('remote')
    })
    return () => window.api.removeServerLinkStatusListener()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const startConnect = async () => {
    const url = inputUrl.trim()
    const token = inputToken.trim()
    if (!url || !token) {
      setServerStatus('error', '服务端 URL 与配对令牌均必填')
      return
    }
    setServerConfig({ serverUrl: url, token })
    setServerStatus('connecting', '')
    const result = await window.api.startServerLink({ url, token })
    // 即时状态（如必填/URL 非法校验）直接反映；connected 由状态事件异步到达再切模式
    if (result.error) setServerStatus(result.status, result.error)
  }

  return (
    <div className="flex h-screen flex-col bg-white">
      {/* 拖拽区：frameless 窗口全靠它移动（约定同 #app-header） */}
      <div
        className="h-9 shrink-0 bg-gray-700/80 text-white flex items-center"
        style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      >
        <div className="mx-auto text-sm">截屏解题助手</div>
      </div>
      <div className="flex-1 flex items-center justify-center">
        <div className="w-full max-w-md px-8 pb-8">
          <h1 className="text-2xl font-bold text-center mb-1">选择本次运行模式</h1>
          <p className="text-sm text-gray-500 text-center mb-8">未选择前不会发起任何网络连接</p>

          <div className="space-y-4">
            <button
              onClick={() => selectMode('local')}
              className="w-full flex items-start gap-4 rounded-lg border border-gray-200 p-4 text-left hover:border-blue-500 hover:bg-blue-50 transition-colors"
            >
              <MonitorSmartphone className="h-6 w-6 text-blue-500 shrink-0 mt-0.5" />
              <div>
                <div className="font-semibold">本地模式</div>
                <div className="text-sm text-gray-500 mt-1">
                  本机截屏、本机 AI 分析、快捷键操作。不连接任何服务端。
                </div>
              </div>
            </button>

            <div>
              <button
                onClick={() => setShowRemoteForm((v) => !v)}
                className="w-full flex items-start gap-4 rounded-lg border border-gray-200 p-4 text-left hover:border-blue-500 hover:bg-blue-50 transition-colors"
              >
                <Wifi className="h-6 w-6 text-emerald-500 shrink-0 mt-0.5" />
                <div>
                  <div className="font-semibold">远程双设备模式</div>
                  <div className="text-sm text-gray-500 mt-1">
                    连接红队服务端，答案在操作台查看。本机不显示答案、不注册快捷键。
                  </div>
                </div>
              </button>

              {showRemoteForm && (
                <div className="mt-3 rounded-lg border border-gray-200 p-4 space-y-3">
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">
                      服务端 URL
                    </label>
                    <input
                      type="text"
                      value={inputUrl}
                      onChange={(e) => setInputUrl(e.target.value)}
                      placeholder="ws://x.x.x.x:9009"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">配对令牌</label>
                    <input
                      type="password"
                      value={inputToken}
                      onChange={(e) => setInputToken(e.target.value)}
                      placeholder="配对令牌"
                      className="w-full px-3 py-2 border border-gray-300 rounded-md bg-white text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                    />
                  </div>

                  <button
                    onClick={startConnect}
                    disabled={serverStatus === 'connecting'}
                    className="w-full rounded-md bg-emerald-600 text-white py-2 text-sm font-medium hover:bg-emerald-700 disabled:opacity-50"
                  >
                    {serverStatus === 'connecting' ? '连接测试中…' : '连接服务端'}
                  </button>

                  {serverStatus === 'connected' && (
                    <p className="text-sm text-emerald-600">已连接，进入远程模式…</p>
                  )}
                  {serverStatus === 'error' && (
                    <p className="flex items-center gap-1.5 text-sm text-red-600">
                      <XCircle className="h-4 w-4" /> {serverError || '连接失败'}
                    </p>
                  )}
                </div>
              )}
            </div>
          </div>

          <p className="text-xs text-gray-400 text-center mt-8">
            每种模式每次启动需主动选择；退出程序可按 Cmd+Q。
          </p>
        </div>
      </div>
    </div>
  )
}
