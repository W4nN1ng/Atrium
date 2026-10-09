import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.spec.ts', 'src/**/__tests__/**/*.spec.ts'],
    globals: false,
    /**
     * better-sqlite3 是原生模块，跑在 worker_threads 里会在**退出时** Segmentation fault：
     * 测试全绿、汇总也打出来了，退出码却是 139 —— 而 build 脚本第一步就是 npm test，
     * 于是打包被随机带崩（实测：只有 5000 条文档那条重索引测试会触发）。
     * 换 forks 进程池退出就干净了，代价是慢一点。
     */
    pool: 'forks',
    testTimeout: 30000,
    /**
     * 建 32MB 假包、灌 5 万条文档这类 fixture 别被默认值掐掉。
     * 实测：pool=forks 并行 + 16GB 机器上，perf 那组的 beforeAll 偶尔会跑过 60 秒，
     * 表现是"某条 perf 测试随机超时"，单跑又全绿 —— 那是抢 CPU，不是变慢。
     */
    hookTimeout: 180000
  }
})
