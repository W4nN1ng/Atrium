# 分类引擎说明（M3）

对应提示词第 2 份。代码在 `src/main/fingerprint/`（读内容）和 `src/main/classify/`（判分类）。

```
输入 IngestResult ──┬─→ fingerprint/corpus.ts     语料 + 权重
（第 1 份的摄取产出）├─→ fingerprint/metadata.ts   URL/版本/作者/封面
                    ├─→ fingerprint/hardRules.ts  §1.1 硬规则
                    └─→ classify/engine.ts        §5.3 六步打分 → ClassificationResult
                                                  classify/groupKey.ts    名字归一 + groupKey
                                                  classify/grouping.ts    跨素材归并（并查集）
                                                  classify/bundle.ts      合集拆分
                                                  classify/learning.ts    用户修正 → learning 表
```

---

## 1. 打分是怎么算的

一个素材的"语料"由四处来源合成，每个词带一个位置权重（`corpus.ts`）：

| 来源 | 权重 | 说明 |
|---|---|---|
| 文件名（去扩展名） | 3.0 | 最强 |
| 原始路径的每一层目录名 | 2.5 | 他自己建的 `插件/`、`衣服/` 是极强信号 |
| 包内路径（含内层 unitypackage 解析出来的 `Assets/...`） | 2.0 | |
| readme 正文 | 1.0 | 最多取 400 个词，防长文本冲淡 |

同一个词多处出现时**取最大权重，不相加**。

每个词查词典（`resources/lexicon/lexicon.json`），命中就给它指向的分类加分：

```
score += 词条权重 w × 位置权重 × (1 + ln(1 + 学习命中次数)) × 学习权重
```

然后：

1. **按一级分类汇总**再比 top1 / top2 —— 不是按 `一级|二级` 比。
   原因：`插件|动作` 和 `插件|（目录名给的无二级）` 是一回事，分开比会互相抵消，
   ABT 明明证据很多却掉到 0.33（实测踩过）。
2. 二级在**胜出的一级内部**挑，且只认真正投了某个二级的分；
   `插件` 这种只投一级的词不能当二级答案。
3. `top2 ≥ top1 × 0.8` → 判歧义，置信度 × 0.6，并在理由里写"同时匹配 X 和 Y"。
4. 分档：`≥0.75` 自动归档（绿）· `0.40~0.75` 归档但标黄 · `<0.40` 进待确认（红）。

### 两条从真件里长出来的规则

- **内容类型先验**：硬规则认出这是 FBX/prefab 模型包时，`材质/着色器/贴图` 这类
  附带产物分类 ×0.5，`模型/服装/头发/配饰/道具/场景` ×1.5。
  一个模型包必然带贴图和 `.mat`，那是结构，不是这条素材的特征。
- **封顶**：内容类型是模型、赢家却是材质/着色器/贴图时，置信度压到 0.35 以下，
  强制进待确认。触发原因：`束縛チャイナFULLSET`（服装，内含 matcap 贴图）
  一度被判成 `材质/MatCap 71%`，差 4 个点就要自动归档了。

---

## 2. 词典格式

`resources/lexicon/lexicon.json`：

```json
{ "schema": 1, "count": 854, "entries": [
  { "term": "goloco", "cat": "plugin", "sub": "action", "w": 5, "dim": "tool" }
]}
```

- `term` 一律小写、空白折叠（`normTerm`）；查询时还会做一次"去空格/去下划线"匹配，
  所以 `face animation` 能被 `faceanimation` 命中。
- `cat`/`sub` 必须是 `categories.json` 里真实存在的 key。
  **构建时会校验，写错直接 fail**（曾经 14 组共 100 条写了不存在的 key，
  被 `isValidCategory` 静默丢掉，表现只是"这次没分出二级"，其实词典白写了一半）。
- `dim` 决定它参与哪件事：`avatar`/`install`/`locale` 参与归并键的剥离，
  `tool`/`theme`/`generic` 参与打分。

### 怎么改

改词条**不要直接编辑 JSON**（会被覆盖），改 `tools/build-lexicon.cjs` 里的表，然后：

```bash
npm run lexicon
```

一行一组，逗号分词形：`cat|sub|weight|dim|词形1,词形2,…`。

用户自己的增删改走设置页，落在 `resources/lexicon/lexicon.user.json` 同级的用户词典
（`%APPDATA%\A\lexicon.user.json`），同词覆盖内置。

### 词条收录纪律（§10.3）

只放**真实存在**的产品/工具名。拿不准具体叫什么，就放通用词（`animator`、`blendshape`、
`ギミック`），不许臆造。目前 854 条里 256 条是工具/产品名，459 条是中·日·英主题词。

---

## 3. 归并键与归并

`deriveGroupKey('Grimoir_SHINANO_V1.0.zip')`：

```
剥容器扩展名 → 先整段摘出版本号（V1.0）→ 切 token → 依次剥 avatar / install / locale
→ 剩下 ['grimoir'] → groupKey = 'grimoir'
```

- 版本号必须**在切分之前**整段摘出来：切分符含 `.`，先切就变成 `V1` + `0`，
  版本再也认不出来，groupKey 成了 `grimoir v1 0`（实测踩过）。
- 归并判定四条：同 key+同一级 / 同 URL / 同 Booth id / 同 key 且除变体外名字一致（并查集）。
- **不许误并**：`Grimoir_Gimmick`、`Grimoir_Hat` 剥完剩 `grimoir gimmick` / `grimoir hat`，
  和 `grimoir` 天然不同 key；`Grimoir2_SHINANO` 同理。单测逐条钉住。

## 3.5 方括号变体槽位与附属资源（增量改动单 2）

`groupKey.ts` 里 `passBrackets()` 干的事：`<前缀>[<内容>]<后缀>` 这种结构里，
**方括号就是变体位**，整段不参与 groupKey。三段拆开看：

```
Libero[Shinano_ATTITUDE The Royal Bunny]_1.01
      └┬─┘ └┬────────────┘
    模型位  系列位 → 系列名的**头一个词**进 groupKey
→ groupKey = "libero attitude"，variant_raw = "Shinano_ATTITUDE The Royal Bunny"
```

三道闸门（05 §B2 的安全保护）：① 括号外 ≥2 个字；② 单位段时括号内容 ≤ 全名 70%；
③ **同目录 ≥3 个不同前缀塌成同一个 key → 判歧义、不自动合并**（`grouping.ambiguousKeys()`，
只在传了 `dir` 时才生效，见 `GroupableAsset.dir`）。

模型位里的 `& ＆ + ＋ 、 , ，` 和驼峰都会拆成多个候选名（`Chiffon&Chocolat` → 两个徽章、
`KipfelMame` → 两个）。**驼峰只在每一段都命中词表时才拆** —— 否则 `FaceAnimation`
被劈成两半之后 groupKey 再也拼不回去。词表命中与否只决定徽章和 `avatars`，
没命中的进 `variantUnknown`，那是 §B4「从库中学习模型名」的原料。

`primary.ts` 的 `splitContainer()` 判主体/附属：unitypackage > 完整 Unity 工程
（`Assets/` + `ProjectSettings/`）> UPM 包（`package.json` + `Editor/*.cs`）>
含 prefab·mat·shader·fbx 的目录 > 压缩包。**主体目录根上散着的图/文档算附属介绍图，
再往里一层的算主体的一部分**（没有这条例外，`Outfit/preview.jpg` 会被吞进主体）。
`.cs` 不算主体 —— 光有脚本不成件东西，要么跟 package.json 组成 UPM 包，
要么整个目录按 `codeOnly` 收成一个单元。

`shared/junk.ts` 是垃圾与附属类型的**唯一**判定处，三处调用点共用：
`findStrays`、`listTree`、worker 的压缩包内层清单。少一处就会从别的门灌进来 ——
默认设置不解压，所以第三条是拦住 `__MACOSX/` 碎片的唯一口子。

**同一个规则不许有两份实现。** 反面教材：`cleanDisplayName` 在提版本号前剥 UUID，
`deriveGroupKey` 没剥，于是真库那张 `d6b99874-… base resized.jpg` 名字修好了、
版本号还是从 UUID 里咬出来的 `99874-3687-4746-8e`。现在两边都调
`shared/naming.stripIdLike()`。同理 `.cs.meta` 那种伴生文件原先在 `health.contentKind`
里有一份正则、`primary.splitContainer` 里压根没有，也收到了 `junk.isCompanionFileName()`。

## 3.6 重新分析：规则改了之后怎么补救

`library/reanalyze.ts`。只重算 `name / version / variant_raw / size_bytes` 四样，
**category / subcategory / needs_review 一个都不碰**（用户手改的分类是资产）。
改名还有一道闸门 `nameIsGarbage()`：只在当前名字确实是垃圾（UUID、长 hex、
还挂着扩展名、`.0版本` 那种残骸）时才提议改。没这道闸，
`FREE無料-PoseAnimationShinano` 会被换成 raw_name 直译出来的
`Shinano100Type ❥ Face&Pose Animations ⌖ ݁˚` —— 真库实测 219 条误伤，加闸之后 82 条且全是真垃圾。

体积重算**只量目录、文件一律不动**：压缩包型合集的成员行 `library_path` 指的是那个 `.rar` 自己，
按文件量会把每个成员都改成整包大小（库里存的 4.1 MB 才是对的）。

附属资源识别不在这里补 —— 那要重新扫目录，而"重新扫 + 登记"是收件箱那条路，
硬补会绕开预览和撤销。所以要让介绍图真的变成附属行，得清掉收件箱重新登记一次。

## 3.7 归并必须有目录前提（#40）

四条归并判据里，**①groupKey+一级 和 ④groupKey+名字一致** 这两条现在都多一道"同一个父容器"的前提：

```
真库实测到的事故：贴图/脸部/4900077  与  贴图/lime/4900077
两个毫不相干的商品，名字都是 Booth id → 归并键都是 `4900077` → 并成一张写"2 变体"的卡
```

`asset_group.dir_key` 记这一组的货架在哪（小写、正斜杠、无尾斜杠，`src/main/lib/pathkey.ts` 一个函数负责归一化）。
两条判据的桶键变成 `目录 + groupKey (+ 一级)`。`dir` 未知（老数据）时保持原行为 —— "判不了"不该变成"合不起"。

**②source_url / ③source_item_id 不加这道闸**：Booth 商品 id 是"同一件商品的两份拷贝"级别的证据，
你库里这种跨目录重复实测有 6 组（`Sexy skin material for VRC 6053463`、`真实肤质材质球`、
`milfy Prism cat eye…`、`Costume Pomae`、`Shinano Real skin NO39`、`4900077`）。
纯同名 + 不同目录 = 巧合，ID 相同 + 不同目录 = 重复拷贝，这两种必须区别对待。

落库侧同步：`ensureGroup` 只在同目录的组里复用；schema V4 把 V1 的 `UNIQUE(group_key, category)`
换成 `UNIQUE(group_key, category, dir_key)`（不换掉，第二个"同 key 不同目录"的组根本插不进去）。
迁移回填只在全组成员目录一致时写值，不一致的留 NULL = "历史误并组，不再吸附新成员"，
真库实测 122 组 → 103 有 dir_key / 19 留 NULL。拆开那 13 个误并组是改数据、要能撤销，交给健康检查，不塞进迁移。

## 4. 合集：三级模型，不拆成顶层素材

`bundle.ts` 产出的是**一棵树**，不是 N 个顶层单元（2026-10-05 增量改动单 §2 覆盖了原第 2 份 §4 全部内容）：

```
合集 Bundle ─ 子项 Item ─ 版本 Variant      三级都在 asset 表里，靠 parent_asset_id 串
```

**判定三条**（满足任一）：① 名字写着 `合集/セット/まとめ/set/pack/大全/全家桶`；
② 下面能独立分类的子项 ≥3；③ **目录名是"容器名"而不是"商品名"** ——
`道具22件`、`ERP用12件`、`プラグイン17件`、`更新`、`重要！` 这类纯计数/归类词（`CONTAINER_RE`）。
名字写着合集或③成立时只要 2 个子项就算，否则要 3 个。

**两道护栏**（都是实测逼出来的）：

- **Unity 结构目录不算子项**：`Mesh` / `Textures` / `Prefabs` / `材质` / `贴图`… 是一件素材的内部结构。
  不排掉的话 `Some_Avatar_Fullset/` 会被判成"含三个素材的合集"，等于把一件衣服撕碎。
- **`looksLikeOneProduct`（首词 60% 相同）不再否决合集**，只用来标 `oneProduct` 把合集那行置信度打 0.9 折。
  旧版靠它挡 ABT 被拆；新版"合集"只是一张卡、一个文件都不搬，代价几乎为零，
  而改动单 §6.7 反过来要求 `ABT 左手用` / `ABT 右手用` 是 2 个 Item。

**ID 目录穿透**：`4952737/INVICTA/…` 里 `4952737` 是 Booth 商品号，不是商品名。
这一层只有一个非数字子目录时穿过去，子项叫 `INVICTA`，ID 记成 `sourceItemId` 且置信度只给 0.4（"疑似，要确认"）。

**版本归并**：用 §3 的归并键，**只在同一层里做**。
`StoZeroCustomEX{,_v1.01,_v1.10}.zip` → 1 子项 3 版本；`Grimoir_{11 个体型}_V1.0` → 1 子项 11 个 avatar 变体，
而 `Grimoir_Hat` / `Grimoir_Gimmick` 核心词不同、各自成项。
跨层归并会把 `ERP用12件/DPS.zip` 和 `道具16件/DPS.zip` 并成一项，名字对了路径丢一半 —— 不许。
版本排序在 `shared/version.ts`（`v1.10 > v1.9`，按数字段比），落库后由 `listVersions()` 用。

**落库**（`commit.ts` 的 `commitBundleAsset`）：整包登记成 1 条合集行 + N 条子项 + （≥2 版本时）版本行，
**一个文件都不搬**（§7.1）。合集那行的分类取子项多数派、置信度取**最低**那件 ——
一坨里只要有 1 件没把握，整包就该回来看。

**已经拆开的怎么救**：设置 → 维护 → **重新整理合集**（`library/rebundle.ts`）。
只读扫"物理上同目录、且该目录符合上面判据"的顶层素材，预览「13 个素材 → 3 个子项」，
确认后建合集行 + 改挂 + 重算版本，同样零磁盘改动，写 journal 可撤销。

## 5. 内层 unitypackage（"读内容"不是"猜名字"）

默认不自动解压，但 §1.1 要求"含 `.unitypackage` 就递归解析后再判定"。
做法：`worker.ts` 的 `digUnitypackages()` 只把内层那几个包（≤5 个、单个 ≤300MB）
抽到任务的 `_dig` 目录，用 `unpack/unitypackage.ts` 流式解析（只读 `pathname` +
`asset.meta` 头部，`asset` 主体跳过），把 `Assets/...` 路径并进语料。

效果：`Grimoir_SHINANO_V1.0.zip` 从 `other / 0%` 变成
`clothing/outfit 82%`，理由写着"含 9 个模型/预制体文件；命中 grimoir/c.c.matilda/…"。

---

## 6. 学习机制

用户在卡片上改分类 → `learnFromCorrection()`：

- 学哪些词：**目录名 + 文件名切出的全部词**，加**包内路径里命中词典的词**。
  readme 里的词一律不学（"这个插件很好用"里的字不该变成规则）。
- **不学**：版本号形态（`v1`/`1.0`）、扩展名、`set/pack/素材` 这类泛词、纯数字、
  含数字的短词。规格原文说"全部 token"，照做会出事：`v1` 被学成规则之后，
  任何带 `v1` 的素材都被带到同一个分类（实测一个不相干的 `Unrelated_Pack_v1` 中招）。
- 旧分类对应的词 `weight -= 0.5` 抑制；同一词累计修正 ≥3 次 → 待确认队列顶部提示。
- 一级和二级分开改，能区分"分类错了"和"二级错了"。

## 7. 界面显示的理由

`reason` 是拼好的人话，进库存着；界面按 `reasonParts`（i18n key + 参数）自己拼，
所以切英文/日文时理由也跟着变（第 1 份 F11：主进程不许回传中文界面文案）。

## 8. 怎么调试一次误分类

1. 看卡片上的理由行 —— 它列出了命中了哪些词。
2. 怀疑词典：`node -e "const l=require('./resources/lexicon/lexicon.json').entries; console.log(l.filter(e=>e.term.includes('你要查的词')))"`
3. 怀疑权重/先验：跑 `npx vitest run tests/classify/classify.spec.ts`，里面每条 §7 特例都是一个可复现的输入。
4. 修完记得 `npm run lexicon` + `npm test`。

## 9. 还没做的（诚实清单）

- **改分类不会把文件搬到新目录**（任务 #24）。详情面板/待复核里改分类只改库记录，
  磁盘目录不动 —— 实测出现过"卡片写道具/武器、文件夹还在 `材质/MatCap`"。
- **合集的子项没有侧车文件**。整包登记只写库不写盘（§7.1），所以 `.avca.json` 只有独立素材有；
  删库后用「从侧车重建」捞不回合集树。
- **LLM 兜底（§5.5）**：默认关闭，完全未实现。
- **依赖分析（§2.3）的 UI 展示**：`package_entry`/`dependency` 表和 `findProviderOfGuid` 都在，
  但"此素材依赖 3 个外部资源，2 个在你的库中"这句话还没显示。
- 7z/rar 内层包的按需单读只做了 zip；7z/rar 走整包解压那条路（设置里开自动解压）。
- 日文产品名（如 `束縛チャイナ`）词典里没有对应词，这类素材目前靠待复核 + 学习机制兜，
  不猜。
- Unity 导入（改动单 §4 里合集的「整包导入」「只勾某个版本导入」）还没接 —— 桥接是 M5-A 的活，
  界面上这些按钮现在是**禁用 + 说明**状态，没有假装能用。

（原清单里的"聚合视图与变体徽章""已学规则提示条""词典管理界面"三条已经在 M4 做掉了。）

