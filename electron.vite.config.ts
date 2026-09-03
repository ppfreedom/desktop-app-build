import { resolve } from 'path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// 调试包构建标志（CI build-mac-dev.yml 以 DEV_BUILD=1 构建）：编译期固化为字面量——
// 打包产物运行时读不到 CI 环境变量，只能在构建期决定；类型声明见 src/main/index.d.ts
const isDevBuild = process.env.DEV_BUILD === '1'

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    define: {
      __DEV_BUILD__: JSON.stringify(isDevBuild)
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()]
  },
  renderer: {
    resolve: {
      alias: {
        '@renderer': resolve('src/renderer/src'),
        '@': resolve('src/renderer/src')
      }
    },
    plugins: [react(), tailwindcss()]
  }
})
