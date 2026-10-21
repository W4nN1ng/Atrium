# P7-D VCC 只读导入与模板导入导出

> 阶段规格：`../VPM-P7.md`（只读 §6）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P2-C、P5-A
> 覆盖对账项：C12 / F2 / F3 / F4 / F5 / F8 / A9 / A10
> 建议上下文：≤ 35k tokens

## 目标

- 只读 VCC `settings.json` 的 userRepos/userPackageFolders/Unity 提示；去重、验证后使用。
- 可选只读 VCC 模板（LiteDB），失败给错误码，不写回。
- 导入 `.alcomtemplate`（只导入，不注册全局关联）；导出 Atrium 自有模板。

## 不做什么

- 不写 VCC settings/LiteDB，不注册 `.alcomtemplate` 全局关联。
- 不复制 VCC/ALCOM 模板资产。
- 不默认信任 VCC 里的未知路径。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§9
- `docs/prompts/VPM-P7.md` §6
- `docs/VPM-CLEANROOM.md` §3.3/§6
- `domain/template.ts`、`interop/`

## 文件所有权

- 新增：`src/main/vpm/interop/vcc.ts`、`interop/templateIO.ts`
- 新增：IPC/UI 导入入口
- 新增：`tests/vpm/interop/vcc.spec.ts`、`templateIO.spec.ts`

## 交付物

- VCC settings 只读解析/去重/校验；坏文件错误码。
- 可选 LiteDB 只读适配（不存在则跳过）；绝不写。
- `.alcomtemplate` 导入（文件选择/拖入）；Atrium 模板导出。
- 导入确认/来源提示/失败回滚。

## 施工步骤

1. 先做 VCC settings 只读 fixture 测试。
2. 实现仓库/用户包/Unity 提示导入。
3. 实现模板导入/导出（自有格式）。
4. 可选 LiteDB 只读，失败降级。
5. 写“绝不写 VCC”的静态/集成测试。

## 契约与不变量

- VCC 文件零写入。
- 模板导入不复制品牌/资产。
- .alcomtemplate 不做全局文件关联。

## 测试与证据

- VCC settings 正常/坏/缺字段/去重。
- 模板导入/导出/坏文件。
- 无 VCC 写入调用。
- 全量测试/typecheck。

## 完成定义

- VCC 只读导入可用且有证据。
- 模板互操作不引入侵权资产。
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
