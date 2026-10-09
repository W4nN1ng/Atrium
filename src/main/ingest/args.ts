/**
 * 解析 `A.exe --ingest <路径> [<路径>…]`（第 1 份 F1 入口 4、5）。
 *
 * 不能假设 --ingest 后面紧跟路径 —— Electron 会往 argv 里插自己的开关。
 * 实测 second-instance 收到的是：
 *   ["C:\\...\\electron.exe","--ingest","--allow-file-access-from-files",".","C:\\Windows\\notepad.exe"]
 * 老写法在这里直接 break，返回 0 个路径，等于右键"发送到 A"完全失效。
 * 所以：跳过所有开关、跳过 app 路径占位符 '.'、跳过 exe 自身，剩下的都当路径收。
 */
const INGEST_FLAGS = new Set(['--ingest', '/ingest', '-i'])

function isSwitch(token: string): boolean {
  return token.startsWith('-')
}

export function parseIngestArgs(argv: string[]): string[] {
  const out: string[] = []
  const self = argv[0] ? argv[0].toLowerCase() : ''

  for (const a of argv) {
    if (a.startsWith('--ingest=')) out.push(a.slice('--ingest='.length))
  }

  const flagIdx = argv.findIndex((a) => INGEST_FLAGS.has(a))
  if (flagIdx >= 0) {
    for (let i = flagIdx + 1; i < argv.length; i++) {
      const a = argv[i]
      if (!a || a === '.' || a === '..') continue
      if (isSwitch(a)) continue
      // 注意不要按 ".exe 结尾" 排除 —— 用户就是要摄取一个 exe（实测踩过）
      if (a.toLowerCase() === self) continue
      out.push(a)
    }
  } else if (!out.length) {
    // 没带 --ingest 时（比如把文件直接拖到 exe 图标上），收下像绝对路径的裸参数
    for (let i = 1; i < argv.length; i++) {
      const a = argv[i]
      if (!a || a === '.' || a === '..' || isSwitch(a)) continue
      if (a.toLowerCase() === self) continue
      if (/^[a-zA-Z]:[\\/]/.test(a) || a.startsWith('\\\\')) out.push(a)
    }
  }

  return Array.from(new Set(out))
}
