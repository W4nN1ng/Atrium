/**
 * `npm run dev` / `npm run dev:debug` 的启动器。
 *
 * ## 为什么不能直接调 `electron-vite dev`
 *
 * `ELECTRON_RUN_AS_NODE` 一旦被设为 `1`（有些终端、CI、agent harness 环境会设它），
 * electron.exe 会把主进程当**普通 Node 脚本**跑：运行时完全不初始化，
 * 于是 `require('electron')` 返回的**不是 API 对象，而是 electron.exe 的路径字符串**，
 * `electron.app` 就是 `undefined`。表现是一句极具误导性的崩溃：
 *
 * ```
 * TypeError: Cannot read properties of undefined (reading 'isPackaged')
 *     at Object.<anonymous> (out/main/index.js:...)
 *     at Module._compile ...
 * ```
 *
 * 看着像 bundle 坏了或者 electron-vite 配错了，实际什么都没坏 —— 只是那个环境变量。
 * 实测（2026-10-06）：本机 harness 里 `ELECTRON_RUN_AS_NODE=1`，dev 直接起不来；
 * 在同一台机器上 `set ELECTRON_RUN_AS_NODE=&& npm run dev:debug` 立刻正常。
 *
 * 所以这里**显式删掉它**再拉起 electron-vite，让"dev 起不来"不再是个环境谜题。
 *
 * ## 为什么用 spawn + inherit
 *
 * dev 服务器的输出要实时打在终端上（用户/agent 都靠它判断状态），
 * 而且受管控的沙箱环境里捕获子进程 stdio 会 EPERM —— `inherit` 两头都占。
 */
const { spawn } = require('node:child_process')
const path = require('node:path')

const env = { ...process.env }
delete env.ELECTRON_RUN_AS_NODE

/** 本机 npm 安装的可执行入口：优先用 node_modules/.bin 里的 .cmd（Windows）*/
const bin = path.join(__dirname, '..', 'node_modules', '.bin', process.platform === 'win32' ? 'electron-vite.cmd' : 'electron-vite')

const extra = process.argv.slice(2)
/**
 * ⚠ 活体红线（2026-10-09 被自己撞过一次）：带 `--remote-debugging-port` 的 dev 就是**给脚本开的实例**，
 * 而这类实例**必须**带 `AVCA_APP_HOME` 指到沙盒。漏了会怎样：它打开的就是用户真库
 * `%APPDATA%\A\library.db` —— 主进程一起来就跑工程发现，当场往真库里登记了新工程，
 * 而日志第一行还是「数据库就绪 C:\Users\…」（`services/paths.ts` 头部记过同一类事故）。
 * 所以这里直接拒绝启动，不靠人记性。
 */
const wantsCdp = extra.some((a) => a.startsWith('--remote-debugging-port'))
if (wantsCdp && !/avca|sandbox/i.test(process.env.AVCA_APP_HOME || '')) {
  console.error('[dev] 拒绝启动：带了 --remote-debugging-port 却没设 AVCA_APP_HOME（或路径里没有 avca/sandbox 字样）。')
  console.error('[dev] 那样这个实例会直接打开用户的真库。先：AVCA_APP_HOME=D:\\avca-…\\AppData 再起。')
  process.exit(2)
}
/**
 * electron-vite 用 `--` 把参数透传给 electron 本身，
 * 所以 `--remote-debugging-port=9222` 这类要放在分隔符后面。
 */
const args = ['dev']
if (extra.length) args.push('--', ...extra)

const child = spawn(bin, args, {
  env,
  stdio: 'inherit',
  shell: process.platform === 'win32'
})

child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal)
  else process.exit(code ?? 0)
})
