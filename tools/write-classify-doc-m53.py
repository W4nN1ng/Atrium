r"""往 docs/CLASSIFY.md 里补改动单 2 那批规则（§3 归并键之后、§4 合集之前）。幂等。"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'docs', 'CLASSIFY.md')

SEC = """## 3.5 方括号变体槽位与附属资源（增量改动单 2）

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

"""


def main() -> None:
    s = io.open(P, encoding='utf-8').read()
    if '## 3.5 方括号变体槽位' in s:
        print('already present')
        return
    anchor = '## 4. 合集：三级模型，不拆成顶层素材'
    if anchor not in s:
        raise SystemExit('anchor missing')
    s = s.replace(anchor, SEC + anchor)
    io.open(P, 'w', encoding='utf-8', newline='').write(s)
    print('inserted')


if __name__ == '__main__':
    main()
