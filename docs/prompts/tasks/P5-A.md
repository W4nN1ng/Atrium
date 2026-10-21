# P5-A 模板格式、存储与原创内置模板

> 阶段规格：`../VPM-P5.md`（只读 §4）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P1-B
> 覆盖对账项：A4 / A5 / A6 / A7 / A8 / A11
> 建议上下文：≤ 25k tokens

## 目标

- 定义 Atrium 自有模板格式（版本化、base 继承、依赖范围、附件引用）。
- 实现模板存储/校验/列表/新增/编辑/复制/删除引用（收藏、最近；删引用不删文件）。
- 提供原创空白/角色/世界模板：只含最小工程骨架 + 官方包依赖，不含第三方资产。

## 不做什么

- 不复制 ALCOM 模板/资产/描述。
- 不做建工程/附件解包（P5-B/C）。
- 不做模板 UI（P5-D）。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§6
- `docs/prompts/VPM-P5.md` §4
- `docs/VPM-CLEANROOM.md` §3.3
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §7.2

## 文件所有权

- 新增：`src/shared/vpm/domain/template.ts`、`src/main/vpm/templates/`
- 新增：`tests/vpm/domain/template.spec.ts`、`tests/vpm/templates/*.spec.ts`
- 新增：`src/main/vpm/templates/README.md`

## 交付物

- 模板 schema + `schemaVersion` + base 继承/范围交集。
- 存储位置（非 C 数据根/设置目录）与原子写。
- 内置模板清单：空白/角色/世界，依赖只写包 ID + 范围。
- 列表/新增/编辑/复制/收藏/最近/删除引用（不删文件）。

## 施工步骤

1. 定义 schema 与校验。
2. 实现存储/列表/收藏/最近。
3. 实现 base 继承与范围校验。
4. 写原创内置模板（无资产）。
5. 测试非法/循环继承/缺失 base。

## 契约与不变量

- 模板不含第三方美术/场景/材质/图标。
- 删除模板默认不永久删文件。
- 未知字段保留；schemaVersion 必须校验。

## 测试与证据

- schema/继承/循环/范围交集。
- 存储原子写/坏文件/新增/编辑/复制/收藏/最近。
- 内置模板依赖合法且无资产。
- 全量测试/typecheck。

## 完成定义

- 模板格式有文档/版本/迁移策略。
- 内置模板可被建工程消费。
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
