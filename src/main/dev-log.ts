// dev 包专属排障日志（PRD tasks/服务端指令.md §9「客户端日志收集」）：
// - 仅 __DEV_BUILD__ 构建生效（编译期字面量，生产包恒走 return，零落盘零痕迹）
// - 落盘 userData/dev-debug.log，1MB 轮转（.old 备份），mac 排障时直接取文件
// - 记录内容：连接状态变化、服务端指令执行（截图耗时/源数量/字节数）、异常
//   ——用于诊断 TCC 拒绝（getSources 挂起→超时 / 返回全黑图）这类无异常抛出的静默故障
import { app } from 'electron'
import { appendFileSync, renameSync, statSync } from 'node:fs'
import { join } from 'node:path'

const MAX_LOG_BYTES = 1024 * 1024
let headerWritten = false

/** dev 包排障日志；生产包为编译期空操作 */
export function devLog(tag: string, message: string): void {
  // __DEV_BUILD__ 由 electron.vite.config.ts define 注入字面量：
  // 生产构建此处为 `if (!false) return` 即恒 return，后续代码被 minifier 折叠消除
  if (!__DEV_BUILD__) return

  try {
    const logPath = join(app.getPath('userData'), 'dev-debug.log')
    // 超限轮转：当前文件改名 .old（覆盖旧备份），新文件从零开始
    try {
      if (statSync(logPath).size > MAX_LOG_BYTES) renameSync(logPath, `${logPath}.old`)
    } catch {
      // 文件不存在（首条日志）——正常路径，继续写
    }
    if (!headerWritten) {
      headerWritten = true
      appendFileSync(
        logPath,
        `===== dev-debug ${new Date().toISOString()} app=${app.getName()} v${app.getVersion()} =====\n`
      )
    }
    appendFileSync(logPath, `${new Date().toISOString()} [${tag}] ${message}\n`)
  } catch {
    // 日志失败不影响业务（如 userData 目录暂不可用）
  }
}
