# P6-D 旧式迁移、备份/迁移 UI 与真机

> ⚠️ **UI 部分已被 `../VPM-UX-RESET.md` 取代（2026-10-22）**：本卡只保留服务层要求，
> 界面按 UX-RESET 的 R1–R7 施工；两处冲突时以 UX-RESET 为准。


> 阶段规格：`../VPM-P6.md`（只读 §9、§10）
> 任务板：`../../VPM-TASKS.md` · 共同规则：`../_COMMON.md` · 架构合同：`../../VPM-ARCHITECTURE.md`
> 前置：P2-B、P6-C
> 覆盖对账项：B18 / E8 / K4 / K5
> 建议上下文：≤ 35k tokens

## 目标

- 把 P2 的 legacy 报告变成引导式迁移：备份→事务→移入 Packages→清理旧副本（进 vault）。
- 覆盖常见 VPM legacy；Unity 2022/SDK 特例单独验证，不做“一键全自动”。
- 补备份/复制/换版本/迁移 UI 与真 Unity 验证。

## 不做什么

- 不迁移未知/不信任的包。
- 不覆盖已有包、不永久删旧资源。
- 不承诺所有 Unity 版本。

## 必读（只读这些）

- `docs/VPM-ARCHITECTURE.md` §5、§7.1、§10.4
- `docs/prompts/VPM-P6.md` §9、§10
- `docs/VPM-IMPLEMENTATION-GUIDE.md` §6.2
- `domain/project.ts`、`install/transaction.ts`

## 文件所有权

- 新增：`src/main/vpm/backup/migrate.ts`、IPC、UI
- 修改：工程详情/维护区
- 新增：`tests/vpm/backup/migrate.spec.ts`、E2E 记录

## 交付物

- 迁移计划/确认/备份/事务/回滚；旧副本进 vault。
- 备份/迁移前拿工程活动租约；素材写入进行中拒绝；旧 Assets 清理不碰导入资产/桥接包。
- Unity 2022 特例的检测与“未验证”边界。
- 备份/复制/换版本/迁移 UI；进度/取消/错误。
- 真 Unity 迁移验证。

## 施工步骤

1. 先做迁移计划与拒绝矩阵。
2. 接备份与事务。
3. 做 UI 与确认。
4. 真 Unity 验证常见 legacy。
5. 把已知差异写进 README/对账。

## 契约与不变量

- 迁移前必须备份；失败可回滚。
- 备份/迁移/换版本与素材导入互斥；桥接包和 `import_log` 资产保留。
- 排除 VPM 包备份时，`com.avca.bridge` 不得被静默丢掉；恢复后要能自动补装。
- 旧资源不永久删。
- 未知包不自动迁移。

## 测试与证据

- legacy 检测/计划/迁移/回滚。
- Unity 运行/未知包/覆盖冲突拒绝。
- 真 Unity 验证 + 全量测试/typecheck。

## 完成定义

- P6 门禁全过。
- 迁移差异/未验证写入文档。
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
