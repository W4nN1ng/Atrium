/**
 * 生成 resources/lexicon/lexicon.json（第 2 份 §6 种子词典）。
 *
 * 为什么不直接手写 JSON：词典条目几百上千条，手写 JSON 每条约 40 个 token，
 * 而且改一个权重要翻很久。这里用一行一组、逗号分词形的紧凑格式，
 * 一行能顶十几条，改起来也只看一行。产物仍然是规格里要求的
 * "外部 JSON、用户可在设置页增删改、可导出分享"。
 *
 * 行格式：  cat|sub|weight|dim|词形1,词形2,…
 *   cat    一级分类 key（categories.json 里的）；留空 = 不直接给分类，只当维度标签
 *   sub    二级分类 key；留空 = 只到一级
 *   weight 1~5，打分时的 baseWeight
 *   dim    avatar | install | tool | theme | style | locale | generic
 *
 * 铁律（§10.3）：**不许编造不存在的工具名**。拿不准具体名字时只放通用词
 * （animator / blendshape / ギミック / 轻量化 这类），不要臆造专有名词。
 */
const fs = require('node:fs')
const path = require('node:path')

const L = `
# ===== 分类本名（§1.2：用户自建目录 插件/衣服/贴图 是最强信号，必须有词）=====
plugin||5|theme|插件,プラグイン,plugin,アドオン,addon,扩展,追加
model||5|theme|模型,モデル,model,アバター,avatar,キャラ,キャラクター
clothing||5|theme|服装,衣服,衣装,服,クローズ,ふく,clothing
hair||5|theme|头发,髪,髪型,ヘア,ヘアー,hair
accessory||5|theme|配饰,アクセ,アクセサリー,accessory
texture||5|theme|贴图,纹理,テクスチャ,texture
material||5|theme|材质,マテリアル,material
shader||5|theme|着色器,シェーダー,shader
animation||5|theme|动画,アニメ,アニメーション,モーション,animation
audio||5|theme|音频,音声,サウンド,音,audio,sound
prop||5|theme|道具,小物,プロップ,prop,props
world||5|theme|场景,世界,ワールド,ステージ,world
tool||5|theme|工具,ツール,utilities,utility,tool
reference||5|theme|参考,资料,資料,リファレンス,reference
other|unclassified|3|theme|其他,其它,未归类,misc,miscellaneous

# ===== 目标模型（avatar 维度，不直接决定分类）=====
||5|avatar|shinano,しなの,シナノ,信奈
||5|avatar|manuka,マヌカ
||5|avatar|selestia,セレスティア
||5|avatar|kikyo,桔梗,ききょう
||5|avatar|lime,ライム
||5|avatar|moe,萌,もえ
||5|avatar|rurune,ルルネ
||5|avatar|sio,しお
||5|avatar|shinra,森羅,しんら
||5|avatar|airi,アイリ
||5|avatar|chiffon,シフォン
||5|avatar|milltina,ミルティナ
||5|avatar|milfy,ミルフィ
||5|avatar|maya,マヤ
||5|avatar|grus,グルス
||5|avatar|mizuki,瑞希,みずき
||5|avatar|rusk,ラスク
||5|avatar|anon,あのん
||5|avatar|chise,ちせ
||5|avatar|lunalitt,ルナリット
||5|avatar|minase,水無瀬,みなせ
||5|avatar|inaba,因幡,いなば
||5|avatar|mamehinata,まめひなた
||5|avatar|kipfel,キプフェル
||5|avatar|pollen,ポレン
# ----- 增量改动单 2 §B4 点名要补的那批（缺了它们，详情页会显示 avatar:UNIVERSAL）-----
# 依据是真库扫描（tools/scan-avatar-tokens.cjs）：ATTITUDE The Royal Bunny 系列下
# 实测出现 24 个模型名，下面这些当时一个都不在词表里。
||5|avatar|sion,シオン
||5|avatar|ichigo,いちご,苺
||5|avatar|kumaly,クマリー
||5|avatar|lasyusha,ラシュシャ
||5|avatar|misaki,みさき,美咲
||5|avatar|ramune,ラムネ
||5|avatar|lumina,ルミナ
||5|avatar|eku,えく
||5|avatar|chocolat,ショコラ
||5|avatar|nemesis,ネメシス
||5|avatar|elusion,エリュシオン
||5|avatar|mame,まめ,豆
||3|avatar|universal,汎用,共通,ユニバーサル,all purpose

# ===== 产品系列 / 品牌（来自用户库与规格 §7 的真实名字，不许臆造）=====
clothing|outfit|5|tool|grimoire,grimoir,c.c.matilda,matilda

# ===== 安装方式 / 依赖框架（归并时算 install_method 变体）=====
||4|install|modular,vrcfury,ma,modularavatar,ndmf,lilitoon,poiyomi,poiyomitoon,sdk3,vrchatsdk,vrchat sdk,quest,pc,pcss,unitypackage,upm,package manager

# ===== 插件：动作类 =====
plugin|action|5|tool|abt,go golo co,gogoloco,goloco,gesture manager,action wheel,actionwheel,vrcemote,dance gimmick,emote system,animator as code,kineanimator,pose system,动作系统,动作,ジェスチャー,モーション,ダンス
plugin|action|3|tool|animation override,idle,待机姿势,待機,pose,preset 动作,walk,locomotion,移动

# ===== 插件：表情类 =====
plugin|expression|5|tool|blendshape,blend shapes,face emotion,faceemo,eye tracking,eyetracking,vrc face tracking,expression menu,表情,まばたき,リップシンク,lipsync,blink,face animation,face animation,fbm,facial
plugin|expression|3|tool|口,嘴,eye,眼,まぶしい,wink,眉

# ===== 插件：换装类 =====
plugin|closet|5|tool|wardrobe,avatar closet,closet,toggle,dress up,dressup,着せ替え,换装,服装切换,outfit switch,clip mask,toggler

# ===== 插件：物理类 =====
plugin|physics|5|tool|dynamic bone,dynamicbone,dynamicbonecollider,magicacloth,magicacloth2,vampire physics,vampirephysics,physbone,base physics,揺れもの,髪揺れ,物理,物理演算,pendulum,cloth setup,pendulum,spring joint

# ===== 插件：优化类 =====
plugin|optimizer|5|tool|avatar optimizer,aao,d4rk avatar optimizer,thry's avatar performance tools,meshia mesh simplification,textrans tool,vrc quest tools,vrcquesttools,polyreduce,texture atlas,easy quest switch,軽量化,最適化,优化,减面,合并贴图,poly,decimate

# ===== 插件：相机类 =====
plugin|camera|5|tool|vrc lens,vrclens,camera plus,cameraplus,vrc photo,vrc picture to clipboard,カメラ,相机,摄影,photo mode

# ===== 插件：菜单 / UI 类 =====
plugin|menu_ui|4|tool|menu,ui,radial menu,quick menu,main menu,菜单,界面,ボタン,button,radial,遥控
plugin|menu_ui|3|tool|hud,overlay,キーバインド,快捷键

# ===== 插件：交互类 =====
plugin|interactive|4|tool|interactive,interaction,gimmick,ギミック,udon,udonsharp,udon sharp,contact,触発,交互,灯光控制,light controller,lightcontroller,switch,lever,button press

# ===== 插件：音效类 =====
plugin|sound|5|tool|audiolink,audio link,vrc audio,音ギミック,bgm,音效,効果音,声音,sound,speaker,microphone

# ===== 插件：追踪类 =====
plugin|tracker|4|tool|tracker,tracking,追踪,定位,head tracker,hand tracking,pose tracker

# ===== 插件：上传类 =====
plugin|upload|4|tool|builder,upload,上传,sdk,avatar build,setup,インポート

# ===== 插件：编辑器类 =====
plugin|editor|4|tool|editor,编辑器,tool box,toolbox,window,panel,debug,dev tool,开发工具
plugin|editor|3|tool|scriptable,asmdef,script,cs 工具

# ===== 插件：网络同步类 =====
plugin|network|4|tool|sync,network,网络同步,同步,netcode,custom sync,data store

# ===== 着色器 =====
shader||5|tool|lilitoon,lil toon,poiyomi toon,poiyomi pro,mochie,silent's cel shading,nilotoon,sunao shader,gura shader,unity toon shader,uts,qqtoon,toon standard,shader,着色器,シェーダー,toon
shader|skin|4|tool|skin shader,肌シェーダー,皮肤着色
shader|clothing|3|tool|cloth shader,服シェーダー
shader|effect|3|tool|effect shader,エフェクトシェーダー,glow,rim light,リムライト,iridescence
shader|post|3|tool|post process,postprocessing,后处理,bloom,color grading

# ===== 材质 =====
material|mat|2|tool|材质球,マテリアル,material set
material|preset|3|tool|material preset,材质预设,preset
material|matcap|2|tool|matcap,マットキャップ
material|pack|3|tool|material pack,材质包,材质合集

# ===== 模型 =====
model|base|4|tool|base body,素体,ベース,body mesh,avatar base
model|finished|4|tool|finished avatar,成品模型,完成品,フルセット,fullset,full set,完成版
model|head|3|tool|head,头部,頭,フェイスマップ,face mesh
model|body_part|3|tool|body part,身体部件,手足,指,hand,foot,腕,脚
model|retrofit|4|tool|retrofit,模型改造,改造,改変,edit mesh,リメイク

# ===== 服装 =====
clothing||4|theme|服,衣装,ウェア,クローズ,outfit,clothes,clothing,apparel,服装,衣服
clothing|top|3|theme|上衣,tops,t shirt,tshirt,blouse,shirt,ブラウス,シャツ,セーター,pullover,ニット,タンクトップ,camisole
clothing|bottom|3|theme|下装,skirt,スカート,pants,パンツ,shorts,ショーツ,jeans,デニム,ズボン,半ズボン
clothing|dress|4|theme|dress,ワンピース,one piece,连衣裙,ガウン,robes,ローブ
clothing|underwear|3|theme|内衣,下着,パンツ,ランジェリー,lingerie,水着,swimsuit,mizugi,泳装
clothing|outfit|3|theme|套装,セットアップ,setup,coordinate,コーデ,全套
clothing|coat|3|theme|外套,コート,jacket,ジャケット,パーカー,parka,coat,blazer,ベスト,vest
clothing|kimono|4|theme|着物,和服,kimono,浴衣,yukata,振袖,袴,hakama,巫女,袴
clothing|uniform|4|theme|制服,セーラー,sailor,スクール,学ラン,blazer 制服,uni,制服
clothing|socks|3|theme|袜子,ソックス,靴下,socks,タイツ,tights,ストッキング,panchira,パンチラ
clothing|shoes|3|theme|靴,シューズ,shoes,ブーツ,boots,パンプス,heels,スニーカー,sneakers,下駄
clothing|gloves|3|theme|手袋,グローブ,gloves,ミトン,mitten,手套

# ===== 头发 =====
hair||4|theme|髪,ヘア,hair,头发,ヘアカラー,髪型
hair|long|3|theme|long hair,ロング,ロングヘア,长发
hair|short|3|theme|short hair,ショート,ボブ,bob,短发
hair|twintail|4|theme|ツインテール,ダブルテール,twintail,双马尾,ponytail,ポニーテール
hair|bangs|3|theme|前髪,刘海,bangs,ahoge,アホ毛
hair|hairwear|3|theme|发饰,ヘアアクセ,カチューシャ,hairband,リボン ヘア,kanzashi,かんざし

# ===== 配饰 =====
accessory||4|theme|アクセ,アクセサリー,accessory,accessories,配饰,小物
accessory|glasses|4|theme|眼鏡,メガネ,glasses,eyewear,サングラス,sunglasses,眼镜
accessory|earring|3|theme|イヤリング,ピアス,earring,earrings,耳饰
accessory|headwear|3|theme|头饰,帽子,キャップ,hats,cap,hat,カチューシャ,リボン
accessory|tail|4|theme|しっぽ,尻尾,tail,尾巴
accessory|ears|4|theme|けものみみ,獣耳,animal ears,mimi,兽耳,ネコミミ
accessory|horn|3|theme|角,horns,horn,ツノ,角
accessory|wings|3|theme|翼,wings,ウィング,翅膀
accessory|necklace|3|theme|ネックレス,necklace,choker,项链
accessory|ring|2|theme|リング,指輪,ring,戒指
accessory|bag|3|theme|bag,バック,バッグ,リュック,rucksack,背包,かばん
accessory|mask|3|theme|mask,マスク,仮面,面具,お面

# ===== 贴图 =====
texture|skin|4|theme|skin,肌,肌色,texture,テクスチャ,贴图
texture|face|3|theme|顔,face,フェイスマップ,脸部,face texture
texture|eye|3|theme|目,瞳,eye,アイ,コンタクト,eye texture,眼睛
texture|clothing_texture|2|theme|服テクスチャ,cloth texture,服装贴图,albedo,normal map,orm
texture|tattoo|4|theme|タトゥー,刺青,tattoo,纹身,decal,デカール
texture|makeup|4|theme|メイク,化粧,cosmetics,妆容,リップ,チーク,アイシャドウ,eyeshadow,blush,化妆,makeup,make up,フェイス,フェイスマップ メイク
texture|expression|3|theme|表情贴图,face set,フェイスセット,expression texture
texture|psd|4|theme|psd,psd源文件,psd 源文件,レイヤー付き,source file,プロジェクトファイル

# ===== 动画 =====
animation|motion|4|theme|animation,アニメーション,motion,モーション,动作,animation clip
animation|dance|3|theme|dance,ダンス,舞,踊り,舞蹈
animation|idle|3|theme|idle,待機,待机,idle animation
animation|facial|3|theme|表情アニメ,face anim,表情动画
animation|controller|4|theme|controller,animator,animator controller,overridecontroller,override controller,アニメーター
animation|preset|3|theme|animation preset,プリセット,动画预设

# ===== 音频 =====
audio|se|4|theme|効果音,sfx,sound effect,音效,SE音
audio|music|4|theme|bgm,音楽,music,曲,track,音乐
audio|voice|3|theme|ボイス,voice,音声,语音,voicepack,seiyu
audio|ambient|3|theme|環境音,ambience,environment sound,环境音

# ===== 道具 =====
prop|weapon|5|theme|武器,ウェポン,weapon,剣,刀,銃,gun,sword,knife,blade,枪械,枪,弓,bow,武器合集
prop|food|3|theme|食べ物,フード,food,飲み物,飲食物,食物,料理,スイーツ
prop|furniture|3|theme|家具,furniture,chair,テーブル,table,机,椅子,棚
prop|decor|3|theme|装飾,decor,decorative,飾り,インテリア,装饰,小物 装饰
prop|fx_prop|3|theme|エフェクト,effect,特效,particle,パーティクル,vfx,粒子

# ===== 场景世界 =====
world|map|4|theme|world,マップ,map,地图,ワールド,场景,世界
world|world_prop|3|theme|scene prop,场景道具,ステージ,stage
world|skybox|3|theme|skybox,スカイボックス,空,天空盒,environment sky

# ===== 工具软件 =====
tool|modeling|4|theme|blender,maya,3ds max,zbrush,modelling tool,建模,モデリング
tool|texturing|3|theme|photoshop,sai,clip studio,ペイントツール,纹理工具,paint tool
tool|convert|3|theme|converter,変換,转换,format tool,fbx 转换,unitools,unity asset store tool
tool|compress|3|theme|compressor,圧縮,压缩,zip tool,7zip,archive tool
tool|other|2|theme|utility,ユーティリティ,便利ツール,小工具

# ===== 参考资料 =====
reference|ref_image|3|theme|参考,reference image,リファレンス,資料 画像,设定资料
reference|tutorial|4|theme|tutorial,チュートリアル,解説,教程,howto,how to,guide,ガイド,マニュアル,说明
reference|doc|3|theme|document,ドキュメント,pdf,readme,利用規約,規約,说明书,文档,license
reference|video|3|theme|movie,動画,video,mp4,wmv,演示,デモ映像

# ===== 通用（弱信号，帮判"这是个包/套装/素材"）=====
other|bundle|2|generic|セット,まとめ,まとめ売り,bundle,pack,合集,大全,全家桶,道具合集,插件合集
||1|generic|素材,asset,assets,素材集,アセット,data
||2|generic|template,テンプレート,サンプル,sample,見本,试用,demo
||1|generic|ver,version,beta,final,rev,upd,更新版,新版,旧版

# ===== 语言 / 汉化标记（归并时算 locale 变体）=====
||5|locale|汉化,漢化,中文版,机翻,翻译,簡体字,简中,繁中,cn版,simplified chinese,chinese version
||4|locale|日本語,日语,日文,日文版,japanese,jp版,tokyo
||2|locale|en,eng,english,英語版,英文
||3|locale|cn,chinese,zh,中文
`

const OUT = path.resolve(__dirname, '..', 'resources', 'lexicon', 'lexicon.json')

/** 归一化：小写 + 折叠空白 + 去掉 Windows 大小写/全角差异里无关的部分 */
function normalize(s) {
  return s
    .toLowerCase()
    .replace(/[\s　]+/g, ' ')
    .trim()
}

function build() {
  const entries = []
  const seen = new Map()
  const lines = L.split('\n').map((x) => x.trim()).filter((x) => x && !x.startsWith('#'))
  for (const line of lines) {
    const parts = line.split('|')
    if (parts.length < 5) throw new Error('词典行格式不对：' + line)
    const [cat, sub, wRaw, dim, formsRaw] = parts
    const w = Number(wRaw)
    if (!Number.isFinite(w) || w <= 0 || w > 5) throw new Error('weight 要在 1~5：' + line)
    if (!['avatar', 'install', 'tool', 'theme', 'style', 'locale', 'generic'].includes(dim)) {
      throw new Error('dim 非法：' + dim + ' <- ' + line)
    }
    for (const raw of formsRaw.split(',')) {
      const term = normalize(raw)
      if (!term) continue
      const key = term
      if (seen.has(key)) {
        // 同词多行：留权重高的那条，并记下来让人去修，别静默吞
        const prev = seen.get(key)
        if (prev.w >= w) continue
        entries.splice(entries.indexOf(prev), 1)
      }
      const e = { term, w, dim }
      if (cat) e.cat = cat
      if (sub) e.sub = sub
      seen.set(key, e)
      entries.push(e)
    }
  }
  entries.sort((a, b) => a.term.localeCompare(b.term))
  return {
    schema: 1,
    generatedBy: 'tools/build-lexicon.cjs',
    note: '第 2 份 §6 种子词典。改词条请改构建脚本再 npm run lexicon，别直接改这个 JSON（会被覆盖）；用户自己的增删改走设置页，存 learning/自定义词典文件。',
    count: entries.length,
    entries
  }
}

/**
 * 建完必须对着 categories.json 校验一遍。
 * 之前手写时把 套装 写成 suit（真 key 是 outfit）、音效 写成 sfx（真 key 是 se）等
 * 14 组共 100 条，加载时 isValidCategory 不认就静默丢掉 ——
 * 表现只是"这次没分出二级"，其实是词典白写了一半。所以这里直接 fail build。
 */
function validateAgainstCategories(list) {
  const cats = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'resources', 'lexicon', 'categories.json'), 'utf8'))
  const valid = new Map()
  for (const c of cats.categories) valid.set(c.key, new Set(c.subcategories.map((s) => s.key)))
  const bad = []
  for (const e of list) {
    if (!e.cat) continue
    if (!valid.has(e.cat)) { bad.push(e.term + ': 一级分类不存在 ' + e.cat); continue }
    if (e.sub && !valid.get(e.cat).has(e.sub)) bad.push(e.term + ': ' + e.cat + ' 下没有二级 ' + e.sub)
  }
  if (bad.length) {
    console.error('词典有 ' + bad.length + ' 条指向不存在的分类，前 20 条：')
    for (const b of bad.slice(0, 20)) console.error('  - ' + b)
    process.exit(1)
  }
}

const json = build()
validateAgainstCategories(json.entries)
const cats = new Set(json.entries.filter((e) => e.cat).map((e) => e.cat))
const dims = {}
for (const e of json.entries) dims[e.dim] = (dims[e.dim] || 0) + 1
fs.writeFileSync(OUT, JSON.stringify(json, null, 1) + '\n')
console.log('词条总数：' + json.count)
console.log('带一级分类的词条：' + cats.size + ' 个分类 -> ' + [...cats].sort().join(' '))
console.log('按维度：' + Object.entries(dims).map(([k, v]) => k + '=' + v).join(' '))
