# 待复核 59 条：只读调查清单（甲轨②）

生成时间 2026-10-05 22:00。数据源 `%APPDATA%\A\library.db`（**只读打开**，`readonly:true`），
文件侧只做了 `stat`，一个字节都没写。复现脚本：`node tools/probe-review59.cjs`。

## 0. 先说机制，不然后面每条都要重复一遍

`needs_review` 的唯一来源是这一行（`src/main/ingest/api.ts:444`）：

```ts
needsReview: batch && confidence < s.confidenceAuto,   // confidenceAuto = 0.75（设置里的"自动归档阈值"）
```

而 `confidence` 不是"引擎的确信度"，是**第一名和第二名的相对差距**（`src/main/classify/engine.ts:295`）：

```ts
confidence = top.score / (top.score + second.score + EPS)
```

所以「待复核 59 条」的准确含义是：**这 59 条里没有任何一条是被判成别的类的，只是第一名赢得不够多**。
实测分布证实了这一点：

| 置信度档 | 条数 |
| --- | --- |
| ≥ 60% | 43 |
| 30–59% | 13 |
| < 30% | 3 |

59 条合计 16.4 GB，占全库 24.32 GB 的 68%（大头是两个顶层容器 + `w830` + 两个材质包目录）。

## 1. 分组清单

| # | 分组（条数） | 是什么 | 为什么被判待复核 | 建议处置 |
| --- | --- | --- | --- | --- |
| G1 | **Holy Spice 系列**（15）<br>`衣服\修女\` | 同一个产品 `Holy Spice` 的 13 个 avatar 版本（Airi/Chocolat/ICHIGO/Manuka/Milfy/Milltina/Moe/Rurune/Selestia/Shinano/Shinra/Sio + LUMINA 联名 1 个）+ `KUMALY Holy Spice Gimmick`。库里另有一张 `Holy Spice Kaguya` 已经是容器形态（2 子项，不在待复核里）—— 同一系列两种形态并存 | 一级 clothing 与第二名 70:30 → 70%，差 5 个点过线；Gimmick 61% | **不用逐条点**。缺的是 avatar 词典：实测用当前词典重算归并键，15 条已经能收进 1 组 13 条 + Gimmick 独立（按已批准的裁定 Gimmick 不许并）。补 `shuan` 一个词就 14/1。之后「按系列整批接受」 |
| G2 | **TwinkleSpica 系列**（22）<br>`衣服\衣服TwinkleSpica\` | 19 个 `TwinkleSpica_<avatar>_v1.x.zip`（其中 Manuka 有 v1.1 和 v1.3 —— 正是一个 Item 两个 Variant 的目标形状）+ `TS_MaterialPack_1/2.zip`（材质包，66%，判成 `材质/包`）+ `Blender1.zip`（Blender 源文件，70%） | 包体里没有二级线索，只有名字里的 avatar 词 → clothing 与第二名 62:38 = 62% | 同上，补 `karin/milk/mint/plum` 四个 avatar 名，实测 19 条能收进 `twinklespica` 一组。`Blender1` 与两个 `TS_MaterialPack` 是这件商品的组成部分，**建议降级为所属产品的附属或挂进同一容器**（属 G3 那类问题） |
| G3 | **结构目录被当成素材**（2）<br>`衣服\27\材质` 1.31 GB<br>`衣服\名流\材质包 PSD` 1.32 GB | 产品内部的材质 / PSD 源文件目录。`材质包 PSD` 底下还套了两层同名容器行（`PSD`、`材质包 PSD`），三条行都写着 1322 MB | 游离扫描的粒度规则只把 `{分类}/{二级}` 当结构，**第三层的 `材质` 就成了一个单元**。分类上它"确实就是材质"，于是被判 `material/-` 32–33% | **要改代码（我这边）**：让合集判定里那条 `STRUCTURE_DIR_RE`（Mesh/Textures/Prefabs/材质/贴图 = 素材内部结构，不算子项）在 `findStrays` 层同样生效，这类目录跟着父产品走，不自立成卡 |
| G4 | **两个顶层大容器**（2）<br>`插件道具合集-初音的VRC小店` 6.60 GB / 135 子项<br>`R5613-VRChat-武器合集（军事武器合集）` 554 MB / 11 子项 | 你自建的两个合集，子项**已经全部拆开了**（135 + 11 行），只是顶层这张卡自己还挂在待复核 | 两条叠加：① `commitBundle` 写的是「任一子项不确定 ⇒ 容器不确定」（`src/main/library/commit.ts:532`），135 个子项里只要有 1 条没把握，这张卡必标待复核 —— **合集卡的待复核状态恒真，没有信息量**；② 类别也是猜的：小店被子项里的音效词带偏成 `音频/语音`，R5613 武器合集在词典里根本没有对应一级，直接 0% | **要改代码（我这边）**：容器行不参与分类、不标 `needs_review`，只显示「含 N 项，其中 M 项待复核」；侧栏计数只数叶子。这一条改完，两个最大的卡就从待复核消失，而它们下面真正没把握的 146 个子项仍然看得见 |
| G5 | **Booth ID 当卡名**（1）<br>`衣服\西装\6447797.rar` 859 MB | 一个 .rar，包已经拆开、里面那层叫 `Noir Luxe`（11 子项，另有一张 `Noir Luxe Material` 238 MB 也在待复核，是同一个系列的材质） | ID 穿透那条规则只作用在**目录**上，判据是 `ID_DIR_RE = /^\d{5,8}$/`（纯数字目录名）。这个商品的"目录"其实是一个以 ID 命名的**文件**，文件名里没有产品名 → 顶层卡只能是 `6447797`，分类证据只剩父目录的 `西装` | 把内层容器名提为顶层显示名（`Noir Luxe`），ID 只留 `source_item_id`。改法是把 ID 穿透的适用范围从"目录名"扩到"单元自身的文件名" |
| G6 | **一个产品两种形态**（2）<br>`衣服\Costume_Pomae_20241024.zip` 345 MB<br>`衣服\shinano\Costume_Pomae_20241024\` 326 MB | 同一个服装，一份 zip、一份已解压目录，分别落在两个目录里 | 归并键其实**算对了**（两条都是 `costume pomae`，在同一个 `asset_group`），但已批准的裁定"同内容的 zip 与解压目录视为一个资产"要靠内容比对：zip 有文件 hash，目录算出来的 hash 天然不同 → 并不成一张卡 | 短期：人工合并（或等 G4 的容器改造后用建议合并条端出来）。长期：给目录做「成员排序后拼接 hash」的目录指纹。这条是 M4 遗留缺口之一 |
| G7 | **代码目录 `Editor\`**（2）<br>`HeadAccessoryMover.cs` 4.7 KB<br>`HeadAccessoryMover.cs.meta` 243 B | 两个编辑器脚本 + 它们的 `.meta`（`.meta` 按规则是 companion，不是垃圾） | `splitContainer` 对这个目录判成 **codeOnly**（`.cs` 不算主体，见 R3 的裁定）→ 没有主体就没有附属可挂，于是 4 个文件成了 2 张顶层卡；名字里的 `HeadAccessory` 又把它分到 `配饰/-` 60% | **要改代码（我这边）**：给 codeOnly 一个明确处置 —— 整个目录合成一张「编辑器脚本」卡，`.cs.meta` 挂为附属。这是「重新分析」降级分支现在的空白区（它只在"恰好有一个主体"时才降级） |
| G8 | **两个小插件包**（2）<br>`FaceEmo1.6.3汉化.unitypackage` 11.8 KB<br>`LightControllerV2.0.3.1.unitypackage` 12.2 KB | 都是真插件，体积小说明只含动画/脚本资源，**不是体积算错**（我核过磁盘） | 一级 `插件` 判对了，二级没定出来 → 60% 档；LightController 31% 是 `插件` 与 `工具软件` 歧义罚过之后的数 | 直接接受（`插件/`）。你在待复核里改一次分类，学习机制下次就记住 |
| G9 | **表情动画**（2）<br>`6117553 Shinano_FaceAnimation.rar.rar` 367 KB 73%<br>`Shinano100Type ❥ Face&Pose Animations ⌖ ݁˚.zip` 1.03 MB 56% | 都是 插件/表情类，判得没错。第一条正是验收点名的那个双 `.rar` 后缀 + Booth ID 件，清洗后展示名干净 | 73% 差 2 个点过线；第二条被判成 bundle + 歧义罚 → 56% | 直接接受，不用改任何东西 |
| G10 | **同一个 Booth 商品拆成 3 张卡**（3）<br>`贴图\6718483Milfy妆容\` 下：<br>`milfy Prism cat eye texture + makeup` 44.9 MB 73%<br>`真实肤质材质球` 2.9 MB 31%<br>`Sexy skin material for VRC 6053463` 98.8 MB 70% | 一个商品（Booth 6718483）的三个组成部分，散在同一目录下，归并键彼此无关（`prism cat eye texture + makeup` / `真实肤质材质球` / `sexy skin material for vrc`） | 目录名 `6718483Milfy妆容` 是"ID + 中文"混排：`ID_DIR_RE` 要求**纯数字**才认，不匹配；`CONTAINER_RE` 里也没有"妆容"这类品类词 → 于是按规则钻到第三层，三个子目录各成一个单元。31% 那条是"材质球"撞了材质证据、人又站在 `贴图/` 底下 | 把 ID 穿透的判据从"纯数字"放宽到"以 5–8 位数字开头"，这类目录就会当成一个容器出一张卡。属于 G5 同一次改动 |
| G11 | **其余落单**（6） | `束縛チャイナFULLSET` 65.7 MB 61%（R3 封顶解除后已认成服装，**判对了**）<br>`Obsidian Shinano` 28.8 MB 31%（黑曜石系列，一级歧义）<br>`Shinano Guidance` 54.2 MB 61%（`Guidance` 无词典线索）<br>`w830` 2.50 GB 62% 判 `头发/-`（名字是 4 字符内部代号，无从判断）<br>`Asterielm MaterialPackage` 355 MB 33%<br>`Noir Luxe Material` 238 MB 33%（两个材质包，判 `材质/-`） | 前四条是证据不足/名字无信息（`w830` 只能靠内容，2.5 GB 的目录值得你亲眼看一下再定）；后两条材质包是 `材质` 与 `服装` 一级歧义罚到 33% | `束縛チャイナ` 直接接受。`Asterielm/Noir Luxe Material` 建议接受为 `材质/包`（和 TS_MaterialPack 同档）。`w830` / `Obsidian` / `Guidance` 三条真的需要你点一眼 |

合计 15+22+2+2+1+2+2+2+2+3+6 = **59** ✓

## 2. 按"要谁动手"再归一次类

| 处置动作 | 组 | 条数 |
| --- | --- | --- |
| **不用动手，直接批量接受**（判对了、只差过线） | G8、G9、G11 里的束縛チャイ娜 + 两个材质包、G1 里的 `KUMALY Holy Spice Gimmick`（按裁定本来就该独立） | 8 |
| **补 5 个 avatar 词（shuan / karin / milk / mint / plum）后各收成 1 张系列卡** | G1 的 14 条、G2 的 19 条 | 33 |
| **要我改代码才变得合理**（收编粒度、容器语义、codeOnly） | G3、G4、G5、G7、G10，加上 G2 里的 `Blender1` + `TS_MaterialPack_1/2`（它们是那件产品的组成部分） | 13 |
| **需要你看一眼**（名字无信息、或两份形态要人工并） | G6 的 2 条 + G11 里的 w830 / Obsidian / Guidance | 5 |

8 + 33 + 13 + 5 = 59 ✓

33 / 59 是**一个词典缺口**，不是判断力问题（实测：拿当前词典重算归并键，
`twinklespica` 已经能从 12 条并到 15 条、`holy spice` 从 10 条并到 13 条，
补满那 5 个词就是 19 和 14）。剩下 13 条集中指向同一个病根：
**收编扫描把"素材内部结构"当成了"素材"**（G3 材质目录、G5 ID 文件、G7 codeOnly、G10 ID+中文目录），
以及**容器行不该参与置信度**（G4）。

## 3. 这次没有改任何东西

只读调查，未动产品代码、未动库、未动盘。上面「要改代码」的四类是**建议**，等你点头再排进甲轨③④或 R0。
唯一新增的文件是调查脚本 `tools/probe-review59.cjs`（只读 SELECT + 打印，可重跑）。
