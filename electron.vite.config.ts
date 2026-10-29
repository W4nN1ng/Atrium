import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import { resolve } from 'node:path'

export default defineConfig({
  main: {
    // worker_threads 读不了 asar 里的脚本，所以 out/main 整个解包到 app.asar.unpacked；
    // 代价是 worker.js 的 require 再也回不到 asar 里的 node_modules ——
    // 实测打包版一跑就 "Cannot find module 'hash-wasm'"（dev 永远撞不到，因为都在磁盘上）。
    // 所以 worker 用到的这几个纯 JS 包必须内联进 bundle，别留在运行时解析。
    plugins: [externalizeDepsPlugin({ exclude: [
          // worker 用到的全部纯 JS 包（含传递依赖）
          'hash-wasm', 'yauzl', 'pend', 'iconv-lite', 'safer-buffer',
          'tar', 'chownr', 'fs-minipass', 'minipass', 'minizlib', 'mkdirp', 'yallist',
          // 分类链路的词典/解析也是 worker 在用
          'pinyin-pro', 'wanakana',
          // RAR 解码器必须进入 worker 图；WASM 通过 extraResources 离线提供。
          'node-unrar-js'] })],
    build: {
      outDir: 'out/main',
      lib: {
        // 两个入口：主进程本体 + 摄取 worker（worker_threads 要一个独立文件）
        entry: {
          index: resolve(__dirname, 'src/main/index.ts'),
          worker: resolve(__dirname, 'src/main/ingest/worker.ts')
        },
        formats: ['cjs'],
        fileName: (_format: string, entryName: string) => `${entryName}.js`
      },
      rollupOptions: {
        // 分类表 / 词典 / 桥接模板都是运行时读的外部文件，不打进 bundle
        external: ['electron', 'better-sqlite3']
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: 'out/preload',
      lib: {
        entry: resolve(__dirname, 'src/preload/index.ts'),
        formats: ['cjs'],
        fileName: () => 'index.js'
      }
    }
  },
  renderer: {
    root: resolve(__dirname, 'src/renderer'),
    plugins: [react()],
    build: {
      outDir: resolve(__dirname, 'out/renderer'),
      rollupOptions: {
        input: resolve(__dirname, 'src/renderer/index.html')
      }
    }
  }
})
