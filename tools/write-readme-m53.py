r"""
把 M5-3（增量改动单 2）的成果写进 README。
只改两处：进度那行标题 + 在 M5-2 实录之后插入一节。用脚本是因为 CJK 内容
经 bash heredoc 会被改坏（这个项目里踩过好几次）。幂等：已经有 M5-3 标题就不再插。
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'README.md')

NEW_SECTION = """### M5-3：附属资源识别 + 分组卡片化浏览（增量改动单 2，2026-10-05 傍晚）

**这一节改的是"库里到底该有几张卡"。** 上一版把介绍图、演示视频、`.cs` 脚本、`.DS_Store`
都当成独立素材扫进了库，一屏里 4 张卡有 3 张是垃圾；同一件衣服的 20 个模型适配版
也只并上了词表认识的 8+2 个，剩下 10 个零散着。

规则层（`src/shared/junk.ts`、`src/main/fingerprint/primary.ts`、`src/shared/naming.ts`、
`src/main/classify/groupKey.ts`）：

- **垃圾过滤进了三处**，少一处都会从别的门灌进来：游离扫描 `findStrays`、
  目录遍历 `listTree`（顺带管住解压后的暂存目录）、压缩包内层清单（worker 读完就过）。
  默认设置是不解压，所以第三条是唯一能拦住 `__MACOSX/` 碎片的口子。
- **主体 / 附属**（§A2）：unitypackage > 完整 Unity 工程 > UPM 包 > 含 prefab·mat·shader·fbx
  的目录 > 压缩包。附属资源落成 `parent=主体 + attachment_kind` 的子行：
  不进库的第一层、不计入素材总数、不参与合集判定，但详情页列得出来、导入能单独勾选。
  不是"隐藏卡片"—— 统计口径和列表 SQL 都把它挡在外面。
- **结构层收口**（§A5）：`{分类}/{二级}` 那种库结构目录，如果里面**平铺**着
  全是脚本（或全是图/文档），整棵报一条，不再散成 N 张卡。
  `flat` 那道闸不能省：`贴图/lime/Custom skin/a.png` 必须照旧报到 `Custom skin` 那一层。
- **取名与版本**（§A3/§A4）：UUID 和长 hex **在提版本号之前**就剥掉。
  原先只在 `cleanDisplayName` 里剥了，`deriveGroupKey` 没剥，于是真库那张
  `d6b99874-… base resized.jpg` 的名字修好了、版本号还是从 UUID 里咬出来的
  `99874-3687-4746-8e`。同一个规则两份实现必然漂走，现在收成了
  `shared/naming.stripIdLike()` 一处，两边共用。
- **方括号变体槽位**（§B2）：`Libero[Shinano_ATTITUDE The Royal Bunny]_1.0` 里
  方括号就是变体位，整段不参与 groupKey；括号里的 `<模型>_<系列>` 结构
  第一段当模型位摘掉，系列名参与 groupKey（不同系列不许被误并）。
  词表认不认识**只决定徽章上写什么，不决定并不并** —— 这是验收 6 能在真库上成立的原因。
- **复合模型名**（§B3）：`Chiffon&Chocolat` 按 `& ＆ + ＋ 、 , ，` 拆；
  真库里还有一个把 `&` 写丢了的 `KipfelMame`，所以补了驼峰拆，
  且**只有每一段都命中词表才拆**（否则 `FaceAnimation` 会被劈成两半、groupKey 再也拼不回去）。

界面层：容器进入式浏览（面包屑可点、Esc 返回、Ctrl+A 全选、Enter 导入、
容器内独立搜索 + 按模型/按版本分组 + 模型徽章 + 附属资源分区）、
§B5 同前缀建议合并横幅（**只建议不自动并**，三个按钮：合并并进入 / 查看这 N 个 / 不再提示）、
§B4「从库中学习模型名」面板。

## 我对改动单 2 做的三处偏离（都是被真数据逼的，等裁）

1. **§B2 的"括号内容不超过全名 70%"改成只在单位段时生效。** 按原文无条件套用的话，
   §B0 那 20 个文件名里就有 4 个过不去（`Libero[Chiffon&Chocolat_ATTITUDE The Royal Bunny]_1.01`
   是 40/53 = 75%）—— 用他自己给的例子验他自己的规则，验收 6 直接不成立。
   括号里有 `_` 分成 `<模型>_<系列>` 两段这件事本身就证明它是变体位，所以多段只过"括号外 ≥2 字"那道闸。
2. **系列名只取头一个词进 groupKey。** 真库 19 个写的是 `_ATTITUDE The Royal Bunny]`，
   但 `Libero[KipfelMame_ATTITUDE]_1.00` 那个被截短成 `ATTITUDE`；整串留着的话这一个就并不上去。
   系列名几乎总是在第一个词上就分得开，截到头词既不丢"不同系列不许误并"的保护又能容错。
3. **§B4「出现频次 ≥3」在真库上一条都捞不到**（实测），因为 20 个 Libero 是 20 个不同模型
   各出现 1 次。改成两条判据：单名 ≥3 次 **或** 同一系列下候选名 ≥3 个。
   真库靠的是第二条，扫出来 24 个名字（`tools/scan-avatar-tokens.cjs` 留了输出）。

**另外一处规则冲突，我按改动单 1 的旧裁定走了：** §B5 说 `TwinkleSpica` 那 6 个"不自动合并"，
但 §B4 又要求把 `Eku / Ramune` 补进 avatar 词表；补进去之后按改动单 1 §2.3
「只有差异 token 命中已知词表时才算变体」它们就该并。两条对同一批文件给了相反答案。
我按 §2.3 走（Grimoir 那 11 个的既有裁定就是这个口径），§B5 担心的"配色被当成模型"
靠词表区分 —— 真库 `衣服TwinkleSpica` 19 个里 15 个模型名并成一组，
`Mint / Plum / Milk / Karin` 四个词表不认的各自独立。**要不要反过来，等你裁。**

## 顺手修掉的一个真 bug：容器体积被算成 869 GB

真库那条 `插件道具合集-初音的VRC小店` 存的是 **869.84 GB**，而整个库才 24.3 GB（实测）。
根因在入库：`unitFromModel` 给每个子项兜底用了 `res.sizeBytes` = **整个容器的体积**，
于是 17 个子项各背一遍整包大小，容器那一行再把它们加起来 —— 17 倍，嵌套就是 17²。
改成传子项自己的版本之和；`重新分析` 里也加了体积重算，但**只量目录、文件一律不动**：
压缩包型合集的成员行，`library_path` 指的是那个 `.rar` 自己，按文件量会把每个成员
都改成整包 300 MB（库里存的 4.1 MB 才是对的）。这条是写的时候发现的，不修更错。

## 重新分析（§交付 4）：按下之前先看到影响条数

`设置 → 维护 → 重新分析已入库的数据`。第一个按钮只跑预览，报
"扫描 N 条 → 会影响 M 条（改名 K）+ 垃圾记录 J 条 + 前 50 条明细"，点了第二个才写库。
只 UPDATE 列，**一个文件都不移动**；写 `reanalyze` 那条 journal，Ctrl+Z 整批退回旧值
（存的是旧值，不是"撤销时再算一遍"）。

真库实测（2026-10-05，跑在 `%APPDATA%\\A\\library.db` 的**副本**上）：

```
真库副本：asset 373 行 / 素材 154 / 容器 5 / 子项 156 / 附属 0 / 待复核 59
重新分析预览：扫描 373 条 → 会影响 174 条（改名 82，体积重算 39）；
             名字里还挂着 UUID 4 条；垃圾记录 1 条（.DS_Store）
```

**改名这条有闸门**：只在当前名字确实是垃圾（UUID / 长 hex / 还挂着扩展名 /
`.0版本` 那种残骸）时才提议。不加这道闸，`FREE無料-PoseAnimationShinano` 会被
换成从 raw_name 直译出来的 `Shinano100Type ❥ Face&Pose Animations ⌖ ݁˚` ——
那是引擎（或用户手改）挑过的名字，一次"重新分析"就冲掉了。加上闸门之后
"改名"从 219 条降到 82 条，且剩下的全是真垃圾。

**分类（category/subcategory）不在重算范围内**，一个都不碰。要重跑分类请走
「重新整理合集」+ 收件箱重新登记。附属资源识别也不在这里补 ——
那需要重新扫目录（`splitContainer` 要读文件清单），而"重新扫 + 登记"正是收件箱那条路，
硬在重新分析里补会绕开预览和撤销。所以：**要让介绍图真正变成附属行，得清掉收件箱重新登记一次。**

"""


def main() -> None:
    s = io.open(P, encoding='utf-8').read()
    if '### M5-3：附属资源识别' in s:
        print('M5-3 section already present, skipped insert')
    else:
        anchor = '## 数据放在哪'
        if anchor not in s:
            raise SystemExit('anchor not found: ' + anchor)
        s = s.replace(anchor, NEW_SECTION + anchor)
        print('M5-3 section inserted')

    old_title = '## 当前进度：**M4 完成，M5-1/M5-2 完成（三级合集模型 + 一键入库），真库 151 项在收件箱等确认**'
    new_title = ('## 当前进度：**M4 完成，M5-1/M5-2/M5-3 完成（三级容器 + 一键入库 + 附属资源与分组卡片），'
                 '真库 151 项在收件箱等确认；491 项测试全绿')
    if old_title in s:
        s = s.replace(old_title, new_title)
        print('progress line updated')
    elif new_title in s:
        print('progress line already updated')
    else:
        print('WARN: progress line matched neither old nor new — 手工检查 README')

    io.open(P, 'w', encoding='utf-8', newline='').write(s)


if __name__ == '__main__':
    main()
