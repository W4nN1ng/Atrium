/**
 * 资源管理器右键"发送到 Atrium"（第 1 份 F1 入口 5）。
 *
 * 只写 HKCU，不碰 HKLM —— 不需要管理员权限，也不会给这台机器上别的账号留东西。
 * 卸载就是删这几个键，不残留。
 *
 * 菜单文字由渲染进程传进来（主进程没有 i18next，不许硬编码界面文案）。
 */
import { execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { app } from 'electron'
import log from 'electron-log'

const KEY_ROOT = 'HKCU\\Software\\Classes'
const SHELL_KEY = 'Atrium.Ingest'
/** 文件右键、文件夹右键、多选文件夹右键各一处 */
const LOCATIONS = ['*', 'Directory', 'Directory\\Background'] as const

export interface ShellMenuState {
  installed: boolean
  /** 注册表里现在指向哪个 exe（用于"我搬家了/重装了要不要重登记"） */
  target: string | null
}

/**
 * dev 下 process.execPath 是 electron.exe，登记进去等于给用户装坏菜单。
 * 所以优先用免安装版的 Atrium.exe（桌面快捷方式也指它），找不到才退回 execPath。
 */
export function ingestExePath(): string {
  if (app.isPackaged) return process.execPath
  const guess = path.resolve(process.cwd(), 'dist', 'win-unpacked', 'Atrium.exe')
  try {
    if (fs.existsSync(guess)) return guess
  } catch {
    /* 就当没有 */
  }
  return process.execPath
}

function reg(args: string[]): Promise<{ code: number; out: string }> {
  return new Promise((resolve) => {
    execFile('reg.exe', args, { windowsHide: true, encoding: 'buffer' }, (e, outBuf) => {
      const code = e ? Number((e as { code?: unknown }).code ?? 1) : 0
      // reg.exe 的中文输出走 ANSI 码页，这里只用来判断成功与否，解码失败也无所谓
      resolve({ code, out: String(outBuf ?? '') })
    })
  })
}

function keyPath(loc: string): string {
  return `${KEY_ROOT}\\${loc}\\shell\\${SHELL_KEY}`
}

export async function shellMenuState(): Promise<ShellMenuState> {
  const r = await reg(['query', keyPath('Directory'), '/v', ''] as string[])
  if (r.code !== 0) return { installed: false, target: null }
  const cmd = await reg(['query', `${keyPath('Directory')}\\command`, '/v', ''])
  const m = /REG_SZ\s+"?([^"\r\n]+?)"?\s*(?:--|$)/i.exec(cmd.out)
  return { installed: true, target: m ? m[1].trim() : null }
}

export interface ShellMenuResult {
  ok: boolean
  messageKey: 'settings.shellMenu.installed' | 'settings.shellMenu.uninstalled' | 'settings.shellMenu.failed'
  detail?: string
}

/**
 * 装菜单。
 * @param label 界面文字，例如"发送到 Atrium" / "Send to Atrium"
 */
export async function installShellMenu(label: string): Promise<ShellMenuResult> {
  const exe = ingestExePath()
  if (!/Atrium\.exe$/i.test(exe)) {
    log.warn('右键菜单登记被拒：找不到 Atrium.exe，只有 ' + exe)
    return {
      ok: false,
      messageKey: 'settings.shellMenu.failed',
      detail: '找不到 Atrium.exe（先跑 npm run build:dir 出免安装版）'
    }
  }
  const text = (label || 'Atrium').replace(/"/g, '').slice(0, 40)
  const command = `"${exe}" --ingest "%1"`

  for (const loc of LOCATIONS) {
    const base = keyPath(loc)
    const steps: string[][] = [
      ['add', base, '/ve', '/d', text, '/f'],
      ['add', base, '/v', 'Icon', '/d', `"${exe},0"`, '/f'],
      ['add', `${base}\\command`, '/ve', '/d', command, '/f']
    ]
    // 文件夹背景右键要 %V + %* 才吃得到多选
    if (loc === 'Directory\\Background') {
      steps[2] = ['add', `${base}\\command`, '/ve', '/d', `"${exe}" --ingest "%V" %*`, '/f']
    }
    for (const s of steps) {
      const r = await reg(s)
      if (r.code !== 0) {
        log.error('reg.exe 失败：' + s.join(' ') + ' -> ' + r.out.slice(0, 160))
        return { ok: false, messageKey: 'settings.shellMenu.failed', detail: 'reg.exe exit ' + r.code }
      }
    }
  }
  log.info('右键菜单已登记 → ' + exe)
  return { ok: true, messageKey: 'settings.shellMenu.installed' }
}

export async function uninstallShellMenu(): Promise<ShellMenuResult> {
  let failed = 0
  for (const loc of LOCATIONS) {
    const r = await reg(['delete', keyPath(loc), '/f'])
    // reg.exe 的中文输出按 ANSI 码页来，两种写法都认一下
    const absent = /找不到|cannot find/i.test(r.out)
    if (r.code !== 0 && !absent) {
      log.error('reg.exe 删除失败：' + loc + ' -> ' + r.out.slice(0, 160))
      failed++
    }
  }
  if (failed) return { ok: false, messageKey: 'settings.shellMenu.failed', detail: `${failed} 处没删掉` }
  log.info('右键菜单已移除')
  return { ok: true, messageKey: 'settings.shellMenu.uninstalled' }
}
