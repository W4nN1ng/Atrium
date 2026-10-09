# -*- coding: utf-8 -*-
r"""
修 tests/library/health.spec.ts 被上一次批量替换脚本误伤的 7 行。

起因：我用"含 i.path 且含 replace"当匹配条件去定位自己新写的那一行，
结果把文件里原有的 7 行 `const paths = items.map(...)` 一起替换掉了 ——
声明的左半边（`const paths = `）没了，测试直接语法崩。
教训：**批量替换前必须把匹配条件收到唯一，别按"看起来像"扫。**

顺手把 `.replace(/\\/g, '/')` 换成 `.split(path.sep).join('/')` —— 同样的意思，
但不用在 python/bash 两层里数反斜杠（这台机器上这写法已经翻过三次车）。
"""
import io
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
P = os.path.join(ROOT, 'tests', 'library', 'health.spec.ts')


def R(expr_root):
    return "items.map((i) => path.relative(%s, i.path).split(path.sep).join('/'))" % expr_root


FIX = {
    124: '    const paths = ' + R('lib'),
    142: '    const paths = findStrays(d, []).items.map((i) => path.relative(d, i.path).split(path.sep).join(\'/\'))',
    154: '    const only = findStrays(d, [], { under: path.join(d, 贴图PLACEHOLDER) }).' + R('d'),
    157: '    const both = findStrays(d, [], {}).' + R('d'),
    212: '    const all = ' + R('d') + ".join('|')",
    234: '    const rel = ' + R('d'),
    246: '    const rel = ' + R('d'),
}
BAD = "      items.map((i) => path.relative(root, i.path).split(path.sep).join('/'))"


def main():
    lines = io.open(P, encoding='utf-8').read().split('\n')
    for n, want in sorted(FIX.items()):
        i = n - 1
        if '贴图PLACEHOLDER' in want:
            want = want.replace('贴图PLACEHOLDER', "'贴图'")
        if lines[i] != BAD:
            print('跳过 %d：内容不是预期的坏行 -> %r' % (n, lines[i][:60]))
            continue
        lines[i] = want
        print('修好 %d: %s' % (n, want.strip()[:78]))
    io.open(P, 'w', encoding='utf-8', newline='').write('\n'.join(lines))


if __name__ == '__main__':
    main()
