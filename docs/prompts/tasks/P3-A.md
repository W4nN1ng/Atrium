# P3-A 版本、范围、Unity 兼容纯逻辑

> 阶段规格：`../VPM-P3.md`（只读 §4.1）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-B
> 覆盖对账项：B10 / B12 / B16
> 建议上下文：≤ 25k tokens

## 目标

- 实现 VPM 版本/范围/Unity 版本/包名的纯解析与比较。
- 严格处理预发布、build 元数据、部分 Unity 版本、f/p/c 变体。
- 非法/不支持的范围明确报错，不猜；所有输入有长度上限。

## 不做什么

- 不做解析器、不读仓库、不写 DB。
- 不引入重型依赖；能用小函数就不用库。
- 不做 Unity 安装/启动。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §3、§6.3、§10
- `docs/prompts/VPM-P3.md` §4.1
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §2.2
- `src/shared/vpm/errors.ts`

## 文件所有权

- 新增：`src/shared/vpm/domain/version.ts`、`range.ts`、`unityVersion.ts`、`packageId.ts`
- 新增：`tests/vpm/domain/version.spec.ts` 等 + golden fixtures
- 新增：`src/shared/vpm/domain/README.md`

## 交付物

- SemVer 2.0 比较（预发布 < 正式，build 不参与）。
- 范围：精确、^ ~ >= <= > < x/*、||、连字符；非法给 code。
- Unity 版本：YYYY.MINOR.PATCH[abfp]N，部分版本；中国版 c 后缀保留显示。
- 包名归一/校验；Windows 保留名/尾点/分隔符拒绝。

## 施工步骤

1. 先写 golden vectors（合法/非法/边界）。
2. 实现 version/range/unityVersion/packageId。
3. 给每个入口加长度/字符防御。
4. 写属性式循环测试（比较反对称/传递性）。
5. 在 README 写语义与不支持项。

## 契约与不变量

- 纯函数，无 IO/时钟/随机。
- 不静默接受不支持的范围写法。
- 比较结果稳定，不受 locale 影响。

## 测试与证据

- golden vectors：版本、范围、Unity 版本、包名。
- 比较性质：a<b 则 b>a；相等传递。
- 非法/超长输入不抛未捕获异常。
- 全量测试/typecheck。

## 完成定义

- 解析语义有文档、有反例、有边界测试。
- 后续 resolver 只依赖这些纯函数。
- 更新 `docs/VPM-TASKS.md`：该任务标为 done（或按实际状态标 blocked/review）。
- PR 含交接段；未验证项明确写出。

## 交接（写进 PR）

```text
Task: <ID>
状态: 完成 / 部分 / 阻塞
公开 API/契约变化: ...
新增/修改模块 README: ...
已验证: ...
未验证: ...
给下一个任务: ...
```

共同质量闸门、沙盒规则、停止规则见 `../_COMMON.md`。
