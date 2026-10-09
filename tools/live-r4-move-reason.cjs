#!/usr/bin/env node
/**
 * R4 ③ 活体的补测：把"只登记不搬那件的 toast 到底写了什么"真的读出来。
 *
 * 上一版驱动那句 `界面 toast 里有没有原因：no` 用的是"叶子元素文本匹配"这个探针，
 * 而探针本身可疑（toast 的 DOM 结构、什么时候消失都会影响它）——
 * 所以这里不猜，直接把界面上那几行抓下来看。
 *
 * 用法：node tools/live-r4-move-reason.cjs   （A 得带 --remote-debugging-port 起着）
 */
const cp = require('node:child_process')
const path = require('node:path')

const ROOT = path.resolve(__dirname, '..')
const PORT = process.env.AVCA_CDP_PORT || '9225'
const ENV = { ...process.env, AVCA_CDP_PORT: PORT }
const SHOT = 'D:\\avca-r4-move\\r4-move-06-indexed-reason.png'

function ev(expr) {
  return cp
    .execFileSync(process.execPath, [path.join(__dirname, 'cdp-eval.cjs'), expr], {
      cwd: ROOT,
      encoding: 'utf8',
      env: ENV,
      maxBuffer: 16 * 1024 * 1024
    })
    .trim()
}

function ej(expr) {
  const raw = ev(expr)
  try {
    return JSON.parse(raw)
  } catch {
    return raw
  }
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log(
    '  点那张只登记的卡：' +
      JSON.stringify(
        ej(`(() => {
          const cards = [...document.querySelectorAll('.card')]
          const el = cards.find(n => (n.textContent || '').includes('Indexed'))
          if (!el) return JSON.stringify({ ok: false, seen: cards.map(c => (c.textContent || '').trim().slice(0, 16)) })
          el.dispatchEvent(new MouseEvent('click', { bubbles: true }))
          return JSON.stringify({ ok: true, name: (el.textContent || '').trim().slice(0, 24) })
        })()`)
      )
  )
  await sleep(1200)
  console.log(
    '  改下拉：' +
      JSON.stringify(
        ej(`(() => {
          const aside = [...document.querySelectorAll('aside')].find(a => a.querySelector('select'))
          if (!aside) return JSON.stringify({ ok: false, why: '详情面板没出现' })
          const sels = [...aside.querySelectorAll('select')]
          const set = (el, v) => {
            Object.getOwnPropertyDescriptor(Object.getPrototypeOf(el), 'value').set.call(el, v)
            el.dispatchEvent(new Event('change', { bubbles: true }))
          }
          set(sels[0], 'texture')
          set(sels[1], 'skin')
          return JSON.stringify({ cat: sels[0].value, sub: sels[1].value, catText: sels[0].selectedOptions[0].textContent.trim() })
        })()`)
      )
  )
  await sleep(500)
  console.log(
    '  保存：' +
      JSON.stringify(
        ej(`(() => {
          const b = [...document.querySelectorAll('button')].find(x => (x.textContent || '').trim() === '保存')
          if (!b) return JSON.stringify({ ok: false, why: '没有保存按钮（分类没改上？）' })
          b.click()
          return JSON.stringify({ ok: true })
        })()`)
      )
  )
  await sleep(1500)
  const dump = ej(`(() => {
    const m = document.body.innerText
    return JSON.stringify({
      dialogUp: /改分类：/.test(m),
      reasonLines: m.split('\\n').filter(l => /已保存|登记|没动|原因|库里|文件/.test(l)).slice(0, 8)
    })
  })()`)
  console.log('  界面上现在写着：' + JSON.stringify(dump, null, 1))
  cp.execFileSync(process.execPath, [path.join(__dirname, 'cdp-shot.cjs'), SHOT], { cwd: ROOT, env: ENV })
  console.log('  📷 ' + SHOT)
}

main().catch((e) => {
  console.error('FAILED: ' + (e && e.message ? e.message : e))
  process.exit(1)
})
