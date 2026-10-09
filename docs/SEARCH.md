# M4 前半：检索与封面

> 代码位置：`src/shared/normalize.ts`、`src/main/search/{aliases,index}.ts`、
> `src/main/library/{thumbRules,thumbs}.ts`、`src/main/services/thumb-protocol.ts`。
> 分类算法另见 `docs/CLASSIFY.md`。

## 1. 检索要解决的不是"快"，是"换个写法也能搜到"

库里的素材名混着四种写法：`束縛チャイナFULLSET`、`Shinano FaceAnimation`、`Grimoir_SHINANO_V1.0`、
自己起的中文名 `衣服套装`。用户输入的时候不会跟着这套混合规则走 —— 他会打 `shinano`、`しなの`、
`yifu`、`taozhuang`、也可能只打一半。SQL 的 `LIKE '%…%'` 对这种跨脚本写法完全没办法，
所以 M4 换成了**归一化 + 倒排索引**：

```
名字/原始名/分类/标签/作者/备注/包内路径/组名/合集名
        │
        ├─ searchForms()  原文 + 小写 + 去符号 + 拼音(汉字) + 罗马字(假名)
        │
        ├─ buildAliases() 每个字段一套别名，落 search_alias 表（也喂索引）
        │
        └─ MiniSearch     内存倒排索引，字段加权 + 前缀 + 拉丁词容错
```

查询侧走**同一个** `searchForms()`，所以"索引里存什么写法"和"输入被展开成什么写法"永远一致。
`assets:list` 先问索引拿 id 列表，再交给原来的 SQL 过滤器（分类 / 状态 / 集合的筛选逻辑不重写一遍）。

## 2. 四个实测踩出来的坑（别再改回去）

| 现象 | 原因 | 处理 |
|---|---|---|
| `Grimoir` 被拆成 `G r i m o i r` | `pinyin()` 对非汉字字符**逐字母加空格** | 先按字符类别切段，只把汉字段丢给 pinyin |
| `束縛チャイナ` 出来 `束縛chaina` | `wanakana.toRomaji()` 只转假名，汉字原样留着 | 汉字段再过一遍 pinyin，两段拼起来 |
| 搜一个「バ」能匹配出无关素材 | `normalize('NFKD')` 把浊音假名拆成"清音 + U+3099"，而 U+3099 不在拉丁音标删除范围里 | `fold()` 改成 NFKC 优先 + NFD 剥拉丁音标 + NFC 收回来 |
| 搜 `animation` 找不到 `FaceAnimation` | MiniSearch 默认只在空白处切词，驼峰整词进索引 | 自定义 `tokenize()`：大小写交界、拉丁↔中日韩交界都补切点；**数字边界不切**，否则 `V1.0` 散架、版本号搜不到 |

第 3 条最值得记：dev 环境一切正常，因为它一直是同一份缓存；这个 bug 只在**索引里已经存了带组合音标的 token**
之后才显形，所以单测要直接断言 `searchForms('ソクバク').translit` 里是 `sokubaku` 而不是 `ha゙`。

## 3. 索引怎么保持新鲜

- 启动时 `setImmediate` 里全量重建（UI 先出来，索引后到；没就绪的几百毫秒里搜索自动退回 LIKE）。
- 改名 / 改分类 / 入库 / 撤销 → `reindexAsset(db, id)` 增量更新，同时重写该素材的 `search_alias`。
- 撤销一次会删掉若干库记录 → 直接全量重建（一次撤销涉及的条目不多，全量最不容易留脏数据）。
- 移入回收站 → `assetIndex.remove(id)` + 删缩略图缓存。

"搜得到但点不开"的幽灵卡片比搜不到更糟，所以这几条同步点是硬性要求，不是优化。

## 4. 已知边界（不假装支持）

- **汉字 → 日语读音不支持。** 索引里有 `束縛` 的中文拼音 `shufu`，但没有日语读法 `sokubaku`；
  要支持得挂一份 Kanji 读音词典（几 MB，且多音字照样错）。想按日语读法搜，请把原名写进备注。
- **类别口语同义词不进索引。** 分类表里 `服装` 只有一个中文名，所以 `fuzhuang` / `服装` 能搜到，
  `yifu` / `衣服` 搜不到。要补的话应该在 `resources/lexicon/categories.json` 里给每个分类加 `synonyms`，
  而不是在检索层硬编码词表。
- 单字母 / 两字母查询会带出一堆前缀匹配（`fu` 命中 `fullset`、`fuzhuang`）。这是"边打边出结果"的代价，没关。

## 5. 封面：为什么不用 sharp

`sharp` 要拉 libvips 预编译包（这台机器 GitHub 时通时不通），而且和 better-sqlite3 一样是原生模块，
双 ABI（Node 137 / Electron 130）的坑要再踩一遍。Electron 自带的 `nativeImage` 就是 Chromium 的图像解码器 ——
png / jpg / webp / bmp / gif 都能读、内置 resize，零新依赖，打包版一定能用。代价：没有 webp 编码器，
所以缓存统一写 jpg。

**挑哪张图**（`thumbRules.pickCoverCandidate`，纯函数有单测）按四级排序：
名字带 `preview/cover/主图/封面/一览` → 扩展名偏好（png > jpg > webp > bmp > tga > gif）→
是否超过 8MB（超了降一档，不淘汰）→ 大的优先 → 目录层级浅的优先。
小于 2KB 的一律不当封面（那是角标），48MB 以上的直接放弃（解码一次几百 MB 内存）。

**包里的图也要能当封面。** VRChat 素材一大半是"目录里只有 .unitypackage"（ABT 实测就是这样），
只看散图的话这些卡片永远是首字母方块。所以有第二步：`extractPackagePreview()` 流式读包，
拿到**第一张** ≥2KB 的 `preview.png` 就掐断读流。为什么不等最大的：gzip 是顺序流，
为了比较后面的预览得把整个包解压一遍，500MB 的包要十几秒，而且是主进程。

因为这条开销，`ensureThumb` 分两档：

| 触发点 | 扫目录散图 | 伸进 unitypackage |
|---|---|---|
| 启动补批（150 条 / 1.5 秒预算） | ✅ | ❌ |
| 用户刚入库那一条 | ✅ | ✅ |
| 维护页"重建缩略图" | ✅ | ✅ |

没开包内查找的那一档**不写** `cover_image='none'` 记号 —— 那只是"还没往包里看"，
标成没图会让维护页以后再也不补它。

## 6. `athumb://` 而不是 `file:///`

`asset.cover_image` 里存的是 `athumb://<hash>.jpg`。两个理由：

1. dev 页面跑在 `http://localhost:5173`，Chromium 不允许非 file 源加载 `file://` 子资源（webSecurity 默认开着），
   打包版又是 `file://` —— 同一份代码"只有打包后能看图"最难查。自定义协议两边一致，
   顺带把可访问范围锁死在缩略图目录里。
2. 库要能整体挪盘（侧车同理不写绝对路径），缓存路径属于这台机器，所以只存文件名、路径现算。

**踩过的坑**：`standard: true` 的协议会被 Chromium 规范化成"host = 文件名、path = 空"，
回调里收到的 `request.url` 常常还带一个尾斜杠。只按字符串正则抠 `athumb://([^/]+)$` 会全部落空，
表现为图片 400、卡片静默退回首字母。现在先走 `new URL()`，host 和 path 两种位置都认，
再对原始串做 `%` / `\` / `..` 的硬拒绝。

## 7. "N 变体"徽章数错了（顺手修的）

原来 `variant_count` 数的是 `variant` 表的行数。一个包里带 11 个体型目录时（束縛チャイナFULLSET 就是这样），
`persistRelations` 会写 11 行 avatar variant，于是**一张卡**上标着"12 变体"。

改了两处：

- 徽章数的是**组内素材份数**（`SELECT COUNT(*) FROM asset WHERE group_id = …`），
  差异维度另出 `dims: [{kind, values}]` 给聚合视图分列展示。
- 单一体型才算变体；多体型是"兼容性说明"，写成 `tag(kind='avatar')`（顺手也进了检索别名）。

配套修了一个更阴的：`setAssetTags()` 原来按 `(asset_id, source)` 整批删标签，
所以后写的 topic 标签会把先写的 avatar 标签一起抹掉 —— 适配体型全丢。现在删除限定 `tag.kind`。

## 8. 验证

单测：`tests/search/{normalize,index}.spec.ts`、`tests/library/thumbRules.spec.ts`、
`tests/classify/unitypackage.spec.ts`、`tests/library/commit-undo.spec.ts`。
全库 `npm test` = **315 passed / 2 skipped**，两个 tsc 工程都干净。

活体（dev 版真界面 + CDP，库根 `E:/vrc/test/library`，4 件真素材）：

| 输入 | 结果 |
|---|---|
| `shinano` | 2 条（Shinano FaceAnimation + Grimoir SHINANO） |
| `シナノ` | 2 条（假名→罗马字） |
| `animation` | 1 条（驼峰后半截） |
| `fullset` / `chaina` / `shufu` | 束縛チャイナFULLSET |
| `taozhuang` / `服装` / `表情` | 对应分类下的素材 |
| `v1.0` / `grimor`（少一个 i） | Grimoir SHINANO（版本号没被切碎 + 拉丁容错） |
| `ソクバク` / `バ` / `゙` | 0 条（修 NFKD 之前的假匹配已消失） |
| `yifu` | 0 条（见 §4 已知边界） |

封面：`束縛チャイナFULLSET` 用 `_extracted` 里的散图，`ABT` 和 `Grimoir SHINANO` 从包内
`preview.png` 抠出来，`Shinano FaceAnimation`（rar 套 zip，里面没有图）标 `none` 显示首字母。
截图：`docs/screenshots/m4-covers.png`。

## 9. 5 万素材实测（§7 那两条红线）

测试：`tests/perf/scale.spec.ts`（灌 5 万行 → 建索引 → 查询，全在这一台机器上跑）。
数据里的名字故意做成五花八门的（只有 2% 带 `shinano`）—— 5 万条全同名测的就不是检索而是排序了。

| 指标 | 规格 | 实测 |
|---|---|---|
| 启动到可用 | ≤2 秒 | **第一片 367–410ms** 后搜索就能出结果，界面全程能点 |
| 搜索响应 | ≤100ms | **p95 ≈ 20ms**（中英日 + 拼音 + 前缀各一轮） |
| 多命中查询 | — | 命中上千条时 3–5ms |
| 容错（打错字）那一趟 | — | 严格趟零命中才走，单独计时 <400ms |
| 健康检查全库扫描 | — | 168–440ms |
| 一次性全量重建索引 | — | 11.5 秒（别名 3.5s / 写库 4.9s / MiniSearch 3.2s） |

两个不显眼但要记住的实测结论：

1. **一次性建索引会把主进程按死十几秒。** 窗口开着、所有 IPC 不响应，比"没有索引"更糟。
   所以启动走的是 `rebuildIndexChunked()`：一片 800 条，片与片之间 `setImmediate` 让出事件循环。
   一次性版只留给维护页那个手动按钮。
2. **别名表逐条开事务写 = 80 秒。** 原来 `rebuildIndex` 对每个 (素材, 字段) 调一次
   `setSearchAliases`，而那个函数自带事务 —— 5 万 × 10 字段 = 50 万次独立提交。
   改成"整表清一次 + 一个事务灌回去"之后掉到 5 秒。
   另外 `aliases` 字段原来把 name/rawName/tags 的内容又装了一遍，同一个词被索引 2–3 遍，
   去掉重复后术语量和查询时间都明显下降。

`searchForms()` 加了记忆化（上限 4 万条）：分类标签这类字符串会在每条素材里重复出现几十次，
pinyin / toRomaji 没必要每次重算。

## 10. 工具链的一条硬教训

`vitest` 的 `pool: 'threads'` + better-sqlite3 原生模块，会在**进程退出时** Segmentation fault：
测试全绿、汇总也打出来了、退出码却是 139 —— 而 `npm run build` 第一步就是 `npm test`，
于是打包被随机带崩。只有 5000 条文档那条重索引测试能复现。已把 `vitest.config.ts` 固定成 `pool: 'forks'`。

同类坑：`db.transaction(fn)` 只是"包一层"，**返回的函数必须再调用一次**。
第一次写 5 万行性能测试时忘了调用，日志打出"灌 50000 行：0ms"却一路通过到断言才露馅 ——
现在测试里灌完数据会 `SELECT COUNT(*)` 核对，数不对直接抛。

