#!/usr/bin/env node
/**
 * R4 ④ · 把"口语叫法"写进分类表（`resources/lexicon/categories.json` 的 `synonyms`）。
 *
 * ## 为什么放分类表而不是在检索层硬编码词表
 *
 * `docs/SEARCH.md` §4 当初就写了这条结论。硬编码在 `search/` 里的词表有三宗罪：
 *  1. 设置页看不见也改不了 —— 用户想加"我家管贴图叫图包"只能等发版；
 *  2. 分类表可以增删分类，硬编码词表跟着分类表走就成孤儿；
 *  3. 别名不进 `search_alias` 的生成链，索引和反查会各说一套。
 * 放进分类表之后，它和 `label` 是同一种东西：**这张分类表的元数据**。
 *
 * ## 形状：扁平一组词，不按语言分三组
 *
 * `shared/normalize.ts:searchForms` 会把每个词展开成"原文 + 拼音 + 罗马字 + 假名"全套写法，
 * 所以 `衣服` 一条就同时能被 `yifu`、`衣`、`衣服` 命中。按 locale 分三份只是把同一件事做三遍，
 * 还会诱导人去纠结"这个词算中文还是日文"。
 *
 * ## 为什么这里不放单字
 *
 * `aliases.ts:pushUnique` 丢掉长度 < 2 的别名（单字命中面太宽，会把整个库都捞出来）。
 * 表里写「刀」「角」这种单字是白写，所以要么给双字（武器 / 兽角），要么就别写。
 *
 * 用法：node tools/add-category-synonyms.cjs [--print]
 */
const fs = require('node:fs')
const path = require('node:path')

const FILE = path.resolve(__dirname, '..', 'resources', 'lexicon', 'categories.json')

/** 一级分类的口语叫法 */
const CATS = {
  model: ['アバター', 'avatar', '人物', '角色', '皮', '3d模型', 'モデル', '全身'],
  clothing: ['衣服', '服', '衣装', '穿搭', '换装', 'clothes', 'ウェア', 'クローズ'],
  hair: ['发型', '假发', '头发模型', 'ヘア', 'ヘアー', 'hair'],
  accessory: ['饰品', '首饰', '配件', '小物', '挂件', 'アクセ', 'アクセサリー'],
  texture: ['纹理', '贴图文件', '图片素材', 'テクスチャ', 'texture'],
  material: ['材质球', '材质包', 'マテリアル', 'material', 'mtl'],
  shader: ['着色', '着色文件', 'シェーダー', 'shader'],
  plugin: ['脚本', '组件', '系统', '功能', 'プラグイン', 'plugin', 'sdk'],
  animation: ['动作', '动画片段', '动效', 'アニメ', 'モーション', 'animation', 'anim', 'motion'],
  audio: ['声音', '音效', '音乐', '语音', 'bgm', '音声', 'sound', 'audio'],
  prop: ['物品', '物件', '手持', '小道具', 'プロップ', 'prop', 'props'],
  world: ['地图', '场景', '世界', '房间', '会所', 'ワールド', 'world', 'map'],
  tool: ['软件', '编辑器', '实用工具', 'ツール', 'tool', 'tools', 'utility'],
  reference: ['资料', '文档', '手册', '说明', '教程', '指南', 'リファレンス', 'reference', 'docs'],
  other: ['其它', '未分类', '杂项', 'misc', 'other']
}

/** 二级分类的口语叫法，键是 `一级/二级` */
const SUBS = {
  'model/base': ['素体模型', '身体', 'body'],
  'model/finished': ['完成品', '成品', '完成モデル', 'ready'],
  'model/head': ['头部模型', '頭部', 'head'],
  'model/body_part': ['部件', '肢体', '身体パーツ', 'part'],
  'model/retrofit': ['改造', '改模', '改造モデル', 'mod'],
  'clothing/top': ['上装', 'tops', 'shirt', 'ブラウス'],
  'clothing/bottom': ['裤子', '裙子', 'ボトム', 'pants', 'skirt'],
  'clothing/dress': ['洋装', '礼服', 'ドレス', 'onepiece'],
  'clothing/underwear': ['内衣', '泳装', '水着', '下着', 'swimsuit'],
  'clothing/outfit': ['一套', '全身套', 'コーデ', 'coordinate'],
  'clothing/coat': ['外套', '大衣', 'コート', 'jacket'],
  'clothing/kimono': ['和装', '振袖', '着物', 'kimono'],
  'clothing/uniform': ['校服', '制服', 'セーラー', 'uniform'],
  'clothing/socks': ['袜子', '长筒袜', '靴下', 'socks'],
  'clothing/shoes': ['鞋', '靴', 'ブーツ', 'shoes', 'boots'],
  'clothing/gloves': ['手袋', 'グローブ', 'gloves'],
  'hair/long': ['長い髪', 'longhair'],
  'hair/short': ['短发', 'ボブ', 'shorthair'],
  'hair/twintail': ['双马尾', 'ツインテール', 'twintail'],
  'hair/bangs': ['刘海', '前发', '前髪', 'bangs'],
  'hair/hairwear': ['发饰', '发卡', 'ヘアアクセ'],
  'hair/full': ['全套发型', '发型套', 'full hair'],
  'accessory/glasses': ['眼镜', '墨镜', 'メガネ', 'glasses'],
  'accessory/earring': ['耳环', '耳钉', 'ピアス', 'earring'],
  'accessory/headwear': ['头饰', '帽子', '发箍', 'ヘッドウェア', 'headwear'],
  'accessory/tail': ['尾巴', '兽尾', '尻尾', 'tail'],
  'accessory/ears': ['兽耳', '耳朵', 'ケモミミ', 'ears'],
  'accessory/horn': ['兽角', 'ツノ', 'horn'],
  'accessory/wings': ['翅膀', '羽翼', 'ウィング', 'wings'],
  'accessory/necklace': ['项链', '颈饰', 'ネックレス', 'necklace'],
  'accessory/ring': ['戒指', '指环', 'リング', 'ring'],
  'accessory/bag': ['背包', '包包', '手提包', 'バッグ', 'bag'],
  'accessory/mask': ['面具', '面罩', 'マスク', 'mask'],
  'texture/skin': ['皮肤贴图', 'スキン', 'skin'],
  'texture/face': ['脸部贴图', '面部', '顔', 'face'],
  'texture/eye': ['眼睛贴图', '瞳', '目', 'eye'],
  'texture/clothing_texture': ['衣服贴图', '服装纹理'],
  'texture/tattoo': ['纹身', '刺青', 'タトゥー', 'tattoo'],
  'texture/makeup': ['化妆', '妆容', 'メイク', 'makeup'],
  'texture/expression': ['表情贴图', '表情图', 'フェイス', 'expression'],
  'texture/psd': ['分层源文件', 'psd源文件', '源文件'],
  'material/mat': ['材质球', 'mat'],
  'material/preset': ['预设', '预设材质', 'preset'],
  'material/matcap': ['matcap材质', '金属球贴图'],
  'material/pack': ['材质包', '材质合集', 'mat pack'],
  'shader/general': ['通用着色器', '标准着色器'],
  'shader/skin': ['皮肤着色', '皮肤渲染'],
  'shader/clothing': ['衣服着色', '服装渲染'],
  'shader/effect': ['特效', '粒子特效', 'エフェクト', 'effect'],
  'shader/post': ['后处理', '后处理效果', 'ポストエフェクト', 'post process'],
  'plugin/action': ['动作插件', '动作系统', 'action'],
  'plugin/expression': ['表情插件', '表情菜单', 'emote'],
  'plugin/closet': ['换装插件', '衣柜', 'closet', '服装切换'],
  'plugin/physics': ['物理', '物理骨骼', 'physics'],
  'plugin/optimizer': ['优化', '性能优化', 'optimizer', 'fps'],
  'plugin/camera': ['相机', '拍照', '摄影', 'camera'],
  'plugin/interactive': ['交互', '可交互', 'interactive'],
  'plugin/menu_ui': ['菜单', '界面', '菜单脚本', 'ui'],
  'plugin/sound': ['音效插件', '声音插件'],
  'plugin/tracker': ['追踪', '计数追踪', 'tracker'],
  'plugin/upload': ['上传', '上传工具', 'upload'],
  'plugin/editor': ['编辑器工具', 'editor工具', 'editor'],
  'plugin/network': ['网络', '同步', '联机', 'network', 'sync'],
  'plugin/framework': ['依赖', '框架', '前置', 'framework', 'dependency'],
  'plugin/other': ['其他插件'],
  'animation/motion': ['动作', '动作数据', 'モーション'],
  'animation/dance': ['舞蹈', '跳舞', 'ダンス', 'dance'],
  'animation/idle': ['待机', '站姿', '待机动作', 'idle'],
  'animation/facial': ['表情', '面部动画', 'フィシャル', 'facial'],
  'animation/controller': ['动画控制器', 'animator', '控制器'],
  'animation/preset': ['动画预设'],
  'audio/se': ['音效', '短音', '効果音', 'se'],
  'audio/music': ['音乐', '曲子', 'bgm', '曲', 'music'],
  'audio/voice': ['语音', '人声', 'ボイス', 'voice'],
  'audio/ambient': ['环境音', '氛围音', '環境音', 'ambient'],
  'prop/weapon': ['武器', '武器模型', 'ウェポン', 'weapon'],
  'prop/food': ['食物', '食品', '食べ物', 'food'],
  'prop/furniture': ['家具', '家私', 'ファニチャー', 'furniture'],
  'prop/decor': ['装饰', '摆件', '装飾', 'decor'],
  'prop/fx_prop': ['特效道具', '特效件', 'fx'],
  'world/map': ['地图', '世界地图', 'マップ', 'map'],
  'world/world_prop': ['场景道具', '世界道具'],
  'world/skybox': ['天空盒', '天空', 'スカイボックス', 'skybox'],
  'tool/modeling': ['建模', '建模工具', 'モデリング', 'modeling'],
  'tool/texturing': ['贴图工具', '纹理工具', '纹理制作'],
  'tool/convert': ['转换', '格式转换', 'コンバータ', 'convert'],
  'tool/compress': ['压缩', '瘦身', '圧縮', 'compress'],
  'tool/other': ['其他工具'],
  'reference/ref_image': ['参考图', '设定图', '参考画像'],
  'reference/tutorial': ['教程', '教学', '指南', 'チュートリアル', 'tutorial'],
  'reference/doc': ['文档', '说明书', '说明', 'ドキュメント', 'doc'],
  'reference/video': ['视频', '影像', '動画', 'video'],
  'other/unclassified': ['未归类', '没分类'],
  'other/bundle': ['合集', '同捆', 'bundle']
}

function clean(list) {
  const out = []
  for (const raw of list ?? []) {
    const s = String(raw ?? '').trim()
    if (s.length < 2) continue
    if (!out.includes(s)) out.push(s)
  }
  return out
}

const cfg = JSON.parse(fs.readFileSync(FILE, 'utf8'))
let catHits = 0
let subHits = 0
const unknown = []

for (const c of cfg.categories) {
  const list = clean(CATS[c.key])
  if (list.length) {
    c.synonyms = list
    catHits++
  } else if (CATS[c.key]) {
    unknown.push('一级 ' + c.key + ' 的表被清空的（都是单字？）')
  } else {
    unknown.push('没有给一级分类 ' + c.key + ' 写口语')
  }
  for (const s of c.subcategories) {
    const key = c.key + '/' + s.key
    const sl = clean(SUBS[key])
    if (sl.length) {
      s.synonyms = sl
      subHits++
    } else if (SUBS[key]) {
      unknown.push('二级 ' + key + ' 的表被清空')
    }
  }
}

const missingSubs = Object.keys(SUBS).filter((k) => !cfg.categories.find((c) => c.key === k.split('/')[0])?.subcategories.find((s) => s.key === k.split('/')[1]))
for (const k of missingSubs) unknown.push('表里有二级 ' + k + '，但分类表里没有这个二级（写错了？）')

if (process.argv.includes('--print')) {
  console.log(JSON.stringify({ catHits, subHits, unknown }, null, 1))
} else {
  fs.writeFileSync(FILE, JSON.stringify(cfg, null, 2) + '\n', 'utf8')
  console.log(`已写入 ${FILE}`)
  console.log(`  一级分类带口语：${catHits}/${cfg.categories.length}`)
  console.log(`  二级分类带口语：${subHits}/${cfg.categories.reduce((a, c) => a + c.subcategories.length, 0)}`)
}
for (const u of unknown) console.log('  ⚠ ' + u)
