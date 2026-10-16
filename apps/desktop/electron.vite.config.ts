import { resolve } from 'node:path'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

export default defineConfig({
  main: {
    plugins: [
      // @shiguang/shared / @shiguang/ai 以 TS 源码直引（package.json 入口指向 ./src/index.ts），
      // 必须打进主进程 bundle，从 external 依赖名单中排除
      externalizeDepsPlugin({ exclude: ['@shiguang/shared', '@shiguang/ai'] }),
    ],
    build: {
      rollupOptions: {
        // 原生模块不打包，保留运行时 require；ABI 由 @electron/rebuild postinstall 对齐
        external: ['better-sqlite3'],
      },
    },
  },
  preload: {
    plugins: [
      // @shiguang/shared 以 TS 源码直引，必须打进 preload bundle
      externalizeDepsPlugin({ exclude: ['@shiguang/shared'] }),
    ],
    build: {
      // electron-vite 约定：preload 默认输出 cjs 到 out/preload
      rollupOptions: {
        input: resolve(__dirname, 'src/preload/index.ts'),
      },
    },
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    build: {
      rollupOptions: {
        // M1 双页面：宠物窗口 + 输入框窗口；M2 追加后台（console）窗口
        input: {
          pet: resolve(__dirname, 'src/renderer/pet/pet.html'),
          input: resolve(__dirname, 'src/renderer/input/input.html'),
          console: resolve(__dirname, 'src/renderer/console/console.html'),
        },
      },
    },
  },
})
