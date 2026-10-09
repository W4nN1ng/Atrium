import { app, Menu, Tray, nativeImage } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import log from 'electron-log'
import type { LocaleKey } from '../shared/types'
import { APP_DISPLAY_NAME } from '../shared/constants'
import { getSettings } from './services/settings'
import { i18nFile } from './services/paths'
import { iconPath } from './window'

let tray: Tray | null = null

export interface TrayActions {
  showMain(): void
  showMiniDrop(): void
  quit(): void
}

/**
 * 托盘菜单文案也走同一份 i18n JSON，不在这里硬编码中文。
 * 文件位置由 i18nFile() 找（打包后在 resources/i18n，dev 在 src/renderer/i18n）。
 */
function trayLabels(): Record<string, string> {
  const lang: LocaleKey = getSettings().language
  const file = i18nFile(lang)
  const fallback = i18nFile('zh-CN')
  for (const f of [file, fallback]) {
    try {
      const json = JSON.parse(fs.readFileSync(f, 'utf8')) as { common?: Record<string, string> }
      const c = json.common
      if (c) {
        return {
          show: c.trayShow ?? '显示主窗口',
          drop: c.trayDrop ?? '迷你投放窗',
          quit: c.trayQuit ?? '退出'
        }
      }
    } catch (e) {
      log.warn('读托盘文案失败 ' + f + '：' + (e instanceof Error ? e.message : String(e)))
    }
  }
  return { show: '显示主窗口', drop: '迷你投放窗', quit: '退出' }
}

export function createTray(actions: TrayActions): Tray {
  if (tray && !tray.isDestroyed()) return tray
  const icon = iconPath()
  const image = icon ? nativeImage.createFromPath(icon) : nativeImage.createEmpty()
  const t = new Tray(image.isEmpty() ? image : image.resize({ width: 16, height: 16 }))
  tray = t
  const rebuild = (): void => {
    const L = trayLabels()
    t.setContextMenu(
      Menu.buildFromTemplate([
        { label: L.show, click: actions.showMain },
        { label: L.drop, click: actions.showMiniDrop },
        { type: 'separator' },
        {
          label: app.getName(),
          enabled: false
        },
        { type: 'separator' },
        { label: L.quit, click: actions.quit }
      ])
    )
  }
  rebuild()
  const L0 = trayLabels()
  t.setToolTip(APP_DISPLAY_NAME)
  t.setTitle(L0.show)
  t.on('click', () => actions.showMain())
  t.on('double-click', () => actions.showMain())
  return t
}

export function refreshTray(): void {
  if (tray && !tray.isDestroyed()) {
    const L = trayLabels()
    tray.setToolTip(APP_DISPLAY_NAME)
    tray.setTitle(L.show)
  }
}

export function destroyTray(): void {
  tray?.destroy()
  tray = null
}
