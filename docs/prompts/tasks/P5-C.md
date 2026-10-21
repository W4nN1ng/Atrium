# P5-C unitypackage 读取与模板附件

> 阶段规格：`../VPM-P5.md`（只读 §6）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P5-A
> 覆盖对账项：A11 / I5
> 建议上下文：≤ 25k tokens

## 目标

- 读取 unitypackage（gzip tar，GUID 目录）并安全解包到工程 Assets。
- 保留包内 `.asset`/`.meta` 原样；忽略 preview；不生成/补写 `.meta`。
- 支持模板附件引用与冲突策略（已存在则拒绝/备份）。

## 不做什么

- 不生成 `.meta`、不修改包内资源。
- 不做模板 UI（P5-D）。
- 不接受路径逃逸/超大包。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§10.3
- `docs/prompts/VPM-P5.md` §6
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §7.2
- `P5-A` 的 template schema

## 文件所有权

- 新增：`src/shared/vpm/domain/unitypackage.ts`（解析）
- 新增：`src/main/vpm/unity/unitypackage.ts`（落盘适配器）
- 新增：`tests/vpm/domain/unitypackage.spec.ts` + fixtures

## 交付物

- 解析 pathname/asset/asset.meta，构建目标路径。
- 安全落盘（路径归一/冲突/符号链接拒绝）。
- meta 原样搬运；preview 忽略。
- 模板附件清单与安装步骤。

## 施工步骤

1. 造最小 unitypackage fixture（含 meta）。
2. 实现纯解析与路径安全。
3. 实现落盘/冲突/回滚。
4. 接模板附件清单。
5. 写“不手写 meta”回归测试。

## 契约与不变量

- 不生成/改写 `.meta`。
- 目标必须在 Assets 下；不覆盖未确认文件。
- 解包失败不留半套资源。

## 测试与证据

- 正常包/缺 meta/路径逃逸/冲突/超大。
- meta 字节保持一致。
- 模板附件只装清单内文件。
- 全量测试/typecheck。

## 完成定义

- 真 Unity 能识别导入的资源（P5-D 验证）。
- 代码里没有写 `.meta` 的路径。
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
