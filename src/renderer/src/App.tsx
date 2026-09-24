import { useEffect, useState } from 'react'
import { useConnectionStore } from './lib/store/connection'

export default function App() {
  const {
    serverUrl,
    token,
    status,
    error,
    screenshotMetaSummary,
    setConfig,
    setStatus,
    setScreenshotMetaSummary
  } = useConnectionStore()
  const [inputUrl, setInputUrl] = useState(serverUrl)
  const [inputToken, setInputToken] = useState(token)
  const connected = status === 'connected' || status === 'reconnecting'

  useEffect(() => {
    // Zustand 的持久化配置可能晚于 React 首次渲染完成, 保持表单回填与保存值一致。
    const unsubscribe = useConnectionStore.persist.onFinishHydration((state) => {
      setInputUrl(state.serverUrl)
      setInputToken(state.token)
    })
    if (useConnectionStore.persist.hasHydrated()) {
      const state = useConnectionStore.getState()
      setInputUrl(state.serverUrl)
      setInputToken(state.token)
    }
    return unsubscribe
  }, [])

  useEffect(() => {
    void window.api.getServerLinkStatus().then(({ status, error }) => setStatus(status, error))
    window.api.onServerLinkStatus((status, error) => setStatus(status, error))
    window.api.onScreenshotMeta(({ summary }) => setScreenshotMetaSummary(summary))
    return () => {
      window.api.removeServerLinkStatusListener()
      window.api.removeScreenshotMetaListener()
    }
  }, [setStatus, setScreenshotMetaSummary])

  const connect = async () => {
    const url = inputUrl.trim()
    const nextToken = inputToken.trim()
    if (!url || !nextToken) {
      setStatus('error', '服务端 URL 与配对令牌均必填')
      return
    }
    setConfig({ serverUrl: url, token: nextToken })
    setStatus('connecting', '')
    try {
      const result = await window.api.startServerLink({ url, token: nextToken })
      if (result.error) setStatus(result.status, result.error)
    } catch (error) {
      setStatus('error', error instanceof Error ? error.message : String(error))
    }
  }

  if (connected) {
    return (
      <div className="capsule-drag">
        <span
          className={status === 'connected' ? 'status-indicator' : 'status-indicator waiting'}
        />
        <span>{status === 'connected' ? '已连接' : '重连中'}</span>
        {status === 'reconnecting' && error && <span className="status-detail">{error}</span>}
        {screenshotMetaSummary && <span className="status-detail">· {screenshotMetaSummary}</span>}
      </div>
    )
  }

  return (
    <div className="setup-page">
      <header className="titlebar">耳机录音器</header>
      <main className="setup-content">
        <h1>连接服务端</h1>
        <p>每次启动需手动连接；配置已保存，下次启动自动回填。</p>
        <label htmlFor="server-url">服务端 URL</label>
        <input
          id="server-url"
          value={inputUrl}
          onChange={(event) => setInputUrl(event.target.value)}
          placeholder="ws://x.x.x.x:9109/client"
        />
        <label htmlFor="pairing-token">配对令牌</label>
        <input
          id="pairing-token"
          type="password"
          value={inputToken}
          onChange={(event) => setInputToken(event.target.value)}
          placeholder="配对令牌"
        />
        <button type="button" onClick={connect} disabled={status === 'connecting'}>
          {status === 'connecting' ? '连接中…' : '连接服务端'}
        </button>
        {status === 'error' && <p className="error-message">{error || '连接失败'}</p>}
      </main>
    </div>
  )
}
