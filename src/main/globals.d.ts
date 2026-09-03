// 调试包构建标志：electron.vite.config.ts 在 DEV_BUILD=1 时注入编译期字面量
// （CI build-mac-dev.yml 出的调试包为 true；dev server 与生产包均为 false）。
// 运行时该标识符已被 define 替换为字面量，声明仅服务于类型检查。
// 注意：不能放进 index.d.ts——它顶部有 import 是模块文件，declare global
// 的 var 对裸标识符解析不可见；本文件无 import/export，顶层声明天然全局。
declare const __DEV_BUILD__: boolean
