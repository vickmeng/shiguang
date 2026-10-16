/**
 * Vitest 配置（独立于 electron.vite.config.ts，避免破坏 electron-vite 构建）。
 *
 * 桌面主进程测试只 mock 不加载真实原生模块（better-sqlite3 / Electron API），
 * 因此无需 ABI rebuild；各测试文件内通过 vi.mock 隔离 electron 副作用。
 */
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
