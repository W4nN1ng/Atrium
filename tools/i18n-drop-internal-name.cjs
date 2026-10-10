/**
 * 第 10 轮 F · 把界面文案里当产品名用的内部代号「A」换成 Atrium / 它。
 *
 * 为什么用脚本不手改：三份语言文件加起来四十来条，手改必漏；
 * 而这条要求（"公开物料里不许出现内部代号"）以后由 `tests/renderer/i18n-hygiene.spec.ts` 长期钉住。
 *
 * 只改**值**，不动 key；每条都要求"原文完全命中一次"，否则报错停手（不静默跳过）。
 * 跑完这个脚本本身就该被删掉？不 —— 留着，因为下次再漂可以照抄这张表。
 */
const fs = require('node:fs')
const path = require('node:path')

const I18N = path.resolve(__dirname, '../src/renderer/i18n')

/** key（点号路径）→ 要替换的若干 [原文片段, 新片段] */
const MAP = {
  'zh-CN': {
    'library.memberTooBroad': [['A 不替你选', '它不替你选']],
    'library.noteNestedArchive': [['A 只处理一层', '它只处理一层']],
    'project.bridgeAskBody': [['还没装 A 的桥接', '还没装 Atrium 的桥接'], ['装了它，A 才知道', '装了它，Atrium 才知道']],
    'settings.autoLaunchHint': [['A 必须常驻托盘', 'Atrium 必须常驻托盘']],
    'settings.autoSwitchBehaviorHint': [['A 该做什么', '它该做什么']],
    'settings.trayRequiredNote': [['A 只有开着才能感知', 'Atrium 只有开着才能感知']],
    'settings.autoLaunchAskTitle': [['要让 A 开机常驻托盘吗', '要让 Atrium 开机常驻托盘吗']],
    'settings.autoLaunchAskBody': [['A 必须开着才能自动切', 'Atrium 必须开着才能自动切'], ['手动打开 A 一样能自动切', '手动打开 Atrium 一样能自动切']],
    'settings.synonymsKanjiHint': [['所以 A 不做', '所以它不做']],
    'collections.backfillEmptyHint': [['打开 Unity 时 A 没地方可切', '打开 Unity 时它没地方可切']],
    'err.selfIngest': [['这是 A 自己的目录', '这是 Atrium 自己的目录']],
    'err.extractNoLibrary': [['A 推不出安全的抽取目录', '它推不出安全的抽取目录']],
    'rearchive.reason.outside': [['A 不挪别人目录里的东西', '它不挪别人目录里的东西']],
    'installed.empty': [['A 的导入日志里', 'Atrium 的导入日志里']],
    'installed.noteLogOnly': [['只统计通过 A 导入的那几次', '只统计通过 Atrium 导入的那几次'], ['A 查不到', '它查不到']],
    'wizard.step1.body': [['A 只往这里归档素材', 'Atrium 只往这里归档素材']],
    'wizard.step1.facts.files': [['A 吃得下的文件', 'Atrium 吃得下的文件']],
    'wizard.step2.body': [['往里丢东西 A 会自动排队收编', '往里丢东西它会自动排队收编']],
    'wizard.step4.body': [['A 得在托盘里活着', 'Atrium 得在托盘里活着']],
    'wizard.step4.launchHint': [['先把 A 打开', '先把 Atrium 打开']]
  },
  en: {
    'library.memberOpenHint': [["— A won't pick for you", "— it won't pick for you"]],
    'library.noteNestedArchive': [['A only handles one level', 'it only handles one level']],
    'project.bridgeAskBody': [["A's bridge", "Atrium's bridge"], ['A knows whether Unity', 'Atrium knows whether Unity']],
    'settings.autoLaunchHint': [['A must keep running in the tray', 'Atrium must keep running in the tray']],
    'settings.autoSwitchBehaviorHint': [['what A does', 'what it does']],
    'settings.trayRequiredNote': [['A can only notice Unity starting', 'Atrium can only notice Unity starting']],
    'settings.autoLaunchAskTitle': [['start A with Windows', 'start Atrium with Windows']],
    'settings.autoLaunchAskBody': [['A has to be running to switch', 'Atrium has to be running to switch'], ['open A yourself', 'open Atrium yourself']],
    'settings.synonymsKanjiHint': [['so A does not do it', 'so it does not do it']],
    'collections.backfillEmptyHint': [['so A has nowhere to switch', 'so there is nowhere to switch']],
    'err.selfIngest': [["A's own folder", "Atrium's own folder"]],
    'err.extractNoLibrary': [['A cannot derive a safe extraction folder', 'it cannot derive a safe extraction folder']],
    'rearchive.reason.outside': [['A does not move files', 'it does not move files']],
    "installed.empty": [["A's import log", "Atrium's import log"]],
    'installed.noteLogOnly': [['imported through A', 'imported through Atrium'], ['A cannot see', 'it cannot see']],
    'wizard.step1.body': [['A archives assets here', 'Atrium archives assets here']],
    'wizard.step1.facts.files': [['files A can ingest', 'files Atrium can ingest']],
    'wizard.step2.body': [['A queues them', 'it queues them']],
    'wizard.step4.body': [['A has to stay in the tray', 'Atrium has to stay in the tray']],
    'wizard.step4.launchHint': [['open A first', 'open Atrium first']]
  },
  ja: {
    'library.memberOpenHint': [['A は選べません', 'Atrium は選べません']],
    'library.noteNestedArchive': [['A は 1 段しか扱いません', 'Atrium は 1 段しか扱いません']],
    'project.bridgeAskBody': [['A のブリッジ', 'Atrium のブリッジ'], ['A でないと分かりません', 'Atrium でないと分かりません']],
    'settings.autoLaunchHint': [['A 必须常驻托盘', 'Atrium 必须常驻托盘'], ['A がトレイに常駐', 'Atrium がトレイに常駐']],
    'settings.autoSwitchBehaviorHint': [['A がどう動くか', 'Atrium がどう動くか']],
    'settings.trayRequiredNote': [['A が Unity の起動を感知', 'Atrium が Unity の起動を感知']],
    'settings.autoLaunchAskTitle': [['A をログイン時に起動', 'Atrium をログイン時に起動']],
    'settings.autoLaunchAskBody': [['A が起動している必要があります', 'Atrium が起動している必要があります'], ['手動で A を開けば', '手動で Atrium を開けば']],
    'settings.synonymsKanjiHint': [['A ではやりません', 'Atrium ではやりません']],
    'collections.backfillEmptyHint': [['A が切り替え先', 'Atrium が切り替え先']],
    'err.selfIngest': [['A 自身のフォルダ', 'Atrium 自身のフォルダ']],
    'err.extractNoLibrary': [['A は安全な', 'Atrium は安全な']],
    'rearchive.reason.outside': [['A は他フォルダを動かしません', 'Atrium は他フォルダを動かしません']],
    'installed.empty': [['A のインポートログ', 'Atrium のインポートログ']],
    'installed.noteLogOnly': [['A 経由のインポート', 'Atrium 経由のインポート'], ['A には映らず', 'Atrium には映らず']],
    'wizard.step1.body': [['A はここにだけ', 'Atrium はここにだけ']],
    'wizard.step1.facts.files': [['A が扱えるファイル', 'Atrium が扱えるファイル']],
    'wizard.step2.body': [['A がキューに入れます', 'Atrium がキューに入れます']],
    'wizard.step4.body': [['A がトレイにいる', 'Atrium がトレイにいる']],
    'wizard.step4.launchHint': [['その都度 A を開く', 'その都度 Atrium を開く']]
  }
}

function get(obj, key) {
  const parts = key.split('.')
  let node = obj
  for (let i = 0; i < parts.length - 1; i++) {
    if (!node || typeof node !== 'object') return null
    node = node[parts[i]]
  }
  return { parent: node, leaf: parts[parts.length - 1] }
}

let changed = 0
const problems = []
for (const [loc, table] of Object.entries(MAP)) {
  const file = path.join(I18N, `${loc}.json`)
  const data = JSON.parse(fs.readFileSync(file, 'utf8'))
  for (const [key, pairs] of Object.entries(table)) {
    const hit = get(data, key)
    if (!hit || typeof hit.parent[hit.leaf] !== 'string') {
      problems.push(`${loc} ${key} 不是字符串或不存在`)
      continue
    }
    let v = hit.parent[hit.leaf]
    for (const [from, to] of pairs) {
      const n = v.split(from).length - 1
      if (n !== 1) {
        problems.push(`${loc} ${key}：片段「${from}」命中 ${n} 次（要恰好 1 次）`)
        continue
      }
      v = v.split(from).join(to)
      changed++
    }
    hit.parent[hit.leaf] = v
  }
  fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n')
}
if (problems.length) {
  console.error(' 有片段没对上，**这些没改**：')
  for (const p of problems) console.error('   ' + p)
  console.log(`已改 ${changed} 处`)
  process.exit(1)
}
console.log(`全部对上：改了 ${changed} 处`)
