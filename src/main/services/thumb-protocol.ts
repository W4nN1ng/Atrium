/**
 * athumb:// 协议：把 %APPDATA%\A\thumbs 里的缓存图喂给界面。
 *
 * 为什么不用 file:///：dev 页面跑在 http://localhost:5173，
 * Chromium 不允许非 file 源加载 file:// 子资源（webSecurity 默认开着），
 * 打包版却是 file://，同一份代码两种结果 —— 缩略图会在 dev 里全灰、
 * 打包后才出来，这种"只有某一边能看"的问题最难查。
 * 自定义协议两边一致，而且天然把可访问范围锁在缩略图目录里。
 */
import { protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import log from 'electron-log'
import { P } from './paths'
import { THUMB_SCHEME, thumbKeyFromUrl } from '../library/thumbRules'

/** 必须在 app ready 之前调用，否则 standard 权限拿不到（<img> 会当成非法 URL） */
export function registerThumbSchemePrivileges(): void {
  protocol.registerSchemesAsPrivileged([
    {
      scheme: THUMB_SCHEME,
      privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, bypassCSP: true }
    }
  ])
}

/** 在 app ready 之后调用 */
export function installThumbProtocol(): void {
  protocol.handle(THUMB_SCHEME, async (request) => {
    const key = thumbKeyFromUrl(request.url)
    if (!key) return new Response('bad request', { status: 400 })
    const file = path.join(P.thumbs(), key + '.jpg')
    // path.join 对绝对路径/.. 已经收敛过一次，这里再确认一次落在缓存目录内
    const root = path.resolve(P.thumbs())
    if (!path.resolve(file).startsWith(root + path.sep)) return new Response('forbidden', { status: 403 })
    if (!fs.existsSync(file)) return new Response('not found', { status: 404 })
    try {
      const buf = fs.readFileSync(file)
      return new Response(new Uint8Array(buf), {
        status: 200,
        headers: { 'content-type': 'image/jpeg', 'content-length': String(buf.length), 'cache-control': 'max-age=31536000, immutable' }
      })
    } catch (e) {
      log.warn('缩略图读取失败 ' + file + '：' + (e instanceof Error ? e.message : String(e)))
      return new Response('error', { status: 500 })
    }
  })
}

/** 给主进程自己用的文件地址（托盘/通知一类要真 URL 的地方） */
export function thumbFileUrl(key: string): string {
  return pathToFileURL(path.join(P.thumbs(), key + '.jpg')).toString()
}
