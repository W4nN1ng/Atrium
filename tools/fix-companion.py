r"""
真库跑出来的两个缺陷要一起修（见 tests/real/real-library.spec.ts）：
  1) `.cs.meta` 这类伴生文件没被算进"代码"，于是纯脚本目录的 codeOnly 判定落空，
     `E:\vrc\A\Editor\` 又会散成 4 张卡（验收 4）。
  2) 伴生判定原先在 health.ts 里写了一份、primary.ts 里根本没写 —— 这次收到 shared/junk.ts 一处。

用法：python tools/fix-companion.py
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def patch(rel, pairs):
    p = os.path.join(ROOT, rel)
    s = io.open(p, encoding='utf-8').read()
    for old, new in pairs:
        n = s.count(old)
        if n != 1:
            raise SystemExit('FAIL %s: found %d occurrences of %r' % (rel, n, old[:70]))
        s = s.replace(old, new)
    io.open(p, 'w', encoding='utf-8', newline='').write(s)
    print('patched', rel)


# ---------------------------------------------------------------- 1) shared/junk.ts
patch(os.path.join('src', 'shared', 'junk.ts'), [
    (
        r"""/** 压缩包壳（§A2 优先级 4：主体可能在里面，得先 dig 一层再判） */""",
        r"""/**
 * 脚本/包的伴生文件：跟着 .cs 一起算「代码」，不算"别的东西"。
 *
 * 真库 `E:\vrc\A\Editor\` 里是 2 个 .cs 加 2 个 .cs.meta（实读）。少这一条，
 * .meta 会让 codeOnly 判定落空，那一个目录又散成 4 张卡 —— 验收 4 说的就是它。
 *
 * 判定只写在这一处：原先 health.contentKind 里自己有一份、primary.splitContainer
 * 里压根没有，同一个目录会出现"一处算 code、一处算 mixed"的分歧。
 */
const COMPANION_EXT_RE =
  /\.(json|meta|xml|ya?ml|asmdef|asmref|hlsl|cginc|glsl|shadersubgraph|uxml|uss|ini|cfg|config|props|targets)$/i

export function isCompanionFileName(name: string): boolean {
  return COMPANION_EXT_RE.test(name)
}

/** 压缩包壳（§A2 优先级 4：主体可能在里面，得先 dig 一层再判） */""",
    ),
])

# ---------------------------------------------------------------- 2) primary.ts
patch(os.path.join('src', 'main', 'fingerprint', 'primary.ts'), [
    (
        "  attachmentKindOf,\n  isArchiveFileName,",
        "  attachmentKindOf,\n  isArchiveFileName,\n  isCompanionFileName,",
    ),
    (
        """    if (isPrimaryFileName(base(e.relPath))) primaries.push(e)
    else if (isCodeFileName(base(e.relPath))) codes.push(e)""",
        """    if (isPrimaryFileName(base(e.relPath))) primaries.push(e)
    /** .cs.meta / package.json 跟着脚本一起走，不然纯脚本目录会因为多了几个 .meta 而散开 */
    else if (isCodeFileName(base(e.relPath)) || isCompanionFileName(base(e.relPath))) codes.push(e)""",
    ),
])

# ---------------------------------------------------------------- 3) health.ts
patch(os.path.join('src', 'main', 'library', 'health.ts'), [
    (
        "import { attachmentKindOf, isArchiveFileName, isCodeFileName, isJunkSegment, isPrimaryFileName } from '../../shared/junk'",
        "import { attachmentKindOf, isArchiveFileName, isCodeFileName, isCompanionFileName, isJunkSegment, isPrimaryFileName } from '../../shared/junk'",
    ),
    (
        """/** 脚本/包的伴生文件：跟着 .cs 一起算 code，不算"别的东西" */
const COMPANION_RE = /\\.(json|meta|xml|ya?ml|asmdef|asmref|hlsl|cginc|glsl|shadersubgraph|uxml|uss|ini|cfg|config|props|targets)$/i

""",
        "",
    ),
    (
        "      if (isCodeFileName(e.name) || COMPANION_RE.test(e.name)) code++",
        "      if (isCodeFileName(e.name) || isCompanionFileName(e.name)) code++",
    ),
])

print('all patches applied')
